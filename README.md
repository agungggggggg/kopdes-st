# Kopdes Mart DIY — Sistem Informasi Minimarket Koperasi Desa Terdistribusi 5 Wilayah

Implementasi lengkap dan fungsional untuk Tugas Akhir Sistem Terdistribusi: **React** (frontend), **Node.js/Express** (backend), **MySQL 8** (basis data), dengan desain UI yang identik dengan `index.html` (Tailwind, Plus Jakarta Sans + JetBrains Mono, Lucide).

## Arsitektur

```
React (Vite, :5173)
   │  fetch /api (proxy dev → :3000)
   ▼
Express API (:3000)  ── JWT RBAC (KASIR / SUPERVISOR / ADMIN_PUSAT / MANAJER)
   │
   ├── mysql2 pool → MySQL 8 (kopdes_mart)
   │     • stok_cabang   : HORIZONTAL FRAGMENTATION per cabang_id (NODE-1..5)
   │     • checkout/sync : SELECT ... FOR UPDATE (row lock, anti-overselling)
   │     • transaksi_pos : no_struk PRIMARY KEY = idempotency key sinkronisasi
   │     • outbox_sync   : OUTBOX PATTERN (peristiwa ditulis atomik, dikirim async)
   │     • mutasi_stok   : state machine 2PC (PENDING→PREPARED→COMMITTED/ABORTED)
   │
   └── 2PC Coordinator (ADMIN_PUSAT): PREPARE → VOTE → GLOBAL_COMMIT/GLOBAL_ABORT
```

**Offline-first (Store & Forward):** saat node dianggap offline, kasir menyimpan struk ke antrean lokal browser (`localStorage`), stok *tidak* dipotong. Saat "Hubungkan"/Sync Antrean, antrean dikirim ke `POST /api/sync/transactions` yang memotong stok dengan `FOR UPDATE` dan mencatat struk secara **idempoten** (`ON DUPLICATE KEY UPDATE no_struk = no_struk`) → per struk menghasilkan `COMMITTED` / `DUPLICATE` (anti *double counting*) / `ABORT` (stok kurang).

## Struktur folder

```
kopdes-mart-app/
├── db/
│   ├── init.sql          # 15 tabel + seed lengkap (5 node, 8 produk, stok 5×8, transaksi, dst.)
│   └── README.md         # penjelasan tabel & peran distribusinya
├── backend/              # Express + mysql2 + JWT + bcryptjs
│   ├── .env.example      # salin menjadi .env
│   └── src/
│       ├── config/db.js  # pool mysql2/promise
│       ├── middleware/auth.js  # authRequired + requireRole
│       ├── routes/       # auth, nodes, pos, supervisor, admin, manajer, sync
│       ├── services/     # 2pc.service.js, sync.service.js
│       └── server.js
└── frontend/             # Vite + React 18 + Tailwind v3 + lucide-react + @fontsource
    └── src/ (pages: Login, Pos, Supervisor, Admin, Manajer)
```

## Cara menjalankan

### 1) Basis data MySQL
- Lokal: `mysql -u root -p < db/init.sql`
- Docker (pakai port 3307 bila 3306 sudah terpakai, dan TZ WIB agar EOD/hourly pakai tanggal lokal):
  `docker run -d --name kopdes-mysql -e TZ=Asia/Jakarta -e MYSQL_ROOT_PASSWORD=kopdes -e MYSQL_DATABASE=kopdes_mart -p 3307:3306 mysql:8.0`
  lalu `docker exec -i kopdes-mysql mysql -uroot -pkopdes < db/init.sql`
  (sesuaikan `DB_PORT` di `backend/.env` bila memakai port lain)

### 2) Backend (port 3000)
```
cd backend
npm install
copy .env.example .env   # sesuaikan DB_PASSWORD bila perlu
npm start                # atau: npm run dev (auto-reload)
```

### 3) Frontend (port 5173)
```
cd frontend
npm install
npm run dev              # buka http://localhost:5173 (proxy /api → :3000)
npm run build            # produksi → dist/
```

## Akun demo (RBAC 4 portal)

| Portal | Username / ID Karyawan | Password | Role | Node |
|---|---|---|---|---|
| /pos | `budi.sleman` / KSR-SLM-01 | `Budi#Sleman26` | KASIR | NODE-2 |
| /pos | `sari.bantul` / KSR-BTL-01 | `Sari#Btl26` | KASIR | NODE-3 |
| /supervisor | `hendro.spv` / SPV-SLM-01 | `Hendro#Spv26` | SUPERVISOR (PIN void: `123456`) | NODE-2 |
| /admin-gudang | `rian.pusat` / ADM-YK-01 | `Rian#Pusat26` | ADMIN_PUSAT | NODE-1 |
| /manajer | `joko.manajer` / MGR-DIY-01 | `Joko#Mgr26` | MANAJER | NODE-1 |

## Peta fitur → endpoint

| Halaman | Fitur | Endpoint utama |
|---|---|---|
| /login | JWT + deteksi node & role | `POST /api/auth/login` |
| /pos | heartbeat online/offline + antrean | `GET /api/nodes`, `GET /api/nodes/:kode/queue`, `POST /api/nodes/:kode/status` |
| /pos | scan/katalog/kategori (F1) | `GET /api/products?node_kode=` |
| /pos | member 5% (F2) | `GET /api/members` |
| /pos | bayar tunai (F9) / QRIS (F10) / struk thermal | `POST /api/pos/checkout` |
| /pos | offline store & forward + sync | `POST /api/sync/transactions` (idempoten) |
| /pos | ajukan void struk | `POST /api/pos/void-request` |
| /supervisor | persetujuan void PIN 6-digit | `GET/POST /api/void-requests/:id/approve` |
| /supervisor | distributed stock query 5 wilayah | `GET /api/stock5?q=` |
| /supervisor | mutasi darurat / EOD settlement | `POST /api/mutasi-requests`, `GET /api/eod` |
| /admin-gudang | master katalog CRUD | `GET/POST/PUT/DELETE /api/admin/products` |
| /admin-gudang | broadcast harga serentak | `POST /api/admin/broadcast` (+outbox) |
| /admin-gudang | matriks stok 5 wilayah | `GET /api/admin/matrix` |
| /admin-gudang | orkestrator 2PC (+ skenario timeout) | `POST /api/admin/2pc/execute`, `GET /api/admin/mutasi-queue` |
| /admin-gudang | inbound PO supplier | `POST /api/admin/inbound` |
| /manajer | KPI, tren per jam, komposisi UMKM | `GET /api/manajer/kpi|hourly|composition` |
| /manajer | cluster health 5 node | `GET /api/nodes` |
| /manajer | audit trail + ekspor RAT | `GET /api/manajer/audit`, `GET /api/manajer/export/csv`, `GET /api/manajer/report.html` |

## Tombol pintas kasir
`F1` fokus scan · `F2` modal member · `F9` bayar tunai · `F10` QRIS · `ESC` tutup modal.

## Catatan model distribusi (prototipe)
Partisipan 2PC disimulasikan pada satu instance MySQL: fragmentasi baris `stok_cabang` per `cabang_id` mewakili basis data lokal tiap node, latensi/ketersediaan node ada di tabel `cabang` (dipakai VOTE), dan jejak protokol ada di `mutasi_stok` + `outbox_sync` + `audit_log`. Ini memungkinkan demo `Prepare → Vote → Global Commit/Rollback` yang deterministik tanpa menjalankan 5 server basis data fisik.

## Status verifikasi (dijalankan live)
- **Backend ↔ MySQL live: 43/43 smoke test lulus** — login/RBAC, checkout FOR UPDATE, idempotensi (kirim ulang → 200, sync ulang → DUPLICATE), oversell 409, sync ABORT stok kurang, void PIN (salah ditolak / benar pulihkan stok), stock5, mutasi, EOD, 2PC COMMITTED & ABORTED, broadcast, inbound PO, KPI/hourly/composition/audit/CSV, simulasi node offline.
- **Frontend E2E live (browser): 27/27 lulus** — alur 4 portal via UI nyata termasuk bayar tunai + struk thermal, store & forward + sinkronisasi, approval void PIN, 2PC dengan strip fase, ekspor CSV.
- `node --check` 14/14 file backend; `npm run build` frontend hijau.
- Port 3306 di mesin ini sudah dipakai MySQL lokal lain — container demo memakai **3307** (`DB_PORT=3307` di `.env`).
