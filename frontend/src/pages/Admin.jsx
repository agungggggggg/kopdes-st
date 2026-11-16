import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api, formatRp } from '../api.js';
import { useToast } from '../components/Toaster.jsx';
import Modal from '../components/Modal.jsx';

const LOW_STOCK_THRESHOLD = 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EMPTY_STRIP = {
  1: { state: '', val: 'Menunggu' },
  2: { state: '', val: '0 / 2 commit' },
  3: { state: '', val: 'Menunggu' },
};

export default function Admin() {
  const toast = useToast();
  const ctx = useOutletContext();
  const tab = ctx.admTab;

  // --- Katalog produk induk ---
  const [products, setProducts] = useState([]);
  const [prodModalOpen, setProdModalOpen] = useState(false);
  const [prodEditing, setProdEditing] = useState(null); // null = tambah, objek = edit
  const [formProd, setFormProd] = useState({ barcode: '', kategori: 'Sembako', nama: '', hpp: '', harga_jual: '' });

  const loadProducts = useCallback(async () => {
    try {
      const data = await api.get('/api/admin/products');
      setProducts(Array.isArray(data) ? data : []);
    } catch (err) {
      toast(err?.message || 'Gagal memuat katalog induk.', 'error');
    }
  }, [toast]);

  const openProdModal = (p = null) => {
    setProdEditing(p);
    setFormProd(
      p
        ? { barcode: p.barcode, kategori: p.kategori || 'Sembako', nama: p.nama || '', hpp: p.hpp ?? '', harga_jual: p.harga_jual ?? '' }
        : { barcode: `89910${(products.length + 11).toString().padStart(2, '0')}`, kategori: 'Sembako', nama: '', hpp: '', harga_jual: '' }
    );
    setProdModalOpen(true);
  };

  const saveProduct = async (e) => {
    e.preventDefault();
    const body = {
      nama: formProd.nama.trim(),
      kategori: formProd.kategori,
      hpp: Number(formProd.hpp || 0),
      harga_jual: Number(formProd.harga_jual || 0),
    };
    try {
      if (prodEditing) {
        await api.put(`/api/admin/products/${prodEditing.barcode}`, body);
        toast('Data produk & harga berhasil disebarkan serentak ke 5 node DIY!', 'success');
      } else {
        await api.post('/api/admin/products', {
          barcode: formProd.barcode.trim(),
          nama: formProd.nama.trim(),
          kategori: formProd.kategori,
          origin: formProd.kategori === 'UMKM Desa' ? 'UMKM Desa' : 'Pabrikan',
          satuan: 'Unit',
          hpp: Number(formProd.hpp || 0),
          harga_jual: Number(formProd.harga_jual || 0),
        });
        toast('Produk baru direplikasi ke 5 wilayah DIY (stok awal: NODE-1 100, gerai 20)!', 'success');
      }
      setProdModalOpen(false);
      loadProducts();
    } catch (err) {
      toast(err?.message || 'Simpan produk gagal.', 'error');
    }
  };

  const deleteProduct = async (barcode) => {
    try {
      await api.del(`/api/admin/products/${barcode}`);
      toast('Produk dihapus dari katalog induk.', 'info');
      loadProducts();
    } catch (err) {
      toast(err?.message || 'Hapus produk gagal.', 'error');
    }
  };

  // --- Broadcast harga ---
  const [broadcasts, setBroadcasts] = useState([]);
  const broadcastBusy = useRef(false);

  const loadBroadcasts = useCallback(async () => {
    try {
      const data = await api.get('/api/admin/broadcasts');
      setBroadcasts(Array.isArray(data) ? data : []);
    } catch {
      setBroadcasts([]);
    }
  }, []);

  const broadcastOne = async (p) => {
    try {
      await api.post('/api/admin/broadcast', { barcode: p.barcode, harga_jual: Number(p.harga_jual) });
      toast(`Harga ${p.nama} (${formatRp(p.harga_jual)}) di-broadcast ke outbox 5 node.`, 'success');
      loadBroadcasts();
    } catch (err) {
      toast(err?.message || 'Broadcast harga gagal.', 'error');
    }
  };

  const broadcastAll = async () => {
    if (broadcastBusy.current) return;
    broadcastBusy.current = true;
    let ok = 0;
    try {
      for (const p of products) {
        try {
          await api.post('/api/admin/broadcast', { barcode: p.barcode, harga_jual: Number(p.harga_jual) });
          ok += 1;
        } catch {
          /* lanjut produk berikutnya */
        }
      }
      toast(`Broadcast selesai: ${ok}/${products.length} katalog harga dikirim ke 5/5 mesin kasir.`, 'success');
      loadBroadcasts();
    } finally {
      broadcastBusy.current = false;
    }
  };

  // --- Matriks stok ---
  const [matrix, setMatrix] = useState([]);

  const loadMatrix = useCallback(async () => {
    try {
      const data = await api.get('/api/admin/matrix');
      setMatrix(Array.isArray(data) ? data : []);
    } catch (err) {
      toast(err?.message || 'Gagal memuat matriks stok.', 'error');
    }
  }, [toast]);

  // --- Orkestrator 2PC ---
  const [pcSrc, setPcSrc] = useState('NODE-1');
  const [pcDst, setPcDst] = useState('NODE-2');
  const [pcProd, setPcProd] = useState('');
  const [pcQty, setPcQty] = useState(30);
  const [pcScenario, setPcScenario] = useState('normal');
  const [pcRunning, setPcRunning] = useState(false);
  const [pcStrip, setPcStrip] = useState(EMPTY_STRIP);
  const [pcConsole, setPcConsole] = useState([{ text: 'Siap mengeksekusi mutasi stok atomik antar-node DIY...', cls: 'text-slate-300' }]);
  const [mutQueue, setMutQueue] = useState([]);

  const appendConsole = (text, cls) => {
    setPcConsole((c) => [...c, { text, cls }]);
  };

  const loadMutQueue = useCallback(async () => {
    try {
      const data = await api.get('/api/admin/mutasi-queue');
      setMutQueue(Array.isArray(data) ? data : []);
    } catch {
      setMutQueue([]);
    }
  }, []);

  const run2pc = async (src, dst, barcode, qty, scenario) => {
    if (pcRunning) return;
    if (src === dst) {
      toast('Simpul pengirim dan penerima tidak boleh sama.', 'error');
      return;
    }
    if (!barcode) {
      toast('Pilih produk terlebih dahulu.', 'warning');
      return;
    }
    setPcRunning(true);
    setPcConsole([]);
    setPcStrip({ 1: { state: 'active', val: 'Mengunci stok…' }, 2: { state: '', val: '0 / 2 commit' }, 3: { state: '', val: 'Menunggu' } });
    try {
      // Protokol 2PC dieksekusi di koordinator (backend); frontend menampilkan
      // fase yang dilaporkan berurutan dgn jeda agar alur konsensus terlihat.
      const res = await api.post('/api/admin/2pc/execute', {
        src_node: src,
        dst_node: dst,
        barcode,
        qty: Number(qty),
        simulate_timeout: scenario === 'timeout',
      });
      const phases = Array.isArray(res?.phases) ? res.phases : [];
      const aborted = res?.status === 'ABORTED';
      for (let i = 0; i < phases.length; i++) {
        const ph = phases[i];
        const idx = ph.fase === 'PREPARE' ? 1 : ph.fase === 'VOTE' ? 2 : 3;
        const cls = ph.fase === 'PREPARE' ? 'text-amber-300' : aborted ? 'text-red-400' : 'text-emerald-400';
        appendConsole(`[Phase: ${ph.fase}] ${ph.detail}`, cls);
        const state = aborted && ph.fase !== 'PREPARE' ? 'fail' : 'ok';
        setPcStrip((s) => ({ ...s, [idx]: { state, val: ph.detail } }));
        await sleep(550);
      }
      if (aborted) {
        setPcStrip((s) => ({ ...s, 3: { state: 'fail', val: s[3].val || 'GLOBAL_ABORT' } }));
        appendConsole('Rollback otomatis: kunci stok pengirim dilepas, kedua simpul kembali ke keadaan semula.', 'text-amber-300');
        toast('2PC ROLLBACK — tidak ada stok yang berpindah.', 'warning');
      } else {
        appendConsole(`[Phase 2: GLOBAL_COMMIT] Stok ${src} (-${qty}) & Stok ${dst} (+${qty}) → Status: 100% SUKSES`, 'text-emerald-400');
        toast(`Mutasi 2PC ${qty} unit (${src} → ${dst}) berhasil!`, 'success');
      }
      loadMutQueue();
      loadMatrix();
    } catch (err) {
      appendConsole(`[ERROR] ${err?.message || 'gagal eksekusi 2PC'}`, 'text-red-400');
      toast(err?.message || 'Eksekusi 2PC gagal.', 'error');
    } finally {
      setPcRunning(false);
    }
  };

  const submit2pcForm = (e) => {
    e.preventDefault();
    run2pc(pcSrc, pcDst, pcProd, pcQty, pcScenario);
  };

  // --- Inbound PO ---
  const [inboundHistory, setInboundHistory] = useState([]);
  const [poNo, setPoNo] = useState('PO-202611-012');
  const [poSj, setPoSj] = useState('SJ-882041');
  const [poSupplier, setPoSupplier] = useState('Bulog Divre DIY');
  const [poProd, setPoProd] = useState('');
  const [poTotal, setPoTotal] = useState(100);
  const [poBad, setPoBad] = useState(2);
  const poGood = Math.max(0, Number(poTotal || 0) - Number(poBad || 0));

  const loadInbound = useCallback(async () => {
    try {
      const data = await api.get('/api/admin/inbound');
      setInboundHistory(Array.isArray(data) ? data : []);
    } catch {
      setInboundHistory([]);
    }
  }, []);

  const submitInbound = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/admin/inbound', {
        no_po: poNo.trim(),
        no_sj: poSj.trim(),
        supplier_id: poSupplier.trim(),
        barcode: poProd,
        total_datang: Number(poTotal || 0),
        rusak: Number(poBad || 0),
      });
      toast(`Verifikasi PO berhasil: +${poGood} unit ditambahkan ke Gudang Pusat.`, 'success');
      loadInbound();
      loadMatrix();
    } catch (err) {
      toast(err?.message || 'Verifikasi inbound PO gagal.', 'error');
    }
  };

  // Muat data sesuai tab aktif
  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (tab === 'katalog') loadProducts();
    if (tab === 'broadcast') {
      loadProducts();
      loadBroadcasts();
    }
    if (tab === 'matriks') loadMatrix();
    if (tab === 'mutasi2pc') {
      loadProducts();
      loadMutQueue();
    }
    if (tab === 'inbound') {
      loadProducts();
      loadInbound();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    setPcProd((prev) => prev || (products[0]?.barcode || ''));
    setPoProd((prev) => prev || (products[0]?.barcode || ''));
  }, [products]);

  const stripCls = (st) =>
    `p-3 rounded-xl border text-xs ${st === 'active' ? 'border-brand-red bg-brand-soft/60' : st === 'ok' ? 'border-emerald-200 bg-emerald-50' : st === 'fail' ? 'border-red-200 bg-brand-soft' : 'border-slate-200 bg-white'}`;

  return (
    <section id="view-admin-gudang" className="space-y-6 fade-in">
      {/* Pane 1: Master Katalog Produk */}
      <div id="adm-pane-katalog" className={tab === 'katalog' ? 'space-y-4' : 'hidden'}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold text-slate-900">Master Katalog Produk Induk Se-DIY</h2>
            <p className="text-xs text-slate-500">Tambah, ubah, atau hapus katalog produk yang direplikasi penuh ke 5 gerai.</p>
          </div>
          <button type="button" onClick={() => openProdModal(null)} className="px-4 py-2 rounded-xl bg-brand-red hover:bg-brand-redHover text-white text-xs font-extrabold">
            + Tambah Produk
          </button>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#FAFAFA] border-b border-slate-200 text-slate-500 font-bold">
                <th className="py-3 px-4">Barcode</th>
                <th className="py-3 px-4">Nama Produk</th>
                <th className="py-3 px-4 text-right">Harga Beli</th>
                <th className="py-3 px-4 text-right">Harga Jual</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody id="table-adm-katalog" className="divide-y divide-slate-100">
              {products.map((p) => (
                <tr key={p.barcode} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono font-bold text-slate-700">{p.barcode}</td>
                  <td className="py-3 px-4 font-bold text-slate-900">
                    {p.nama} <span className="text-[11px] font-normal text-slate-400">({p.kategori})</span>
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-slate-600">{formatRp(p.hpp)}</td>
                  <td className="py-3 px-4 text-right font-mono font-extrabold text-brand-red">{formatRp(p.harga_jual)}</td>
                  <td className="py-3 px-4 text-right space-x-1">
                    <button type="button" onClick={() => openProdModal(p)} className="px-2.5 py-1 rounded-lg border border-slate-300 text-xs font-bold hover:bg-slate-100">
                      Edit
                    </button>
                    <button type="button" onClick={() => deleteProduct(p.barcode)} className="px-2.5 py-1 rounded-lg border border-red-200 text-brand-red text-xs font-bold hover:bg-brand-soft">
                      Hapus
                    </button>
                  </td>
                </tr>
              ))}
              {products.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-slate-400">Katalog kosong.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pane 2: Broadcast Update Harga Serentak */}
      <div id="adm-pane-broadcast" className={tab === 'broadcast' ? 'space-y-4' : 'hidden'}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold text-slate-900">Broadcast Update Harga Serentak ke 5 Wilayah</h2>
            <p className="text-xs text-slate-500">Distribusi harga baru langsung ke seluruh terminal POS tanpa henti layanan.</p>
          </div>
          <button type="button" onClick={broadcastAll} className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold">
            Broadcast Semua Harga (5/5 Node)
          </button>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#FAFAFA] border-b border-slate-200 text-slate-500 font-bold">
                <th className="py-3 px-4">Barcode</th>
                <th className="py-3 px-4">Nama Produk</th>
                <th className="py-3 px-4 text-right">Harga Jual Aktif</th>
                <th className="py-3 px-4 text-center">Status Replikasi</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody id="table-adm-broadcast" className="divide-y divide-slate-100">
              {products.map((p) => (
                <tr key={p.barcode}>
                  <td className="py-3 px-4 font-mono font-bold">{p.barcode}</td>
                  <td className="py-3 px-4 font-bold text-slate-900">{p.nama}</td>
                  <td className="py-3 px-4 text-right font-mono font-extrabold text-brand-red">{formatRp(p.harga_jual)}</td>
                  <td className="py-3 px-4 text-center">
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-mono text-[11px] font-bold">5/5 Node Tersinkron</span>
                  </td>
                  <td className="py-3 px-4 text-right space-x-1">
                    <button type="button" onClick={() => broadcastOne(p)} className="px-3 py-1 rounded-lg bg-brand-red text-white text-xs font-bold">
                      Broadcast
                    </button>
                    <button type="button" onClick={() => openProdModal(p)} className="px-3 py-1 rounded-lg border border-slate-300 text-xs font-bold hover:bg-slate-100">
                      Ubah Harga
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Riwayat broadcast harga */}
        <div className="p-5 rounded-2xl border border-slate-200 bg-white space-y-3">
          <h3 className="text-sm font-extrabold text-slate-900">Riwayat Broadcast Update Harga</h3>
          <div className="space-y-2">
            {broadcasts.length === 0 && <p className="text-xs text-slate-400">Belum ada riwayat broadcast.</p>}
            {broadcasts.map((b, i) => (
              <div key={b.id || i} className="p-3 rounded-xl border border-slate-200 bg-[#FAFAFA] flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <p className="font-bold text-slate-900">
                    <span className="font-mono text-slate-400 mr-1.5">{b.barcode}</span>
                    {b.nama || ''}
                  </p>
                  <p className="font-mono text-[11px] text-slate-500">
                    Harga baru: {formatRp(b.harga_jual ?? b.harga_baru ?? 0)} {b.waktu ? `• ${b.waktu}` : ''}
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-mono text-[10px] font-bold">OUTBOX 5 NODE</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pane 3: Matriks Stok 5 Wilayah DIY */}
      <div id="adm-pane-matriks" className={tab === 'matriks' ? 'space-y-4' : 'hidden'}>
        <div>
          <h2 className="text-base font-extrabold text-slate-900">Matriks Stok Fisik 5 Wilayah DIY</h2>
          <p className="text-xs text-slate-500">Perbandingan persediaan Gudang Pusat Umbulharjo vs 4 gerai kabupaten.</p>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-left border-collapse text-xs tabular-nums">
            <thead>
              <tr className="bg-[#FAFAFA] border-b border-slate-200 text-slate-500 font-bold">
                <th className="py-3 px-4">Produk</th>
                <th className="py-3 px-4 text-center bg-brand-soft/60 text-brand-maroon">Pusat YK</th>
                <th className="py-3 px-4 text-center">Sleman</th>
                <th className="py-3 px-4 text-center">Bantul</th>
                <th className="py-3 px-4 text-center">K. Progo</th>
                <th className="py-3 px-4 text-center">G. Kidul</th>
                <th className="py-3 px-4 text-center">Total DIY</th>
              </tr>
            </thead>
            <tbody id="table-adm-matriks" className="divide-y divide-slate-100">
              {matrix.map((row) => {
                const cells = ['NODE-1', 'NODE-2', 'NODE-3', 'NODE-4', 'NODE-5'].map((n) => Number(row.stocks?.[n] || 0));
                const total = row.total != null ? Number(row.total) : cells.reduce((a, b) => a + b, 0);
                return (
                  <tr key={row.barcode}>
                    <td className="py-3 px-4">
                      <span className="font-mono text-slate-400 mr-1.5">{row.barcode}</span>
                      <strong className="text-slate-900">{row.nama}</strong>
                    </td>
                    <td className="py-3 px-4 text-center font-mono font-extrabold bg-brand-soft/40 text-brand-maroon">{cells[0]}</td>
                    {cells.slice(1).map((v, i) => (
                      <td key={i} className={`py-3 px-4 text-center font-mono ${v < LOW_STOCK_THRESHOLD ? 'text-brand-red font-bold' : ''}`}>
                        {v}
                      </td>
                    ))}
                    <td className="py-3 px-4 text-center font-mono font-extrabold text-slate-900">{total}</td>
                  </tr>
                );
              })}
              {matrix.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-400">Matriks belum tersedia.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pane 4: Eksekusi Mutasi Stok 2-Phase Commit (2PC) */}
      <div id="adm-pane-mutasi2pc" className={tab === 'mutasi2pc' ? 'grid grid-cols-1 lg:grid-cols-12 gap-6' : 'hidden'}>
        <form onSubmit={submit2pcForm} className="lg:col-span-5 p-5 rounded-2xl border border-slate-200 bg-white space-y-4">
          <h3 className="text-sm font-extrabold text-slate-900">Orkestrator Mutasi Stok 2-Phase Commit (2PC)</h3>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="space-y-1">
              <label className="font-bold text-slate-700">Simpul Pengirim</label>
              <select id="adm-2pc-src" value={pcSrc} onChange={(e) => setPcSrc(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white">
                <option value="NODE-1">NODE-1 (Pusat YK)</option>
                <option value="NODE-3">NODE-3 (Bantul)</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="font-bold text-slate-700">Simpul Penerima</label>
              <select id="adm-2pc-dst" value={pcDst} onChange={(e) => setPcDst(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white">
                <option value="NODE-2">NODE-2 (Sleman)</option>
                <option value="NODE-3">NODE-3 (Bantul)</option>
                <option value="NODE-4">NODE-4 (Kulon Progo)</option>
                <option value="NODE-5">NODE-5 (Gunungkidul)</option>
              </select>
            </div>
          </div>
          <div className="space-y-1 text-xs">
            <label className="font-bold text-slate-700">Produk</label>
            <select id="adm-2pc-prod" value={pcProd} onChange={(e) => setPcProd(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white">
              {products.map((p) => (
                <option key={p.barcode} value={p.barcode}>
                  {p.barcode} — {p.nama}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1 text-xs">
            <label className="font-bold text-slate-700">Kuantitas Transfer</label>
            <input type="number" id="adm-2pc-qty" min="1" value={pcQty} onChange={(e) => setPcQty(e.target.value)} required className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono" />
          </div>
          <div className="space-y-1 text-xs">
            <label className="font-bold text-slate-700">Skenario Pengujian</label>
            <select id="adm-2pc-scenario" value={pcScenario} onChange={(e) => setPcScenario(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white">
              <option value="normal">Normal — kedua simpul siaga</option>
              <option value="timeout">Simpul penerima tidak merespons (timeout)</option>
            </select>
          </div>
          <button type="submit" id="adm-2pc-run" disabled={pcRunning} className="w-full py-2.5 rounded-xl bg-brand-red hover:bg-brand-redHover text-white text-xs font-extrabold disabled:opacity-60">
            Eksekusi Mutasi 2PC
          </button>
        </form>

        <div className="lg:col-span-7 space-y-4">
          <div id="adm-2pc-phases" className="grid grid-cols-3 gap-2 text-xs">
            <div id="pc-ph-1" className={stripCls(pcStrip[1].state)}>
              <p className="font-mono text-[10px] font-bold text-slate-500">FASE 1 · PREPARE</p>
              <p className="font-extrabold text-slate-900 mt-0.5" id="pc-ph1-v">{pcStrip[1].val}</p>
            </div>
            <div id="pc-ph-2" className={stripCls(pcStrip[2].state)}>
              <p className="font-mono text-[10px] font-bold text-slate-500">VOTE</p>
              <p className="font-extrabold text-slate-900 mt-0.5" id="pc-ph2-v">{pcStrip[2].val}</p>
            </div>
            <div id="pc-ph-3" className={stripCls(pcStrip[3].state)}>
              <p className="font-mono text-[10px] font-bold text-slate-500">FASE 2 · KEPUTUSAN</p>
              <p className="font-extrabold text-slate-900 mt-0.5" id="pc-ph3-v">{pcStrip[3].val}</p>
            </div>
          </div>
          <div className="p-4 rounded-2xl bg-slate-900 text-slate-100 font-mono text-xs space-y-1.5">
            <p className="text-slate-400 font-bold">// Konsol Protokol Konsensus 2-Phase Commit</p>
            <div id="adm-2pc-console" className="space-y-1 text-[11px]">
              {pcConsole.map((l, i) => (
                <p key={i} className={l.cls}>&gt; {l.text}</p>
              ))}
            </div>
          </div>
          <div className="p-5 rounded-2xl border border-slate-200 bg-white space-y-3">
            <h3 className="text-sm font-extrabold text-slate-900">Antrean Permintaan Mutasi dari Cabang</h3>
            <div id="adm-restock-queue" className="space-y-2">
              {mutQueue.length === 0 && <p className="text-xs text-slate-400">Tidak ada antrean permintaan mutasi dari cabang.</p>}
              {mutQueue.map((m) => (
                <div key={m.id} className="p-3 rounded-xl border border-slate-200 bg-[#FAFAFA] flex items-center justify-between gap-2 text-xs">
                  <div>
                    <p className="font-bold text-slate-900">
                      {m.nama} ({m.qty} unit)
                    </p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {m.src_node} &rarr; {m.dst_node}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => run2pc(m.src_node, m.dst_node, m.barcode, m.qty, 'normal')}
                    className="px-3 py-1.5 rounded-lg bg-brand-red text-white text-xs font-bold"
                  >
                    Eksekusi 2PC
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Pane 5: Penerimaan Barang Masuk (Inbound PO) */}
      <div id="adm-pane-inbound" className={tab === 'inbound' ? 'grid grid-cols-1 lg:grid-cols-12 gap-6' : 'hidden'}>
        <form onSubmit={submitInbound} className="lg:col-span-5 p-5 rounded-2xl border border-slate-200 bg-white space-y-3 text-xs">
          <h3 className="text-sm font-extrabold text-slate-900">Penerimaan Barang Masuk (Inbound PO)</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-bold text-slate-700">No. Purchase Order</label>
              <input type="text" id="po-number" value={poNo} onChange={(e) => setPoNo(e.target.value)} required className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono" />
            </div>
            <div className="space-y-1">
              <label className="font-bold text-slate-700">No. Surat Jalan</label>
              <input type="text" id="po-sj" value={poSj} onChange={(e) => setPoSj(e.target.value)} required className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="font-bold text-slate-700">Nama Supplier / Pabrik</label>
            <input type="text" id="po-supplier" value={poSupplier} onChange={(e) => setPoSupplier(e.target.value)} required className="w-full px-3 py-2 rounded-xl border border-slate-300" />
          </div>
          <div className="space-y-1">
            <label className="font-bold text-slate-700">Produk Diterima</label>
            <select id="po-prod" value={poProd} onChange={(e) => setPoProd(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white">
              {products.map((p) => (
                <option key={p.barcode} value={p.barcode}>
                  {p.barcode} — {p.nama}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="font-bold text-slate-700">Datang</label>
              <input type="number" id="po-total" value={poTotal} min="1" onChange={(e) => setPoTotal(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono" />
            </div>
            <div className="space-y-1">
              <label className="font-bold text-emerald-700">Lolos Uji</label>
              <input type="number" id="po-good" value={poGood} readOnly className="w-full px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 font-mono font-bold text-emerald-900" />
            </div>
            <div className="space-y-1">
              <label className="font-bold text-brand-red">Rusak/Retur</label>
              <input type="number" id="po-bad" value={poBad} min="0" onChange={(e) => setPoBad(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono" />
            </div>
          </div>
          <button type="submit" className="w-full py-2.5 rounded-xl bg-brand-red hover:bg-brand-redHover text-white font-extrabold">
            Verifikasi &amp; Tambah Stok Pusat
          </button>
        </form>
        <div className="lg:col-span-7 p-5 rounded-2xl border border-slate-200 bg-white space-y-3">
          <h3 className="text-sm font-extrabold text-slate-900">Riwayat Verifikasi Inbound PO</h3>
          <div id="adm-inbound-history" className="space-y-2.5">
            {inboundHistory.length === 0 && <p className="text-xs text-slate-400">Belum ada riwayat inbound.</p>}
            {inboundHistory.map((po, i) => {
              const total = Number(po.total_datang ?? po.total ?? 0);
              const bad = Number(po.rusak ?? po.bad ?? 0);
              const good = Number(po.lolos ?? po.good ?? Math.max(0, total - bad));
              return (
                <div key={po.id || i} className="p-3 rounded-xl border border-slate-200 bg-[#FAFAFA] text-xs space-y-1">
                  <div className="flex justify-between font-mono font-bold">
                    <span className="text-slate-900">
                      {po.no_po || po.po} &bull; {po.no_sj || po.sj}
                    </span>
                    <span className="text-emerald-700">+{good} Stok Pusat</span>
                  </div>
                  <p className="text-slate-700 font-semibold">
                    {po.nama || po.barcode} ({po.supplier || po.supplier_id})
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Datang: {total} | Lolos Uji: {good} | Rusak/Retur: {bad}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Modal Tambah / Edit Produk Admin Gudang */}
      <Modal open={prodModalOpen} onClose={() => setProdModalOpen(false)} title={prodEditing ? 'Edit & Broadcast Harga Produk' : 'Tambah Produk Master Baru'}>
        <form onSubmit={saveProduct} className="space-y-3 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-bold text-slate-700">Kode Barcode</label>
              <input
                type="text"
                id="aprod-code"
                required
                readOnly={Boolean(prodEditing)}
                value={formProd.barcode}
                onChange={(e) => setFormProd({ ...formProd, barcode: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="font-bold text-slate-700">Kategori</label>
              <select
                id="aprod-cat"
                value={formProd.kategori}
                onChange={(e) => setFormProd({ ...formProd, kategori: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white"
              >
                <option value="Sembako">Sembako</option>
                <option value="Minyak & Gas">Minyak &amp; Gas</option>
                <option value="UMKM Desa">UMKM Desa</option>
                <option value="Konsumsi">Konsumsi</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="font-bold text-slate-700">Nama Produk</label>
            <input
              type="text"
              id="aprod-name"
              required
              value={formProd.nama}
              onChange={(e) => setFormProd({ ...formProd, nama: e.target.value })}
              className="w-full px-3 py-2 rounded-xl border border-slate-300"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-bold text-slate-700">Harga Beli (Rp)</label>
              <input
                type="number"
                id="aprod-hpp"
                required
                value={formProd.hpp}
                onChange={(e) => setFormProd({ ...formProd, hpp: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="font-bold text-slate-700">Harga Jual Nasional (Rp)</label>
              <input
                type="number"
                id="aprod-jual"
                required
                value={formProd.harga_jual}
                onChange={(e) => setFormProd({ ...formProd, harga_jual: e.target.value })}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 font-mono"
              />
            </div>
          </div>
          <button type="submit" className="w-full py-2.5 rounded-xl bg-brand-red hover:bg-brand-redHover text-white font-extrabold">
            Simpan &amp; Sebarkan ke 5 Node
          </button>
        </form>
      </Modal>
    </section>
  );
}
