// =====================================================================
// ROUTE MANAJER - dashboard RAT level DIY. Seluruh /api/manajer/* hanya MANAJER.
//   GET /api/manajer/kpi          -> {total_diy, per_node[{node_kode,region,omzet}]}
//   GET /api/manajer/hourly       -> bucket omzet jam 09:00-16:00 hari ini
//   GET /api/manajer/composition  -> {umkm{nilai,pct}, pabrikan{nilai,pct}}
//   GET /api/manajer/audit        -> jejak audit (default 50)
//   GET /api/manajer/export/csv   -> unduhan CSV (attachment, header text/csv)
//   GET /api/manajer/report.html  -> laporan RAT siap print (Ctrl+P -> PDF)
// =====================================================================
const express = require('express');
const { query } = require('../config/db');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// Guard role untuk SEMUA endpoint di file ini
router.use(requireRole('MANAJER'));

// Omzet transaksi VALID per node (kelima node selalu tampil walau 0)
async function omzetPerNode() {
  return query(
    `SELECT c.kode AS node_kode, c.region, COALESCE(SUM(t.bersih), 0) AS omzet
       FROM cabang c
       LEFT JOIN transaksi_pos t ON t.cabang_kode = c.kode AND t.status = 'VALID'
      GROUP BY c.kode, c.region
      ORDER BY c.id`
  );
}

// Komposisi omzet UMKM Desa vs Pabrikan dari detail transaksi VALID
// (persen dibulatkan seperti prototype: pctUmkm = round(umkm/total*100))
async function komposisi() {
  const rows = await query(
    `SELECT d.origin, COALESCE(SUM(d.qty * d.harga_jual), 0) AS nilai
       FROM detail_transaksi d
       JOIN transaksi_pos t ON t.no_struk = d.no_struk AND t.status = 'VALID'
      GROUP BY d.origin`
  );
  let umkm = 0;
  let pabrikan = 0;
  for (const r of rows) {
    if (r.origin === 'UMKM Desa') umkm += Number(r.nilai || 0);
    else pabrikan += Number(r.nilai || 0);
  }
  const total = umkm + pabrikan;
  const pctUmkm = total > 0 ? Math.round((umkm / total) * 100) : 0;
  return { umkm: { nilai: umkm, pct: pctUmkm }, pabrikan: { nilai: pabrikan, pct: 100 - pctUmkm } };
}

// GET /api/manajer/kpi
router.get('/manajer/kpi', async (req, res) => {
  const perNode = await omzetPerNode();
  const totalDiy = perNode.reduce((a, r) => a + Number(r.omzet || 0), 0);
  res.json({
    total_diy: totalDiy,
    per_node: perNode.map(r => ({ node_kode: r.node_kode, region: r.region, omzet: Number(r.omzet || 0) })),
  });
});

// GET /api/manajer/hourly - bucket 09:00 s.d. 16:00 hari ini (transaksi VALID)
router.get('/manajer/hourly', async (req, res) => {
  const rows = await query(
    `SELECT HOUR(waktu) AS jam, COALESCE(SUM(bersih), 0) AS omzet
       FROM transaksi_pos
      WHERE status = 'VALID' AND DATE(waktu) = CURDATE() AND HOUR(waktu) BETWEEN 9 AND 16
      GROUP BY HOUR(waktu)`
  );
  const map = new Map(rows.map(r => [Number(r.jam), Number(r.omzet || 0)]));
  const buckets = [];
  for (let h = 9; h <= 16; h++) {
    buckets.push({ jam: `${String(h).padStart(2, '0')}:00`, omzet: map.get(h) || 0 });
  }
  res.json(buckets);
});

// GET /api/manajer/composition
router.get('/manajer/composition', async (req, res) => {
  res.json(await komposisi());
});

// GET /api/manajer/audit?limit=50
router.get('/manajer/audit', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200);
  res.json(await query(
    `SELECT waktu, aktor_kode, aktor_nama, tipe, detail, node FROM audit_log ORDER BY id DESC LIMIT ${limit}`
  ));
});

// GET /api/manajer/export/csv - text/csv + Content-Disposition attachment
router.get('/manajer/export/csv', async (req, res) => {
  const rows = await query(
    `SELECT no_struk, cabang_kode, waktu, kasir_nama, metode, bersih
       FROM transaksi_pos WHERE status = 'VALID' ORDER BY waktu ASC`
  );
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = ['No Struk,Node,Waktu,Kasir,Metode,Total Bersih'];
  let total = 0;
  for (const r of rows) {
    total += Number(r.bersih || 0);
    lines.push([r.no_struk, r.cabang_kode, r.waktu, r.kasir_nama, r.metode, r.bersih].map(esc).join(','));
  }
  lines.push(`Total,,,,,${total}`);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="Laporan_Keuangan_RAT_Kopdes_Mart_DIY.csv"');
  res.send('\uFEFF' + lines.join('\n')); // BOM agar Excel membaca UTF-8 dgn benar
});

// GET /api/manajer/report.html - HTML lengkap: tabel per node + total,
// inline style minimal (warna brand), tombol print disembunyikan saat cetak.
router.get('/manajer/report.html', async (req, res) => {
  const perNode = await omzetPerNode();
  const comp = await komposisi();
  const nodeInfo = await query('SELECT kode, nama, region FROM cabang ORDER BY id');
  const txs = await query(
    `SELECT no_struk, cabang_kode, waktu, kasir_nama, member_kode, metode, bersih
       FROM transaksi_pos WHERE status = 'VALID' ORDER BY cabang_kode ASC, waktu ASC`
  );
  const escHtml = (v) => String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

  // Kelompokkan transaksi per node
  const byNode = {};
  for (const t of txs) {
    if (!byNode[t.cabang_kode]) byNode[t.cabang_kode] = [];
    byNode[t.cabang_kode].push(t);
  }

  let totalBersih = 0;
  const sections = nodeInfo.map((n) => {
    const list = byNode[n.kode] || [];
    const subtotal = list.reduce((a, t) => a + Number(t.bersih || 0), 0);
    totalBersih += subtotal;
    const baris = list.map(t => `
        <tr>
          <td>${escHtml(t.no_struk)}</td>
          <td>${escHtml(t.waktu)}</td>
          <td>${escHtml(t.kasir_nama || '-')}</td>
          <td>${escHtml(t.member_kode || 'Umum')}</td>
          <td>${escHtml(t.metode)}</td>
          <td style="text-align:right">${rp(t.bersih)}</td>
        </tr>`).join('');
    return `
      <h2>${escHtml(n.kode)} - ${escHtml(n.nama)} (${escHtml(n.region)})</h2>
      <table>
        <tr><th>No Struk</th><th>Waktu</th><th>Kasir</th><th>Member</th><th>Metode</th><th style="text-align:right">Bersih</th></tr>
        ${baris || '<tr><td colspan="6" style="text-align:center;color:#888">Belum ada transaksi</td></tr>'}
        <tr class="tot"><td colspan="5">Subtotal ${escHtml(n.kode)}</td><td style="text-align:right">${rp(subtotal)}</td></tr>
      </table>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>Laporan RAT - Kopdes Mart DIY</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; margin: 36px; }
  h1 { color: #D61F26; font-size: 20px; margin: 0 0 4px; }
  .sub { color: #4A080C; font-size: 12px; margin-bottom: 20px; }
  h2 { font-size: 14px; color: #4A080C; margin: 22px 0 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #4A080C; color: #fff; text-align: left; padding: 6px 8px; }
  td { border-bottom: 1px solid #FCE7E8; padding: 5px 8px; }
  .tot td { font-weight: bold; color: #4A080C; background: #FFF5F5; }
  .ringkas { font-size: 12px; margin-top: 18px; padding: 10px 14px; border: 1px solid #FECACA; border-radius: 8px; background: #FFF5F5; }
  .btn { margin: 18px 0; padding: 8px 16px; background: #C81E25; color: #fff; border: 0; border-radius: 8px; font-weight: bold; cursor: pointer; }
  @media print { .btn { display: none; } body { margin: 12px; } }
</style>
</head>
<body>
  <button class="btn" onclick="window.print()">Cetak / Simpan PDF (Ctrl+P)</button>
  <h1>Laporan Rapat Anggota Tahunan (RAT)</h1>
  <div class="sub">Kopdes Mart DIY - 5 Node (Master Hub Umbulharjo + 4 Gerai) &bull; dicetak ${new Date().toLocaleString('id-ID')} &bull; hanya transaksi berstatus VALID</div>
  ${sections}
  <div class="ringkas">
    <strong>Total omzet bersih DIY: ${rp(totalBersih)}</strong><br>
    Komposisi produk: UMKM Desa ${comp.umkm.pct}% (${rp(comp.umkm.nilai)}) &bull; Ritel Pabrikan ${comp.pabrikan.pct}% (${rp(comp.pabrikan.nilai)})
  </div>
</body>
</html>`;
  res.type('html').send(html);
});

module.exports = router;
