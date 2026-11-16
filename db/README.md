# Basis Data Kopdes Mart DIY — `init.sql`

MySQL 8 · skema `kopdes_mart` · 15 tabel · seed lengkap sesuai prototipe UI (`index.html`).
Import: `mysql -u root -p < init.sql` (aman dipanggil ulang — database di-drop dulu).
Docker: `docker run -d --name kopdes-mysql -e MYSQL_ROOT_PASSWORD=kopdes -e MYSQL_DATABASE=kopdes_mart -p 3307:3306 mysql:8.0` lalu `docker exec -i kopdes-mysql mysql -uroot -pkopdes < db/init.sql`.

## Tabel & perannya dalam arsitektur terdistribusi

| # | Tabel | Peran |
|---|---|---|
| 1 | `cabang` | Direktori 5 node (Master Hub NODE-1 + 4 gerai) — `online`/`ping_ms` dipakai heartbeat UI dan keputusan **VOTE** pada 2PC |
| 2 | `karyawan` | Akun RBAC 4 portal; `password_hash` & `pin_hash` supervisor di-hash **bcrypt** |
| 3 | `member` | Anggota KTA — diskon 5%, poin += floor(bersih/10.000) |
| 4 | `supplier` | Pemasok untuk Inbound PO |
| 5 | `produk` | Katalog induk se-DIY (direplikasi ke 5 node); `origin` = dasar komposisi UMKM vs Pabrikan |
| 6 | `stok_cabang` | **Horizontal fragmentation** — partisi stok per `cabang_kode` (mewakili DB lokal tiap node edge); target `SELECT ... FOR UPDATE` anti-overselling |
| 7 | `transaksi_pos` | Header struk; **`no_struk` = PRIMARY KEY = idempotency key** sinkronisasi offline (`ON DUPLICATE KEY UPDATE no_struk=no_struk`); `is_synced=0` = menunggu sinkron |
| 8 | `detail_transaksi` | Item struk (snapshot nama/origin/harga) — dasar komposisi UMKM vs Pabrikan |
| 9 | `mutasi_request` | Antrean permintaan mutasi darurat dari supervisor ke admin pusat |
| 10 | `mutasi_stok` | **Ledger Two-Phase Commit**: `PENDING → PREPARED → COMMITTED/ABORTED` (ditulis koordinator `2pc.service.js`) |
| 11 | `void_request` | Antrean otorisasi void (PIN 6-digit supervisor); approval mengembalikan stok |
| 12 | `broadcast_harga` | Riwayat penyebaran harga serentak ke 5 node |
| 13 | `outbox_sync` | **Outbox pattern**: peristiwa (TRANSAKSI/BROADCAST/MUTASI) ditulis atomik bersama transaksi bisnis, dikirim async (`NEW → SENT`) |
| 14 | `inbound_po` | Riwayat penerimaan barang supplier di NODE-1 (lolos = datang − rusak) |
| 15 | `audit_log` | Distributed audit trail append-only (login, checkout, sync, void, 2PC, broadcast, inbound) |

## Catatan desain

- **Natural key `cabang_kode`** dipakai di semua tabel transaksional (bukan surrogate id) agar SQL backend langsung terbaca sebagai operasi per-node; integritas tetap terjaga lewat FK ke `cabang(kode)` yang UNIQUE.
- **Fragmentasi horizontal** `stok_cabang` diwakili baris per `(cabang_kode, barcode)`; pada deployment nyata, tiap partisi dapat dipisah menjadi basis data node edge masing-masing tanpa mengubah semantik query.
- **Idempotency**: karena `no_struk` adalah PRIMARY KEY, kirim ulang struk offline yang sama tidak akan mencatat ganda — backend menjawab `DUPLICATE` tanpa memotong stok lagi.
- **Outbox**: memastikan tidak ada transaksi bisnis yang commit tanpa peristiwa distribusinya ikut tersimpan (amankan sinkronisasi lintas node saat restart/timeout).
- `mutasi_stok` sengaja kosong saat seed — diisi runtime oleh koordinator 2PC.

## Akun demo (hash bcrypt cost 10)

| Kode | Username | Password | Role | Node |
|---|---|---|---|---|
| KSR-SLM-01 | budi.sleman | Budi#Sleman26 | KASIR | NODE-2 |
| KSR-BTL-01 | sari.bantul | Sari#Btl26 | KASIR | NODE-3 |
| SPV-SLM-01 | hendro.spv | Hendro#Spv26 (PIN: 123456) | SUPERVISOR | NODE-2 |
| ADM-YK-01 | rian.pusat | Rian#Pusat26 | ADMIN_PUSAT | NODE-1 |
| MGR-DIY-01 | joko.manajer | Joko#Mgr26 | MANAJER | NODE-1 |
