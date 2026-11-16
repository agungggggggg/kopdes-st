import { useCallback, useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { FileSpreadsheet, Printer } from 'lucide-react';
import { api, formatRp, rpShort } from '../api.js';
import { useToast } from '../components/Toaster.jsx';
import { NODE_ORDER, metaOf, useNodes } from '../nodes.jsx';

export default function Manajer() {
  const toast = useToast();
  const { nodes } = useNodes();
  const ctx = useOutletContext();
  const nonce = ctx?.dashNonce;

  const [kpi, setKpi] = useState({ total_diy: 0, per_node: [] });
  const [hourly, setHourly] = useState([]);
  const [composition, setComposition] = useState({ umkm: { nilai: 0, pct: 0 }, pabrikan: { nilai: 0, pct: 0 } });
  const [audit, setAudit] = useState([]);

  const loadAll = useCallback(async () => {
    if (!nonce && nonce !== 0) return;
    try {
      const [k, h, c, a] = await Promise.all([
        api.get('/api/manajer/kpi'),
        api.get('/api/manajer/hourly'),
        api.get('/api/manajer/composition'),
        api.get('/api/manajer/audit?limit=50'),
      ]);
      setKpi({ total_diy: 0, per_node: [], ...(k || {}) });
      setHourly(Array.isArray(h) ? h : []);
      setComposition({
        umkm: { nilai: 0, pct: 0, ...(c?.umkm || {}) },
        pabrikan: { nilai: 0, pct: 0, ...(c?.pabrikan || {}) },
      });
      setAudit(Array.isArray(a) ? a : []);
    } catch (err) {
      toast(err?.message || 'Gagal memuat dashboard manajer.', 'error');
    }
  }, [toast]);

  useEffect(() => {
    loadAll();
  }, [loadAll, nonce]);

  // Ekspor Excel (CSV): fetch blob dari endpoint lalu unduh sebagai attachment.
  const exportCsv = async () => {
    try {
      const res = await api.raw('/api/manajer/export/csv');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Laporan_Keuangan_RAT_Kopdes_Mart_DIY.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast('Laporan keuangan format Excel (CSV) berhasil diunduh.', 'success');
    } catch (err) {
      toast(err?.message || 'Ekspor CSV gagal.', 'error');
    }
  };

  // Cetak laporan RAT: HTML dari server dibuka di tab baru lalu memanggil print.
  const printRat = async () => {
    try {
      const res = await api.raw('/api/manajer/report.html');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, '_blank');
      if (!w) {
        toast('Popup diblokir browser. Izinkan popup untuk mencetak laporan RAT.', 'warning');
        return;
      }
      setTimeout(() => {
        try {
          w.focus();
          w.print();
        } catch {
          /* user dapat mencetak manual (Ctrl+P) */
        }
      }, 700);
    } catch (err) {
      toast(err?.message || 'Cetak laporan RAT gagal.', 'error');
    }
  };

  // Grafik per jam: bucket tetap 09:00–16:00, bucket kosong redup dengan label '—'
  const hourlyMap = {};
  hourly.forEach((r) => {
    hourlyMap[r.jam] = Number(r.omzet || 0);
  });
  const buckets = [];
  for (let hh = 9; hh <= 16; hh++) {
    const jam = `${String(hh).padStart(2, '0')}:00`;
    buckets.push({ jam, val: hourlyMap[jam] || 0 });
  }
  const maxVal = Math.max(1, ...buckets.map((b) => b.val));
  const activeHours = buckets.filter((b) => b.val > 0).map((b) => b.jam);

  const perNode = NODE_ORDER.map((n) => {
    const row = (kpi.per_node || []).find((x) => x.node_kode === n);
    return { kode: n, region: row?.region || metaOf(n).region, omzet: Number(row?.omzet || 0) };
  });

  return (
    <section id="view-manajer" className="space-y-6 fade-in">
      {/* Banner KPI Total & Ekspor RAT */}
      <div className="p-6 rounded-3xl bg-brand-maroon text-white flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="font-mono text-xs uppercase tracking-wider text-red-200">Omzet Konsolidasi Gabungan Se-DIY</span>
          <p id="mgr-kpi-total-diy" className="font-mono text-3xl sm:text-4xl font-extrabold mt-1">{formatRp(kpi.total_diy)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportCsv}
            className="px-4 py-2.5 rounded-xl bg-white text-brand-maroon hover:bg-red-50 text-xs font-extrabold flex items-center gap-1.5"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Ekspor Excel (CSV)</span>
          </button>
          <button
            type="button"
            onClick={printRat}
            className="px-4 py-2.5 rounded-xl bg-brand-red hover:bg-brand-redHover text-white text-xs font-extrabold flex items-center gap-1.5"
          >
            <Printer className="w-4 h-4" />
            <span>Cetak Laporan RAT (PDF)</span>
          </button>
        </div>
      </div>

      {/* Rincian Omzet 5 Wilayah */}
      <div id="mgr-branch-kpi-grid" className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {perNode.map((n) => (
          <div key={n.kode} className="p-3.5 rounded-2xl border border-slate-200 bg-white">
            <span className="font-mono text-[10px] font-bold text-slate-400">{n.kode}</span>
            <p className="text-xs font-bold text-slate-800 truncate">{n.region}</p>
            <p className="font-mono text-sm font-extrabold text-brand-red mt-1">{formatRp(n.omzet)}</p>
          </div>
        ))}
      </div>

      {/* 5-Node Cluster Health Check */}
      <div className="space-y-2.5">
        <h3 className="text-sm font-extrabold text-slate-900">Pantau Kesehatan Server (5-Node Cluster Health Check)</h3>
        <div id="mgr-cluster-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {NODE_ORDER.map((n) => {
            const live = nodes.find((x) => x.kode === n || x.id === n);
            const on = live ? live.online !== false : true;
            const ip = live?.ip_address || metaOf(n).ip;
            const ping = live?.ping_ms != null ? live.ping_ms : metaOf(n).ping;
            return (
              <div key={n} className={`p-3.5 rounded-xl border ${on ? 'border-slate-200 bg-white' : 'border-amber-300 bg-amber-50'} space-y-1`}>
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span className="font-bold text-slate-800">{n}</span>
                  <span className={`font-bold ${on ? 'text-emerald-700' : 'text-amber-800'}`}>{on ? `ONLINE (${ping}ms)` : 'OFFLINE'}</span>
                </div>
                <p className="text-xs font-extrabold text-slate-900">{metaOf(n).region}</p>
                <p className="font-mono text-[10px] text-slate-500">IP: {ip}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Grafik Tren & Komposisi UMKM */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 p-5 rounded-2xl border border-slate-200 bg-white space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-slate-900">Grafik Tren Transaksi Harian Per Jam</h3>
            <span id="mgr-hourly-range" className="font-mono text-[11px] font-bold text-slate-400">
              {activeHours.length ? `${activeHours[0]} – ${activeHours[activeHours.length - 1]} WIB` : 'Belum ada transaksi hari ini'}
            </span>
          </div>
          <div id="mgr-hourly-chart" className="h-48 pt-6 px-2 border-b border-slate-200 flex items-end gap-3">
            {buckets.map((h) => {
              const pct = h.val > 0 ? Math.max(6, Math.round((h.val / maxVal) * 100)) : 2;
              return (
                <div key={h.jam} className="flex-1 h-full flex flex-col justify-end items-center gap-1.5 group">
                  <span className="font-mono text-[10px] font-bold text-slate-600 group-hover:text-brand-red transition-colors">{h.val > 0 ? rpShort(h.val) : '—'}</span>
                  <div className="w-full h-32 bg-slate-100/80 rounded-t-xl flex items-end p-0.5">
                    <div
                      className={`w-full rounded-t-lg ${h.val > 0 ? 'bg-gradient-to-t from-brand-maroon to-brand-red group-hover:brightness-110' : 'bg-slate-200'} transition-all duration-300`}
                      style={{ height: `${pct}%` }}
                    ></div>
                  </div>
                  <span className="font-mono text-[10px] font-bold text-slate-500">{h.jam}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="lg:col-span-6 p-5 rounded-2xl border border-slate-200 bg-white space-y-4">
          <h3 className="text-sm font-extrabold text-slate-900">Komposisi Penjualan: UMKM Desa vs Ritel Pabrikan</h3>
          <div id="mgr-composition-bars" className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-emerald-800">Produk UMKM Desa</span>
                <span className="font-mono">
                  {composition.umkm.pct}% ({formatRp(composition.umkm.nilai)})
                </span>
              </div>
              <div className="w-full h-3 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-emerald-600 rounded-full" style={{ width: `${composition.umkm.pct}%` }}></div>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-slate-800">Ritel Pabrikan</span>
                <span className="font-mono">
                  {composition.pabrikan.pct}% ({formatRp(composition.pabrikan.nilai)})
                </span>
              </div>
              <div className="w-full h-3 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-brand-red rounded-full" style={{ width: `${composition.pabrikan.pct}%` }}></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Distributed Audit Trail Log */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-5 py-3.5 bg-[#FAFAFA] border-b border-slate-200">
          <h3 className="text-sm font-extrabold text-slate-900">Riwayat Jejak Audit (Distributed Audit Trail Log)</h3>
        </div>
        <div id="mgr-audit-list" className="divide-y divide-slate-100 font-mono text-xs max-h-72 overflow-y-auto">
          {audit.length === 0 && <p className="px-5 py-6 text-center text-slate-400">Belum ada jejak audit.</p>}
          {audit.map((l, i) => (
            <div key={l.id || i} className="px-5 py-2.5 flex flex-wrap items-center gap-2 hover:bg-slate-50">
              <span className="text-slate-400">{l.waktu}</span>
              <span className="px-2 py-0.5 rounded bg-slate-100 font-bold text-slate-800">{l.aktor_kode || l.aktor_nama}</span>
              <span className="px-2 py-0.5 rounded bg-brand-soft font-bold text-brand-red">{l.tipe}</span>
              <span className="font-sans text-slate-700">{l.detail}{l.node ? ` • ${l.node}` : ''}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
