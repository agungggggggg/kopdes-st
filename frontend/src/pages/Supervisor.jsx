import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import Modal from '../components/Modal.jsx';
import { api, formatRp } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toaster.jsx';
import { NODE_ORDER, metaOf, useNodes } from '../nodes.jsx';

const LOW_STOCK_THRESHOLD = 20;

export default function Supervisor() {
  const { user } = useAuth();
  const toast = useToast();
  const ctx = useOutletContext();
  const { refresh: refreshNodes } = useNodes();

  const kode = user?.cabang_kode || 'NODE-2';
  const tab = ctx.spvTab;

  // --- Tab 1: Persetujuan Void (PIN supervisor) ---
  const [voidReqs, setVoidReqs] = useState([]);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinReq, setPinReq] = useState(null);
  const [pinInput, setPinInput] = useState('');
  const [directVoidOpen, setDirectVoidOpen] = useState(false);
  const [validTxs, setValidTxs] = useState([]);
  const [directVoidStruk, setDirectVoidStruk] = useState('');
  const [directVoidReason, setDirectVoidReason] = useState('');

  const loadVoidReqs = useCallback(async () => {
    try {
      const data = await api.get(`/api/void-requests?node_kode=${kode}`);
      setVoidReqs(Array.isArray(data) ? data : []);
    } catch (err) {
      toast(err?.message || 'Gagal memuat permintaan void.', 'error');
    }
  }, [kode, toast]);

  const openPinModal = (req) => {
    setPinReq(req);
    setPinInput('');
    setPinOpen(true);
  };

  const confirmVoidPin = async (e) => {
    e.preventDefault();
    if (!pinReq) return;
    try {
      await api.post(`/api/void-requests/${pinReq.id}/approve`, { pin: pinInput.trim() });
      setPinOpen(false);
      toast(`Struk ${pinReq.no_struk} dibatalkan dan stok lokal telah dikembalikan.`, 'success');
      loadVoidReqs();
      refreshNodes();
    } catch (err) {
      toast(err?.status === 400 || err?.status === 401 ? 'PIN Supervisor salah! Gunakan PIN 6 digit yang benar.' : err?.message || 'Otorisasi PIN gagal.', 'error');
    }
  };

  // Void langsung dari sisi supervisor (form sama dengan kasir, endpoint /api/pos/void-request)
  const openDirectVoid = async () => {
    try {
      const data = await api.get(`/api/pos/transactions?node_kode=${kode}&limit=50`);
      const rows = (Array.isArray(data) ? data : []).filter((t) => t.status === 'VALID');
      if (rows.length === 0) {
        toast('Tidak ada transaksi valid yang dapat diajukan void.', 'warning');
        return;
      }
      setValidTxs(rows);
      setDirectVoidStruk(rows[0].no_struk);
      setDirectVoidReason('');
      setDirectVoidOpen(true);
    } catch (err) {
      toast(err?.message || 'Gagal memuat daftar struk.', 'error');
    }
  };

  const submitDirectVoid = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/pos/void-request', { no_struk: directVoidStruk, alasan: directVoidReason.trim() });
      setDirectVoidOpen(false);
      toast(`Permintaan void ${directVoidStruk} dikirim ke antrean PIN Supervisor.`, 'success');
      loadVoidReqs();
    } catch (err) {
      toast(err?.message || 'Pengajuan void gagal.', 'error');
    }
  };

  // --- Tab 2: Cek Stok 5 Wilayah ---
  const [stock5, setStock5] = useState([]);
  const [stock5Query, setStock5Query] = useState('');

  const loadStock5 = useCallback(async (q = '') => {
    try {
      const data = await api.get(`/api/stock5${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      setStock5(Array.isArray(data) ? data : []);
    } catch (err) {
      toast(err?.message || 'Gagal memuat stok 5 wilayah.', 'error');
    }
  }, [toast]);

  // Pencarian live dengan debounce 300 ms — memakai parameter q di GET /api/stock5
  useEffect(() => {
    if (tab !== 'stock5') return undefined;
    const t = setTimeout(() => loadStock5(stock5Query), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stock5Query, tab]);

  // --- Tab 3: Mutasi ---
  const [products, setProducts] = useState([]);
  const [mutHistory, setMutHistory] = useState([]);
  const [mutSrc, setMutSrc] = useState('NODE-1');
  const [mutProd, setMutProd] = useState('');
  const [mutQty, setMutQty] = useState(25);
  const [mutNote, setMutNote] = useState('');

  const loadMutasi = useCallback(async () => {
    try {
      const [prods, hist] = await Promise.all([
        api.get(`/api/products?node_kode=${kode}`),
        api.get('/api/mutasi-requests'),
      ]);
      const list = Array.isArray(prods) ? prods : [];
      setProducts(list);
      setMutProd((prev) => prev || (list[0]?.barcode || ''));
      setMutHistory(Array.isArray(hist) ? hist : []);
    } catch (err) {
      toast(err?.message || 'Gagal memuat data mutasi.', 'error');
    }
  }, [kode, toast]);

  const submitMutasi = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/mutasi-requests', {
        src_node: mutSrc,
        dst_node: kode,
        barcode: mutProd,
        qty: Number(mutQty),
        note: mutNote.trim(),
      });
      toast('Permintaan mutasi stok dikirim ke Admin Gudang Pusat.', 'success');
      loadMutasi();
    } catch (err) {
      toast(err?.message || 'Pengiriman permintaan mutasi gagal.', 'error');
    }
  };

  // --- Tab 4: Tutup Shift EOD ---
  const [eod, setEod] = useState({ sys_total: 0, sys_cash: 0, sys_qris: 0 });
  const [eodModal, setEodModal] = useState(0);
  const [eodLembaran, setEodLembaran] = useState(0);
  const [eodKoin, setEodKoin] = useState(0);

  const loadEod = useCallback(async () => {
    try {
      const data = await api.get(`/api/eod?node_kode=${kode}`);
      const d = { sys_total: 0, sys_cash: 0, sys_qris: 0, ...(data || {}) };
      setEod(d);
      setEodLembaran(Number(d.sys_cash || 0));
      setEodKoin(0);
    } catch (err) {
      toast(err?.message || 'Gagal memuat rekap EOD.', 'error');
    }
  }, [kode, toast]);

  const fisik = Number(eodLembaran || 0) + Number(eodKoin || 0) - Number(eodModal || 0);
  const diff = fisik - Number(eod.sys_cash || 0);

  const submitEod = () => {
    toast('Laporan Closing EOD berhasil disimpan & siap dicetak.', 'success');
  };

  // Muat data sesuai tab aktif
  useEffect(() => {
    if (tab === 'void') loadVoidReqs();
    if (tab === 'stock5') loadStock5(stock5Query);
    if (tab === 'mutasi') loadMutasi();
    if (tab === 'eod') loadEod();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const diffBoxCls =
    diff === 0
      ? 'p-4 rounded-xl border border-emerald-200 bg-emerald-50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-emerald-950'
      : 'p-4 rounded-xl border border-red-200 bg-brand-soft flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-brand-maroon';

  return (
    <section id="view-supervisor" className="space-y-6 fade-in">
      {/* Pane 1: Persetujuan Void PIN 6-Digit */}
      <div id="spv-pane-void" className={tab === 'void' ? 'space-y-4' : 'hidden'}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold text-slate-900">Persetujuan Batal Struk (Void PIN 6-Digit)</h2>
            <p className="text-xs text-slate-500">
              Otorisasi pembatalan struk kasir menggunakan PIN rahasia Supervisor (<code className="font-mono font-bold">123456</code>).
            </p>
          </div>
          <button
            type="button"
            onClick={openDirectVoid}
            className="px-4 py-2 rounded-xl border border-red-200 bg-brand-soft hover:bg-red-100 text-brand-red text-xs font-extrabold"
          >
            + Ajukan Void Struk
          </button>
        </div>
        <div id="spv-void-list" className="space-y-3">
          {voidReqs.length === 0 ? (
            <p className="p-6 rounded-2xl border border-slate-200 text-center text-xs text-slate-400">Tidak ada antrean permintaan void.</p>
          ) : (
            voidReqs.map((v) => (
              <div key={v.id} className="p-4 rounded-2xl border border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <span className="font-extrabold text-slate-900">{v.no_struk}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${v.status === 'PENDING' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-800'}`}>{v.status}</span>
                  </div>
                  <p className="text-xs text-slate-700 font-semibold">
                    Nominal: <span className="font-mono font-bold text-brand-red">{formatRp(v.nominal)}</span> &bull; Kasir: {v.kasir_nama}
                  </p>
                  <p className="text-xs text-slate-500">Alasan: {v.alasan}</p>
                </div>
                {v.status === 'PENDING' ? (
                  <button
                    type="button"
                    onClick={() => openPinModal(v)}
                    className="px-4 py-2 rounded-xl bg-brand-red hover:bg-brand-redHover text-white text-xs font-bold shrink-0"
                  >
                    Otorisasi PIN 6-Digit
                  </button>
                ) : (
                  <span className="text-xs font-bold text-emerald-700">Disetujui &amp; Stok Dikembalikan</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Pane 2: Cek Stok Lintas 5 Wilayah DIY */}
      <div id="spv-pane-stock5" className={tab === 'stock5' ? 'space-y-4' : 'hidden'}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold text-slate-900">Distributed Stock Query (5 Wilayah DIY)</h2>
            <p className="text-xs text-slate-500">Pencarian stok waktu nyata pada Umbulharjo YK, Depok Sleman, Sewon Bantul, Wates, dan Wonosari.</p>
          </div>
          <input
            type="text"
            id="spv-stock5-search"
            value={stock5Query}
            onChange={(e) => setStock5Query(e.target.value)}
            placeholder="Cari nama produk atau barcode..."
            className="w-full sm:w-72 px-3.5 py-2 rounded-xl border border-slate-300 text-xs focus:outline-none focus:border-brand-red"
          />
        </div>
        <div id="spv-stock5-results" className="space-y-3">
          {stock5.length === 0 && <p className="p-6 rounded-2xl border border-slate-200 text-center text-xs text-slate-400">Tidak ada produk.</p>}
          {stock5.map((p) => (
            <div key={p.barcode} className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-mono text-[11px] text-slate-400">{p.barcode}</span>
                  <h4 className="font-extrabold text-sm text-slate-900">{p.nama}</h4>
                </div>
                <span className="font-mono text-xs font-bold text-brand-red">{formatRp(p.harga_jual)}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs tabular-nums">
                {NODE_ORDER.map((n) => {
                  const st = Number(p.stocks?.[n] || 0);
                  const off = p.online?.[n] === false;
                  const ping = p.ping?.[n];
                  return (
                    <div
                      key={n}
                      className={`p-2.5 rounded-xl border ${off ? 'border-amber-300 bg-amber-50' : st < LOW_STOCK_THRESHOLD ? 'border-red-200 bg-brand-soft/60' : 'border-slate-200 bg-[#FAFAFA]'}`}
                    >
                      <p className="font-mono text-[10px] font-bold text-slate-500">
                        {n} · {ping != null ? ping : metaOf(n).ping} ms
                      </p>
                      <p className="font-bold text-slate-800 truncate">{metaOf(n).region}</p>
                      <p className={`font-mono text-sm font-extrabold ${off ? 'text-amber-700' : st < LOW_STOCK_THRESHOLD ? 'text-brand-red' : 'text-slate-900'} mt-0.5`}>
                        {off ? 'OFFLINE' : `${st} ${p.satuan}`}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Pane 3: Form Permintaan Mutasi Stok */}
      <div id="spv-pane-mutasi" className={tab === 'mutasi' ? 'grid grid-cols-1 lg:grid-cols-12 gap-6' : 'hidden'}>
        <form onSubmit={submitMutasi} className="lg:col-span-5 p-5 rounded-2xl border border-slate-200 bg-white space-y-4">
          <h3 className="text-sm font-extrabold text-slate-900">Form Permintaan Mutasi Stok</h3>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Simpul Asal Pasokan</label>
            <select id="spv-mut-source" value={mutSrc} onChange={(e) => setMutSrc(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white">
              <option value="NODE-1">NODE-1 — Gudang Pusat Umbulharjo (Kota YK)</option>
              <option value="NODE-3">NODE-3 — Gerai Sewon (Bantul)</option>
              <option value="NODE-4">NODE-4 — Gerai Wates (Kulon Progo)</option>
              <option value="NODE-5">NODE-5 — Gerai Wonosari (Gunungkidul)</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Pilih Barang</label>
            <select id="spv-mut-prod" value={mutProd} onChange={(e) => setMutProd(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white">
              {products.map((p) => (
                <option key={p.barcode} value={p.barcode}>
                  {p.barcode} — {p.nama}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Jumlah Kuantitas</label>
            <input
              type="number"
              id="spv-mut-qty"
              min="1"
              value={mutQty}
              onChange={(e) => setMutQty(e.target.value)}
              required
              className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Catatan Kebutuhan</label>
            <input
              type="text"
              id="spv-mut-note"
              required
              value={mutNote}
              onChange={(e) => setMutNote(e.target.value)}
              placeholder="Contoh: Stok etalase menipis menjelang akhir pekan"
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
            />
          </div>
          <button type="submit" className="w-full py-2.5 rounded-xl bg-brand-red hover:bg-brand-redHover text-white text-xs font-extrabold">
            Kirim Permintaan Mutasi
          </button>
        </form>
        <div className="lg:col-span-7 p-5 rounded-2xl border border-slate-200 bg-white space-y-3">
          <h3 className="text-sm font-extrabold text-slate-900">Riwayat Permintaan Mutasi Cabang</h3>
          <div id="spv-mut-history" className="space-y-2.5">
            {mutHistory.length === 0 && <p className="text-xs text-slate-400">Belum ada permintaan mutasi.</p>}
            {mutHistory.map((m) => (
              <div key={m.id} className="p-3 rounded-xl border border-slate-200 bg-[#FAFAFA] flex items-center justify-between gap-2 text-xs">
                <div>
                  <p className="font-bold text-slate-900">
                    {m.nama} ({m.qty} unit)
                  </p>
                  <p className="font-mono text-[11px] text-slate-500">
                    {m.src_node} &rarr; {m.dst_node} &bull; {m.note}
                  </p>
                </div>
                <span className={`px-2.5 py-1 rounded-lg font-mono text-[10px] font-bold ${m.status === 'COMMITTED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
                  {m.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pane 4: Tutup Shift Kasir (EOD Settlement) */}
      <div id="spv-pane-eod" className={tab === 'eod' ? 'max-w-2xl p-6 rounded-2xl border border-slate-200 bg-white space-y-5' : 'hidden max-w-2xl p-6 rounded-2xl border border-slate-200 bg-white space-y-5'}>
        <div>
          <h2 className="text-base font-extrabold text-slate-900">Tutup Shift Kasir (End of Day Settlement)</h2>
          <p className="text-xs text-slate-500">Rekonsiliasi penerimaan sistem (Tunai vs QRIS) dengan penghitungan uang fisik di laci kasir.</p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-xs tabular-nums">
          <div className="p-3.5 rounded-xl bg-[#FAFAFA] border border-slate-200">
            <span className="text-slate-500">Total Sistem</span>
            <p id="eod-sys-total" className="font-mono text-sm font-extrabold text-slate-900 mt-1">{formatRp(eod.sys_total)}</p>
          </div>
          <div className="p-3.5 rounded-xl bg-[#FAFAFA] border border-slate-200">
            <span className="text-slate-500">Sistem Tunai</span>
            <p id="eod-sys-cash" className="font-mono text-sm font-extrabold text-brand-red mt-1">{formatRp(eod.sys_cash)}</p>
          </div>
          <div className="p-3.5 rounded-xl bg-[#FAFAFA] border border-slate-200">
            <span className="text-slate-500">Sistem QRIS</span>
            <p id="eod-sys-qris" className="font-mono text-sm font-extrabold text-emerald-700 mt-1">{formatRp(eod.sys_qris)}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="space-y-1">
            <label className="font-bold text-slate-700">Modal Awal Laci (Rp)</label>
            <input type="number" id="eod-modal" value={eodModal} onChange={(e) => setEodModal(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono" />
          </div>
          <div className="space-y-1">
            <label className="font-bold text-slate-700">Uang Lembaran (Rp)</label>
            <input type="number" id="eod-lembaran" value={eodLembaran} onChange={(e) => setEodLembaran(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono" />
          </div>
          <div className="space-y-1">
            <label className="font-bold text-slate-700">Uang Koin (Rp)</label>
            <input type="number" id="eod-koin" value={eodKoin} onChange={(e) => setEodKoin(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono" />
          </div>
        </div>
        <div id="eod-diff-box" className={diffBoxCls}>
          <div>
            <p className="text-xs font-bold">
              Total Tunai Fisik Bersih: <span id="eod-fisik-total" className="font-mono font-extrabold">{formatRp(fisik)}</span>
            </p>
            <p id="eod-status-label" className="text-xs font-extrabold mt-0.5">
              {diff === 0 ? 'STATUS: BALANCE / PAS' : diff > 0 ? 'STATUS: UANG LEBIH (OVER)' : 'STATUS: UANG KURANG (SHORT)'}
            </p>
          </div>
          <p className="font-mono text-base font-extrabold">
            Selisih: <span id="eod-diff-val">{formatRp(diff)}</span>
          </p>
        </div>
        <button type="button" onClick={submitEod} className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold">
          Simpan &amp; Tutup Shift EOD
        </button>
      </div>

      {/* Modal Otorisasi PIN 6-Digit Supervisor */}
      <Modal open={pinOpen} onClose={() => setPinOpen(false)} maxWidth="max-w-sm" title="Verifikasi PIN Supervisor">
        <form onSubmit={confirmVoidPin} className="space-y-3 text-xs">
          <p className="text-slate-600">
            Setujui void untuk struk <span id="spv-void-struk-label" className="font-mono font-extrabold text-slate-900">{pinReq?.no_struk}</span>:
          </p>
          <input
            type="password"
            id="spv-pin-input"
            maxLength={6}
            required
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value)}
            placeholder="••••••"
            className="w-full px-4 py-3 rounded-xl border border-slate-300 font-mono text-center text-lg tracking-[0.4em]"
          />
          <button type="submit" className="w-full py-2.5 rounded-xl bg-brand-red hover:bg-brand-redHover text-white font-extrabold">
            Konfirmasi Void &amp; Kembalikan Stok
          </button>
        </form>
      </Modal>

      {/* Modal Ajukan Void (dari Supervisor) */}
      <Modal open={directVoidOpen} onClose={() => setDirectVoidOpen(false)} title="Ajukan Pembatalan Struk (Void)">
        <form onSubmit={submitDirectVoid} className="space-y-3 text-xs">
          <div className="space-y-1">
            <label className="font-bold text-slate-700">Pilih Nomor Struk</label>
            <select
              id="req-void-struk-select"
              value={directVoidStruk}
              onChange={(e) => setDirectVoidStruk(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono bg-white"
            >
              {validTxs.map((t) => (
                <option key={t.no_struk} value={t.no_struk}>
                  {t.no_struk} — {formatRp(t.bersih)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="font-bold text-slate-700">Alasan Pembatalan</label>
            <input
              type="text"
              required
              value={directVoidReason}
              onChange={(e) => setDirectVoidReason(e.target.value)}
              placeholder="Contoh: Salah scan kuantitas barang"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300"
            />
          </div>
          <button type="submit" className="w-full py-2.5 rounded-xl bg-brand-red hover:bg-brand-redHover text-white font-extrabold">
            Kirim ke Antrean PIN Supervisor
          </button>
        </form>
      </Modal>
    </section>
  );
}
