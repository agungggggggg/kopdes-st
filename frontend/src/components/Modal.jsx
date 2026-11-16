import { useEffect } from 'react';
import { X } from 'lucide-react';

// Modal operasional generik — markup persis dialog di index.html
// (backdrop bg-slate-900/50 + kartu rounded-3xl). ESC menutup modal terbuka.
export default function Modal({ open, onClose, title, maxWidth = 'max-w-md', children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 items-center justify-center p-4 flex">
      <div className={`bg-white rounded-3xl ${maxWidth} w-full p-6 space-y-4 shadow-2xl`}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-extrabold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
            aria-label="Tutup dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
