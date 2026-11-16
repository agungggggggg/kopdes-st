import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Banknote, QrCode, RefreshCw, ScanBarcode } from 'lucide-react';
import Modal from '../components/Modal.jsx';
import { api, formatRp, readJSON, timeNow, writeJSON } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toaster.jsx';
import { metaOf, useNodes } from '../nodes.jsx';
import { usePosHotkeys } from '../hooks/useHotkeys.js';

const LOW_STOCK_THRESHOLD = 20;
// Antrean offline (store-and-forward) & cache struk untuk cetak ulang
const OFFLINE_QUEUE_KEY = 'kopdes_offline_queue_v1';
const RECEIPT_CACHE_KEY = 'kopdes_receipt_cache_v1';

function loadQueue() {
  return readJSON(OFFLINE_QUEUE_KEY, []);
}
function saveQueue(q) {
  writeJSON(OFFLINE_QUEUE_KEY, q);
}
function loadReceiptCache() {
  return readJSON(RECEIPT_CACHE_KEY, {});
}
function cacheReceipt(tx) {
  const cache = loadReceiptCache();
  cache[tx.no_struk] = tx;
  writeJSON(RECEIPT_CACHE_KEY, cache);
}

function fmtIsoTime(t) {
  try {
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) return String(t || '');
    const p = (v) => String(v).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  } catch {
    return String(t || '');
  }
}

export default function Pos() {
  const { user } = useAuth();
  const toast = useToast();
  const { isOnline, refresh: refreshNodes } = useNodes();
  const ctx = useOutletContext();

  const kode = user?.cabang_kode || 'NODE-2';
  const online = isOnline(kode);

  const searchRef = useRef(null);
  const [products, setProducts] = useState([]);
  const [searchInput, setSearchInput] = useState('');
  const [cart, setCart] = useState([]);
  const [heldCart, setHeldCart] = useState(null);
  const [member, setMember] = useState(null);
  const [memberInput, setMemberInput] = useState('');
  const [members, setMembers] = useState([]);
  const [history, setHistory] = useState([]);
  const [pendingLocal, setPendingLocal] = useState(0);
  const [cashOpen, setCashOpen] = useState(false);
  const [cashInput, setCashInput] = useState(0);
  const [qrisOpen, setQrisOpen] = useState(false);
  const [qrisSec, setQrisSec] = useState(120);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidNoStruk, setVoidNoStruk] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const qrisTimer = useRef(null);

  const totals = useMemo(() => {
    const kotor = cart.reduce((s, c) => s + c.harga * c.qty, 0);
    const diskon = member ? Math.round(kotor * 0.05) : 0;
    return { kotor, diskon, bersih: kotor - diskon };
  }, [cart, member]);

  // --- Muat data dari API (produk node kasir, riwayat struk, anggota) ---
  const loadProducts = useCallback(async () => {
    try {
      const data = await api.get(`/api/products?node_kode=${kode}`);
      setProducts(Array.isArray(data) ? data : []);
    } catch (err) {
      toast(err?.message || 'Gagal memuat katalog produk.', 'error');
    }
  }, [kode, toast]);

  const loadHistory = useCallback(async () => {
    let serverRows = [];
    try {
      const data = await api.get(`/api/pos/transactions?node_kode=${kode}&limit=6`);
      serverRows = Array.isArray(data) ? data : [];
    } catch {
      serverRows = [];
    }
    // Gabungkan antrean offline lokal (is_synced=0) yang belum ada di server
    const seen = new Set(serverRows.map((r) => r.no_struk));
    const localRows = loadQueue()
      .filter((e) => e.node_kode === kode)
      .filter((e) => !seen.has(e.no_struk))
      .map((e) => ({
        no_struk: e.no_struk,
        waktu: fmtIsoTime(e.created_at),
        metode: e.metode,
        bersih: e.bersih,
        is_synced: 0,
        status: 'VALID',
      }));
    const merged = [...localRows, ...serverRows];
    setHistory(merged);
    setPendingLocal(merged.filter((r) => !r.is_synced).length);
  }, [kode]);

  useEffect(() => {
    loadProducts();
    loadHistory();
  }, [loadProducts, loadHistory]);

  // --- Keranjang: tambah / ubah qty dengan validasi stok lokal ---
  const addToCart = (barcode) => {
    const prod = products.find((p) => p.barcode === barcode);
    if (!prod) return;
    const avail = Number(prod.stok_lokal || 0);
    const existing = cart.find((c) => c.barcode === barcode);
    const nextQty = (existing ? existing.qty : 0) + 1;
    if (nextQty > avail) {
      toast(`Stok lokal ${prod.nama} tidak mencukupi (Sisa: ${avail}).`, 'error');
      return;
    }
    if (existing) {
      setCart(cart.map((c) => (c.barcode === barcode ? { ...c, qty: nextQty } : c)));
    } else {
      setCart([...cart, { barcode: prod.barcode, nama: prod.nama, harga: Number(prod.harga_jual), qty: 1, origin: prod.origin }]);
    }
  };

  const updateQty = (barcode, delta) => {
    const item = cart.find((c) => c.barcode === barcode);
    const prod = products.find((p) => p.barcode === barcode);
    if (!item || !prod) return;
    const next = item.qty + delta;
    if (next <= 0) {
      setCart(cart.filter((c) => c.barcode !== barcode));
    } else if (next > Number(prod.stok_lokal || 0)) {
      toast('Melebihi batas stok lokal cabang.', 'warning');
    } else {
      setCart(cart.map((c) => (c.barcode === barcode ? { ...c, qty: next } : c)));
    }
  };

  const clearCart = () => setCart([]);

  const holdCart = () => {
    if (cart.length === 0) {
      toast('Keranjang belanja masih kosong.', 'warning');
      return;
    }
    setHeldCart({ items: cart, member });
    setCart([]);
    setMember(null);
    setMemberInput('');
    toast('Keranjang ditahan sementara (Hold).', 'info');
  };

  const recallCart = () => {
    if (!heldCart) return;
    setCart(heldCart.items);
    if (heldCart.member) {
      setMember(heldCart.member);
      setMemberInput(heldCart.member.kode || '');
    }
    setHeldCart(null);
    toast('Keranjang yang ditahan dipanggil kembali.', 'success');
  };

  const clearMember = () => {
    setMember(null);
    setMemberInput('');
  };

  const openMembersModal = () => {
    ctx.setMemberOpen(true);
    api
      .get('/api/members')
      .then((data) => setMembers(Array.isArray(data) ? data : []))
      .catch(() => toast('Gagal memuat daftar anggota koperasi.', 'error'));
  };

  const selectMember = (m) => {
    setMember(m);
    setMemberInput(m.kode);
    ctx.setMemberOpen(false);
    toast(`KTA Anggota ${m.kode} diterapkan (Diskon 5%).`, 'success');
  };

  // --- Pembayaran Tunai [F9] ---
  const openCash = () => {
    if (cart.length === 0) {
      toast('Tambahkan barang ke keranjang terlebih dahulu.', 'warning');
      return;
    }
    setCashInput(totals.bersih);
    setCashOpen(true);
  };

  const confirmCash = (e) => {
    e.preventDefault();
    const paid = Number(cashInput || 0);
    if (paid < totals.bersih) {
      toast('Nominal uang tunai kurang dari total tagihan.', 'error');
      return;
    }
    setCashOpen(false);
    finalize('TUNAI', paid, paid - totals.bersih);
  };

  // --- Pembayaran QRIS [F10] dengan countdown 120 detik ---
  const openQris = () => {
    if (cart.length === 0) {
      toast('Tambahkan barang ke keranjang terlebih dahulu.', 'warning');
      return;
    }
    setQrisSec(120);
    if (qrisTimer.current) clearInterval(qrisTimer.current);
    qrisTimer.current = setInterval(() => {
      setQrisSec((s) => {
        if (s <= 1) {
          clearInterval(qrisTimer.current);
          qrisTimer.current = null;
          setQrisOpen(false);
          toast('Waktu scan QRIS habis (2 menit).', 'warning');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    setQrisOpen(true);
  };

  const closeQris = () => {
    if (qrisTimer.current) clearInterval(qrisTimer.current);
    qrisTimer.current = null;
    setQrisOpen(false);
  };

  const confirmQris = () => {
    closeQris();
    finalize('QRIS', totals.bersih, 0);
  };

  // --- Finalisasi transaksi: online → POST checkout; offline → antrean lokal ---
  const finalize = async (metode, tunai, kembali) => {
    if (cart.length === 0) return;
    const { kotor, diskon, bersih } = totals;
    const noStruk = `TRX-${kode.replace('NODE-', 'N')}-${Date.now().toString().slice(-6)}`;
    const itemsSnapshot = cart.map((c) => ({ barcode: c.barcode, nama: c.nama, qty: c.qty, harga: c.harga }));
    const payload = {
      no_struk: noStruk,
      node_kode: kode,
      member_kode: member?.kode || null,
      metode,
      items: cart.map((c) => ({ barcode: c.barcode, qty: c.qty, harga_jual: c.harga })),
      tunai,
      kembali,
      created_at: new Date().toISOString(),
    };

    const cached = {
      no_struk: noStruk,
      node_kode: kode,
      waktu: timeNow(),
      kasir: user?.nama || '-',
      memberName: member ? member.nama : 'Pembeli Umum',
      items: itemsSnapshot,
      kotor,
      diskon,
      bersih,
      metode,
      tunai,
      kembali,
      is_synced: online ? 1 : 0,
      status: 'VALID',
    };

    if (online) {
      try {
        await api.post('/api/pos/checkout', payload);
        cacheReceipt(cached);
        setCart([]);
        setMember(null);
        setMemberInput('');
        toast('Transaksi berhasil & tersinkron ke Master Hub!', 'success');
        loadProducts();
        loadHistory();
        refreshNodes();
        setReceipt(loadReceiptCache()[noStruk] || cached);
        setReceiptOpen(true);
      } catch (err) {
        const detail = err?.data?.error?.detail;
        const extra = Array.isArray(detail) && detail.length
          ? ` (${detail.map((d) => `${d.barcode}: sisa ${d.tersedia}`).join(', ')})`
          : '';
        toast(`Checkout gagal: ${err?.message || 'error'}${extra}`, 'error');
        loadProducts();
      }
    } else {
      // Mode offline store-and-forward: TIDAK ada pemutongan stok di frontend.
      // Struk disimpan di localStorage dan dipotong stoknya saat POST /api/sync/transactions.
      const queue = loadQueue();
      queue.push({ ...payload, bersih, is_synced: 0 });
      saveQueue(queue);
      cacheReceipt(cached);
      setCart([]);
      setMember(null);
      setMemberInput('');
      toast('Transaksi disimpan di Antrean Offline lokal.', 'success');
      loadHistory();
      refreshNodes();
      setReceipt(cached);
      setReceiptOpen(true);
    }
  };

  // --- Sinkronisasi manual antrean offline → POST /api/sync/transactions ---
  const syncQueue = async () => {
    if (!online) {
      toast('Server masih OFFLINE. Aktifkan koneksi terlebih dahulu untuk sinkronisasi.', 'error');
      return;
    }
    const queue = loadQueue().filter((e) => e.node_kode === kode);
    if (queue.length === 0) {
      toast('Semua transaksi sudah tersinkron dengan pusat.', 'info');
      return;
    }
    try {
      const res = await api.post('/api/sync/transactions', {
        items: queue.map(({ is_synced, bersih, ...p }) => p),
      });
      const results = Array.isArray(res?.results) ? res.results : [];
      let remain = loadQueue();
      const cache = loadReceiptCache();
      results.forEach((r) => {
        if (r.status === 'COMMITTED') {
          remain = remain.filter((x) => x.no_struk !== r.no_struk);
          if (cache[r.no_struk]) cache[r.no_struk].is_synced = 1;
          toast(`Struk ${r.no_struk} COMMITTED — masuk buku Master Hub.`, 'success');
        } else if (r.status === 'DUPLICATE') {
          remain = remain.filter((x) => x.no_struk !== r.no_struk);
          if (cache[r.no_struk]) cache[r.no_struk].is_synced = 1;
          toast(`Struk ${r.no_struk} DUPLICATE — sudah pernah dicatat (anti double counting).`, 'warning');
        } else {
          toast(`Struk ${r.no_struk} ABORT${r.reason ? `: ${r.reason}` : ''} — tetap di antrean.`, 'error');
        }
      });
      writeJSON(RECEIPT_CACHE_KEY, cache);
      saveQueue(remain);
      toast(`${results.filter((r) => r.status !== 'ABORT').length}/${results.length} transaksi antrean berhasil diproses pusat.`, 'info');
      loadProducts();
      loadHistory();
      refreshNodes();
    } catch (err) {
      toast(err?.message || 'Sinkronisasi antrean gagal.', 'error');
    }
  };

  // --- Scan/barcode submit (F1) ---
  const handleBarcodeSubmit = (e) => {
    e.preventDefault();
    const q = searchInput.trim().toLowerCase();
    if (!q) return;
    const exact = products.find((p) => String(p.barcode).toLowerCase() === q) || products.find((p) => String(p.nama).toLowerCase().includes(q));
    if (exact) {
      addToCart(exact.barcode);
      setSearchInput('');
    } else {
      toast(`Produk "${searchInput}" tidak ditemukan.`, 'error');
    }
  };

  // --- Cetak struk (thermal) — dari cache agar cetak ulang tetap lengkap ---
  const printReceipt = (row) => {
    const cached = loadReceiptCache()[row.no_struk];
    if (cached) {
      setReceipt(cached);
    } else {
      // Fallback: struk lama tanpa cache — tampilkan ringkasan tanpa rincian item
      setReceipt({
        no_struk: row.no_struk,
        node_kode: kode,
        waktu: row.waktu,
        kasir: user?.nama || '-',
        memberName: '-',
        items: [],
        kotor: row.bersih,
        diskon: 0,
        bersih: row.bersih,
        metode: row.metode,
        tunai: row.bersih,
        kembali: 0,
        is_synced: row.is_synced,
        status: row.status,
      });
    }
    setReceiptOpen(true);
  };

  // --- Ajukan void struk ke Supervisor (PIN) ---
  const openVoidModal = (noStruk) => {
    setVoidNoStruk(noStruk);
    setVoidReason('');
    setVoidOpen(true);
  };

  const submitVoidRequest = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/pos/void-request', { no_struk: voidNoStruk, alasan: voidReason.trim() });
      setVoidOpen(false);
      toast(`Permintaan void ${voidNoStruk} dikirim ke antrean PIN Supervisor.`, 'success');
      loadHistory();
    } catch (err) {
      toast(err?.message || 'Pengajuan void gagal.', 'error');
    }
  };

  // --- Hotkeys kasir (hanya saat halaman /pos aktif) ---
  usePosHotkeys({
    active: true,
    onF1: () => searchRef.current?.focus(),
    onF2: openMembersModal,
    onF9: openCash,
    onF10: openQris,
  });

  const filteredProducts = products.filter((p) => {
    const matchCat = ctx.posCategory === 'SEMUA' || p.kategori === ctx.posCategory;
    const q = searchInput.trim().toLowerCase();
    const matchQ = !q || String(p.barcode).toLowerCase().includes(q) || String(p.nama).toLowerCase().includes(q);
    return matchCat && matchQ;
  });

  const memberCard = member;

  return (
    <section id="view-pos" className="grid grid-cols-1 xl:grid-cols-12 gap-6 fade-in">
      {/* Kiri: Scan Barcode & Katalog Produk Cepat */}
      <div className="xl:col-span-7 space-y-4">
        <form onSubmit={handleBarcodeSubmit} className="p-3.5 rounded-2xl bg-[#FAFAFA] border border-slate-200 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <ScanBarcode className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              ref={searchRef}
              type="text"
              id="pos-search-input"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Scan barcode atau ketik nama barang... [F1]"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white border border-slate-300 text-xs sm:text-sm font-medium focus:outline-none focus:border-brand-red"
            />
          </div>
          <button type="submit" className="px-4 py-2.5 rounded-xl bg-brand-red hover:bg-brand-redHover text-white text-xs font-extrabold shrink-0">
            + Tambah <kbd className="ml-1 bg-white/20 text-white border-white/30">F1</kbd>
          </button>
        </form>

        {/* Grid Produk Cepat */}
        <div id="pos-product-grid" className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {filteredProducts.map((p) => {
            const stok = Number(p.stok_lokal || 0);
            const low = stok < LOW_STOCK_THRESHOLD;
            return (
              <button
                key={p.barcode}
                type="button"
                onClick={() => addToCart(p.barcode)}
                disabled={stok <= 0}
                className={`p-3.5 rounded-2xl border ${stok <= 0 ? 'border-slate-200 bg-slate-50 opacity-50 cursor-not-allowed' : 'border-slate-200 bg-white hover:border-brand-red hover:bg-brand-soft/30'} text-left flex flex-col justify-between transition-all`}
              >
                <div className="flex items-center justify-between gap-1 font-mono text-[10px]">
                  <span className="text-slate-400">{p.barcode}</span>
                  <span className={`px-1.5 py-0.5 rounded font-bold ${low ? 'bg-red-100 text-brand-red' : 'bg-slate-100 text-slate-700'}`}>
                    {stok} {p.satuan}
                  </span>
                </div>
                <p className="font-bold text-xs text-slate-900 mt-2 line-clamp-2">{p.nama}</p>
                <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between">
                  <span className="font-mono text-xs font-extrabold text-brand-red">{formatRp(p.harga_jual)}</span>
                  <span className="text-[10px] font-semibold text-slate-400">{p.origin}</span>
                </div>
              </button>
            );
          })}
          {filteredProducts.length === 0 && (
            <p className="col-span-2 sm:col-span-3 py-8 text-center text-xs text-slate-400">Tidak ada produk yang cocok.</p>
          )}
        </div>

        {/* Riwayat Transaksi & Sync Antrean */}
        <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-700">Riwayat Struk &amp; Antrean Sync</h3>
              <p className="text-[11px] text-slate-500">
                Antrean belum tersinkron: <span id="pos-sync-counter" className="font-mono font-bold text-amber-700">{pendingLocal}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={syncQueue}
              className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Sync Antrean</span>
            </button>
          </div>
          <div id="pos-recent-tx-list" className="space-y-2">
            {history.slice(0, 6).map((t) => (
              <div key={t.no_struk} className="p-2.5 rounded-xl border border-slate-200 bg-[#FAFAFA] flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <div className="flex items-center gap-1.5 font-mono">
                    <span className="font-bold text-slate-900">{t.no_struk}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${t.is_synced ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`}>
                      {t.is_synced ? 'SYNCED' : 'OFFLINE'}
                    </span>
                    {t.status === 'VOIDED' && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-brand-red">VOID</span>}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {t.waktu} &bull; {t.metode} &bull; {formatRp(t.bersih)}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => printReceipt(t)}
                    className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-[11px] font-bold"
                  >
                    Struk
                  </button>
                  {t.status === 'VALID' && (
                    <button
                      type="button"
                      onClick={() => openVoidModal(t.no_struk)}
                      className="px-2.5 py-1 rounded-lg border border-red-200 bg-brand-soft text-brand-red hover:bg-red-100 text-[11px] font-bold"
                    >
                      Ajukan Void
                    </button>
                  )}
                </div>
              </div>
            ))}
            {history.length === 0 && <p className="py-6 text-center text-xs text-slate-400">Belum ada transaksi pada gerai ini.</p>}
          </div>
        </div>
      </div>

      {/* Kanan: Keranjang Belanja & Pembayaran */}
      <div className="xl:col-span-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4 sticky top-20">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-extrabold text-slate-900">Keranjang Belanja</h2>
            <div className="flex items-center gap-1.5">
              {heldCart && (
                <button type="button" onClick={recallCart} className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-950 text-[11px] font-bold">
                  Recall ({heldCart.items.length})
                </button>
              )}
              <button type="button" onClick={holdCart} className="px-2.5 py-1 rounded-lg border border-slate-200 hover:bg-slate-100 text-[11px] font-bold text-slate-700">
                Hold
              </button>
              <button type="button" onClick={clearCart} className="px-2.5 py-1 rounded-lg border border-red-200 text-brand-red hover:bg-brand-soft text-[11px] font-bold">
                Reset
              </button>
            </div>
          </div>

          {/* Input KTA Anggota Koperasi */}
          <div className="p-3 rounded-xl bg-[#FAFAFA] border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-700">
                Anggota Koperasi (Diskon 5%) <kbd>F2</kbd>
              </span>
              <button type="button" onClick={openMembersModal} className="text-[11px] font-bold text-brand-red hover:underline">
                Pilih KTA
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                id="pos-member-input"
                value={memberInput}
                onChange={(e) => {
                  const v = e.target.value;
                  setMemberInput(v);
                  const m = members.find((x) => String(x.kode || '').toUpperCase() === v.trim().toUpperCase());
                  setMember(m || null);
                }}
                placeholder="Ketik ID KTA (misal: MBR-0091)"
                className="flex-1 px-3 py-1.5 rounded-lg bg-white border border-slate-300 font-mono text-xs uppercase focus:outline-none focus:border-brand-red"
              />
              <button type="button" onClick={clearMember} className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600">
                Hapus
              </button>
            </div>
            {memberCard && (
              <div id="pos-member-card" className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 flex items-center justify-between">
                <span id="pos-member-name">{memberCard.nama} ({memberCard.kode})</span>
                <span>Diskon 5% Aktif</span>
              </div>
            )}
          </div>

          {/* Daftar Item */}
          <div id="pos-cart-list" className="divide-y divide-slate-100 max-h-[260px] overflow-y-auto pr-1">
            {cart.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-400">Belum ada barang di keranjang.</p>
            ) : (
              cart.map((item) => (
                <div key={item.barcode} className="pt-2.5 first:pt-0 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-900 truncate">{item.nama}</p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {formatRp(item.harga)} &times; {item.qty}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button type="button" onClick={() => updateQty(item.barcode, -1)} className="w-6 h-6 rounded-lg border border-slate-300 font-bold hover:bg-slate-100">
                      -
                    </button>
                    <span className="font-mono font-bold w-5 text-center">{item.qty}</span>
                    <button type="button" onClick={() => updateQty(item.barcode, 1)} className="w-6 h-6 rounded-lg border border-slate-300 font-bold hover:bg-slate-100">
                      +
                    </button>
                    <span className="font-mono font-extrabold text-slate-900 w-20 text-right">{formatRp(item.harga * item.qty)}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Ringkasan Harga */}
          <div className="p-3.5 rounded-xl bg-[#FAFAFA] border border-slate-200 space-y-1.5 text-xs tabular-nums">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span id="pos-subtotal" className="font-mono font-bold">{formatRp(totals.kotor)}</span>
            </div>
            <div className="flex justify-between text-emerald-700 font-semibold">
              <span>Diskon Anggota (5%)</span>
              <span id="pos-discount" className="font-mono font-bold">- {formatRp(totals.diskon)}</span>
            </div>
            <div className="pt-2 border-t border-slate-200 flex justify-between items-baseline">
              <span className="font-extrabold text-slate-900">Total Bayar</span>
              <span id="pos-grand-total" className="font-mono text-xl font-extrabold text-brand-red">{formatRp(totals.bersih)}</span>
            </div>
          </div>

          {/* Tombol Bayar Tunai & QRIS */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={openCash}
              className="py-3 px-4 rounded-xl bg-brand-red hover:bg-brand-redHover text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Banknote className="w-4 h-4" />
              <span>
                Tunai <kbd className="bg-white/20 text-white border-white/30">F9</kbd>
              </span>
            </button>
            <button
              type="button"
              onClick={openQris}
              className="py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm"
            >
              <QrCode className="w-4 h-4" />
              <span>
                QRIS <kbd className="bg-white/20 text-white border-white/30">F10</kbd>
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Modal Bayar Tunai [F9] */}
      <Modal open={cashOpen} onClose={() => setCashOpen(false)} title={<>Pembayaran Tunai <kbd>F9</kbd></>}>
        <div className="p-4 rounded-2xl bg-brand-soft border border-brand-softBorder flex justify-between items-center">
          <span className="text-xs font-bold text-brand-maroon">Total Tagihan</span>
          <span id="cash-modal-total" className="font-mono text-xl font-extrabold text-brand-red">{formatRp(totals.bersih)}</span>
        </div>
        <form onSubmit={confirmCash} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700">Uang Tunai Diterima (Rp)</label>
            <input
              type="number"
              id="cash-modal-input"
              required
              value={cashInput}
              onChange={(e) => setCashInput(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-300 font-mono text-base font-bold"
            />
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setCashInput(totals.bersih)} className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold">
                Uang Pas
              </button>
              <button type="button" onClick={() => setCashInput(50000)} className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-mono text-xs font-bold">
                Rp 50.000
              </button>
              <button type="button" onClick={() => setCashInput(100000)} className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-mono text-xs font-bold">
                Rp 100.000
              </button>
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex justify-between items-center">
            <span className="text-xs font-bold text-emerald-900">Kembalian</span>
            <span id="cash-modal-change" className="font-mono text-lg font-extrabold text-emerald-700">
              {formatRp(Math.max(0, Number(cashInput || 0) - totals.bersih))}
            </span>
          </div>
          <button type="submit" className="w-full py-3 rounded-xl bg-brand-red hover:bg-brand-redHover text-white text-xs font-extrabold">
            Selesaikan &amp; Cetak Struk
          </button>
        </form>
      </Modal>

      {/* Modal Bayar QRIS [F10] */}
      <Modal open={qrisOpen} onClose={closeQris} maxWidth="max-w-sm" title={<>Pembayaran QRIS Dinamis <kbd>F10</kbd></>}>
        <div className="space-y-4 text-center">
          <p id="qris-modal-total" className="font-mono text-2xl font-extrabold text-brand-red">{formatRp(totals.bersih)}</p>
          <div className="mx-auto w-44 h-44 rounded-2xl border-2 border-slate-900 p-3 flex items-center justify-center bg-white">
            <svg viewBox="0 0 100 100" className="w-full h-full" fill="#0F172A">
              <rect x="6" y="6" width="28" height="28" fill="none" stroke="#0F172A" strokeWidth="6" />
              <rect x="14" y="14" width="12" height="12" />
              <rect x="66" y="6" width="28" height="28" fill="none" stroke="#0F172A" strokeWidth="6" />
              <rect x="74" y="14" width="12" height="12" />
              <rect x="6" y="66" width="28" height="28" fill="none" stroke="#0F172A" strokeWidth="6" />
              <rect x="14" y="74" width="12" height="12" />
              <rect x="44" y="10" width="12" height="12" />
              <rect x="42" y="38" width="16" height="16" fill="#D61F26" />
              <rect x="66" y="46" width="12" height="12" />
              <rect x="46" y="68" width="14" height="24" />
              <rect x="72" y="72" width="20" height="20" />
            </svg>
          </div>
          <p className="text-xs font-semibold text-slate-600">
            Batas waktu scan QRIS:{' '}
            <span id="qris-countdown" className="font-mono font-extrabold text-brand-red">
              {String(Math.floor(qrisSec / 60)).padStart(2, '0')}:{String(qrisSec % 60).padStart(2, '0')}
            </span>
          </p>
          <button type="button" onClick={confirmQris} className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold">
            Konfirmasi Pembayaran QRIS Diterima
          </button>
        </div>
      </Modal>

      {/* Modal Pilih KTA Member [F2] */}
      <Modal open={ctx.memberOpen} onClose={() => ctx.setMemberOpen(false)} title="Pilih Anggota Koperasi (Diskon 5%)">
        <div id="pick-member-list" className="space-y-2 max-h-72 overflow-y-auto">
          {members.map((m) => (
            <button
              key={m.kode}
              type="button"
              onClick={() => selectMember(m)}
              className="w-full p-3 rounded-xl border border-slate-200 hover:border-brand-red hover:bg-brand-soft/40 text-left flex items-center justify-between"
            >
              <div>
                <p className="font-bold text-xs text-slate-900">{m.nama}</p>
                <p className="font-mono text-[11px] text-slate-500">
                  {m.kode} &bull; {m.alamat}
                </p>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-mono text-[11px] font-bold">Diskon 5%</span>
            </button>
          ))}
          {members.length === 0 && <p className="py-6 text-center text-xs text-slate-400">Memuat daftar anggota...</p>}
        </div>
      </Modal>

      {/* Modal Ajukan Void Struk */}
      <Modal open={voidOpen} onClose={() => setVoidOpen(false)} title="Ajukan Pembatalan Struk (Void)">
        <form onSubmit={submitVoidRequest} className="space-y-3 text-xs">
          <p className="text-slate-600">
            Nomor Struk Target: <span id="req-void-label" className="font-mono font-extrabold text-slate-900">{voidNoStruk}</span>
          </p>
          <div className="space-y-1">
            <label className="font-bold text-slate-700">Alasan Pembatalan</label>
            <input
              type="text"
              id="req-void-reason"
              required
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder="Contoh: Salah scan kuantitas barang"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300"
            />
          </div>
          <button type="submit" className="w-full py-2.5 rounded-xl bg-brand-red hover:bg-brand-redHover text-white font-extrabold">
            Kirim ke Antrean PIN Supervisor
          </button>
        </form>
      </Modal>

      {/* Modal Cetak Struk Thermal */}
      <Modal open={receiptOpen} onClose={() => setReceiptOpen(false)} maxWidth="max-w-sm" title={receipt ? `Struk Kasir — ${receipt.no_struk}` : 'Struk Kasir'}>
        <div className="space-y-4">
          <div id="printable-area" className="thermal-paper p-5 rounded-2xl font-mono text-slate-800">
            {receipt && (
              <>
                <div className="text-center space-y-0.5 pb-2">
                  <p className="font-extrabold text-sm">KOPDES MART MERAH PUTIH</p>
                  <p className="text-[11px]">{metaOf(receipt.node_kode).nama} ({metaOf(receipt.node_kode).region})</p>
                  <p className="text-[10px] text-slate-500">{receipt.no_struk} | {receipt.waktu}</p>
                </div>
                <div className="thermal-divider my-2"></div>
                <div className="space-y-1 text-[11px]">
                  <p>Kasir : {receipt.kasir}</p>
                  <p>Member: {receipt.memberName}</p>
                  <p>Status: {receipt.is_synced ? 'TERSINKRON PUSAT' : 'ANTRIAN OFFLINE LOKAL'}</p>
                </div>
                <div className="thermal-divider my-2"></div>
                <div className="space-y-1.5 text-[11px]">
                  {receipt.items.map((it) => (
                    <div key={it.barcode}>
                      <p className="font-bold">{it.nama}</p>
                      <div className="flex justify-between">
                        <span>{it.qty} x {formatRp(it.harga)}</span>
                        <span>{formatRp(it.qty * it.harga)}</span>
                      </div>
                    </div>
                  ))}
                  {receipt.items.length === 0 && <p className="text-slate-400">Rincian item tidak tersedia untuk cetak ulang.</p>}
                </div>
                <div className="thermal-divider my-2"></div>
                <div className="space-y-1 text-[11px]">
                  <div className="flex justify-between"><span>Subtotal</span><span>{formatRp(receipt.kotor)}</span></div>
                  <div className="flex justify-between"><span>Diskon 5%</span><span>-{formatRp(receipt.diskon)}</span></div>
                  <div className="flex justify-between font-extrabold text-xs pt-1"><span>TOTAL</span><span>{formatRp(receipt.bersih)}</span></div>
                  <div className="flex justify-between"><span>Bayar ({receipt.metode})</span><span>{formatRp(receipt.tunai)}</span></div>
                  <div className="flex justify-between"><span>Kembali</span><span>{formatRp(receipt.kembali)}</span></div>
                </div>
                <div className="thermal-divider my-2"></div>
                <p className="text-center text-[10px] text-slate-500">Terima kasih telah berbelanja di Kopdes Mart DIY</p>
              </>
            )}
          </div>
          <button type="button" onClick={() => window.print()} className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-extrabold">
            Cetak Dokumen
          </button>
        </div>
      </Modal>
    </section>
  );
}
