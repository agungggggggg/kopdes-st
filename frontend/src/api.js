// Wrapper fetch tunggal untuk seluruh panggilan API backend Kopdes Mart DIY.
// - Token Bearer dibaca dari localStorage 'kopdes_token'
// - Respons non-2XX dilempar sebagai Error dengan message dari { error: { message } }

export const API_BASE = '';

export const TOKEN_KEY = 'kopdes_token';
export const USER_KEY = 'kopdes_user';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

async function request(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const token = getToken();
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (raw) {
    // Dipakai untuk unduhan blob/teks (CSV, report HTML); pemanggil memeriksa res.ok sendiri.
    return res;
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const err = new Error(data?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  del: (path) => request(path, { method: 'DELETE' }),
  raw: (path) => request(path, { raw: true }),
};

// --- Utilitas format & penyimpanan lokal yang dipakai lintas halaman ---

export function formatRp(n) {
  return 'Rp ' + Number(n || 0).toLocaleString('id-ID');
}

export function rpShort(n) {
  return 'Rp ' + Math.round(n / 1000) + 'rb';
}

export function timeNow() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage penuh / diblokir: abaikan */
  }
}
