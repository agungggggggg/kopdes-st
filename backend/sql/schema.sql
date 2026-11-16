-- =====================================================================
-- SKEMA DATABASE - Kopdes Mart DIY (5 node) / Tugas Akhir Sistem Terdistribusi
-- Jalankan:  mysql -u root -p < schema.sql
-- lalu:      mysql -u root -p < seed.sql
-- Catatan desain:
--   * transaksi_pos.no_struk = PRIMARY KEY  -> idempotensi checkout & sync.
--   * stok_cabang UNIQUE (cabang_kode, barcode) -> target kunci FOR UPDATE.
--   * Tanpa FOREIGN KEY ketat: riwayat (detail/audit/outbox) tetap ada
--     meski produk dihapus (prototipe demo).
--   * Semua nominal rupiah disimpan INTEGER (tanpa sen).
-- =====================================================================
CREATE DATABASE IF NOT EXISTS kopdes_mart CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE kopdes_mart;

-- 5 node DIY: NODE-1 Master Hub + 4 gerai
CREATE TABLE IF NOT EXISTS cabang (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  kode       VARCHAR(20)  NOT NULL UNIQUE,
  nama       VARCHAR(100) NOT NULL,
  region     VARCHAR(50)  NOT NULL,
  jenis      VARCHAR(20)  NOT NULL DEFAULT 'GERAI',   -- MASTER_HUB | GERAI
  ip_address VARCHAR(45)  NULL,
  ping_ms    INT          NOT NULL DEFAULT 0,
  online     TINYINT(1)   NOT NULL DEFAULT 1
) ENGINE=InnoDB;

-- Akun RBAC (password_hash & pin_hash bcrypt)
CREATE TABLE IF NOT EXISTS karyawan (
  kode          VARCHAR(20)  PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  nama          VARCHAR(100) NOT NULL,
  role          ENUM('KASIR','SUPERVISOR','ADMIN_PUSAT','MANAJER') NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  pin_hash      VARCHAR(100) NULL,  -- khusus SUPERVISOR (approval void)
  cabang_id     INT          NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS member (
  kode   VARCHAR(20)  PRIMARY KEY,
  nama   VARCHAR(100) NOT NULL,
  alamat VARCHAR(150) NOT NULL DEFAULT '',
  poin   INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS supplier (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  nama VARCHAR(100) NOT NULL
) ENGINE=InnoDB;

-- Katalog produk induk (origin: 'UMKM Desa' | 'Pabrikan')
CREATE TABLE IF NOT EXISTS produk (
  barcode    VARCHAR(30)  PRIMARY KEY,
  nama       VARCHAR(150) NOT NULL,
  kategori   VARCHAR(50)  NOT NULL,
  origin     VARCHAR(30)  NOT NULL DEFAULT 'Pabrikan',
  satuan     VARCHAR(20)  NOT NULL,
  hpp        INT NOT NULL DEFAULT 0,
  harga_jual INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;

-- Stok per node (baris ini yang dikunci SELECT ... FOR UPDATE)
CREATE TABLE IF NOT EXISTS stok_cabang (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  cabang_kode VARCHAR(20) NOT NULL,
  barcode     VARCHAR(30) NOT NULL,
  qty         INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_stok_node (cabang_kode, barcode),
  KEY idx_stok_barcode (barcode)
) ENGINE=InnoDB;

-- Struk POS (no_struk PRIMARY KEY -> gate idempotensi)
CREATE TABLE IF NOT EXISTS transaksi_pos (
  no_struk    VARCHAR(40) PRIMARY KEY,
  cabang_kode VARCHAR(20) NOT NULL,
  kasir_kode  VARCHAR(20)  NULL,
  kasir_nama  VARCHAR(100) NULL,
  member_kode VARCHAR(20)  NULL,
  metode      ENUM('TUNAI','QRIS') NOT NULL,
  tunai       INT NOT NULL DEFAULT 0,
  kembali     INT NOT NULL DEFAULT 0,
  kotor       INT NOT NULL DEFAULT 0,
  diskon      INT NOT NULL DEFAULT 0,
  bersih      INT NOT NULL DEFAULT 0,
  waktu       DATETIME NOT NULL,
  is_synced   TINYINT(1) NOT NULL DEFAULT 0,  -- 0 = masih antrean offline
  status      ENUM('VALID','VOIDED') NOT NULL DEFAULT 'VALID',
  KEY idx_trx_node_sync (cabang_kode, is_synced),
  KEY idx_trx_waktu (waktu)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS detail_transaksi (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  no_struk   VARCHAR(40)  NOT NULL,
  barcode    VARCHAR(30)  NOT NULL,
  nama       VARCHAR(150) NOT NULL,
  origin     VARCHAR(30)  NOT NULL,
  qty        INT NOT NULL,
  harga_jual INT NOT NULL,
  subtotal   INT NOT NULL,
  KEY idx_detail_struk (no_struk)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS void_request (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  no_struk     VARCHAR(40) NOT NULL,
  cabang_kode  VARCHAR(20) NOT NULL,
  kasir_kode   VARCHAR(20)  NULL,
  kasir_nama   VARCHAR(100) NULL,
  nominal      INT NOT NULL DEFAULT 0,
  alasan       TEXT,
  status       ENUM('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
  requested_at DATETIME NOT NULL,
  approved_by  VARCHAR(20) NULL,
  approved_at  DATETIME NULL,
  KEY idx_void_node (cabang_kode, status),
  KEY idx_void_struk (no_struk, status)
) ENGINE=InnoDB;

-- Pengajuan mutasi manual supervisor -> antrean admin
CREATE TABLE IF NOT EXISTS mutasi_request (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  src_node     VARCHAR(20) NOT NULL,
  dst_node     VARCHAR(20) NOT NULL,
  barcode      VARCHAR(30) NOT NULL,
  nama         VARCHAR(150) NULL,
  qty          INT NOT NULL,
  note         TEXT,
  status       ENUM('PENDING','PROCESSED','REJECTED') NOT NULL DEFAULT 'PENDING',
  waktu        DATETIME NOT NULL,
  requested_by VARCHAR(20) NULL,
  KEY idx_mutasi_status (status)
) ENGINE=InnoDB;

-- State machine 2PC: PENDING -> PREPARED -> COMMITTED / ABORTED
CREATE TABLE IF NOT EXISTS mutasi_stok (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  src_node     VARCHAR(20) NOT NULL,
  dst_node     VARCHAR(20) NOT NULL,
  barcode      VARCHAR(30) NOT NULL,
  nama         VARCHAR(150) NULL,
  qty          INT NOT NULL,
  status       ENUM('PENDING','PREPARED','COMMITTED','ABORTED') NOT NULL DEFAULT 'PENDING',
  detail       TEXT,
  waktu        DATETIME NOT NULL,
  initiated_by VARCHAR(20) NULL,
  KEY idx_2pc_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS broadcast_harga (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  barcode    VARCHAR(30)  NOT NULL,
  nama       VARCHAR(150) NULL,
  harga_lama INT NOT NULL DEFAULT 0,
  harga_baru INT NOT NULL,
  sumber     VARCHAR(20)  NOT NULL,  -- UPDATE_HARGA | BROADCAST
  waktu      DATETIME NOT NULL,
  oleh       VARCHAR(20)  NULL,
  KEY idx_bc_barcode (barcode)
) ENGINE=InnoDB;

-- Outbox pattern: event menunggu dikirim ke node lain (status NEW -> SENT)
CREATE TABLE IF NOT EXISTS outbox_sync (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  agregat     VARCHAR(20)  NOT NULL,  -- TRANSAKSI | BROADCAST | MUTASI
  agregat_id  VARCHAR(40)  NOT NULL,
  cabang_kode VARCHAR(20)  NOT NULL,
  payload     JSON NOT NULL,
  status      ENUM('NEW','SENT') NOT NULL DEFAULT 'NEW',
  created_at  DATETIME NOT NULL,
  KEY idx_outbox_status (status, created_at)
) ENGINE=InnoDB;

-- Jejak aktivitas: login, checkout, void, mutasi, 2PC, broadcast, inbound, sync
CREATE TABLE IF NOT EXISTS audit_log (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  waktu      DATETIME NOT NULL,
  aktor_kode VARCHAR(20)  NULL,
  aktor_nama VARCHAR(100) NULL,
  tipe       VARCHAR(30)  NOT NULL,
  detail     TEXT,
  node       VARCHAR(20)  NULL,
  KEY idx_audit_waktu (waktu)
) ENGINE=InnoDB;

-- Penerimaan PO di gudang pusat (NODE-1)
CREATE TABLE IF NOT EXISTS inbound_po (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  no_po         VARCHAR(40)  NOT NULL,
  no_sj         VARCHAR(40)  NOT NULL,
  supplier_id   INT NOT NULL,
  supplier_nama VARCHAR(100) NULL,
  barcode       VARCHAR(30)  NOT NULL,
  nama          VARCHAR(150) NULL,
  total_datang  INT NOT NULL,
  rusak         INT NOT NULL DEFAULT 0,
  waktu         DATETIME NOT NULL,
  oleh          VARCHAR(20)  NULL,
  KEY idx_inbound_waktu (waktu)
) ENGINE=InnoDB;
