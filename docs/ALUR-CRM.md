# Alur kerja CRM per menu (dan pelanggan existing)

Prinsip: **Lead = minat layanan** (bukan orang). Satu pelanggan bisa punya banyak Lead. Jalur internet bersumber WO/MSRadius (CRM hanya melacak); jalur non-internet bersumber CRM (penawaran → WO).

## Menu
| Menu | Fungsi | Alur singkat |
|---|---|---|
| **Dashboard** | Ringkasan KPI (lead, penawaran, kunjungan, follow-up) per rentang tanggal/marketing | Reviewer melihat semua; staf miliknya |
| **Aktivitas** (Field Report) | Catatan kunjungan lapangan + foto + GPS + follow-up | Draft → Submit → Reviewed / Revision Required → Completed (follow-up harus selesai) |
| **Report Baru** | Buat report: check-in GPS live, foto berlogo, PIC, hasil diskusi | Lihat Aktivitas |
| **Lead** | Prospek internet / non-internet | lihat di bawah |
| **Penawaran** | Quotation non-internet dari Lead | DRAFT → (ajukan langsung dari editor, tanpa simpan draft dulu) PENDING_APPROVAL → (reviewer) APPROVED → SENT → ACCEPTED/REJECTED; EXPIRED otomatis; revisi menaikkan rev dan isi revisi lama tersimpan baca-saja (Riwayat revisi → Buka). Nomor mengikuti format Admin; nomor urut boleh diisi manual sebelum pertama kali dikirim (tidak boleh ganda). Rekening dipilih per penawaran (disalin). Nama penanda tangan disalin dari Manager WO saat disetujui |
| **Katalog** | Jenis jasa/produk (dipakai di penawaran; di-push ke WO) | Item baru boleh dibuat marketing (juga langsung dari penawaran: "+ Item baru"); ubah/nonaktifkan hanya reviewer; SKU opsional |
| **Peta** | Titik kunjungan terverifikasi | Hanya koordinat valid |
| **Lonceng** | Notifikasi dalam aplikasi | Persetujuan, review, follow-up, kedaluwarsa, kirim-WO ditolak |
| **Admin** (Admin asli) | Pengaturan CRM (bawaan penawaran, format & nomor awal penawaran, rekening PT + bawaan), Data & Backup (backup/restore, demo, uji sambung, rekonsiliasi) | Juga tertanam di Pusat Admin WO |

## Lead — pelanggan BARU
- **Internet:** Lead (NEW→CONTACTED→QUALIFIED) → marketing mendaftarkan di MSRadius → WO membuat pelanggan `PROSPECT` → CRM menautkan otomatis (satu kandidat, dibuat setelah Lead) → `REGISTERED → INSTALLING → WON` saat pelanggan `ACTIVE`/Online; `LOST` bila WO Pasang Baru ditolak/dibatalkan. CRM tidak menulis ke WO.
- **Non-internet:** Lead → QUOTING → NEGOTIATION → penawaran `ACCEPTED` = WON → WO membuat **pelanggan baru + Order Jasa**.

## Lead — pelanggan LAMA, layanan baru/tambahan
Di formulir Lead ada **"Sudah pelanggan? Cari di WO"** (nama / kode / telepon, dari cermin WO). Memilih pelanggan mengisi data dan menyimpan **pelanggan acuan** (`relatedCustomerCode`).
- **Non-internet** (sewa WiFi, beli/pasang CCTV…): Lead langsung ditautkan ke pelanggan terpilih → penawaran → `ACCEPTED` → WO membuat **Order Jasa di pelanggan itu** (tanpa pelanggan baru, status/paket internet tidak disentuh). Lokasi/cabang baru: WO diminta mendukung `customer.parentCode` (lihat H di `PERMINTAAN-PERUBAHAN-WO.md`).
- **Internet** (titik/langganan baru milik pelanggan lama): karena WO memberi **kode pelanggan baru** per layanan, pelanggan terpilih hanya **acuan** (status pelanggan lama TIDAK diikuti — kalau diikuti, Lead langsung salah-Won). Lead dilacak ke **kode baru** yang muncul di WO: otomatis (satu kandidat baru yang dibuat setelah Lead, bukan kode acuan) atau pasti lewat `crmLeadRef`/`parentCustomerCode` di Export API bila WO menyediakannya (H.3–4).
- Di luar CRM (tetap di MSRadius/WO): ganti/naik paket, pindah alamat.

## Saran alur bersama WO (ringkas)
1. Satu kode pelanggan = satu layanan/lokasi; **akun** dikelompokkan lewat `parentCustomerCode`.
2. Marketing mengisi `crmLeadRef` pada PROSPECT baru di WO → CRM menautkan pasti, tanpa tebakan nomor/nama.
3. Non-internet pelanggan lama: kirim `customer.code`; lokasi baru: `customer.parentCode`.
4. Pemeriksaan WO per kode pelanggan tidak berubah.

## Kerja tim pada Lead (UAT 3)
Lead tetap milik **pembuat pertama** (satu penanggung jawab, jejak `marketingUserId` ke WO tidak berubah). Rekan Marketing yang ikut approach dicatat sebagai **PIC di Report Aktivitas** (Admin tidak ditampilkan di pilihan PIC). Reviewer dapat memindahkan pemilik Lead bila perlu. Pembagian kredit WON sebagai kerja tim belum dibuat (menunggu keputusan pemilik).
