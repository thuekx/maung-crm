# Maung CRM — Panduan Singkat Pengguna (Draf)

> **Status: DRAF** (17 Okt 2026). Ringkasan fitur dengan bahasa sehari-hari untuk tim Marketing, Supervisor/Manager, dan Admin.

## Apa itu Maung CRM?
Maung CRM adalah aplikasi untuk tim Marketing. Di sini tim mencatat kunjungan lapangan, mengelola calon pelanggan (Lead), dan membuat surat penawaran. CRM menyatu dengan **Maung WO**: Anda tidak perlu akun baru. Data pelanggan diambil dari WO, dan penawaran yang disetujui pelanggan otomatis menjadi order di WO.

## Cara masuk
1. Login di Maung WO seperti biasa (`https://maung.liv.net.id`).
2. Buka menu **Aplikasi**, lalu ikon **CRM**. Anda juga bisa langsung membuka `https://maung.liv.net.id/crm`.
3. Bila muncul "Akses CRM belum diberikan", minta Admin WO mengaktifkan **Hak Akses → Aplikasi: CRM** untuk akun Anda.

## Siapa bisa apa
| Peran | Yang bisa dilakukan |
|---|---|
| **Marketing (Staf)** | Membuat dan melihat aktivitas, lead, dan penawaran milik sendiri atau tempat ia menjadi PIC. Bisa menambah item katalog baru |
| **Supervisor / Manager Marketing** | Semua yang di atas untuk seluruh tim, ditambah meninjau laporan, menyetujui penawaran, dan mengubah katalog |
| **Admin** | Semuanya, ditambah menu Admin CRM (pengaturan, backup data) |

## Menu dan fungsinya
### Dashboard
Ringkasan angka: jumlah lead, penawaran, kunjungan, dan follow-up dalam rentang tanggal yang dipilih. Supervisor/Manager bisa menyaring per marketing atau area.

### Aktivitas (laporan kunjungan lapangan)
Untuk mencatat setiap kunjungan atau canvassing.
- **Check-in lokasi**: ambil posisi GPS saat berada di lokasi. Lokasi yang diambil langsung di tempat ditandai **Terverifikasi**.
- **Foto**: ambil dengan kamera. Foto otomatis diberi logo dan keterangan. Foto dari galeri tetap bisa diunggah, tetapi lokasinya ditandai belum terverifikasi.
- **PIC**: rekan yang ikut kunjungan bisa ditambahkan.
- **Hasil diskusi, kesepakatan, kendala**: tulis poin-poinnya.
- **Follow-up**: tugas lanjutan, wajib ada penanggung jawab dan tanggal.
- Setelah selesai, klik **Submit Report**. Supervisor/Manager akan meninjau: *Ditinjau*, *Perlu Revisi*, atau *Selesai*. Laporan baru bisa *Selesai* bila semua follow-up sudah tuntas.

### Lead (calon pelanggan)
Satu lead adalah satu minat layanan. Satu pelanggan boleh punya beberapa lead.
- **Lead Internet**: setelah Anda mendaftarkan pelanggan di MSRadius dan pelanggan muncul di WO, CRM menautkannya otomatis. Tahapnya lalu mengikuti WO sampai pelanggan aktif (WON).
- **Lead Non-Internet** (sewa WiFi, CCTV, dan sebagainya): lanjutkan dengan membuat **penawaran**.
- **Sudah pelanggan?** Klik "Cari di WO" untuk memilih pelanggan lama. Datanya terisi otomatis. Klik **Lepas** bila salah pilih.

### Penawaran
Untuk membuat surat penawaran resmi dari lead non-internet.
1. Isi item dari katalog. Bila item belum ada, klik **+ Item baru**. Harga jual/sewa diisi di kolom *Harga satuan* setelah berkonsultasi dengan Procurement.
2. Pilih rekening pembayaran. Rekening utama sudah terpilih otomatis.
3. Klik **Ajukan untuk persetujuan**, atau **Simpan draft** bila belum selesai.
4. Supervisor/Manager klik **Setujui** (atau **Kembalikan ke draft** bila perlu diperbaiki). Nama penanda tangan diambil dari pengaturan Manager di WO.
5. Cetak atau kirim ke pelanggan, lalu klik **Tandai terkirim ke pelanggan**.
6. Klik **Pelanggan menyetujui** atau **Pelanggan menolak** sesuai jawaban pelanggan. Penawaran yang diterima otomatis menjadi **Order Jasa di WO**.
- Perlu mengubah penawaran yang sudah terkirim? Klik **Buat revisi**. Setiap revisi tersimpan. Buka **Riwayat revisi** untuk melihat versi lama (hanya bisa dibaca).
- Penawaran yang melewati masa berlaku otomatis menjadi *Kedaluwarsa*.

### Katalog
Daftar jasa dan produk yang dipakai di penawaran. Marketing boleh menambah item. Mengubah atau menonaktifkan item hanya bisa dilakukan Supervisor/Manager.

### Peta
Menampilkan titik kunjungan yang lokasinya terverifikasi.

### Lonceng (notifikasi)
Pemberitahuan penting: penawaran perlu disetujui, laporan ditinjau atau perlu revisi, follow-up jatuh tempo, penawaran kedaluwarsa, dan kiriman ke WO yang ditolak.

### Pengaturan profil
Menu di pojok kanan atas untuk melihat profil Anda.

### Admin (khusus Admin)
- **Pengaturan**: bawaan penawaran, format dan nomor awal penawaran (contoh `QT/LIV/X/260001`), daftar rekening PT beserta rekening bawaan.
- **Data & Backup**: backup dan restore data, backup otomatis harian, data demo untuk latihan, dan pemeriksaan sambungan ke WO.

## Tips
- Gunakan HTTPS dan izinkan akses **kamera** dan **lokasi** di browser agar check-in dan foto bisa terverifikasi.
- Bila muncul "Maung WO tidak dapat dihubungi", muat ulang halaman. Bila masih muncul, kirim tangkapan layarnya ke Admin. Alasannya tertulis di dalam kurung.
- Data demo tidak pernah dikirim ke WO, jadi aman untuk latihan.

## Belum tersedia (rencana)
Dashboard Eksekutif (MRR, target, CAC), klasifikasi pelanggan Corporate/Government/Retail, impor data tahun-tahun sebelumnya dari Excel, dan reimbursement ke Finance.
