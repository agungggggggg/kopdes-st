import { Menu } from 'lucide-react';

// Topbar aplikasi — pill route, label terminal, judul halaman, dan heartbeat control box.
export default function Topbar({ route, terminalLabel, pageTitle, isOnline, pending, onToggleOnline, onOpenSidebar }) {
  return (
    <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="lg:hidden p-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100"
          aria-label="Buka menu"
        >
          <Menu className="w-4 h-4" />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span id="topbar-route-pill" className="px-2 py-0.5 rounded bg-brand-soft border border-brand-softBorder font-mono text-[10px] font-extrabold text-brand-red">
              {route}
            </span>
            <span id="topbar-terminal-label" className="text-[11px] font-medium text-slate-500 truncate">
              {terminalLabel}
            </span>
          </div>
          <h1 id="topbar-page-title" className="text-base sm:text-lg font-extrabold text-slate-900 truncate">{pageTitle}</h1>
        </div>
      </div>
      <div id="heartbeat-control-box" className="flex items-center gap-2">
        {isOnline ? (
          <>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>ONLINE</span>
            </span>
            <button
              type="button"
              onClick={() => onToggleOnline(false)}
              className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-amber-50 text-xs font-bold text-slate-700 transition-colors"
            >
              Simulasi Offline
            </button>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-100 border border-amber-300 text-xs font-bold text-amber-950">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
              <span>OFFLINE ({pending} Antrean)</span>
            </span>
            <button
              type="button"
              onClick={() => onToggleOnline(true)}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors"
            >
              Hubungkan
            </button>
          </>
        )}
      </div>
    </header>
  );
}
