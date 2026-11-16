import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, readJSON, TOKEN_KEY, USER_KEY, writeJSON } from './api.js';

const AuthContext = createContext(null);

// Persistensi sesi: token di 'kopdes_token', profil user di 'kopdes_user'.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => readJSON(USER_KEY, null));
  const [booting, setBooting] = useState(() => Boolean(readJSON(USER_KEY, null)));

  // Validasi sesi tersimpan ke server saat aplikasi dibuka.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!getToken()) {
        if (alive) {
          setUser(null);
          setBooting(false);
        }
        return;
      }
      try {
        const me = await api.get('/api/auth/me');
        const u = me?.user || me;
        if (alive && u) {
          setUser(u);
          writeJSON(USER_KEY, u);
        }
      } catch {
        try {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
        } catch {
          /* abaikan */
        }
        if (alive) setUser(null);
      } finally {
        if (alive) setBooting(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (loginValue, password) => {
    const data = await api.post('/api/auth/login', { login: loginValue, password });
    const u = data?.user;
    // Token disimpan sebagai string polos (BUKAN JSON) — header Bearer harus
    // berisi JWT apa adanya; kutip dari JSON.stringify membuat verify gagal.
    if (data?.token) localStorage.setItem(TOKEN_KEY, data.token);
    if (u) writeJSON(USER_KEY, u);
    setUser(u || null);
    return u;
  }, []);

  const me = useCallback(async () => {
    const data = await api.get('/api/auth/me');
    const u = data?.user || data;
    if (u) writeJSON(USER_KEY, u);
    setUser(u || null);
    return u;
  }, []);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      /* abaikan */
    }
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, booting, login, me, logout }),
    [user, booting, login, me, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus dipakai di dalam AuthProvider');
  return ctx;
}
