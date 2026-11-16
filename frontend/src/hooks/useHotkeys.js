import { useEffect } from 'react';

// Hotkeys kasir: F1 scan, F2 member, F9 tunai, F10 QRIS.
// Hanya aktif saat halaman /pos (mount di halaman Pos) dan dibatalkan default browser.
export function usePosHotkeys({ active = true, onF1, onF2, onF9, onF10 }) {
  useEffect(() => {
    if (!active) return undefined;
    const handler = (e) => {
      if (e.key === 'F1') {
        e.preventDefault();
        onF1?.();
      } else if (e.key === 'F2') {
        e.preventDefault();
        onF2?.();
      } else if (e.key === 'F9') {
        e.preventDefault();
        onF9?.();
      } else if (e.key === 'F10') {
        e.preventDefault();
        onF10?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, onF1, onF2, onF9, onF10]);
}
