import { BarChart3, Calculator, ClipboardCheck, GitCommitHorizontal, IdCard, LayoutGrid, LogOut, Package, Radio, Search, ShieldCheck, ShoppingCart, Truck, X } from 'lucide-react';
import LogoKopdes from './LogoKopdes.jsx';

// Sidebar navigasi — kartu node, menu dinamis per peran, profil, tombol Keluar.
// Markup & class disalin setia dari <aside id="sidebar"> index.html.
export default function Sidebar({
  open,
  onClose,
  user,
  route,
  nodeCard,
  posCategory,
  onSetPosCategory,
  onOpenMemberPicker,
  spvTab,
  onSetSpvTab,
  admTab,
  onSetAdmTab,
  onRefreshDashboard,
  onLogout,
}) {
  const initials = (() => {
    const parts = String(user?.nama || '')
      .split(/\s+/)
      .map((t) => t.replace(/[^A-Za-z]/g, '')[0])
      .filter(Boolean)
      .slice(0, 2);
    return (parts.join('') || String(user?.kode || 'KM').slice(0, 2)).toUpperCase();
  })();

  const POS_CATS = [
    { id: 'SEMUA', label: 'Semua' },
    { id: 'Sembako', label: 'Sembako' },
    { id: 'Minyak & Gas', label: 'Minyak & Gas' },
    { id: 'UMKM Desa', label: 'UMKM Desa' },
    { id: 'Konsumsi', label: 'Konsumsi' },
  ];

  const renderMenu = () => {
    if (route === '/pos') {
      return (
        <>
          <button type="button" onClick={onClose} className="w-full px-3 py-2.5 rounded-xl bg-brand-red text-white text-xs font-bold flex items-center gap-2.5">
            <ShoppingCart className="w-4 h-4" />
            <span>Terminal Kasir POS</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenMemberPicker();
              onClose();
            }}
            className="w-full px-3 py-2.5 rounded-xl text-slate-700 hover:bg-slate-100 text-xs font-semibold flex items-center gap-2.5"
          >
            <IdCard className="w-4 h-4 text-slate-500" />
            <span>Scan KTA Member [F2]</span>
          </button>
          <div className="pt-3 mt-2 border-t border-slate-200 space-y-1">
            <p className="px-3 pb-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Kategori Produk</p>
            {POS_CATS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onSetPosCategory(c.id);
                  onClose();
                }}
                className={`pos-cat-btn w-full px-3 py-2 rounded-xl text-xs text-left flex items-center justify-between transition-colors ${posCategory === c.id ? 'bg-slate-900 text-white font-bold' : 'text-slate-600 hover:bg-slate-100 font-semibold'}`}
              >
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        </>
      );
    }

    if (route === '/supervisor') {
      const items = [
        { id: 'void', icon: ShieldCheck, label: 'Persetujuan Void PIN' },
        { id: 'stock5', icon: Search, label: 'Cek Stok 5 Wilayah' },
        { id: 'mutasi', icon: Truck, label: 'Minta Mutasi Stok' },
        { id: 'eod', icon: Calculator, label: 'Tutup Shift (EOD)' },
      ];
      return items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => {
            onSetSpvTab(it.id);
            onClose();
          }}
          className={`w-full px-3 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition-colors ${spvTab === it.id ? 'bg-brand-red text-white' : 'text-slate-700 hover:bg-slate-100'}`}
        >
          <it.icon className="w-4 h-4" />
          <span>{it.label}</span>
        </button>
      ));
    }

    if (route === '/admin-gudang') {
      const items = [
        { id: 'katalog', icon: Package, label: 'Master Katalog Produk' },
        { id: 'broadcast', icon: Radio, label: 'Broadcast Update Harga' },
        { id: 'matriks', icon: LayoutGrid, label: 'Matriks Stok 5 Wilayah' },
        { id: 'mutasi2pc', icon: GitCommitHorizontal, label: 'Mutasi Stok 2PC' },
        { id: 'inbound', icon: ClipboardCheck, label: 'Inbound PO Supplier' },
      ];
      return items.map((it) => (
        <button
          key={it.id}
          type="button"
          onClick={() => {
            onSetAdmTab(it.id);
            onClose();
          }}
          className={`w-full px-3 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition-colors ${admTab === it.id ? 'bg-brand-red text-white' : 'text-slate-700 hover:bg-slate-100'}`}
        >
          <it.icon className="w-4 h-4" />
          <span>{it.label}</span>
        </button>
      ));
    }

    return (
      <button
        type="button"
        onClick={() => {
          onRefreshDashboard();
          onClose();
        }}
        className="w-full px-3 py-2.5 rounded-xl bg-brand-red text-white text-xs font-bold flex items-center gap-2.5"
      >
        <BarChart3 className="w-4 h-4" />
        <span>Ringkasan &amp; Audit DIY</span>
      </button>
    );
  };

  return (
    <aside
      id="sidebar"
      className={`fixed lg:sticky top-0 left-0 z-40 h-screen w-[264px] shrink-0 bg-[#FAFAFA] border-r border-slate-200 flex flex-col justify-between p-4 transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
    >
      <div className="space-y-4 overflow-y-auto">
        <div className="flex items-center justify-between px-1">
          <LogoKopdes size="sm" />
          <button type="button" onClick={onClose} className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-200" aria-label="Tutup menu">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Info Node Aktif */}
        <div id="sidebar-node-card" className="p-3 rounded-xl border border-brand-softBorder bg-brand-soft/60">
          <div className="flex items-center justify-between font-mono text-[10px] font-bold text-brand-red">
            <span>{nodeCard.kode}</span>
            <span>{nodeCard.region}</span>
          </div>
          <p className="text-xs font-extrabold text-slate-900 mt-0.5 truncate">{nodeCard.nama}</p>
        </div>

        {/* Menu Dinamis Sesuai Peran */}
        <nav id="sidebar-nav" className="space-y-1.5">
          {renderMenu()}
        </nav>
      </div>

      {/* Profil & Tombol Keluar */}
      <div className="pt-3 border-t border-slate-200 space-y-2.5">
        <div className="flex items-center gap-2.5 px-1">
          <div id="sidebar-user-avatar" className="w-9 h-9 rounded-xl bg-brand-maroon text-white font-extrabold text-xs flex items-center justify-center shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <p id="sidebar-user-name" className="text-xs font-extrabold text-slate-900 truncate">{user?.nama}</p>
            <p id="sidebar-user-role" className="font-mono text-[10px] text-slate-500 truncate">
              {user?.role} &bull; {user?.cabang_kode}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="w-full py-2 px-3 rounded-xl border border-red-200 bg-brand-soft hover:bg-red-100 text-brand-red text-xs font-extrabold flex items-center justify-center gap-1.5 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Keluar (Logout)</span>
        </button>
      </div>
    </aside>
  );
}
