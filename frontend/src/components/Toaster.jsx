import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

// Kontainer toast 4 varian (success / error / warning / info) — gaya persis showToast() di index.html.
// Auto-dismiss 3,4 detik lalu fade-out 0,25 detik.
const ToastContext = createContext(() => {});

const STYLES = {
  success: 'bg-emerald-900 text-white border-emerald-700',
  error: 'bg-brand-red text-white border-red-400',
  warning: 'bg-amber-900 text-amber-50 border-amber-700',
  info: 'bg-slate-900 text-white border-slate-700',
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const toast = useCallback((msg, type = 'info') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => {
      setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
      setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== id));
      }, 260);
    }, 3400);
  }, []);

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        id="toast-container"
        className="fixed bottom-5 right-5 z-[80] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto p-3.5 rounded-xl border shadow-xl text-xs font-semibold flex items-start gap-2.5 fade-in ${STYLES[t.type] || STYLES.info}`}
            style={t.leaving ? { opacity: 0, transition: 'opacity 0.25s ease' } : undefined}
          >
            <span className="flex-1 leading-relaxed">{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
