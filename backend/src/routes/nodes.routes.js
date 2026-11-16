// =====================================================================
// ROUTE NODES & REFERENSI - status 5 node, antrean sinkron, katalog,
// stok lintas-node, anggota. Semua endpoint di file ini di bawah authRequired.
//   GET  /api/nodes                     -> daftar node + ping + online
//   POST /api/nodes/:kode/status        -> toggl online/offline (simulasi partisi)
//   GET  /api/nodes/:kode/queue         -> jumlah transaksi belum tersinkron
//   GET  /api/products?node_kode=       -> katalog + stok lokal satu node
//   GET  /api/stock5?q=                 -> stok 5 node + ping & online tiap node
//   GET  /api/members                   -> daftar anggota kopdes
// =====================================================================
const express = require('express');
const { query, queryOne, logAudit } = require('../config/db');
const HttpError = require('../middleware/httpError');

const router = express.Router();

// GET /api/nodes - daftar 5 node (Master Hub + 4 gerai)
router.get('/nodes', async (req, res) => {
  const rows = await query(
    'SELECT id, kode, nama, region, jenis, ip_address, ping_ms, online FROM cabang ORDER BY id'
  );
  // online dari TINYINT(1) -> boolean utk frontend
  res.json(rows.map(r => ({ ...r, online: !!r.online })));
});

// POST /api/nodes/:kode/status {online:boolean} - simulasi node hidup/mati
router.post('/nodes/:kode/status', async (req, res) => {
  const body = req.body || {};
  if (typeof body.online !== 'boolean') {
    throw new HttpError(400, 'Body harus berisi {online: boolean}');
  }
  const row = await queryOne('SELECT kode, nama FROM cabang WHERE kode = ?', [req.params.kode]);
  if (!row) throw new HttpError(404, `Node ${req.params.kode} tidak ditemukan`);
  await query('UPDATE cabang SET online = ? WHERE kode = ?', [body.online ? 1 : 0, row.kode]);
  await logAudit(null, {
    aktorKode: req.user.sub,
    tipe: 'NODE_STATUS',
    detail: `${row.kode} (${row.nama}) diubah menjadi ${body.online ? 'ONLINE' : 'OFFLINE'}`,
    node: row.kode,
  });
  res.json({ ok: true });
});

// GET /api/nodes/:kode/queue - transaksi_pos is_synced=0 di cabang itu
router.get('/nodes/:kode/queue', async (req, res) => {
  const row = await queryOne(
    'SELECT COUNT(*) AS pending FROM transaksi_pos WHERE cabang_kode = ? AND is_synced = 0',
    [req.params.kode]
  );
  res.json({ pending: row ? row.pending : 0 });
});

// GET /api/products?node_kode= - katalog + stok lokal pada satu node
router.get('/products', async (req, res) => {
  const node = req.query.node_kode ? String(req.query.node_kode) : 'NODE-1'; // default master hub
  const rows = await query(
    `SELECT p.barcode, p.nama, p.kategori, p.origin, p.satuan, p.hpp, p.harga_jual,
            COALESCE(sc.qty, 0) AS stok_lokal
       FROM produk p
       LEFT JOIN stok_cabang sc ON sc.barcode = p.barcode AND sc.cabang_kode = ?
      ORDER BY p.barcode`,
    [node]
  );
  res.json(rows);
});

// GET /api/stock5?q= - stok satu produk di kelima node.
// Filter q: nama LIKE ATAU barcode; ping & online SELALU disertakan per node
// (dari tabel cabang) supaya UI bisa menandai node offline.
router.get('/stock5', async (req, res) => {
  const q = req.query.q ? String(req.query.q).trim() : '';
  const like = `%${q}%`;
  const produk = q
    ? await query(
        'SELECT barcode, nama, satuan, harga_jual FROM produk WHERE nama LIKE ? OR barcode LIKE ? ORDER BY barcode',
        [like, like]
      )
    : await query('SELECT barcode, nama, satuan, harga_jual FROM produk ORDER BY barcode');

  const cabang = await query('SELECT kode, ping_ms, online FROM cabang ORDER BY id');
  const ping = {};
  const onlineMap = {};
  for (const c of cabang) {
    ping[c.kode] = c.ping_ms;
    onlineMap[c.kode] = !!c.online;
  }

  // Matriks stok: node tanpa baris stok dianggap 0
  const stocks = {};
  for (const p of produk) {
    stocks[p.barcode] = {};
    for (const c of cabang) stocks[p.barcode][c.kode] = 0;
  }
  if (produk.length) {
    const placeholders = produk.map(() => '?').join(',');
    const stokRows = await query(
      `SELECT barcode, cabang_kode, qty FROM stok_cabang WHERE barcode IN (${placeholders})`,
      produk.map(p => p.barcode)
    );
    for (const s of stokRows) {
      if (stocks[s.barcode]) stocks[s.barcode][s.cabang_kode] = s.qty;
    }
  }

  res.json(
    produk.map(p => ({
      barcode: p.barcode,
      nama: p.nama,
      satuan: p.satuan,
      harga_jual: p.harga_jual,
      stocks: stocks[p.barcode],
      ping,
      online: onlineMap,
    }))
  );
});

// GET /api/members - referensi anggota (dipakai POS utk pilih member)
router.get('/members', async (req, res) => {
  res.json(await query('SELECT kode, nama, alamat, poin FROM member ORDER BY kode'));
});

module.exports = router;
