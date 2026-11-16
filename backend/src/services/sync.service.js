// =====================================================================
// SYNC SERVICE - pemrosesan per-item antrean transaksi offline.
// Kontrak idempotensi (wajib briefing):
//   per item INSERT INTO transaksi_pos (...) ON DUPLICATE KEY UPDATE no_struk=no_struk
//   * affectedRows === 0 -> struk SUDAH ada -> status DUPLICATE
//     (tidak ada pemotongan stok ulang, anti double counting)
//   * affectedRows === 1 -> baris baru -> potong stok node tujuan dgn
//     SELECT ... FOR UPDATE + detail_transaksi + audit + outbox_sync
//     (status NEW, agregat 'TRANSAKSI') -> COMMITTED
//   * stok kurang -> ROLLBACK penuh -> status ABORT dgn reason
// Setiap item diproses dalam transaksinya sendiri: satu item ABORT
// tidak mengganggu item lain dalam batch. Hasil: results array.
// =====================================================================
const { withTransaction, logAudit } = require('../config/db');
const HttpError = require('../middleware/httpError');
const {
  gabungItems, hitungTotal, kunciDanPotongStok, tulisDetail, tambahPoin, waktuDari,
} = require('./transaksi.service');

// Proses satu struk offline di dalam satu transaksi DB (conn).
async function syncSatu(conn, item, aktor) {
  const noStruk = String((item && item.no_struk) || '').trim();
  const node = String((item && item.node_kode) || '').trim();
  if (!noStruk || !node) throw new HttpError(400, 'no_struk & node_kode wajib pada setiap item sync');
  const metode = item.metode === 'QRIS' ? 'QRIS' : item.metode === 'TUNAI' ? 'TUNAI' : null;
  if (!metode) throw new HttpError(400, `metode ${noStruk} harus 'TUNAI' atau 'QRIS'`);
  const nodeRow = (await conn.query('SELECT kode FROM cabang WHERE kode = ?', [node]))[0][0];
  if (!nodeRow) throw new HttpError(400, `Node tujuan ${node} tidak dikenal`);

  const items = gabungItems(item.items);
  const memberKode = item.member_kode || null;
  const t = await hitungTotal(conn, { items, memberKode });

  const waktu = waktuDari(item.created_at);
  const tunai = Number(item.tunai) || 0;
  const kembali = Number(item.kembali) || 0;

  // --- GATE IDEMPOTENSI: affectedRows 0 = struk sudah ada -> DUPLICATE ---
  const [ins] = await conn.query(
    `INSERT INTO transaksi_pos
       (no_struk, cabang_kode, kasir_kode, kasir_nama, member_kode, metode,
        tunai, kembali, kotor, diskon, bersih, waktu, is_synced, status)
     VALUES (?,?,NULL,'Sinkronisasi Offline',?,?,?,?,?,?,?,?,'1','VALID')
     ON DUPLICATE KEY UPDATE no_struk = no_struk`,
    [noStruk, node, memberKode, metode, tunai, kembali, t.kotor, t.diskon, t.bersih, waktu]
  );
  if (ins.affectedRows === 0) {
    return { no_struk: noStruk, status: 'DUPLICATE' };
  }

  // --- Sukses insert: potong stok node tujuan (FOR UPDATE) ---
  // Stok kurang -> HttpError 409 -> ditangkap syncBatch -> ABORT + reason.
  await kunciDanPotongStok(conn, node, t.items);
  await tulisDetail(conn, noStruk, t.detail);
  if (memberKode) await tambahPoin(conn, memberKode, t.bersih);

  // --- Outbox event TRANSAKSI (status NEW) utk direplikasi ke node terkait ---
  await conn.query(
    `INSERT INTO outbox_sync (agregat, agregat_id, cabang_kode, payload, status, created_at)
     VALUES ('TRANSAKSI', ?, ?, ?, 'NEW', NOW())`,
    [noStruk, node, JSON.stringify({
      no_struk: noStruk,
      node_kode: node,
      member_kode: memberKode,
      metode,
      items: t.detail.map(d => ({ barcode: d.barcode, qty: d.qty, harga_jual: d.harga_jual })),
      tunai,
      kembali,
      kotor: t.kotor,
      diskon: t.diskon,
      bersih: t.bersih,
      created_at: item.created_at || null,
    })]
  );

  await logAudit(conn, {
    aktorKode: aktor ? aktor.sub : null,
    tipe: 'SYNC_TRANSAKSI',
    detail: `Transaksi offline ${noStruk} dari ${node} diterima di pusat (Rp ${t.bersih})`,
    node,
  });

  return { no_struk: noStruk, status: 'COMMITTED' };
}

// Proses batch antrean offline; hasil selalu array results sesuai kontrak.
async function syncBatch(items, aktor) {
  const results = [];
  for (const item of items) {
    const noStruk = item && item.no_struk ? String(item.no_struk) : '(tanpa no_struk)';
    try {
      // withTransaction: beginTransaction -> COMMIT, error -> ROLLBACK, release di finally
      results.push(await withTransaction((conn) => syncSatu(conn, item, aktor)));
    } catch (err) {
      // Gagal per item (stok kurang / input salah) -> ABORT, batch lanjut.
      const reason = err.extra && err.extra.detail
        ? `${err.message}: ${err.extra.detail.map(d => `${d.barcode} (tersedia ${d.tersedia})`).join(', ')}`
        : err.message;
      results.push({ no_struk: noStruk, status: 'ABORT', reason });
    }
  }
  return results;
}

module.exports = { syncBatch };
