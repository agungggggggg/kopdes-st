// =====================================================================
// ROUTE SUPERVISOR - approval void (verifikasi PIN bcrypt), pengajuan
// mutasi, dan EOD harian.
//   GET  /api/void-requests?node_kode=            -> antrean void
//   POST /api/void-requests/:id/approve {pin}     -> SUPERVISOR only
//   GET  /api/mutasi-requests?status=PENDING      -> daftar pengajuan mutasi
//   POST /api/mutasi-requests {src,dst,barcode,qty,note} -> SUPERVISOR only
//   GET  /api/eod?node_kode=                      -> {sys_total,sys_cash,sys_qris}
// =====================================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const { query, queryOne, withTransaction, logAudit, getKaryawan } = require('../config/db');
const HttpError = require('../middleware/httpError');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/void-requests?node_kode= - PENDING tampil duluan
router.get('/void-requests', async (req, res) => {
  const node = req.query.node_kode ? String(req.query.node_kode) : null;
  const params = [];
  let where = '';
  if (node) {
    where = 'WHERE cabang_kode = ?';
    params.push(node);
  }
  const rows = await query(
    `SELECT id, no_struk, kasir_nama, nominal, alasan, status, requested_at
       FROM void_request ${where}
      ORDER BY (status = 'PENDING') DESC, requested_at DESC, id DESC
      LIMIT 100`,
    params
  );
  res.json(rows);
});

// POST /api/void-requests/:id/approve {pin} - hanya SUPERVISOR.
// Verifikasi bcrypt.compare(pin, pin_hash) lalu dalam SATU transaksi:
// void_request APPROVED, transaksi VOIDED, stok dikembalikan (FOR UPDATE), audit.
router.post('/void-requests/:id/approve', requireRole('SUPERVISOR'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new HttpError(400, 'id tidak valid');
  const pin = req.body && req.body.pin;
  if (!pin) throw new HttpError(400, 'PIN supervisor wajib diisi');

  const vr = await queryOne('SELECT id, no_struk, nominal, status FROM void_request WHERE id = ?', [id]);
  if (!vr) throw new HttpError(404, 'Pengajuan void tidak ditemukan');
  if (vr.status !== 'PENDING') throw new HttpError(409, `Pengajuan sudah diproses (status ${vr.status})`);

  const spv = await getKaryawan(req.user.sub);
  if (!spv || !spv.pin_hash) throw new HttpError(403, 'Akun supervisor tidak memiliki PIN');
  const pinOk = await bcrypt.compare(String(pin), spv.pin_hash);
  if (!pinOk) {
    await logAudit(null, {
      aktorKode: spv.kode,
      aktorNama: spv.nama,
      tipe: 'VOID_APPROVE_GAGAL',
      detail: `PIN salah utk approval void #${id} (${vr.no_struk})`,
      node: spv.cabang_kode,
    });
    throw new HttpError(401, 'PIN salah');
  }

  await withTransaction(async (conn) => {
    // Kunci baris pengajuan (FOR UPDATE) agar tidak disetujui dua kali paralel
    const [rows] = await conn.query('SELECT id, status FROM void_request WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length || rows[0].status !== 'PENDING') {
      throw new HttpError(409, 'Pengajuan sudah diproses');
    }
    const tx = (await conn.query(
      'SELECT no_struk, cabang_kode, status FROM transaksi_pos WHERE no_struk = ? FOR UPDATE',
      [vr.no_struk]
    ))[0][0];
    if (!tx) throw new HttpError(404, 'Transaksi tidak ditemukan');
    if (tx.status !== 'VALID') throw new HttpError(409, `Transaksi berstatus ${tx.status}`);

    await conn.query(
      "UPDATE void_request SET status = 'APPROVED', approved_by = ?, approved_at = NOW() WHERE id = ?",
      [spv.kode, id]
    );
    await conn.query("UPDATE transaksi_pos SET status = 'VOIDED' WHERE no_struk = ?", [vr.no_struk]);

    // Kembalikan stok per item transaksi (kunci baris stok dulu, lalu tambah)
    const [items] = await conn.query('SELECT barcode, qty FROM detail_transaksi WHERE no_struk = ?', [vr.no_struk]);
    items.sort((a, b) => (a.barcode < b.barcode ? -1 : 1));
    for (const it of items) {
      const [sRows] = await conn.query(
        'SELECT qty FROM stok_cabang WHERE cabang_kode = ? AND barcode = ? FOR UPDATE',
        [tx.cabang_kode, it.barcode]
      );
      if (sRows.length) {
        await conn.query(
          'UPDATE stok_cabang SET qty = qty + ? WHERE cabang_kode = ? AND barcode = ?',
          [it.qty, tx.cabang_kode, it.barcode]
        );
      } else {
        await conn.query(
          'INSERT INTO stok_cabang (cabang_kode, barcode, qty) VALUES (?,?,?)',
          [tx.cabang_kode, it.barcode, it.qty]
        );
      }
    }

    await logAudit(conn, {
      aktorKode: spv.kode,
      aktorNama: spv.nama,
      tipe: 'VOID_APPROVE',
      detail: `Void ${vr.no_struk} disetujui (Rp ${vr.nominal}); stok dikembalikan di ${tx.cabang_kode}`,
      node: tx.cabang_kode,
    });
  });

  res.json({ ok: true, status: 'APPROVED' });
});

// GET /api/mutasi-requests?status=PENDING
router.get('/mutasi-requests', async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const params = [];
  let where = '';
  if (status) {
    where = 'WHERE status = ?';
    params.push(status);
  }
  const rows = await query(
    `SELECT id, src_node, dst_node, barcode, nama, qty, note, waktu
       FROM mutasi_request ${where}
      ORDER BY waktu DESC, id DESC
      LIMIT 100`,
    params
  );
  res.json(rows);
});

// POST /api/mutasi-requests - SUPERVISOR: masuk antrean admin pusat
router.post('/mutasi-requests', requireRole('SUPERVISOR'), async (req, res) => {
  const body = req.body || {};
  const src = String(body.src_node || '').trim();
  const dst = String(body.dst_node || '').trim();
  const barcode = String(body.barcode || '').trim();
  const nQty = Math.floor(Number(body.qty));
  if (!src || !dst || !barcode) throw new HttpError(400, 'src_node, dst_node, barcode wajib diisi');
  if (!Number.isFinite(Number(body.qty)) || nQty <= 0) throw new HttpError(400, 'qty harus angka > 0');
  if (src === dst) throw new HttpError(400, 'src_node dan dst_node tidak boleh sama');

  const spv = await getKaryawan(req.user.sub);
  const prod = await queryOne('SELECT barcode, nama FROM produk WHERE barcode = ?', [barcode]);
  if (!prod) throw new HttpError(404, `Produk ${barcode} tidak ada di katalog`);

  const id = await withTransaction(async (conn) => {
    const [r] = await conn.query(
      `INSERT INTO mutasi_request (src_node, dst_node, barcode, nama, qty, note, status, waktu, requested_by)
       VALUES (?,?,?,?,?,?,'PENDING',NOW(),?)`,
      [src, dst, barcode, prod.nama, nQty, body.note ? String(body.note) : null, spv ? spv.kode : null]
    );
    await logAudit(conn, {
      aktorKode: spv ? spv.kode : null,
      aktorNama: spv ? spv.nama : null,
      tipe: 'MUTASI_REQ',
      detail: `Pengajuan mutasi ${nQty} ${prod.nama} dari ${src} ke ${dst}`,
      node: src,
    });
    return r.insertId;
  });

  res.status(201).json({ ok: true, id, status: 'PENDING' });
});

// GET /api/eod?node_kode= - agregasi metode hari ini (DATE(waktu)=CURDATE()),
// hanya transaksi VALID: sys_cash = TUNAI, sys_qris = QRIS.
router.get('/eod', async (req, res) => {
  const node = req.query.node_kode ? String(req.query.node_kode) : null;
  const params = [];
  let where = "WHERE status = 'VALID' AND DATE(waktu) = CURDATE()";
  if (node) {
    where += ' AND cabang_kode = ?';
    params.push(node);
  }
  const row = await queryOne(
    `SELECT COALESCE(SUM(bersih), 0) AS sys_total,
            COALESCE(SUM(CASE WHEN metode = 'TUNAI' THEN bersih ELSE 0 END), 0) AS sys_cash,
            COALESCE(SUM(CASE WHEN metode = 'QRIS'  THEN bersih ELSE 0 END), 0) AS sys_qris
       FROM transaksi_pos ${where}`,
    params
  );
  res.json({ sys_total: row.sys_total, sys_cash: row.sys_cash, sys_qris: row.sys_qris });
});

module.exports = router;
