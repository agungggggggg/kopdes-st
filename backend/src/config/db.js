// =====================================================================
// KONFIGURASI DATABASE - Kopdes Mart DIY (Tugas Akhir Sistem Terdistribusi)
// Pool koneksi MySQL (mysql2/promise) + helper query/transaction.
// Semua akses DB backend lewat modul ini agar konsisten:
//   - query / queryOne     : query biasa dari pool
//   - withTransaction(fn)  : conn.beginTransaction + COMMIT/ROLLBACK otomatis,
//                            koneksi di-release di finally (anti bocor pool)
//   - logAudit(...)        : tulis audit_log (bisa di dalam tx via conn)
//   - getKaryawan(...)     : data akun + cabang (login, /me, checkout, void)
// =====================================================================
require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'kopdes',
  database: process.env.DB_NAME || 'kopdes_mart',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,    // DATETIME dibaca 'YYYY-MM-DD HH:MM:SS' (stabil utk JSON/CSV/laporan)
  decimalNumbers: true, // hasil SUM/DECIMAL langsung number JS
  // FOUND_ROWS dinonaktifkan agar affectedRows = 0 saat INSERT ... ON DUPLICATE
  // KEY UPDATE tidak mengubah apa pun (baris sudah ada) - ini FONDASI gate
  // idempotensi no_struk di checkout & sinkronisasi (anti double counting).
  flags: '-FOUND_ROWS',
});

// Jalankan query; kembalikan rows saja
async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

// Ambil satu baris pertama (atau null)
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

// =====================================================================
// PEMBUNGKUS TRANSAKSI: beginTransaction -> fn(conn) -> COMMIT,
// melempar error -> ROLLBACK; conn.release SELALU di finally.
// Dipakai checkout, sync, void-approve, 2PC, admin (anti overselling).
// =====================================================================
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const hasil = await fn(conn);
    await conn.commit();
    return hasil;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (e) {
      console.error('[db] rollback gagal:', e.message);
    }
    throw err;
  } finally {
    conn.release(); // koneksi kembali ke pool apa pun hasilnya
  }
}

// Tulis audit_log. Bila conn diberikan, ditulis dalam transaksi yang sama
// (ikut COMMIT/ROLLBACK); bila tidak, langsung dari pool.
async function logAudit(conn, { aktorKode = null, aktorNama = null, tipe, detail = '', node = null }) {
  const sql = 'INSERT INTO audit_log (waktu, aktor_kode, aktor_nama, tipe, detail, node) VALUES (NOW(),?,?,?,?,?)';
  const params = [aktorKode, aktorNama, tipe, detail, node];
  if (conn) return conn.query(sql, params);
  return pool.query(sql, params);
}

// Data karyawan + cabang untuk payload user (tanpa menyebarkan hash ke respons)
async function getKaryawan(kode) {
  return queryOne(
    `SELECT k.kode, k.username, k.nama, k.role, k.password_hash, k.pin_hash, k.cabang_id,
            c.kode AS cabang_kode, c.nama AS cabang_nama, c.region
       FROM karyawan k
       JOIN cabang c ON c.id = k.cabang_id
      WHERE k.kode = ?
      LIMIT 1`,
    [kode]
  );
}

module.exports = { pool, query, queryOne, withTransaction, logAudit, getKaryawan };
