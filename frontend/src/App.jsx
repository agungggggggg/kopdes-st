import { useEffect, useMemo, useState } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import { useAuth } from './auth.jsx';
import { NodesProvider, metaOf, useNodes } from './nodes.jsx';
import { useToast } from './components/Toaster.jsx';
import Sidebar from './components/Sidebar.jsx';
import Topbar from './components/Topbar.jsx';
import Login, { ROLE_ROUTE } from './pages/Login.jsx';
import Pos from './pages/Pos.jsx';
import Supervisor from './pages/Supervisor.jsx';
import Admin from './pages/Admin.jsx';
import Manajer from './pages/Manajer.jsx';

const PAGE_TITLES = {
  '/pos': 'Kasir POS',
  '/supervisor': 'Supervisor Gerai',
  '/admin-gudang': 'Admin Gudang Pusat',
  '/manajer': 'Dashboard Manajer DIY',
};

// Guard per peran: hanya role yang cocok boleh masuk route-nya,
// selain itu dialihkan ke route role masing-masing.
function RequireRole({ role, children }) {
  const { user, booting } = useAuth();
  const loc = useLocation();
  if (booting) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-xs font-bold text-slate-400">Memuat sesi…</p>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  const home = ROLE_ROUTE[user.role];
  if (role && user.role !== role) return <Navigate to={home || '/login'} replace />;
  return children;
}

// Shell aplikasi: sidebar + topbar + banner offline + konten portal.
function AppShell() {
  const { user, logout } = useAuth();
  const { isOnline, pending, toggleOnline } = useNodes();
  const toast = useToast();
  const loc = useLocation();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [posCategory, setPosCategory] = useState('SEMUA');
  const [spvTab, setSpvTab] = useState('void');
  const [admTab, setAdmTab] = useState('katalog');
  const [memberOpen, setMemberOpen] = useState(false);
  const [dashNonce, setDashNonce] = useState(0);

  const route = loc.pathname;
  const kode = user?.cabang_kode || null;
  const meta = kode ? metaOf(kode) : { nama: '', region: '', terminal: '' };
  const nodeOnline = kode ? isOnline(kode) : true;

  // Tutup drawer mobile saat pindah route
  useEffect(() => {
    setSidebarOpen(false);
  }, [route]);

  const ctxValue = useMemo(
    () => ({
      posCategory,
      setPosCategory,
      spvTab,
      setSpvTab,
      admTab,
      setAdmTab,
      memberOpen,
      setMemberOpen,
      dashNonce,
      setDashNonce,
    }),
    [posCategory, spvTab, admTab, memberOpen, dashNonce]
  );

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div id="app-shell" className="min-h-screen bg-white flex flex-col lg:flex-row">
      {/* Mobile Sidebar Backdrop */}
      {sidebarOpen && (
        <div id="sidebar-backdrop" onClick={() => setSidebarOpen(false)} className="fixed inset-0 bg-slate-900/40 z-30 lg:hidden" />
      )}

      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        user={user}
        route={route}
        nodeCard={{ kode: kode || '-', region: user.region || meta.region, nama: user.cabang_nama || meta.nama }}
        posCategory={posCategory}
        onSetPosCategory={setPosCategory}
        onOpenMemberPicker={() => setMemberOpen(true)}
        spvTab={spvTab}
        onSetSpvTab={setSpvTab}
        admTab={admTab}
        onSetAdmTab={setAdmTab}
        onRefreshDashboard={() => setDashNonce((n) => n + 1)}
        onLogout={() => {
          logout();
          toast('Anda telah keluar dari sesi.', 'info');
        }}
      />

      {/* Area Konten Utama */}
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar
          route={route}
          terminalLabel={meta.terminal}
          pageTitle={PAGE_TITLES[route] || 'Kopdes Mart DIY'}
          isOnline={nodeOnline}
          pending={pending}
          onToggleOnline={(online) => {
            toggleOnline(online)
              .then(() => {
                // Antrean offline lokal TIDAK otomatis ditandai synced di sini;
                // sinkronisasi dilakukan manual lewat tombol "Sync Antrean" di /pos.
                if (online) toast(`Koneksi ${kode} kembali ONLINE.`, 'success');
                else toast('Koneksi pusat terputus. Kasir tetap berjalan di database lokal (Store-and-Forward).', 'warning');
              })
              .catch((err) => toast(err?.message || 'Perubahan status node gagal.', 'error'));
          }}
          onOpenSidebar={() => setSidebarOpen(true)}
        />

        {/* Banner Mode Offline Store-and-Forward (khusus kasir /pos) */}
        {route === '/pos' && !nodeOnline && (
          <div id="offline-banner" className="bg-amber-50 border-b border-amber-300 px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-950">
            <div className="flex items-center gap-2 font-semibold">
              <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                <strong>Mode Offline Store-and-Forward Aktif:</strong> Transaksi kasir tetap berjalan di database lokal (
                <span id="offline-banner-count" className="font-mono font-extrabold">{pending}</span> antrean menunggu sinkronisasi).
              </span>
            </div>
            <button
              type="button"
              onClick={() => toggleOnline(true)}
              className="px-3 py-1 rounded-lg bg-amber-900 text-white font-bold hover:bg-amber-950"
            >
              Pulihkan Koneksi
            </button>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          <Outlet context={ctxValue} />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<AppShell />}>
        <Route
          path="/pos"
          element={
            <RequireRole role="KASIR">
              <Pos />
            </RequireRole>
          }
        />
        <Route
          path="/supervisor"
          element={
            <RequireRole role="SUPERVISOR">
              <Supervisor />
            </RequireRole>
          }
        />
        <Route
          path="/admin-gudang"
          element={
            <RequireRole role="ADMIN_PUSAT">
              <Admin />
            </RequireRole>
          }
        />
        <Route
          path="/manajer"
          element={
            <RequireRole role="MANAJER">
              <Manajer />
            </RequireRole>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
