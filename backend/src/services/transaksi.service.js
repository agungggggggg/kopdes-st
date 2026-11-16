// =====================================================================
// TRANSAKSI SERVICE - logika inti struk POS yang dipakai BERSAMA
// oleh checkout online (pos.routes) dan sinkronisasi offline (sync.service):
// penggabungan item, perhitungan diskon member 5% + poin, kunci baris
// stok (SELECT ... FOR UPDATE), potong stok, tulis detail & poin member.
// Prinsip anti-overselling: stok hanya boleh diubah SETELAH barisnya
// terkunci FOR UPDATE di dalam transaksi DB yang sama.
// =====================================================================
const HttpError = require('../middleware/httpError');

// Gabungkan item dgn barcode sama lalu urutkan berdasar barcode.
// Urutan kunci baris yang konsisten antar transaksi paralel mencegah deadlock.
// Harga memakai harga struk (kemunculan pertama); qty digabung.
function gabungItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new HttpError(400, 'items wajib berisi minimal 1 barang');
  }
  const map = new Map();
  for (const it of rawItems) {
    if (!it || !it.barcode) throw new HttpError(400, 'Setiap item wajib punya barcode');
    const qty = Number(it.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new HttpError(400, `qty item ${it.barcode} harus angka > 0`);
    }
    const harga = Number(it.harga_jual);
    const bc = String(it.barcode);
    const prev = map.get(bc);
    if (!prev) {
      map.set(bc, { barcode: bc, qty: Math.floor(qty), harga_jual: Number.isFinite(harga) ? harga : 0 });
    } else {
      prev.qty += Math.floor(qty);
    }
  }
  return [...map.values()].sort((a, b) => (a.barcode < b.barcode ? -1 : a.barcode > b.barcode ? 1 : 0));
}

// Validasi produk & member terhadap katalog, hitung kotor/diskon/bersih.
// Harga struk dipakai bila valid (>0) agar angka struk offline tidak berubah
// saat disinkronkan; fallback ke harga katalog bila harga struk tidak valid.
// Diskon keanggotaan 5% (Math.round, sama dengan prototype index.html),
// poin += floor(bersih / 10000).
async function hitungTotal(conn, { items, memberKode }) {
  const detail = [];
  let kotor = 0;
  for (const it of items) {
    const [pRows] = await conn.query(
      'SELECT nama, origin, harga_jual FROM produk WHERE barcode = ?',
      [it.barcode]
    );
    if (!pRows.length) throw new HttpError(400, `Produk ${it.barcode} tidak terdaftar di katalog`);
    const p = pRows[0];
    const harga = it.harga_jual > 0 ? it.harga_jual : p.harga_jual;
    const subtotal = it.qty * harga;
    kotor += subtotal;
    detail.push({ barcode: it.barcode, nama: p.nama, origin: p.origin, qty: it.qty, harga_jual: harga, subtotal });
  }
  let member = null;
  if (memberKode) {
    const [mRows] = await conn.query('SELECT kode, poin FROM member WHERE kode = ?', [memberKode]);
    if (!mRows.length) throw new HttpError(400, `Member ${memberKode} tidak ditemukan`);
    member = mRows[0];
  }
  const diskon = member ? Math.round(kotor * 0.05) : 0; // member: diskon 5%
  const bersih = kotor - diskon;
  return { items, detail, kotor, diskon, bersih, member, poinTambahan: Math.floor(bersih / 10000) };
}

// KUNCI BARIS STOK (SELECT ... FOR UPDATE) lalu potong.
// Stok kurang -> HttpError 409 berisi detail [{barcode, tersedia}]
// (kontrak: 409 utk checkout; sync mengubahnya jadi status ABORT + reason).
async function kunciDanPotongStok(conn, node, items) {
  const kurang = [];
  for (const it of items) { // items sudah terurut barcode
    const [sRows] = await conn.query(
      'SELECT qty FROM stok_cabang WHERE cabang_kode = ? AND barcode = ? FOR UPDATE',
      [node, it.barcode]
    );
    const tersedia = sRows.length ? sRows[0].qty : 0;
    if (tersedia < it.qty) kurang.push({ barcode: it.barcode, tersedia });
  }
  if (kurang.length) {
    throw new HttpError(409, 'Stok tidak cukup untuk menyelesaikan transaksi', { detail: kurang });
  }
  for (const it of items) {
    await conn.query(
      'UPDATE stok_cabang SET qty = qty - ? WHERE cabang_kode = ? AND barcode = ?',
      [it.qty, node, it.barcode]
    );
  }
}

// Tulis baris detail_transaksi (dgn snapshot nama & origin saat penjualan)
async function tulisDetail(conn, noStruk, detail) {
  for (const d of detail) {
    await conn.query(
      'INSERT INTO detail_transaksi (no_struk, barcode, nama, origin, qty, harga_jual, subtotal) VALUES (?,?,?,?,?,?,?)',
      [noStruk, d.barcode, d.nama, d.origin, d.qty, d.harga_jual, d.subtotal]
    );
  }
}

// Tambah poin member (poin += floor(bersih/10000)); kembalikan poin terbaru
async function tambahPoin(conn, memberKode, bersih) {
  await conn.query('UPDATE member SET poin = poin + ? WHERE kode = ?', [Math.floor(bersih / 10000), memberKode]);
  const [mRows] = await conn.query('SELECT poin FROM member WHERE kode = ?', [memberKode]);
  return mRows.length ? mRows[0].poin : 0;
}

// Normalisasi created_at dari payload offline (ISO / 'YYYY-MM-DD HH:MM:SS')
// menjadi Date utk kolom DATETIME; invalid -> pakai waktu sekarang.
function waktuDari(v) {
  const d = v ? new Date(v) : new Date();
  return isNaN(d.getTime()) ? new Date() : d;
}

module.exports = { gabungItems, hitungTotal, kunciDanPotongStok, tulisDetail, tambahPoin, waktuDari };
