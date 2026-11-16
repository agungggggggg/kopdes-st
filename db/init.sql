-- ============================================================================
-- INIT.SQL - Kopdes Mart DIY (Tugas Akhir Sistem Terdistribusi)
-- Basis data MySQL 8 utk prototipe 5 node:
--   NODE-1 Master Hub Umbulharjo (Kota YK)  - 103.11.20.1 - 12 ms
--   NODE-2 Gerai Depok, Sleman              - 192.168.2.1 - 18 ms
--   NODE-3 Gerai Sewon, Bantul              - 192.168.3.1 - 24 ms
--   NODE-4 Gerai Wates, Kulon Progo         - 192.168.4.1 - 38 ms
--   NODE-5 Gerai Wonosari, Gunungkidul      - 192.168.5.1 - 42 ms
--
-- LOGIKA TERDISTRIBUSI YANG DIWADHI SKEMA INI:
--   1. HORIZONTAL FRAGMENTATION : stok_cabang terfragmentasi per cabang_kode
--      (satu partisi logis = basis data lokal node edge). Kueri lintas node
--      (Distributed Stock Query) menjumlah/menggabungkan partisi ini.
--   2. IDEMPOTENCY KEY          : transaksi_pos.no_struk = PRIMARY KEY.
--      Sinkronisasi offline memakai INSERT ... ON DUPLICATE KEY UPDATE
--      no_struk = no_struk -> struk ganda bernilai DUPLICATE (anti
--      double counting saat store & forward).
--   3. OUTBOX PATTERN           : outbox_sync menampung peristiwa (TRANSAKSI,
--      BROADCAST, MUTASI) yang ditulis ATOMIK bersama transaksi bisnisnya,
--      lalu "diantar" async ke rekap/replikasi node lain (status NEW -> SENT).
--   4. TWO-PHASE COMMIT (2PC)   : mutasi_stok merekam state machine
--      PENDING -> PREPARED -> COMMITTED/ABORTED yang ditulis koordinator
--      (backend/src/services/2pc.service.js) dalam SATU transaksi koordinator.
--   5. ROW-LEVEL LOCKING        : checkout/sync/void/2PC memakai
--      SELECT ... FOR UPDATE pada stok_cabang (anti overselling).
--
-- IMPORT: mysql -u root -p < init.sql
--         (aman dipanggil ulang: database di-drop dulu agar seed selalu bersih)
-- ============================================================================

DROP DATABASE IF EXISTS kopdes_mart;
CREATE DATABASE kopdes_mart CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE kopdes_mart;

-- ============================================================================
-- 1. CABANG - direktori 5 node fisik (Master Hub + 4 gerai kecamatan).
--    kolom online/ping_ms dipakai heartbeat UI + keputusan VOTE pada 2PC.
-- ============================================================================
CREATE TABLE cabang (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  kode       VARCHAR(10)  NOT NULL UNIQUE,           -- 'NODE-1'..'NODE-5'
  nama       VARCHAR(100) NOT NULL,
  region     VARCHAR(60)  NOT NULL,
  jenis      ENUM('PUSAT','CABANG') NOT NULL DEFAULT 'CABANG',
  ip_address VARCHAR(45)  NULL,
  ping_ms    INT          NOT NULL DEFAULT 20,
  online     TINYINT(1)   NOT NULL DEFAULT 1
) ENGINE=InnoDB COMMENT='Direktori 5 node terdistribusi (heartbeat + VOTE 2PC)';

-- ============================================================================
-- 2. KARYAWAN - akun RBAC (password & PIN supervisor di-hash bcryptjs).
-- ============================================================================
CREATE TABLE karyawan (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  kode          VARCHAR(20) NOT NULL UNIQUE,             -- KSR-SLM-01, dst.
  username      VARCHAR(40) NOT NULL UNIQUE,             -- budi.sleman, dst.
  nama          VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  pin_hash      VARCHAR(255) NULL,                       -- khusus SUPERVISOR (void 6-digit)
  role          ENUM('KASIR','SUPERVISOR','ADMIN_PUSAT','MANAJER') NOT NULL,
  cabang_id     INT NOT NULL,
  aktif         TINYINT(1) NOT NULL DEFAULT 1,
  CONSTRAINT fk_karyawan_cabang FOREIGN KEY (cabang_id) REFERENCES cabang(id)
) ENGINE=InnoDB COMMENT='Akun RBAC 4 portal';

-- ============================================================================
-- 3. MEMBER - anggota koperasi (diskon otomatis 5%, poin += floor(bersih/10000))
-- ============================================================================
CREATE TABLE member (
  id    INT AUTO_INCREMENT PRIMARY KEY,
  kode  VARCHAR(20) NOT NULL UNIQUE,                     -- MBR-0091, dst.
  nama  VARCHAR(100) NOT NULL,
  alamat VARCHAR(120) NULL,
  poin  INT NOT NULL DEFAULT 0
) ENGINE=InnoDB COMMENT='Anggota koperasi (KTA) - diskon 5%';

-- ============================================================================
-- 4. SUPPLIER - pemasok barang (Inbound PO)
-- ============================================================================
CREATE TABLE supplier (
  id    INT AUTO_INCREMENT PRIMARY KEY,
  nama  VARCHAR(120) NOT NULL,
  kontak VARCHAR(120) NULL
) ENGINE=InnoDB COMMENT='Pemasok / pabrik untuk Inbound PO';

-- ============================================================================
-- 5. PRODUK - katalog induk se-DIY (direplikasi ke seluruh node; harga jual
--    nasional disebarkan lewat broadcast_harga + outbox_sync).
-- ============================================================================
CREATE TABLE produk (
  barcode   VARCHAR(20) PRIMARY KEY,
  nama      VARCHAR(120) NOT NULL,
  kategori  VARCHAR(40)  NOT NULL,
  origin    ENUM('UMKM Desa','Pabrikan') NOT NULL,       -- dasar komposisi UMKM vs Pabrikan
  satuan    VARCHAR(20)  NOT NULL,
  hpp       INT NOT NULL DEFAULT 0,                      -- harga beli
  harga_jual INT NOT NULL DEFAULT 0,                     -- harga jual nasional
  aktif     TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB COMMENT='Katalog induk direplikasi ke 5 node';

-- ============================================================================
-- 6. STOK_CABANG - HORIZONTAL FRAGMENTATION per node (partisi logis edge DB).
--    Natural key cabang_kode dipakai seluruh query backend (checkout FOR
--    UPDATE, stock5, matriks, inbound, 2PC).
-- ============================================================================
CREATE TABLE stok_cabang (
  cabang_kode VARCHAR(10) NOT NULL,
  barcode     VARCHAR(20) NOT NULL,
  qty         INT NOT NULL DEFAULT 0,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (cabang_kode, barcode),
  CONSTRAINT fk_stok_cabang FOREIGN KEY (cabang_kode) REFERENCES cabang(kode),
  CONSTRAINT fk_stok_produk FOREIGN KEY (barcode) REFERENCES produk(barcode) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='Horizontal fragmentation: partisi stok per node edge';

-- ============================================================================
-- 7. TRANSAKSI_POS - header struk. no_struk = PRIMARY KEY = IDEMPOTENCY KEY
--    sinkronisasi offline (INSERT ... ON DUPLICATE KEY UPDATE no_struk=no_struk).
--    is_synced=0 menandai transaksi hasil store & forward yang menunggu sync.
-- ============================================================================
CREATE TABLE transaksi_pos (
  no_struk   VARCHAR(40) PRIMARY KEY,
  cabang_kode VARCHAR(10) NOT NULL,                      -- node tempat transaksi terjadi
  kasir_kode VARCHAR(20) NULL,                          -- NULL utk seed outlet non-akun
  kasir_nama VARCHAR(100) NOT NULL,
  member_kode VARCHAR(20) NULL,
  metode     ENUM('TUNAI','QRIS') NOT NULL,
  tunai      INT NOT NULL DEFAULT 0,
  kembali    INT NOT NULL DEFAULT 0,
  kotor      INT NOT NULL DEFAULT 0,
  diskon     INT NOT NULL DEFAULT 0,
  bersih     INT NOT NULL DEFAULT 0,
  waktu      DATETIME NOT NULL,
  is_synced  TINYINT(1) NOT NULL DEFAULT 1,              -- 0 = menunggu sinkron ke pusat
  status     ENUM('VALID','VOIDED') NOT NULL DEFAULT 'VALID',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_trx_sync (cabang_kode, is_synced),
  INDEX idx_trx_waktu (waktu),
  CONSTRAINT fk_trx_cabang FOREIGN KEY (cabang_kode) REFERENCES cabang(kode),
  CONSTRAINT fk_trx_kasir FOREIGN KEY (kasir_kode) REFERENCES karyawan(kode),
  CONSTRAINT fk_trx_member FOREIGN KEY (member_kode) REFERENCES member(kode)
) ENGINE=InnoDB COMMENT='Header struk POS - idempotency key sinkronisasi offline';

-- ============================================================================
-- 8. DETAIL_TRANSAKSI - baris barang per struk (snapshot nama/origin/harga).
--    Dasar perhitungan komposisi UMKM Desa vs Pabrikan di dashboard manajer.
-- ============================================================================
CREATE TABLE detail_transaksi (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  no_struk   VARCHAR(40) NOT NULL,
  barcode    VARCHAR(20) NOT NULL,
  nama       VARCHAR(120) NOT NULL,                      -- snapshot nama produk
  origin     ENUM('UMKM Desa','Pabrikan') NOT NULL,
  qty        INT NOT NULL,
  harga_jual INT NOT NULL,
  subtotal   INT NOT NULL,
  INDEX idx_detail_struk (no_struk),
  CONSTRAINT fk_detail_trx  FOREIGN KEY (no_struk) REFERENCES transaksi_pos(no_struk),
  CONSTRAINT fk_detail_prod FOREIGN KEY (barcode) REFERENCES produk(barcode)
) ENGINE=InnoDB COMMENT='Item struk (snapshot) - dasar komposisi UMKM';

-- ============================================================================
-- 9. MUTASI_REQUEST - pengajuan mutasi darurat dari SUPERVISOR gerai,
--    masuk antrean ADMIN_PUSAT (GET /api/admin/mutasi-queue).
-- ============================================================================
CREATE TABLE mutasi_request (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  src_node     VARCHAR(10) NOT NULL,
  dst_node     VARCHAR(10) NOT NULL,
  barcode      VARCHAR(20) NOT NULL,
  nama         VARCHAR(120) NULL,
  qty          INT NOT NULL,
  note         VARCHAR(255) NULL,
  status       ENUM('PENDING','PROCESSED') NOT NULL DEFAULT 'PENDING',
  waktu        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  requested_by VARCHAR(20) NULL,
  INDEX idx_mutreq_status (status),
  CONSTRAINT fk_mutreq_src    FOREIGN KEY (src_node) REFERENCES cabang(kode),
  CONSTRAINT fk_mutreq_dst    FOREIGN KEY (dst_node) REFERENCES cabang(kode),
  CONSTRAINT fk_mutreq_produk FOREIGN KEY (barcode) REFERENCES produk(barcode)
) ENGINE=InnoDB COMMENT='Antrean permintaan mutasi dari cabang';

-- ============================================================================
-- 10. MUTASI_STOK - LEDGER protokol 2PC (koordinator). State machine:
--     PENDING -> PREPARED (VOTE_COMMIT 2/2) -> COMMITTED
--     PENDING -> ABORTED   (VOTE_ABORT: stok kurang / node offline / timeout)
--     Diisi runtime oleh backend/src/services/2pc.service.js.
-- ============================================================================
CREATE TABLE mutasi_stok (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  src_node     VARCHAR(10) NOT NULL,
  dst_node     VARCHAR(10) NOT NULL,
  barcode      VARCHAR(20) NOT NULL,
  nama         VARCHAR(120) NULL,
  qty          INT NOT NULL,
  status       ENUM('PENDING','PREPARED','COMMITTED','ABORTED') NOT NULL DEFAULT 'PENDING',
  detail       VARCHAR(255) NULL,                        -- jejak keputusan koordinator
  waktu        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  initiated_by VARCHAR(20) NULL,
  INDEX idx_2pc_status (status),
  CONSTRAINT fk_2pc_src    FOREIGN KEY (src_node) REFERENCES cabang(kode),
  CONSTRAINT fk_2pc_dst    FOREIGN KEY (dst_node) REFERENCES cabang(kode),
  CONSTRAINT fk_2pc_produk FOREIGN KEY (barcode) REFERENCES produk(barcode)
) ENGINE=InnoDB COMMENT='Ledger Two-Phase Commit (PENDING->PREPARED->COMMITTED/ABORTED)';

-- ============================================================================
-- 11. VOID_REQUEST - pengajuan pembatalan struk oleh kasir; otorisasi
--     SUPERVISOR dgn PIN bcrypt (pin_hash di tabel karyawan). Approval
--     mengembalikan stok (FOR UPDATE) dan menandai struk VOIDED.
-- ============================================================================
CREATE TABLE void_request (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  no_struk     VARCHAR(40) NOT NULL,
  cabang_kode  VARCHAR(10) NOT NULL,
  kasir_kode   VARCHAR(20) NULL,
  kasir_nama   VARCHAR(100) NOT NULL,
  nominal      INT NOT NULL,
  alasan       VARCHAR(255) NOT NULL,
  status       ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by  VARCHAR(20) NULL,
  approved_at  DATETIME NULL,
  INDEX idx_void_status (status),
  CONSTRAINT fk_void_trx    FOREIGN KEY (no_struk) REFERENCES transaksi_pos(no_struk),
  CONSTRAINT fk_void_cabang FOREIGN KEY (cabang_kode) REFERENCES cabang(kode),
  CONSTRAINT fk_void_kasir  FOREIGN KEY (kasir_kode) REFERENCES karyawan(kode)
) ENGINE=InnoDB COMMENT='Antrean otorisasi void struk (PIN supervisor)';

-- ============================================================================
-- 12. BROADCAST_HARGA - jejak penyebaran harga baru serentak ke 5 node
--     (tanpa restart server). Setiap broadcast juga menulis outbox_sync.
-- ============================================================================
CREATE TABLE broadcast_harga (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  barcode    VARCHAR(20) NOT NULL,
  nama       VARCHAR(120) NULL,
  harga_lama INT NOT NULL,
  harga_baru INT NOT NULL,
  sumber     VARCHAR(20) NOT NULL,                       -- 'UPDATE_HARGA' | 'BROADCAST'
  waktu      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  oleh       VARCHAR(20) NULL,
  CONSTRAINT fk_bc_produk FOREIGN KEY (barcode) REFERENCES produk(barcode)
) ENGINE=InnoDB COMMENT='Riwayat broadcast harga serentak ke 5 node';

-- ============================================================================
-- 13. OUTBOX_SYNC - OUTBOX PATTERN: peristiwa distribusi (TRANSAKSI, BROADCAST,
--     MUTASI) ditulis atomik bersama transaksi bisnisnya, lalu diantar async
--     ke node lain / rekap pusat (status NEW -> SENT).
-- ============================================================================
CREATE TABLE outbox_sync (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  agregat     VARCHAR(30) NOT NULL,                      -- TRANSAKSI | BROADCAST | MUTASI
  agregat_id  VARCHAR(40) NOT NULL,
  cabang_kode VARCHAR(10) NULL,                          -- node tujuan/peristiwa
  payload     JSON NOT NULL,
  status      ENUM('NEW','SENT') NOT NULL DEFAULT 'NEW',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at     DATETIME NULL,
  INDEX idx_outbox_status (status, created_at),
  CONSTRAINT fk_outbox_cabang FOREIGN KEY (cabang_kode) REFERENCES cabang(kode)
) ENGINE=InnoDB COMMENT='Outbox pattern: peristiwa distribusi atomik + async';

-- ============================================================================
-- 14. INBOUND_PO - penerimaan barang dari supplier di Master Hub (NODE-1).
--     stok NODE-1 += (total_datang - rusak) dgn FOR UPDATE.
-- ============================================================================
CREATE TABLE inbound_po (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  no_po         VARCHAR(30) NOT NULL,
  no_sj         VARCHAR(30) NOT NULL,
  supplier_id   INT NOT NULL,
  supplier_nama VARCHAR(120) NULL,
  barcode       VARCHAR(20) NOT NULL,
  nama          VARCHAR(120) NULL,
  total_datang  INT NOT NULL,
  rusak         INT NOT NULL DEFAULT 0,                  -- lolos = total_datang - rusak
  waktu         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  oleh          VARCHAR(20) NULL,
  CONSTRAINT fk_po_supplier FOREIGN KEY (supplier_id) REFERENCES supplier(id),
  CONSTRAINT fk_po_produk   FOREIGN KEY (barcode) REFERENCES produk(barcode)
) ENGINE=InnoDB COMMENT='Riwayat penerimaan barang supplier (Inbound PO)';

-- ============================================================================
-- 15. AUDIT_LOG - jejak audit terdistribusi (append-only). Mencatat login
--     sukses/gagal, checkout, sync, void, mutasi, 2PC, broadcast, inbound.
-- ============================================================================
CREATE TABLE audit_log (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  waktu      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  aktor_kode VARCHAR(20) NULL,
  aktor_nama VARCHAR(100) NULL,
  tipe       VARCHAR(30) NOT NULL,
  detail     VARCHAR(500) NOT NULL,
  node       VARCHAR(10) NULL,
  INDEX idx_audit_waktu (waktu)
) ENGINE=InnoDB COMMENT='Distributed audit trail (append-only, forensik RAT)';

-- ============================================================================
-- SEED DATA
-- ============================================================================

-- 5 node (urutan id = urutan tampil di UI)
INSERT INTO cabang (id, kode, nama, region, jenis, ip_address, ping_ms, online) VALUES
  (1,'NODE-1','Gudang Pusat Umbulharjo','Kota Yogyakarta','PUSAT' ,'103.11.20.1',12,1),
  (2,'NODE-2','Gerai Depok','Sleman','CABANG','192.168.2.1',18,1),
  (3,'NODE-3','Gerai Sewon','Bantul','CABANG','192.168.3.1',24,1),
  (4,'NODE-4','Gerai Wates','Kulon Progo','CABANG','192.168.4.1',38,1),
  (5,'NODE-5','Gerai Wonosari','Gunungkidul','CABANG','192.168.5.1',42,1);

-- 5 akun RBAC (hash bcrypt cost 10; password tercantum di README akun demo)
INSERT INTO karyawan (id, kode, username, nama, password_hash, pin_hash, role, cabang_id, aktif) VALUES
  (1,'KSR-SLM-01','budi.sleman' ,'Budi Santoso'  ,'$2b$10$nGKSf7.ihYUxH9a8NOhsKO/n9DESFjeGt3VmAABVypj2Dw12sXq9O',NULL,'KASIR'      ,2,1),
  (2,'KSR-BTL-01','sari.bantul' ,'Sari Wulandari','$2b$10$txJjJqrhPBeVmvCjEC5yiuNjbh8qwWeOarLMDdHFddtABGnXGhHua',NULL,'KASIR'      ,3,1),
  (3,'SPV-SLM-01','hendro.spv'  ,'Hendro, S.E.'  ,'$2b$10$c4LHXhq2SFmO5fQPLeSobO9Sean375SrDBQQtuGA1V6E6GpCryY5u','$2b$10$SVAa73oC/fwbe9Obtnu1LugMPiiBBkt60HXM1aNIaXCjYSYX9rW5S','SUPERVISOR'  ,2,1),
  (4,'ADM-YK-01' ,'rian.pusat'  ,'Rian Pratama'  ,'$2b$10$3DH7P3gKMq89lTMsBW1sAOyvSX.NdMBdoig6An2J.iuKu19maWtRS',NULL,'ADMIN_PUSAT',1,1),
  (5,'MGR-DIY-01','joko.manajer','Ir. H. Joko'   ,'$2b$10$c7Ln4G4U8KkYAVAHvhwraO3H9Vca2fL2b8pJjLyW624YgkUSPpPaa',NULL,'MANAJER'    ,1,1);

-- 4 anggota KTA
INSERT INTO member (id, kode, nama, alamat, poin) VALUES
  (1,'MBR-0091','Suharto Wijaya'  ,'Depok, Sleman'        ,145),
  (2,'MBR-0092','Ratna Sari Dewi','Sewon, Bantul'        ,210),
  (3,'MBR-0093','Agus Setiawan'   ,'Wates, Kulon Progo'   , 88),
  (4,'MBR-0094','Endang Sulastri','Wonosari, Gunungkidul',172);

-- 2 pemasok
INSERT INTO supplier (id, nama, kontak) VALUES
  (1,'PT Sembako Nusantara','0274-881920'),
  (2,'Bulog Divre DIY'     ,'0274-556677');

-- 8 produk katalog induk (persis prototipe UI)
INSERT INTO produk (barcode, nama, kategori, origin, satuan, hpp, harga_jual) VALUES
  ('8991001','Beras Rojolele 5kg'        ,'Sembako'    ,'UMKM Desa','Karung', 63000, 70000),
  ('8991002','Minyak Goreng Kita 1L'   ,'Minyak & Gas','Pabrikan','Pouch', 14500, 17000),
  ('8991003','Gula Pasir Kristal 1kg'   ,'Sembako'    ,'UMKM Desa','Kg'   , 15000, 17500),
  ('8991004','Telur Ayam Kampung 1kg'   ,'Sembako'    ,'UMKM Desa','Kg'   , 25000, 29000),
  ('8991005','Gas LPG 3kg Subsidi'      ,'Minyak & Gas','Pabrikan','Tabung',18000, 21000),
  ('8991006','Bakpia & Gudeg Kaleng Desa','UMKM Desa' ,'UMKM Desa','Box'  , 22000, 28000),
  ('8991007','Teh Tubruk Melati Jogja'  ,'UMKM Desa'  ,'UMKM Desa','Pak'  ,  8000, 11000),
  ('8991008','Mie Instan Goreng (1 Dus)','Konsumsi'   ,'Pabrikan','Dus'  ,105000,116000);

-- FRAGMENTASI HORIZONTAL: stok 8 produk x 5 node (persis prototipe UI)
INSERT INTO stok_cabang (cabang_kode, barcode, qty) VALUES
  ('NODE-1','8991001',450),('NODE-2','8991001', 12),('NODE-3','8991001', 85),('NODE-4','8991001', 40),('NODE-5','8991001', 30),
  ('NODE-1','8991002',320),('NODE-2','8991002', 44),('NODE-3','8991002', 60),('NODE-4','8991002', 35),('NODE-5','8991002', 28),
  ('NODE-1','8991003',280),('NODE-2','8991003', 32),('NODE-3','8991003', 50),('NODE-4','8991003', 25),('NODE-5','8991003', 22),
  ('NODE-1','8991004',190),('NODE-2','8991004', 18),('NODE-3','8991004', 42),('NODE-4','8991004', 20),('NODE-5','8991004', 16),
  ('NODE-1','8991005',150),('NODE-2','8991005', 24),('NODE-3','8991005', 30),('NODE-4','8991005', 19),('NODE-5','8991005', 15),
  ('NODE-1','8991006',210),('NODE-2','8991006', 35),('NODE-3','8991006', 48),('NODE-4','8991006', 30),('NODE-5','8991006', 25),
  ('NODE-1','8991007',260),('NODE-2','8991007', 50),('NODE-3','8991007', 55),('NODE-4','8991007', 40),('NODE-5','8991007', 38),
  ('NODE-1','8991008',140),('NODE-2','8991008', 16),('NODE-3','8991008', 24),('NODE-4','8991008', 14),('NODE-5','8991008', 12);

-- 5 transaksi awal (is_synced=1, status VALID) + detailnya
INSERT INTO transaksi_pos
  (no_struk, cabang_kode, kasir_kode, kasir_nama, member_kode, metode, tunai, kembali, kotor, diskon, bersih, waktu, is_synced, status) VALUES
  ('TRX-SLM-20261116-01','NODE-2','KSR-SLM-01','Budi Santoso'    ,'MBR-0091','TUNAI',100000, 1200,104000, 5200, 98800,'2026-11-16 14:10:02',1,'VALID'),
  ('TRX-BTL-20261116-01','NODE-3',NULL       ,'Sari Wulandari'  ,NULL      ,'QRIS',140000,    0,140000,    0,140000,'2026-11-16 13:45:12',1,'VALID'),
  ('TRX-KPR-20261116-01','NODE-4',NULL       ,'Kasir Wates'     ,'MBR-0093','TUNAI',120000, 9800,116000, 5800,110200,'2026-11-16 12:30:40',1,'VALID'),
  ('TRX-GKD-20261116-01','NODE-5',NULL       ,'Kasir Wonosari'  ,NULL      ,'QRIS',116000,    0,116000,    0,116000,'2026-11-16 11:20:15',1,'VALID'),
  ('TRX-YK-20261116-01' ,'NODE-1',NULL       ,'Outlet Umbulharjo','MBR-0092','QRIS',133000,    0,133000, 7000,133000,'2026-11-16 10:05:00',1,'VALID');

INSERT INTO detail_transaksi (no_struk, barcode, nama, origin, qty, harga_jual, subtotal) VALUES
  ('TRX-SLM-20261116-01','8991001','Beras Rojolele 5kg'        ,'UMKM Desa',1, 70000,  70000),
  ('TRX-SLM-20261116-01','8991002','Minyak Goreng Kita 1L'     ,'Pabrikan' ,2, 17000,  34000),
  ('TRX-BTL-20261116-01','8991006','Bakpia & Gudeg Kaleng Desa','UMKM Desa',5, 28000, 140000),
  ('TRX-KPR-20261116-01','8991008','Mie Instan Goreng (1 Dus)' ,'Pabrikan' ,1,116000, 116000),
  ('TRX-GKD-20261116-01','8991004','Telur Ayam Kampung 1kg'    ,'UMKM Desa',4, 29000, 116000),
  ('TRX-YK-20261116-01' ,'8991001','Beras Rojolele 5kg'        ,'UMKM Desa',2, 70000, 140000);

-- Antrean mutasi darurat dari supervisor (menunggu eksekusi admin pusat)
INSERT INTO mutasi_request (src_node, dst_node, barcode, nama, qty, note, status, waktu, requested_by) VALUES
  ('NODE-1','NODE-2','8991001','Beras Rojolele 5kg',50,'Stok lokal Sleman tersisa 12 karung','PENDING','2026-11-16 13:50:00','SPV-SLM-01');

-- Antrean void (menunggu PIN supervisor 123456)
INSERT INTO void_request (no_struk, cabang_kode, kasir_kode, kasir_nama, nominal, alasan, status, requested_at) VALUES
  ('TRX-SLM-20261116-01','NODE-2','KSR-SLM-01','Budi Santoso',98800,'Salah input kuantitas minyak goreng','PENDING','2026-11-16 14:12:30');

-- Riwayat broadcast harga terakhir (katalog 68.000 -> 70.000, ACK 5/5 node)
INSERT INTO broadcast_harga (barcode, nama, harga_lama, harga_baru, sumber, waktu, oleh) VALUES
  ('8991001','Beras Rojolele 5kg',68000,70000,'BROADCAST','2026-11-16 06:12:04','ADM-YK-01');

-- Contoh outbox event (menunggu dikirim ke NODE-2)
INSERT INTO outbox_sync (agregat, agregat_id, cabang_kode, payload, status, created_at, sent_at) VALUES
  ('BROADCAST','8991001','NODE-2','{"tipe":"BROADCAST_HARGA","barcode":"8991001","harga_baru":70000}','NEW','2026-11-16 06:12:04',NULL);

-- Riwayat inbound PO awal
INSERT INTO inbound_po (no_po, no_sj, supplier_id, supplier_nama, barcode, nama, total_datang, rusak, waktu, oleh) VALUES
  ('PO-202611-009','SJ-881920',1,'PT Sembako Nusantara','8991001','Beras Rojolele 5kg',100,2,'2026-11-16 09:30:00','ADM-YK-01');

-- Jejak audit awal
INSERT INTO audit_log (waktu, aktor_kode, aktor_nama, tipe, detail, node) VALUES
  ('2026-11-16 14:35:10','KSR-SLM-01','Budi Santoso','POS_TRX'   ,'Transaksi TRX-SLM-20261116-01 (Rp 98.800) tersinkron ke Master Hub.','NODE-2'),
  ('2026-11-16 13:50:22','SPV-SLM-01','Hendro, S.E.','MUTASI_REQ','Pengajuan mutasi 50 Beras Rojolele 5kg dari Node 1 ke Node 2.','NODE-1'),
  ('2026-11-16 09:30:00','ADM-YK-01' ,'Rian Pratama','INBOUND_PO','PO-202611-009 diterima di Umbulharjo: 98 lolos uji fisik, 2 retur.','NODE-1'),
  ('2026-11-16 06:12:04','ADM-YK-01' ,'Rian Pratama','BROADCAST_HARGA','Harga 8991001 Beras Rojolele 5kg disiarkan 68.000 -> 70.000 ke 5 node.','NODE-1');

-- Selesai. mutasi_stok sengaja kosong saat seed: diisi runtime oleh koordinator
-- 2PC backend/src/services/2pc.service.js (PENDING -> PREPARED -> COMMITTED/ABORTED).
