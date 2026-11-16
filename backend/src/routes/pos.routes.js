// =====================================================================
// ROUTE POS - transaksi kasir pada node gerai.
//   POST /api/pos/checkout        -> 201 struk baru / 200 existing (idempoten)
//   GET  /api/pos/transactions    -> riwayat struk node (default 6 terakhir)
//   POST /api/pos/void-request    -> pengajuan void (kasir dari JWT)
// Checkout: satu transaksi DB dgn SELECT ... FOR UPDATE pada baris
// stok_cabang (anti-overselling: transaksi paralel menunggu kunci baris,
// stok tidak pernah minus). Idempoten: no_struk = PRIMARY KEY; kirim
// ulang no_struk sama mengembalikan data existing tanpa potong stok lagi.
// =====================================================================
const express = require('express');
const { query, queryOne, withTransaction, logAudit, getKaryawan } = require('../config/db');
const HttpError = require('../middleware/httpError');
const { requireRole } = require('../middleware/auth');
const {
  gabungItems, hitungTotal, kunciDanPotongStok, tulisDetail, tambahPoin, waktuDari,
} = require('../services/transaksi.service');

const router = express.Router();

// Checkout & void-request: KASIR/SUPERVISOR/ADMIN_PUSAT (mode demo TA)
const ROLE_POS = requireRole('KASIR', 'SUPERVISOR', 'ADMIN_PUSAT');

// POST /api/pos/checkout
router.post('/pos/checkout', ROLE_POS, async (req, res) => {
  const body = req.body || {};
  const node = String(body.node_kode || '').trim();
  const noStruk = String(body.no_struk || '').trim();
  if (!node || !noStruk) throw new HttpError(400, 'node_kode dan no_struk wajib diisi');
  const metode = body.metode === 'QRIS' ? 'QRIS' : body.metode === 'TUNAI' ? 'TUNAI' : null;
  if (!metode) throw new HttpError(400, "metode harus 'TUNAI' atau 'QRIS'");
  if (!(await queryOne('SELECT kode FROM cabang WHERE kode = ?', [node]))) {
    throw new HttpError(400, `Node ${node} tidak dikenal`);
  }
  const kasir = await getKaryawan(req.user.sub);
  if (!kasir) throw new HttpError(401, 'Akun kasir tidak ditemukan');
  const memberKode = body.member_kode || null;
  const tunai = Number(body.tunai) || 0;
  const kembali = Number(body.kembali) || 0;
  const waktu = waktuDari(body.created_at); // offline tetap bawa waktu buat struk

  const hasil = await withTransaction(async (conn) => {
    const items = gabungItems(body.items);
    const t = await hitungTotal(conn, { items, memberKode });

    // --- GATE IDEMPOTENSI (no_struk PRIMARY KEY) ---
    // INSERT ... ON DUPLICATE KEY UPDATE no_struk = no_struk:
    // affectedRows 0 = struk sudah ada -> kembalikan data existing (200),
    // TIDAK memotong stok ulang (anti double counting).
    const [ins] = await conn.query(
      `INSERT INTO transaksi_pos
         (no_struk, cabang_kode, kasir_kode, kasir_nama, member_kode, metode,
          tunai, kembali, kotor, diskon, bersih, waktu, is_synced, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'1','VALID')
       ON DUPLICATE KEY UPDATE no_struk = no_struk`,
      [noStruk, node, kasir.kode, kasir.nama, memberKode, metode,
       tunai, kembali, t.kotor, t.diskon, t.bersih, waktu]
    );
    if (ins.affectedRows === 0) {
      const tx = (await conn.query(
        'SELECT kotor, diskon, bersih, is_synced, member_kode FROM transaksi_pos WHERE no_struk = ?',
        [noStruk]
      ))[0][0];
      let poinBaru = 0;
      if (tx.member_kode) {
        const [mRows] = await conn.query('SELECT poin FROM member WHERE kode = ?', [tx.member_kode]);
        poinBaru = mRows.length ? mRows[0].poin : 0;
      }
      return {
        idempoten: true,
        data: { no_struk: noStruk, kotor: tx.kotor, diskon: tx.diskon, bersih: tx.bersih, poin_baru: poinBaru, is_synced: tx.is_synced },
      };
    }

    // --- KUNCI BARIS STOK + potong (rollback penuh bila stok kurang) ---
    await kunciDanPotongStok(conn, node, t.items);
    await tulisDetail(conn, noStruk, t.detail);
    let poinBaru = 0;
    if (memberKode) poinBaru = await tambahPoin(conn, memberKode, t.bersih);

    await logAudit(conn, {
      aktorKode: kasir.kode,
      aktorNama: kasir.nama,
      tipe: 'POS_CHECKOUT',
      detail: `Checkout ${noStruk} (Rp ${t.bersih}, ${metode}) di ${node}`,
      node,
    });

    return {
      idempoten: false,
      data: { no_struk: noStruk, kotor: t.kotor, diskon: t.diskon, bersih: t.bersih, poin_baru: poinBaru, is_synced: 1 },
    };
  });

  res.status(hasil.idempoten ? 200 : 201).json(hasil.data);
});

// GET /api/pos/transactions?node_kode=&limit=6
router.get('/pos/transactions', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '6'), 10) || 6, 1), 100);
  const node = req.query.node_kode ? String(req.query.node_kode) : null;
  const params = [];
  let where = '';
  if (node) {
    where = 'WHERE cabang_kode = ?';
    params.push(node);
  }
  const rows = await query(
    `SELECT no_struk, waktu, metode, bersih, is_synced, status
       FROM transaksi_pos ${where}
      ORDER BY waktu DESC, no_struk DESC
      LIMIT ${limit}`,
    params
  );
  res.json(rows);
});

// POST /api/pos/void-request {no_struk, alasan} - kasir diambil dari JWT
router.post('/pos/void-request', ROLE_POS, async (req, res) => {
  const body = req.body || {};
  const noStruk = String(body.no_struk || '').trim();
  const alasan = String(body.alasan || '').trim();
  if (!noStruk || !alasan) throw new HttpError(400, 'no_struk dan alasan wajib diisi');
  const kasir = await getKaryawan(req.user.sub);
  if (!kasir) throw new HttpError(401, 'Akun tidak ditemukan');

  const tx = await queryOne('SELECT no_struk, cabang_kode, bersih, status FROM transaksi_pos WHERE no_struk = ?', [noStruk]);
  if (!tx) throw new HttpError(404, `Transaksi ${noStruk} tidak ditemukan`);
  if (tx.status !== 'VALID') {
    throw new HttpError(409, `Transaksi ${noStruk} berstatus ${tx.status}, tidak bisa diajukan void`);
  }
  const dup = await queryOne("SELECT id FROM void_request WHERE no_struk = ? AND status = 'PENDING'", [noStruk]);
  if (dup) throw new HttpError(409, `Sudah ada pengajuan void PENDING untuk ${noStruk}`);

  const id = await withTransaction(async (conn) => {
    const [r] = await conn.query(
      `INSERT INTO void_request (no_struk, cabang_kode, kasir_kode, kasir_nama, nominal, alasan, status, requested_at)
       VALUES (?,?,?,?,?,?,'PENDING',NOW())`,
      [noStruk, tx.cabang_kode, kasir.kode, kasir.nama, tx.bersih, alasan]
    );
    await logAudit(conn, {
      aktorKode: kasir.kode,
      aktorNama: kasir.nama,
      tipe: 'VOID_REQUEST',
      detail: `Pengajuan void ${noStruk} (Rp ${tx.bersih}): ${alasan}`,
      node: tx.cabang_kode,
    });
    return r.insertId;
  });

  res.status(201).json({ ok: true, id, status: 'PENDING' });
});

module.exports = router;
