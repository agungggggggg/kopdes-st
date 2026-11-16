// =====================================================================
// ROUTE ADMIN PUSAT - katalog induk, broadcast harga, 2PC, antrean
// mutasi, penerimaan PO. Seluruh /api/admin/* hanya ADMIN_PUSAT.
//   GET    /api/admin/products            -> katalog penuh + stok per node
//   POST   /api/admin/products            -> produk baru + stok awal (NODE-1:100, lain:20)
//   PUT    /api/admin/products/:barcode   -> update; harga berubah -> broadcast 5 node
//   DELETE /api/admin/products/:barcode   -> hapus produk
//   POST   /api/admin/broadcast           -> siarkan harga (broadcast_harga + outbox)
//   GET    /api/admin/broadcasts          -> riwayat broadcast
//   GET    /api/admin/matrix              -> matriks stok per node
//   POST   /api/admin/2pc/execute         -> jalankan Two-Phase Commit
//   GET    /api/admin/mutasi-queue        -> antrean mutasi PENDING
//   GET    /api/admin/inbound             -> riwayat penerimaan PO
//   POST   /api/admin/inbound             -> terima PO: stok NODE-1 += lolos
// =====================================================================
const express = require('express');
const { query, queryOne, withTransaction, logAudit, getKaryawan } = require('../config/db');
const HttpError = require('../middleware/httpError');
const { requireRole } = require('../middleware/auth');
const { execute2pc } = require('../services/2pc.service');

const router = express.Router();

// Guard role untuk SEMUA endpoint di file ini
router.use(requireRole('ADMIN_PUSAT'));

// Nama aktor utk audit (JWT hanya menyimpan kode)
async function aktorDari(req) {
  const k = await getKaryawan(req.user.sub);
  return { sub: req.user.sub, nama: k ? k.nama : null };
}

// Katalog + matriks stok per node (dipakai GET /admin/products & /admin/matrix)
async function fetchKatalog() {
  const produk = await query(
    'SELECT barcode, nama, kategori, origin, satuan, hpp, harga_jual FROM produk ORDER BY barcode'
  );
  const cabang = await query('SELECT kode FROM cabang ORDER BY id');
  const stokRows = await query('SELECT barcode, cabang_kode, qty FROM stok_cabang');
  const stocks = {};
  for (const p of produk) {
    stocks[p.barcode] = {};
    for (const c of cabang) stocks[p.barcode][c.kode] = 0;
  }
  for (const s of stokRows) {
    if (stocks[s.barcode]) stocks[s.barcode][s.cabang_kode] = s.qty;
  }
  return produk.map(p => {
    const stocksP = stocks[p.barcode];
    const total = Object.values(stocksP).reduce((a, b) => a + Number(b || 0), 0);
    return { ...p, stocks: stocksP, total };
  });
}

// Tulis broadcast_harga + outbox_sync utk kelima node (status NEW).
// Dipakai bersama oleh PUT harga & POST broadcast (satu semantik, satu tempat).
async function siarkanHarga(conn, { barcode, nama, hargaLama, hargaBaru, sumber, oleh }) {
  await conn.query(
    'INSERT INTO broadcast_harga (barcode, nama, harga_lama, harga_baru, sumber, waktu, oleh) VALUES (?,?,?,?,?,NOW(),?)',
    [barcode, nama, hargaLama, hargaBaru, sumber, oleh]
  );
  const nodes = (await conn.query('SELECT kode FROM cabang ORDER BY id'))[0];
  for (const c of nodes) {
    await conn.query(
      `INSERT INTO outbox_sync (agregat, agregat_id, cabang_kode, payload, status, created_at)
       VALUES ('BROADCAST', ?, ?, ?, 'NEW', NOW())`,
      [barcode, c.kode, JSON.stringify({ tipe: 'BROADCAST_HARGA', barcode, harga_baru: hargaBaru })]
    );
  }
}

// GET /api/admin/products - katalog penuh
router.get('/products', async (req, res) => {
  res.json(await fetchKatalog());
});

// GET /api/admin/matrix - matriks stok 5 node + total
router.get('/matrix', async (req, res) => {
  const rows = await fetchKatalog();
  res.json(rows.map(p => ({ barcode: p.barcode, nama: p.nama, satuan: p.satuan, stocks: p.stocks, total: p.total })));
});

// POST /api/admin/products - produk baru + stok awal (NODE-1: 100, gerai: 20)
router.post('/products', async (req, res) => {
  const { barcode, nama, kategori, origin, satuan, hpp, harga_jual } = req.body || {};
  if (!barcode || !nama || !satuan) throw new HttpError(400, 'barcode, nama, dan satuan wajib diisi');
  const nHpp = Number(hpp);
  const nJual = Number(harga_jual);
  if (!Number.isFinite(nHpp) || nHpp < 0 || !Number.isFinite(nJual) || nJual < 0) {
    throw new HttpError(400, 'hpp dan harga_jual harus angka >= 0');
  }
  if (await queryOne('SELECT barcode FROM produk WHERE barcode = ?', [barcode])) {
    throw new HttpError(409, `Produk ${barcode} sudah ada di katalog`);
  }
  const aktor = await aktorDari(req);
  await withTransaction(async (conn) => {
    await conn.query(
      'INSERT INTO produk (barcode, nama, kategori, origin, satuan, hpp, harga_jual) VALUES (?,?,?,?,?,?,?)',
      [barcode, nama, kategori || 'Sembako', origin || 'Pabrikan', satuan, Math.round(nHpp), Math.round(nJual)]
    );
    const nodes = (await conn.query('SELECT kode FROM cabang ORDER BY id'))[0];
    for (const c of nodes) {
      await conn.query(
        'INSERT INTO stok_cabang (cabang_kode, barcode, qty) VALUES (?,?,?)',
        [c.kode, barcode, c.kode === 'NODE-1' ? 100 : 20]
      );
    }
    await logAudit(conn, {
      aktorKode: aktor.sub,
      aktorNama: aktor.nama,
      tipe: 'PRODUK_BARU',
      detail: `Produk baru ${nama} (${barcode}) Rp ${Math.round(nJual)} + stok awal 5 node (100/20)`,
      node: 'NODE-1',
    });
  });
  res.status(201).json({ ok: true, barcode });
});

// PUT /api/admin/products/:barcode - update data; harga berubah -> broadcast 5 node
router.put('/products/:barcode', async (req, res) => {
  const bc = req.params.barcode;
  const { nama, kategori, hpp, harga_jual } = req.body || {};
  const prod = await queryOne('SELECT barcode, nama, harga_jual FROM produk WHERE barcode = ?', [bc]);
  if (!prod) throw new HttpError(404, `Produk ${bc} tidak ditemukan`);

  const sets = [];
  const params = [];
  let hargaBaru = null;
  if (nama !== undefined) { sets.push('nama = ?'); params.push(String(nama)); }
  if (kategori !== undefined) { sets.push('kategori = ?'); params.push(String(kategori)); }
  if (hpp !== undefined) {
    const v = Number(hpp);
    if (!Number.isFinite(v) || v < 0) throw new HttpError(400, 'hpp harus angka >= 0');
    sets.push('hpp = ?'); params.push(Math.round(v));
  }
  if (harga_jual !== undefined) {
    const v = Number(harga_jual);
    if (!Number.isFinite(v) || v < 0) throw new HttpError(400, 'harga_jual harus angka >= 0');
    hargaBaru = Math.round(v);
    sets.push('harga_jual = ?'); params.push(hargaBaru);
  }
  if (!sets.length) throw new HttpError(400, 'Tidak ada field utk diubah (nama/kategori/hpp/harga_jual)');

  const hargaBerubah = hargaBaru !== null && hargaBaru !== prod.harga_jual;
  const aktor = await aktorDari(req);
  await withTransaction(async (conn) => {
    await conn.query(`UPDATE produk SET ${sets.join(', ')} WHERE barcode = ?`, [...params, bc]);
    if (hargaBerubah) {
      // Harga nasional berubah -> catat broadcast + outbox utk kelima node
      await siarkanHarga(conn, {
        barcode: bc, nama: prod.nama, hargaLama: prod.harga_jual, hargaBaru,
        sumber: 'UPDATE_HARGA', oleh: aktor.sub,
      });
    }
    await logAudit(conn, {
      aktorKode: aktor.sub,
      aktorNama: aktor.nama,
      tipe: hargaBerubah ? 'BROADCAST_HARGA' : 'PRODUK_UPDATE',
      detail: hargaBerubah
        ? `Update produk ${prod.nama} (${bc}): harga ${prod.harga_jual} -> ${hargaBaru}, disiarkan ke 5 node`
        : `Update data produk ${prod.nama} (${bc})`,
      node: 'NODE-1',
    });
  });
  res.json({ ok: true, barcode: bc, harga_jual: hargaBaru !== null ? hargaBaru : prod.harga_jual, broadcast: hargaBerubah });
});

// DELETE /api/admin/products/:barcode - hapus produk + baris stoknya
router.delete('/products/:barcode', async (req, res) => {
  const bc = req.params.barcode;
  const prod = await queryOne('SELECT barcode, nama FROM produk WHERE barcode = ?', [bc]);
  if (!prod) throw new HttpError(404, `Produk ${bc} tidak ditemukan`);
  const aktor = await aktorDari(req);
  await withTransaction(async (conn) => {
    await conn.query('DELETE FROM stok_cabang WHERE barcode = ?', [bc]);
    await conn.query('DELETE FROM produk WHERE barcode = ?', [bc]);
    await logAudit(conn, {
      aktorKode: aktor.sub,
      aktorNama: aktor.nama,
      tipe: 'PRODUK_HAPUS',
      detail: `Produk ${prod.nama} (${bc}) dihapus dari katalog induk`,
      node: 'NODE-1',
    });
  });
  res.json({ ok: true });
});

// POST /api/admin/broadcast - siarkan harga baru (jalur manual, sama dgn jalur PUT)
router.post('/broadcast', async (req, res) => {
  const { barcode, harga_jual } = req.body || {};
  const v = Number(harga_jual);
  if (!barcode || !Number.isFinite(v) || v < 0) {
    throw new HttpError(400, 'barcode dan harga_jual (angka >= 0) wajib diisi');
  }
  const prod = await queryOne('SELECT barcode, nama, harga_jual FROM produk WHERE barcode = ?', [barcode]);
  if (!prod) throw new HttpError(404, `Produk ${barcode} tidak ditemukan`);
  const hargaBaru = Math.round(v);
  const hargaBerubah = hargaBaru !== prod.harga_jual;
  const aktor = await aktorDari(req);
  await withTransaction(async (conn) => {
    await conn.query('UPDATE produk SET harga_jual = ? WHERE barcode = ?', [hargaBaru, barcode]);
    if (hargaBerubah) {
      await siarkanHarga(conn, {
        barcode, nama: prod.nama, hargaLama: prod.harga_jual, hargaBaru,
        sumber: 'BROADCAST', oleh: aktor.sub,
      });
    }
    await logAudit(conn, {
      aktorKode: aktor.sub,
      aktorNama: aktor.nama,
      tipe: 'BROADCAST_HARGA',
      detail: `Harga ${prod.nama} disiarkan: ${prod.harga_jual} -> ${hargaBaru} ke 5 node`,
      node: 'NODE-1',
    });
  });
  res.json({ ok: true, barcode, harga_jual: hargaBaru });
});

// GET /api/admin/broadcasts - riwayat broadcast harga
router.get('/broadcasts', async (req, res) => {
  res.json(await query(
    'SELECT id, barcode, nama, harga_lama, harga_baru, sumber, waktu, oleh FROM broadcast_harga ORDER BY id DESC LIMIT 100'
  ));
});

// POST /api/admin/2pc/execute - jalankan Two-Phase Commit koordinator
router.post('/2pc/execute', async (req, res) => {
  const { src_node, dst_node, barcode, qty, simulate_timeout } = req.body || {};
  const aktor = await aktorDari(req);
  const hasil = await execute2pc({
    src: src_node,
    dst: dst_node,
    barcode,
    qty,
    simulate_timeout: !!simulate_timeout,
    aktor: { sub: aktor.sub, nama: aktor.nama },
  });
  res.json(hasil); // {status:'COMMITTED'|'ABORTED', phases:[{fase,detail,ts}]}
});

// GET /api/admin/mutasi-queue - antrean pengajuan mutasi PENDING
router.get('/mutasi-queue', async (req, res) => {
  res.json(await query(
    "SELECT id, src_node, dst_node, barcode, nama, qty, note, waktu FROM mutasi_request WHERE status = 'PENDING' ORDER BY waktu ASC, id ASC"
  ));
});

// GET /api/admin/inbound - riwayat penerimaan PO
router.get('/inbound', async (req, res) => {
  res.json(await query(
    `SELECT id, no_po, no_sj, supplier_id, supplier_nama, barcode, nama, total_datang, rusak,
            (total_datang - rusak) AS lolos, waktu, oleh
       FROM inbound_po ORDER BY id DESC LIMIT 100`
  ));
});

// POST /api/admin/inbound - terima PO di NODE-1: stok += lolos (total_datang - rusak)
router.post('/inbound', async (req, res) => {
  const { no_po, no_sj, supplier_id, barcode, total_datang, rusak } = req.body || {};
  if (!no_po || !no_sj || !supplier_id || !barcode) {
    throw new HttpError(400, 'no_po, no_sj, supplier_id, barcode wajib diisi');
  }
  const nTotal = Number(total_datang);
  const nRusak = Number(rusak) || 0;
  if (!Number.isFinite(nTotal) || nTotal <= 0) throw new HttpError(400, 'total_datang harus angka > 0');
  if (nRusak < 0 || nRusak > nTotal) throw new HttpError(400, 'rusak harus di antara 0 dan total_datang');
  const sup = await queryOne('SELECT id, nama FROM supplier WHERE id = ?', [supplier_id]);
  if (!sup) throw new HttpError(404, 'Supplier tidak ditemukan');
  const prod = await queryOne('SELECT barcode, nama FROM produk WHERE barcode = ?', [barcode]);
  if (!prod) throw new HttpError(404, `Produk ${barcode} tidak ada di katalog`);
  const lolos = Math.round(nTotal - nRusak);
  const aktor = await aktorDari(req);

  await withTransaction(async (conn) => {
    // Kunci baris stok NODE-1 (FOR UPDATE) lalu tambahkan barang lolos uji
    const [sRows] = await conn.query(
      'SELECT qty FROM stok_cabang WHERE cabang_kode = ? AND barcode = ? FOR UPDATE',
      ['NODE-1', barcode]
    );
    if (sRows.length) {
      await conn.query(
        'UPDATE stok_cabang SET qty = qty + ? WHERE cabang_kode = ? AND barcode = ?',
        [lolos, 'NODE-1', barcode]
      );
    } else {
      await conn.query(
        'INSERT INTO stok_cabang (cabang_kode, barcode, qty) VALUES (?,?,?)',
        ['NODE-1', barcode, lolos]
      );
    }
    await conn.query(
      `INSERT INTO inbound_po (no_po, no_sj, supplier_id, supplier_nama, barcode, nama, total_datang, rusak, waktu, oleh)
       VALUES (?,?,?,?,?,?,?,?,NOW(),?)`,
      [no_po, no_sj, sup.id, sup.nama, barcode, prod.nama, Math.round(nTotal), Math.round(nRusak), aktor.sub]
    );
    await logAudit(conn, {
      aktorKode: aktor.sub,
      aktorNama: aktor.nama,
      tipe: 'INBOUND_PO',
      detail: `${no_po} (${no_sj}) dari ${sup.nama}: ${lolos} lolos, ${Math.round(nRusak)} retur -> stok NODE-1`,
      node: 'NODE-1',
    });
  });
  res.status(201).json({ ok: true, lolos });
});

module.exports = router;
