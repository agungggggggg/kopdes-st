-- =====================================================================
-- SEED DATA - Kopdes Mart DIY (sumber: index.html / konstanta SEED_*)
-- Hash password & PIN sudah bcrypt (dari briefing TA).
-- Waktu demo memakai CURDATE() agar EOD/KPI/hourly langsung terisi
-- pada hari seed dijalankan (jam 09:00-16:00, di dalam bucket hourly).
-- Jalankan SETELAH schema.sql.
-- =====================================================================
USE kopdes_mart;

-- 5 node DIY
INSERT INTO cabang (id, kode, nama, region, jenis, ip_address, ping_ms, online) VALUES
  (1,'NODE-1','Gudang Pusat Umbulharjo','Kota Yogyakarta','MASTER_HUB','103.11.20.1',12,1),
  (2,'NODE-2','Gerai Depok','Sleman','GERAI','192.168.2.1',18,1),
  (3,'NODE-3','Gerai Sewon','Bantul','GERAI','192.168.3.1',24,1),
  (4,'NODE-4','Gerai Wates','Kulon Progo','GERAI','192.168.4.1',38,1),
  (5,'NODE-5','Gerai Wonosari','Gunungkidul','GERAI','192.168.5.1',42,1);

-- Karyawan (password: Budi#Sleman26 / Sari#Btl26 / Hendro#Spv26 / Rian#Pusat26 / Joko#Mgr26, PIN supervisor 123456)
INSERT INTO karyawan (kode, username, nama, role, password_hash, pin_hash, cabang_id) VALUES
  ('KSR-SLM-01','budi.sleman','Budi Santoso','KASIR','$2b$10$nGKSf7.ihYUxH9a8NOhsKO/n9DESFjeGt3VmAABVypj2Dw12sXq9O',NULL,2),
  ('KSR-BTL-01','sari.bantul','Sari Wulandari','KASIR','$2b$10$txJjJqrhPBeVmvCjEC5yiuNjbh8qwWeOarLMDdHFddtABGnXGhHua',NULL,3),
  ('SPV-SLM-01','hendro.spv','Hendro, S.E.','SUPERVISOR','$2b$10$c4LHXhq2SFmO5fQPLeSobO9Sean375SrDBQQtuGA1V6E6GpCryY5u','$2b$10$SVAa73oC/fwbe9Obtnu1LugMPiiBBkt60HXM1aNIaXCjYSYX9rW5S',2),
  ('ADM-YK-01','rian.pusat','Rian Pratama','ADMIN_PUSAT','$2b$10$3DH7P3gKMq89lTMsBW1sAOyvSX.NdMBdoig6An2J.iuKu19maWtRS',NULL,1),
  ('MGR-DIY-01','joko.manajer','Ir. H. Joko','MANAJER','$2b$10$c7Ln4G4U8KkYAVAHvhwraO3H9Vca2fL2b8pJjLyW624YgkUSPpPaa',NULL,1);

INSERT INTO member (kode, nama, alamat, poin) VALUES
  ('MBR-0091','Suharto Wijaya','Depok, Sleman',145),
  ('MBR-0092','Ratna Sari Dewi','Sewon, Bantul',210),
  ('MBR-0093','Agus Setiawan','Wates, Kulon Progo',88),
  ('MBR-0094','Endang Sulastri','Wonosari, Gunungkidul',172);

INSERT INTO supplier (id, nama) VALUES
  (1,'PT Sembako Nusantara'),
  (2,'Bulog Divre DIY');

-- Katalog induk (stok per node mengikuti SEED_PRODUCTS di index.html)
INSERT INTO produk (barcode, nama, kategori, origin, satuan, hpp, harga_jual) VALUES
  ('8991001','Beras Rojolele 5kg','Sembako','UMKM Desa','Karung',63000,70000),
  ('8991002','Minyak Goreng Kita 1L','Minyak & Gas','Pabrikan','Pouch',14500,17000),
  ('8991003','Gula Pasir Kristal 1kg','Sembako','UMKM Desa','Kg',15000,17500),
  ('8991004','Telur Ayam Kampung 1kg','Sembako','UMKM Desa','Kg',25000,29000),
  ('8991005','Gas LPG 3kg Subsidi','Minyak & Gas','Pabrikan','Tabung',18000,21000),
  ('8991006','Bakpia & Gudeg Kaleng Desa','UMKM Desa','UMKM Desa','Box',22000,28000),
  ('8991007','Teh Tubruk Melati Jogja','UMKM Desa','UMKM Desa','Pak',8000,11000),
  ('8991008','Mie Instan Goreng (1 Dus)','Konsumsi','Pabrikan','Dus',105000,116000);

INSERT INTO stok_cabang (cabang_kode, barcode, qty) VALUES
  ('NODE-1','8991001',450),('NODE-2','8991001',12),('NODE-3','8991001',85),('NODE-4','8991001',40),('NODE-5','8991001',30),
  ('NODE-1','8991002',320),('NODE-2','8991002',44),('NODE-3','8991002',60),('NODE-4','8991002',35),('NODE-5','8991002',28),
  ('NODE-1','8991003',280),('NODE-2','8991003',32),('NODE-3','8991003',50),('NODE-4','8991003',25),('NODE-5','8991003',22),
  ('NODE-1','8991004',190),('NODE-2','8991004',18),('NODE-3','8991004',42),('NODE-4','8991004',20),('NODE-5','8991004',16),
  ('NODE-1','8991005',150),('NODE-2','8991005',24),('NODE-3','8991005',30),('NODE-4','8991005',19),('NODE-5','8991005',15),
  ('NODE-1','8991006',210),('NODE-2','8991006',35),('NODE-3','8991006',48),('NODE-4','8991006',30),('NODE-5','8991006',25),
  ('NODE-1','8991007',260),('NODE-2','8991007',50),('NODE-3','8991007',55),('NODE-4','8991007',40),('NODE-5','8991007',38),
  ('NODE-1','8991008',140),('NODE-2','8991008',16),('NODE-3','8991008',24),('NODE-4','8991008',14),('NODE-5','8991008',12);

-- Transaksi contoh (VALID, is_synced=1) sesuai SEED_TRANSACTIONS
INSERT INTO transaksi_pos (no_struk, cabang_kode, kasir_kode, kasir_nama, member_kode, metode, tunai, kembali, kotor, diskon, bersih, waktu, is_synced, status) VALUES
  ('TRX-SLM-20261116-01','NODE-2','KSR-SLM-01','Budi Santoso','MBR-0091','TUNAI',100000,1200,104000,5200,98800,CONCAT(CURDATE(),' 14:10:02'),1,'VALID'),
  ('TRX-BTL-20261116-01','NODE-3','KSR-BTL-01','Sari Wulandari',NULL,'QRIS',140000,0,140000,0,140000,CONCAT(CURDATE(),' 13:45:12'),1,'VALID'),
  ('TRX-KPR-20261116-01','NODE-4',NULL,'Kasir Wates','MBR-0093','TUNAI',120000,9800,116000,5800,110200,CONCAT(CURDATE(),' 12:30:40'),1,'VALID'),
  ('TRX-GKD-20261116-01','NODE-5',NULL,'Kasir Wonosari',NULL,'QRIS',116000,0,116000,0,116000,CONCAT(CURDATE(),' 11:20:15'),1,'VALID'),
  ('TRX-YK-20261116-01','NODE-1',NULL,'Outlet Umbulharjo','MBR-0092','QRIS',133000,0,140000,7000,133000,CONCAT(CURDATE(),' 10:05:00'),1,'VALID');

INSERT INTO detail_transaksi (no_struk, barcode, nama, origin, qty, harga_jual, subtotal) VALUES
  ('TRX-SLM-20261116-01','8991001','Beras Rojolele 5kg','UMKM Desa',1,70000,70000),
  ('TRX-SLM-20261116-01','8991002','Minyak Goreng Kita 1L','Pabrikan',2,17000,34000),
  ('TRX-BTL-20261116-01','8991006','Bakpia & Gudeg Kaleng Desa','UMKM Desa',5,28000,140000),
  ('TRX-KPR-20261116-01','8991008','Mie Instan Goreng (1 Dus)','Pabrikan',1,116000,116000),
  ('TRX-GKD-20261116-01','8991004','Telur Ayam Kampung 1kg','UMKM Desa',4,29000,116000),
  ('TRX-YK-20261116-01','8991001','Beras Rojolele 5kg','UMKM Desa',2,70000,140000);

INSERT INTO void_request (no_struk, cabang_kode, kasir_kode, kasir_nama, nominal, alasan, status, requested_at) VALUES
  ('TRX-SLM-20261116-01','NODE-2','KSR-SLM-01','Budi Santoso',98800,'Salah input kuantitas minyak goreng','PENDING',CONCAT(CURDATE(),' 14:12:30'));

INSERT INTO mutasi_request (src_node, dst_node, barcode, nama, qty, note, status, waktu, requested_by) VALUES
  ('NODE-1','NODE-2','8991001','Beras Rojolele 5kg',50,'Stok lokal Sleman tersisa 12 karung','PENDING',CONCAT(CURDATE(),' 13:50:00'),'SPV-SLM-01');

INSERT INTO inbound_po (no_po, no_sj, supplier_id, supplier_nama, barcode, nama, total_datang, rusak, waktu, oleh) VALUES
  ('PO-202611-009','SJ-881920',1,'PT Sembako Nusantara','8991001','Beras Rojolele 5kg',100,2,CONCAT(CURDATE(),' 09:30:00'),'ADM-YK-01');

INSERT INTO audit_log (waktu, aktor_kode, aktor_nama, tipe, detail, node) VALUES
  (CONCAT(CURDATE(),' 14:35:10'),'KSR-SLM-01','Budi Santoso','POS_TRX','Transaksi TRX-SLM-20261116-01 (Rp 98.800) tersinkron ke Master Hub.','NODE-2'),
  (CONCAT(CURDATE(),' 13:50:22'),'SPV-SLM-01','Hendro, S.E.','MUTASI_REQ','Pengajuan mutasi 50 Beras Rojolele 5kg dari Node 1 ke Node 2 (Depok Sleman).','NODE-1'),
  (CONCAT(CURDATE(),' 09:30:00'),'ADM-YK-01','Rian Pratama','INBOUND_PO','PO-202611-009 diterima di Umbulharjo: 98 lolos uji fisik, 2 retur.','NODE-1');
