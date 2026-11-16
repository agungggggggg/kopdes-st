import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { useAuth } from './auth.jsx';

// Metadata tampilan 5 node DIY (label terminal, region, ip, ping default).
// Nilai hidup (online/ping/ip) selalu diutamakan dari GET /api/nodes.
export const NODE_META = {
  'NODE-1': { id: 'NODE-1', nama: 'Gudang Pusat Umbulharjo', region: 'Kota Yogyakarta', terminal: 'Master Hub Umbulharjo (Kota YK)', ip: '103.11.20.1', ping: 12 },
  'NODE-2': { id: 'NODE-2', nama: 'Gerai Depok', region: 'Sleman', terminal: 'Terminal Kasir 01 - Kopdes Kec. Depok, Sleman', ip: '192.168.2.1', ping: 18 },
  'NODE-3': { id: 'NODE-3', nama: 'Gerai Sewon', region: 'Bantul', terminal: 'Terminal Kasir 01 - Kopdes Kec. Sewon, Bantul', ip: '192.168.3.1', ping: 24 },
  'NODE-4': { id: 'NODE-4', nama: 'Gerai Wates', region: 'Kulon Progo', terminal: 'Terminal Kasir 01 - Kopdes Kec. Wates, Kulon Progo', ip: '192.168.4.1', ping: 38 },
  'NODE-5': { id: 'NODE-5', nama: 'Gerai Wonosari', region: 'Gunungkidul', terminal: 'Terminal Kasir 01 - Kopdes Kec. Wonosari, Gunungkidul', ip: '192.168.5.1', ping: 42 },
};

export const NODE_ORDER = ['NODE-1', 'NODE-2', 'NODE-3', 'NODE-4', 'NODE-5'];

export function metaOf(kode) {
  return NODE_META[kode] || { id: kode, nama: kode, region: '', terminal: kode, ip: '', ping: 0 };
}

// Heartbeat node: poll GET /api/nodes tiap 10 detik + tersedia refresh() untuk
// dipanggil setelah aksi (checkout, sync, dsb). Saat node user OFFLINE, jumlah
// antrean diambil dari GET /api/nodes/:kode/queue.
const POLL_INTERVAL_MS = 10000;

const NodesContext = createContext(null);

export function NodesProvider({ children }) {
  const { user } = useAuth();
  const [nodes, setNodes] = useState([]);
  const [pending, setPending] = useState(0);

  const kode = user?.cabang_kode || null;

  const refresh = useCallback(async () => {
    let list = [];
    try {
      const data = await api.get('/api/nodes');
      if (Array.isArray(data)) list = data;
    } catch {
      /* server belum siap: pertahankan snapshot terakhir */
    }
    setNodes(list);

    let queueCount = 0;
    if (kode) {
      const mine = list.find((n) => n.kode === kode || n.id === kode);
      if (mine && mine.online === false) {
        try {
          const q = await api.get(`/api/nodes/${kode}/queue`);
          queueCount = Number(q?.pending || 0);
        } catch {
          queueCount = 0;
        }
      }
    }
    setPending(queueCount);
  }, [kode]);

  useEffect(() => {
    if (!user) {
      setNodes([]);
      setPending(0);
      return undefined;
    }
    refresh();
    const t = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [user, refresh]);

  const toggleOnline = useCallback(
    async (online) => {
      if (!kode) return;
      await api.post(`/api/nodes/${kode}/status`, { online });
      await refresh();
    },
    [kode, refresh]
  );

  const getNode = useCallback(
    (k) => nodes.find((n) => n.kode === k || n.id === k) || null,
    [nodes]
  );

  const isOnline = useCallback(
    (k) => {
      const n = nodes.find((x) => x.kode === k || x.id === k);
      return n ? n.online !== false : true;
    },
    [nodes]
  );

  const value = useMemo(
    () => ({ nodes, pending, refresh, toggleOnline, getNode, isOnline }),
    [nodes, pending, refresh, toggleOnline, getNode, isOnline]
  );

  return <NodesContext.Provider value={value}>{children}</NodesContext.Provider>;
}

export function useNodes() {
  const ctx = useContext(NodesContext);
  if (!ctx) throw new Error('useNodes harus dipakai di dalam NodesProvider');
  return ctx;
}
