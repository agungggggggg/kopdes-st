// =====================================================================
// SERVER EXPRESS - Kopdes Mart DIY (5 node, Tugas Akhir Sistem Terdistribusi)
// Semua endpoint di-mount di prefix /api; respons JSON {..} atau {error:{message}}.
// Publik (tanpa Bearer): GET /api/health & POST /api/auth/login.
// Jalankan: npm start / npm run dev (pastikan MySQL + skema sudah siap).
// =====================================================================
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { pool } = require('./config/db');
const { authRequired } = require('./middleware/auth');

const app = express();
app.use(cors());                      // demo TA: API dibuka utk frontend lokal
app.use(express.json({ limit: '1mb' }));

const api = express.Router();

// --- Healthcheck publik: pengecekan node hidup ---
api.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'kopdes-mart-backend', node: 'NODE-1', time: new Date().toISOString() });
});

// --- Router auth: login publik; /auth/me menjaga dirinya sendiri ---
api.use(require('./routes/auth.routes'));

// --- Dari sini SEMUA endpoint wajib Bearer JWT ---
api.use(authRequired);
api.use(require('./routes/nodes.routes'));      // /nodes, /products, /stock5, /members
api.use(require('./routes/pos.routes'));        // /pos/checkout, /pos/transactions, /pos/void-request
api.use(require('./routes/sync.routes'));       // /sync/transactions
api.use(require('./routes/supervisor.routes')); // /void-requests, /mutasi-requests, /eod
api.use('/admin', require('./routes/admin.routes')); // /admin/* (ADMIN_PUSAT) - prefix di sini agar guard router.use tak menimpa /manajer/*
api.use(require('./routes/manajer.routes'));    // /manajer/* (MANAJER)

// --- 404 utk endpoint /api yang tidak dikenal ---
api.use((req, res) => {
  res.status(404).json({ error: { message: `Endpoint ${req.method} ${req.originalUrl} tidak ditemukan` } });
});

app.use('/api', api);

// --- Error handler terpusat: HttpError(4xx) / tak terduga (500) -> {error:{message,...}} ---
app.use((err, req, res, next) => {
  if (res.headersSent) return;
  const status = err && err.httpStatus
    ? err.httpStatus
    : (err && err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error('[kopdes-mart][error]', req.method, req.originalUrl, err);
  const payload = { error: { message: (err && err.message) || 'Kesalahan internal server' } };
  if (err && err.extra) Object.assign(payload.error, err.extra);
  res.status(status).json(payload);
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`[kopdes-mart] API berjalan di http://localhost:${PORT}/api - Master Hub NODE-1`);
});

// Tutup pool koneksi MySQL dgn rapi saat proses dihentikan (Ctrl+C / SIGTERM)
async function shutdown() {
  try {
    await pool.end();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
