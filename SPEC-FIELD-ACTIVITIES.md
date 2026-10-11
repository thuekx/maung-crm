# DEVELOPMENT TASK — Marketing Canvassing & GPS-Tagged Field Activity Tracking

**Project:** Maung Super Apps – Sales & Marketing CRM · **Module:** Field Marketing / Canvassing · **Priority:** High · **Target:** Responsive Web App / Mobile PWA

## 1. Objective
Bangun modul Marketing Canvassing yang memungkinkan tim marketing mencatat aktivitas kunjungan lapangan secara terstruktur, mengunggah foto dokumentasi dengan informasi lokasi GPS, mengelola prospek, dan melaporkan hasil serta tindak lanjut secara real-time. Mendukung monitoring oleh Sales Manager, Marketing Manager, dan Direksi.

## 2. Struktur menu — Sales & Marketing → Field Activities
1. Dashboard Canvassing 2. New Field Report 3. Activity History 4. Map View 5. Prospect & Lead Follow-up 6. Team Activity Monitoring 7. Reports & Analytics

## 3. Form Field Report
**A. Informasi Aktivitas** — tanggal & waktu kunjungan (otomatis, dapat mencatat waktu aktivitas sebenarnya); Marketing/PIC (multi-user: Nurman, Rasyad, dll); Activity Type (Canvassing, Meeting, Follow-up, Survey, Partnership, Community Engagement, lainnya); Counterpart; Account/organisasi; Area/wilayah; Lokasi GPS (lat, lng, accuracy); Status verifikasi lokasi.

**B. Hasil Kegiatan** — Summary; Update/hasil diskusi (multiple items); Agreement/kesepakatan; New Prospect; Estimated Potential Customer; Estimated Revenue (opsional); Issues/kendala; Expense/reimbursement request; Next Action; Due Date; Responsible PIC; Status Follow-up.

**C. Dokumentasi** — multiple photo upload; optional video; caption per foto; GPS tagging otomatis; timestamp dokumentasi; lokasi pada peta; preview & download.

## 4. GPS Tagging & Foto (requirement utama)
Saat marketing mengambil foto lewat aplikasi:
1. Browser meminta izin lokasi perangkat.
2. Ambil GPS dengan Geolocation API **high accuracy**.
3. Simpan latitude, longitude, accuracy, dan waktu pembacaan GPS.
4. Foto dikaitkan dengan GPS tersebut otomatis.
5. Pilihan watermark: tanggal & jam · lat/long · area/lokasi · nama marketing · nama aktivitas.
6. Simpan **original** dan **versi watermark** terpisah.
7. Semua foto tampil di Map View.

**Penting:** foto dari galeri tidak otomatis dianggap diambil di lokasi upload; bila ada, baca EXIF GPS dan simpan sebagai sumber metadata berbeda; bila lokasi tidak tersedia, foto tetap bisa diunggah dengan status **Location Unverified**; GPS capture saat **pengambilan foto**, bukan saat submit; cantumkan accuracy & source (**Live GPS / EXIF / Upload Location / Manual**); lokasi manual TIDAK boleh tampil sebagai Verified GPS; HTTPS, permission perangkat, penanganan error GPS.

**Contoh panel watermark:**
```
LIV | Marketing Field Activity                [GPS Verified]
9 Oktober 2026 · 10:35 WIB
Panundaan, Ciwidey, Kabupaten Bandung
PIC: Nurman, Rasyad
GPS: -6.xxxxxx, 107.xxxxxx · Accuracy: ±8 m
```

## 5. Workflow
Marketing Login → Create Field Activity → Check-in GPS → Input Counterpart → Take Photos → Record Discussion → Add Prospects → Set Next Actions → Submit Report → Manager Review → Follow-up Tracking → Completed.
Status report: **Draft · Submitted · Reviewed · Revision Required · Completed**. Manager dapat memberi komentar dan mengembalikan report untuk revisi.

## 6. Contoh data UAT
**9 Oktober 2026** · Marketing: Nurman, Rasyad · Counterpart: Pengurus BUMDes & Tokoh Panundaan · Area: Panundaan.
Hasil: (a) menyetujui penerimaan dana kontribusi bulanan oleh BUMDes; (b) menyetujui perhitungan fee sampai Juni; (c) pihak terkait berminat program kemitraan pemasaran internet retail Panundaan; (d) pengajuan reimbursement penggunaan kertas untuk operasional BUMDes Net; (e) prospek area Panyocokan, potensi ±30 pelanggan.
Perilaku yang diharapkan: satu report memuat banyak hasil diskusi; tiap keputusan/kesepakatan bisa jadi follow-up task; reimbursement diteruskan ke workflow Finance; minat kemitraan → Partnership Opportunity; potensi 30 pelanggan → **Area Prospect** (bukan 30 lead individual otomatis); semua foto terkait report; manager melihat via timeline & peta.

## 7. Dashboard
KPI: Total Visits · Visits per Marketing · Verified GPS Visits · Unverified Visits · New Leads · Area Prospects · Potential Customers · Follow-up Overdue · Partnership Opportunities · Conversion from Canvassing · Estimated Potential MRR. Filter: tanggal, marketing, lokasi, cabang, status.

## 8. Persyaratan teknis
- Integrasi autentikasi & RBAC Maung Super Apps (lihat `HANDOFF.md` → login terpusat via `GET /api/auth/introspect` di Maung WO).
- `company_id`, `branch_id`, `created_by`, audit log, soft delete.
- Domain terpisah, terintegrasi dengan Lead, Account, Opportunity, Task, Finance.
- PostgreSQL (+PostGIS bila perlu), object storage untuk foto (MinIO/Garage di container terpisah).
- Upload aman, kompresi, validasi MIME/ukuran, signed URL, pembatasan akses.
- Metadata lokasi tidak boleh diubah tanpa audit trail.
- Pertimbangkan draft offline & sync.
- Permission kamera/lokasi hanya saat dibutuhkan; **tanpa background tracking**; lokasi dikumpulkan hanya saat aktivitas kerja yang diinisiasi pengguna.

## 9. Deliverables
UI/UX mobile-first · skema DB + migrasi · REST API/service contract · frontend Field Activity · GPS Photo Capture & Watermark · Dashboard & Map View · integrasi CRM Leads/Opportunities/Tasks · unit/integration test + UAT · dokumentasi teknis & deployment staging.

## 10. Acceptance criteria
- Report dengan >1 PIC.
- Foto live tersimpan dengan koordinat, timestamp, accuracy, GPS source.
- GPS ditolak/tidak ada → aplikasi tidak mengarang koordinat.
- Foto galeri dibedakan dari live capture.
- Peta menampilkan aktivitas berdasarkan koordinat valid.
- Semua follow-up punya PIC & due date.
- Manager dapat review & melihat history perubahan.
- Report terhubung ke lead, opportunity, reimbursement.
- Nyaman di smartphone Android/iOS.
- Semua fitur diuji di staging sebelum production.

**Prioritas implementasi (MVP):** Field Report, Multi-PIC, GPS Check-in, Live Photo Capture, GPS Watermark, Map View, Follow-up Task. Bertahap setelah MVP stabil: offline sync, approval reimbursement penuh, analytics lanjutan.
