// =====================================================================
// ROUTE 2PC SERVICE - Koordinator Two-Phase Commit mutasi stok antar node.
// Fase: PREPARE -> VOTE -> DECISION (GLOBAL_COMMIT / GLOBAL_ABORT).
//   PREPARE  : kunci baris stok node sumber dgn SELECT ... FOR UPDATE,
//              cek produk terdaftar & apakah node tujuan online.
//   VOTE     : simulate_timeout / dst offline / stok kurang / produk
//              tak dikenal -> VOTE_ABORT; selain itu VOTE_COMMIT 2/2.
//   DECISION : COMMIT -> stok src dikurangi & stok dst ditambah dalam
//              SATU transaksi koordinator (atomik) + mutasi_stok COMMITTED;
//              ABORT -> tidak ada stok berpindah, mutasi_stok ABORTED.
// State machine dicatat di tabel mutasi_stok: PENDING -> PREPARED ->
// COMMITTED/ABORTED. Satu koneksi dari pool dipakai dari awal sampai
// akhir (conn.release di finally). Marker ABORTED di-COMMIT (bukan
// rollback) agar jejak state machine + audit tetap terekam; outbox_sync
// hanya ditulis pada COMMIT (tidak ada mutasi utk disiarkan saat ABORT).
// =====================================================================
const { pool, logAudit } = require('../config/db');
const HttpError = require('../middleware/httpError');

const nowIso = () => new Date().toISOString(); // ts fase format ISO

async function execute2pc({ src, dst, barcode, qty, simulate_timeout = false, aktor = null }) {
  // --- Validasi input koordinator (kesalahan pemanggil -> 400, bukan ABORT) ---
  if (!src || !dst || !barcode) throw new HttpError(400, 'src_node, dst_node, barcode wajib diisi');
  const nQty = Math.floor(Number(qty));
  if (!Number.isFinite(Number(qty)) || nQty <= 0) throw new HttpError(400, 'qty harus angka > 0');
  if (src === dst) throw new HttpError(400, 'Node sumber dan tujuan tidak boleh sama');

  const conn = await pool.getConnection(); // satu koneksi = satu koordinator transaksi
  const phases = [];
  try {
    await conn.beginTransaction();

    const cekSrc = (await conn.query('SELECT kode FROM cabang WHERE kode = ?', [src]))[0][0];
    const cekDst = (await conn.query('SELECT kode FROM cabang WHERE kode = ?', [dst]))[0][0];
    if (!cekSrc) throw new HttpError(400, `Node sumber ${src} tidak dikenal`);
    if (!cekDst) throw new HttpError(400, `Node tujuan ${dst} tidak dikenal`);

    const produk = (await conn.query('SELECT barcode, nama FROM produk WHERE barcode = ?', [barcode]))[0][0] || null;

    // --- Awal state machine: PENDING ---
    const [insMutasi] = await conn.query(
      `INSERT INTO mutasi_stok (src_node, dst_node, barcode, nama, qty, status, detail, waktu, initiated_by)
       VALUES (?,?,?,?,?,'PENDING','Koordinator memulai sesi 2PC', NOW(), ?)`,
      [src, dst, barcode, produk ? produk.nama : null, nQty, aktor ? aktor.sub : null]
    );
    const mutasiId = insMutasi.insertId;

    // ================= FASE 1: PREPARE =================
    const [stokRows] = await conn.query(
      'SELECT qty FROM stok_cabang WHERE cabang_kode = ? AND barcode = ? FOR UPDATE',
      [src, barcode]
    );
    const stokSrc = stokRows.length ? stokRows[0].qty : 0;
    const dstCabang = (await conn.query('SELECT kode, online FROM cabang WHERE kode = ?', [dst]))[0][0];
    const dstSiap = !!dstCabang && !!dstCabang.online;
    phases.push({
      fase: 'PREPARE',
      detail: `Kunci baris stok ${barcode} di ${src} (FOR UPDATE): tersedia ${stokSrc}, diminta ${nQty}; node tujuan ${dst} ${dstSiap ? 'online' : 'offline/tak siap'}`,
      ts: nowIso(),
    });

    // ================= FASE 2: VOTE =================
    let alasanAbort = null;
    if (!produk) alasanAbort = `VOTE_ABORT: produk ${barcode} tidak terdaftar di katalog`;
    else if (stokSrc < nQty) alasanAbort = `VOTE_ABORT: stok ${src} tidak cukup (${stokSrc} < ${nQty})`;
    else if (!dstSiap) alasanAbort = `VOTE_ABORT: node tujuan ${dst} offline`;
    else if (simulate_timeout) alasanAbort = `VOTE_ABORT: simulasi timeout - ${dst} tidak menjawab koordinator`;

    if (alasanAbort) {
      phases.push({ fase: 'VOTE', detail: alasanAbort, ts: nowIso() });
      phases.push({ fase: 'DECISION', detail: 'GLOBAL_ABORT: rollback penuh, tidak ada stok berpindah', ts: nowIso() });
      await conn.query("UPDATE mutasi_stok SET status = 'ABORTED', detail = ? WHERE id = ?", [alasanAbort, mutasiId]);
      await logAudit(conn, {
        aktorKode: aktor ? aktor.sub : null,
        aktorNama: aktor ? aktor.nama : null,
        tipe: '2PC_ABORT',
        detail: `2PC ${src}->${dst} ${barcode} x${nQty} -> ABORTED (${alasanAbort})`,
        node: src,
      });
      await conn.commit(); // commit marker ABORTED agar state machine terekam
      return { status: 'ABORTED', phases };
    }

    phases.push({ fase: 'VOTE', detail: 'VOTE_COMMIT 2/2 (node sumber siap, node tujuan siap)', ts: nowIso() });
    await conn.query("UPDATE mutasi_stok SET status = 'PREPARED', detail = 'Kedua peserta VOTE_COMMIT' WHERE id = ?", [mutasiId]);

    // ================= FASE 3: DECISION - GLOBAL_COMMIT =================
    await conn.query(
      'UPDATE stok_cabang SET qty = qty - ? WHERE cabang_kode = ? AND barcode = ?',
      [nQty, src, barcode]
    );
    // Stok node tujuan: baris bisa belum ada -> upsert (atomik di level baris)
    await conn.query(
      `INSERT INTO stok_cabang (cabang_kode, barcode, qty) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE qty = qty + VALUES(qty)`,
      [dst, barcode, nQty]
    );
    await conn.query(
      "UPDATE mutasi_stok SET status = 'COMMITTED', detail = ? WHERE id = ?",
      [`COMMIT: ${nQty} unit ${barcode} berpindah ${src}->${dst}`, mutasiId]
    );
    // Outbox utk node tujuan (status NEW) + audit koordinator
    await conn.query(
      `INSERT INTO outbox_sync (agregat, agregat_id, cabang_kode, payload, status, created_at)
       VALUES ('MUTASI', ?, ?, ?, 'NEW', NOW())`,
      [String(mutasiId), dst, JSON.stringify({
        tipe: 'MUTASI_STOK',
        mutasi_id: mutasiId,
        src_node: src,
        dst_node: dst,
        barcode,
        qty: nQty,
      })]
    );
    await logAudit(conn, {
      aktorKode: aktor ? aktor.sub : null,
      aktorNama: aktor ? aktor.nama : null,
      tipe: '2PC_COMMIT',
      detail: `2PC COMMIT: ${nQty} ${produk.nama} (${barcode}) ${src}->${dst}`,
      node: src,
    });
    phases.push({
      fase: 'DECISION',
      detail: `GLOBAL_COMMIT: stok ${src} -${nQty}, stok ${dst} +${nQty} (atomik, satu transaksi koordinator)`,
      ts: nowIso(),
    });

    await conn.commit();
    return { status: 'COMMITTED', phases };
  } catch (err) {
    try {
      await conn.rollback();
    } catch (e) {
      console.error('[2pc] rollback gagal:', e.message);
    }
    throw err;
  } finally {
    conn.release(); // koneksi kembali ke pool apa pun hasilnya
  }
}

module.exports = { execute2pc };
