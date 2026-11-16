// =====================================================================
// MIDDLEWARE AUTENTIKASI & OTORISASI (JWT Bearer)
//   - authRequired     : verifikasi "Authorization: Bearer <token>",
//                        payload JWT = { sub: kode_karyawan, role, cabang_id }
//   - requireRole(...) : guard RBAC per role (4 portal: kasir/supervisor/
//                        admin pusat/manajer)
// Endpoint publik (tanpa token): POST /api/auth/login & GET /api/health.
// =====================================================================
const jwt = require('jsonwebtoken');

// Secret dibaca saat request (bukan saat import) agar .env pasti sudah dimuat.
function jwtSecret() {
  return process.env.JWT_SECRET || 'kopdes-mart-diy-secret-ta-2026'; // fallback demo TA
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: { message: 'Token Bearer tidak ditemukan pada header Authorization' } });
  }
  const token = header.slice(7).trim();
  try {
    req.user = jwt.verify(token, jwtSecret());
    return next();
  } catch (err) {
    const pesan = err && err.name === 'TokenExpiredError'
      ? 'Token kedaluwarsa, silakan login ulang'
      : 'Token tidak valid';
    return res.status(401).json({ error: { message: pesan } });
  }
}

// Pabrik middleware pembatas role; dipakai: admin.* (ADMIN_PUSAT),
// manajer.* (MANAJER), void-approve (SUPERVISOR), checkout/sync (demo).
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: { message: 'Belum terautentikasi' } });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: { message: `Akses ditolak: butuh role ${roles.join(' atau ')}` } });
    }
    return next();
  };
}

module.exports = { authRequired, requireRole, jwtSecret };
