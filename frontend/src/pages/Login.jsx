import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Lock, User } from 'lucide-react';
import LogoKopdes from '../components/LogoKopdes.jsx';
import LoginIllustration from './LoginIllustration.jsx';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toaster.jsx';

export const ROLE_ROUTE = {
  KASIR: '/pos',
  SUPERVISOR: '/supervisor',
  ADMIN_PUSAT: '/admin-gudang',
  MANAJER: '/manajer',
};

// 4 kartu akun uji — klik mengisi form (username), password diketik manual
// dan ditampilkan sebagai teks kecil 'demo' di kartu.
const TEST_ACCOUNTS = [
  { label: 'Kasir (/pos)', user: 'budi.sleman', demoPass: 'Budi#Sleman26', node: 'NODE-2', nodeCls: 'text-amber-300' },
  { label: 'Supervisor', user: 'hendro.spv', demoPass: 'Hendro#Spv26', node: 'NODE-2', nodeCls: 'text-amber-300' },
  { label: 'Admin Gudang', user: 'rian.pusat', demoPass: 'Rian#Pusat26', node: 'NODE-1', nodeCls: 'text-emerald-300' },
  { label: 'Manajer DIY', user: 'joko.manajer', demoPass: 'Joko#Mgr26', node: 'HQ', nodeCls: 'text-emerald-300' },
];

export default function Login() {
  const { user, login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [loginInput, setLoginInput] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) {
    return <Navigate to={ROLE_ROUTE[user.role] || '/login'} replace />;
  }

  const fillCredential = (u) => {
    setLoginInput(u);
    toast(`Kredensial ${u} diisikan. Masukkan kata sandi demo lalu klik LOGIN.`, 'info');
  };

  const handleManualLogin = async (e) => {
    e.preventDefault();
    const raw = loginInput.trim();
    if (!raw || !password) return;
    setBusy(true);
    try {
      const acc = await login(raw, password);
      setLoginInput('');
      setPassword('');
      toast(`Berhasil masuk sebagai ${acc?.nama || raw} (${ROLE_ROUTE[acc?.role] || '/pos'})`, 'success');
      navigate(ROLE_ROUTE[acc?.role] || '/login', { replace: true });
    } catch (err) {
      toast(err?.message?.includes('HTTP') ? 'Login gagal. Periksa username/ID karyawan dan kata sandi Anda.' : err?.message || 'Login gagal. Periksa username/ID karyawan dan kata sandi Anda.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="login-gateway" className="min-h-screen bg-white flex flex-col lg:flex-row relative overflow-hidden">
      {/* SISI KIRI: Logo Resmi, Ilustrasi Minimarket & Ringkasan 5 Wilayah DIY */}
      <div className="lg:w-[55%] bg-white p-6 sm:p-10 lg:px-14 lg:py-9 flex flex-col justify-between relative z-10">
        {/* Header Kiri: Logo Resmi KOPDES MERAH PUTIH */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="kopdes-logo-slot" data-logo-size="lg">
            <LogoKopdes size="lg" />
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-soft border border-brand-softBorder text-[11px] font-bold text-brand-red">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-red"></span>
              5 Wilayah DIY Terdistribusi
            </span>
          </div>
        </div>

        {/* Tengah Kiri: Blob Organik Merah Lembut + Ilustrasi Belanja Warga */}
        <div className="my-auto py-3 flex flex-col items-center justify-center">
          <LoginIllustration />
        </div>

        {/* Footer Kiri: Peta 5 Wilayah DIY */}
        <div className="pt-3 border-t border-slate-100 flex items-center justify-center text-xs text-slate-500">
          <span>Umbulharjo YK &bull; Depok Sleman &bull; Sewon Bantul &bull; Wates &bull; Wonosari</span>
        </div>
      </div>

      {/* SISI KANAN: Panel Gelombang Vertikal & Form Login RBAC */}
      <div className="lg:w-[45%] bg-brand-maroon text-white p-8 sm:p-12 lg:px-14 lg:py-10 flex flex-col justify-center relative z-10">
        {/* Pembatas Gelombang Vertikal Organik (Desktop) */}
        <svg
          viewBox="0 0 120 900"
          preserveAspectRatio="none"
          className="hidden lg:block absolute top-0 -left-[78px] h-full w-[80px] text-brand-maroon pointer-events-none"
          fill="currentColor"
        >
          <path d="M120 0 H45 C15 160, 95 300, 38 460 C-15 610, 88 745, 42 900 H120 Z" />
        </svg>

        <div className="max-w-md w-full mx-auto space-y-6">
          <div className="text-center space-y-1.5">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-[0.16em]">LOGIN</h2>
            <p className="text-xs text-red-200/80">Masuk dengan kredensial pribadi karyawan Kopdes Mart DIY</p>
          </div>

          <form onSubmit={handleManualLogin} className="space-y-4">
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-brand-maroonMid flex items-center justify-center absolute left-1.5 top-1/2 -translate-y-1/2 text-red-200">
                <User className="w-4 h-4" />
              </div>
              <input
                type="text"
                id="login-emp-id"
                required
                value={loginInput}
                onChange={(e) => setLoginInput(e.target.value)}
                placeholder="Username atau ID Karyawan"
                autoComplete="username"
                className="w-full pl-14 pr-5 py-3.5 rounded-full bg-brand-pill hover:bg-brand-pillHover focus:bg-brand-pillHover text-white placeholder-red-200/70 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-white/30 transition-colors"
              />
            </div>

            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-brand-maroonMid flex items-center justify-center absolute left-1.5 top-1/2 -translate-y-1/2 text-red-200">
                <Lock className="w-4 h-4" />
              </div>
              <input
                type="password"
                id="login-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Kata Sandi"
                autoComplete="current-password"
                className="w-full pl-14 pr-5 py-3.5 rounded-full bg-brand-pill hover:bg-brand-pillHover focus:bg-brand-pillHover text-white placeholder-red-200/70 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-white/30 transition-colors"
              />
            </div>

            <div className="pt-1 text-center">
              <button
                type="submit"
                disabled={busy}
                className="w-48 py-3.5 rounded-xl bg-brand-btn hover:bg-brand-red text-white font-extrabold text-xs sm:text-sm tracking-[0.15em] uppercase shadow-lg shadow-black/25 transition-all disabled:opacity-60"
              >
                LOGIN
              </button>
            </div>
          </form>

          {/* Direktori Kredensial Uji Peran (Klik untuk isi form) */}
          <div className="pt-4 border-t border-red-200/15 space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-red-200/75 text-center">Akun Uji Coba 4 Portal (Klik untuk Isi)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              {TEST_ACCOUNTS.map((acc) => (
                <button
                  key={acc.user}
                  type="button"
                  onClick={() => fillCredential(acc.user)}
                  className="p-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-left transition-colors"
                >
                  <div className="flex items-center justify-between font-bold text-white">
                    <span>{acc.label}</span>
                    <span className={`font-mono text-[10px] ${acc.nodeCls}`}>{acc.node}</span>
                  </div>
                  <p className="font-mono text-[10px] text-red-200 mt-0.5 truncate">{acc.user}</p>
                  <p className="font-mono text-[10px] text-amber-200/90 mt-0.5 truncate">demo: {acc.demoPass}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
