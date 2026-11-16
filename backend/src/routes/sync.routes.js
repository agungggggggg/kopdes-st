// =====================================================================
// ROUTE SYNC - masuknya antrean transaksi offline dari gerai.
//   POST /api/sync/transactions {items:[...]} -> {results:[{no_struk,status,reason?}]}
// Pemotongan stok HANYA terjadi di sini (sisi master) saat sync, sehingga
// transaksi offline tidak pernah memotong stok dua kali. Idempoten per
// no_struk (lihat sync.service). Role: KASIR/SUPERVISOR/ADMIN_PUSAT (demo).
// =====================================================================
const express = require('express');
const HttpError = require('../middleware/httpError');
const { requireRole } = require('../middleware/auth');
const { syncBatch } = require('../services/sync.service');

const router = express.Router();

router.post('/sync/transactions', requireRole('KASIR', 'SUPERVISOR', 'ADMIN_PUSAT'), async (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'items wajib berisi minimal 1 transaksi');
  }
  const results = await syncBatch(items, req.user);
  res.json({ results });
});

module.exports = router;
