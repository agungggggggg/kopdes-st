// =====================================================================
// ROUTE AUTH - login publik & identitas token.
//   POST /api/auth/login {login, password} -> {token, user{...}}
//   GET  /api/auth/me                      -> user (data sama dgn login)
// Login: cari karyawan by username ATAU kode, bcrypt.compare password_hash,
// JWT {sub:id, role, cabang_id} dengan masa berlaku dari env JWT_EXPIRES.
// =====================================================================
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { queryOne, logAudit } = require('../config/db');
const { authRequired, jwtSecret } = require('../middleware/auth');

const router = express.Router();

// Bentuk data user yg dikirim ke frontend (tanpa hash password/PIN)
function userPayload(row) {
  return {
    id: row.kode,
    kode: row.kode,
    username: row.username,
    nama: row.nama,
    role: row.role,
    cabang_id: row.cabang_id,
    cabang_kode: row.cabang_kode,
    cabang_nama: row.cabang_nama,
    region: row.region,
  };
}

// Cari karyawan by username ATAU kode (mis. budi.sleman / KSR-SLM-01)
async function cariKaryawan(login) {
  return queryOne(
    `SELECT k.kode, k.username, k.nama, k.role, k.password_hash, k.cabang_id,
            c.kode AS cabang_kode, c.nama AS cabang_nama, c.region
       FROM karyawan k
       JOIN cabang c ON c.id = k.cabang_id
      WHERE k.username = ? OR k.kode = ?
      LIMIT 1`,
    [login, login]
  );
}

// POST /api/auth/login - PUBLIK (satu-satunya endpoint auth tanpa token)
router.post('/auth/login', async (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) {
    return res.status(400).json({ error: { message: 'Field login dan password wajib diisi' } });
  }
  const karyawan = await cariKaryawan(String(login).trim());
  const cocok = karyawan ? await bcrypt.compare(String(password), karyawan.password_hash) : false;
  if (!karyawan || !cocok) {
    // Audit kegagalan login (persyaratan keamanan TA)
    await logAudit(null, {
      aktorKode: karyawan ? karyawan.kode : null,
      aktorNama: karyawan ? karyawan.nama : null,
      tipe: 'LOGIN_GAGAL',
      detail: `Percobaan login gagal utk "${login}"`,
      node: karyawan ? karyawan.cabang_kode : null,
    });
    return res.status(401).json({ error: { message: 'Login gagal: kredensial salah' } });
  }
  // Sign JWT {sub:id, role, cabang_id}; kedaluwarsa dari env (default 8h)
  const token = jwt.sign(
    { sub: karyawan.kode, role: karyawan.role, cabang_id: karyawan.cabang_id },
    jwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES || '8h' }
  );
  await logAudit(null, {
    aktorKode: karyawan.kode,
    aktorNama: karyawan.nama,
    tipe: 'LOGIN_SUKSES',
    detail: `${karyawan.nama} login sebagai ${karyawan.role}`,
    node: karyawan.cabang_kode,
  });
  res.json({ token, user: userPayload(karyawan) });
});

// GET /api/auth/me - dilindungi sendiri (middleware authRequired di sini)
router.get('/auth/me', authRequired, async (req, res) => {
  const karyawan = await cariKaryawan(req.user.sub);
  if (!karyawan) return res.status(404).json({ error: { message: 'Akun tidak ditemukan' } });
  res.json(userPayload(karyawan));
});

module.exports = router;
