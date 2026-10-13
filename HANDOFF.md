# HANDOFF — maung-crm (Sales & Marketing CRM · Field Activities)

> Berkas ini untuk sesi Claude baru. Baca juga `SPEC-FIELD-ACTIVITIES.md` (spesifikasi lengkap dari pemilik).

## Konteks
- Pemilik membangun ekosistem **Maung Super Apps**. Aplikasi pertama = **Maung WO + Inventori** (repo `thuekx/Maung-Wo-Inv`, ISP: Work Order, inventori, PR/PO, MSRadius, notifikasi). `maung-crm` adalah aplikasi **kedua**, dibangun terpisah (repo & sesi sendiri) agar pembaruan Live WO tidak tertumpuk.
- Bahasa kerja: **Bahasa Indonesia**. Git identity: `thuekx <thuekx@kolu.web.id>`; hanya branch `main`; jangan tambah fitur di luar permintaan; jangan tempel token/secret di chat; uji sungguhan sebelum push.

## Integrasi dengan Maung WO (sudah tersedia)
- **Login terpusat**: `GET {WO_URL}/api/auth/introspect` dengan `Authorization: Bearer <token>` → `{active, sub, name, email, role, subRole, exp}` (401 bila tidak valid). Token diperoleh dari `POST {WO_URL}/api/auth/login`. Jangan membuat tabel user sendiri; rujuk `userId` WO. Peran: ADMIN/MKT/NOC/FOC/GA/FIN + sub-role MANAGER/SUPERVISOR/STAFF → pakai divisi **MKT** untuk sales; MANAGER/SUPERVISOR = reviewer.
- **API data WO** (baca): `/api/export/*` (header `x-api-key`) — pelanggan, WO, dsb. Dokumentasi: `docs/API.md`, `docs/SUPER-APPS.md` di repo Maung-Wo-Inv. Rujuk `customerId` WO, jangan salin data pelanggan.
- Satu domain via reverse proxy (Caddy) — mis. `crm.perusahaan.co.id` subdomain terpisah di server yang sama; panduan: `docs/INSTALL.md` Maung-Wo-Inv.

## Stack yang disarankan (selaras Maung WO agar UI/pola auth bisa dipakai ulang)
Express 5 + TypeScript + Prisma 7 (adapter-pg) + PostgreSQL 16 (PostGIS bila perlu) + Redis/BullMQ, Next.js 16 (App Router) + React 19 + Tailwind 3, Docker Compose + Caddy. Foto: object storage (MinIO/Garage) atau volume dulu + resize on-demand (sharp, pola `/api/img` di Maung WO). PWA (mobile-first).

## Pelajaran dari Maung WO (jangan diulang salah)
- GPS foto: ambil lokasi **saat jepret** (Geolocation high accuracy), tempel banner GPS+logo di klien (canvas) — lihat `apps/web/src/lib/photo.ts` & `Scanner.tsx` di Maung WO. Kamera/GPS butuh **HTTPS**.
- `router.use(guard)` tanpa path menahan semua router sesudahnya → selalu beri path pada guard.
- Tombol "Foto" dengan `<input capture>` memakai kamera bawaan (autofokus); jangan simpan EXIF sebagai "Verified".
- Sesi diam 30 menit + refresh token; ikon mata di semua isian password; mode gelap harus terbaca (audit kontras otomatis dengan Playwright).
- Backup/restore/purge via menu Admin (format NDJSON.gz) — pola ada di `apps/api/src/backup.ts`.

## Rencana awal
1. Setup repo, skeleton API+web, login via introspect, RBAC dasar, CI typecheck.
2. MVP: Field Report (multi-PIC), GPS check-in, live photo + watermark (original & watermark terpisah, source: LIVE/EXIF/UPLOAD/MANUAL), Map View, Follow-up Task.
3. Dashboard KPI, review manager (Draft→Submitted→Reviewed→Revision Required→Completed), Area Prospect / Partnership Opportunity, reimbursement → Finance.
4. Offline draft & sync, analytics lanjutan.
Keputusan terbuka untuk pemilik: lokasi object storage (MinIO/Garage vs volume), apakah memakai PostGIS, apakah Lead/Opportunity memakai master pelanggan WO atau modul CRM sendiri.

## Preferensi cara kerja dari pemilik (wajib diikuti)
- **Setiap kali menyuruh pemilik menjalankan sesuatu, TULIS PERINTAH LENGKAPNYA di pesan yang sama** (blok kode siap salin-tempel, satu per langkah). DILARANG menulis "jalankan update.sh seperti biasa", "ulangi langkah tadi", atau merujuk ke pesan/dokumen lain tanpa menuliskan perintahnya. Ini sudah beberapa kali diingatkan pemilik.
- **Perintah ke server = SATU skrip otomatis berfase**, bukan langkah manual terpisah. Format keluaran seperti contoh pemilik: banner `====`, `[n/N] nama fase`, baris `✓`/`!`/`✗`, lalu blok `RESULT` berisi `kunci=nilai` (status, proof/audit log, apa yang TIDAK diubah) dan baris akhir `RESULT : ... PASS/GAGAL / NEXT=...`. Contoh: `scripts/update.sh`.
- **Guard dulu sebelum eksekusi**: tampilkan `pwd`, cek direktori (kosong / repo yang benar / bukan folder aplikasi lain), buat direktori baru khusus untuk aplikasi, dan hentikan tanpa mengubah apa pun bila ragu. Jangan jalankan perintah di direktori yang belum diperiksa (insiden: `cp .env.example .env` menimpa `.env` Maung WO saat `cd` gagal).
- Skrip menulis log audit ke `~/maung-crm-logs/`, tidak pernah mencetak secret, dan tidak menimpa `.env`.
- Minta pemilik mengetik/menjalankan perintah manual hanya bila benar-benar tidak mungkin (mis. token GitHub untuk repo private); jelaskan alasannya.
- **Jangan minta pemilik mengubah/menyunting skrip** (mis. "ubah baris pertama", "isi variabel ini", "ganti nama host"). Selalu berikan **skrip UTUH yang siap tempel dan jalankan** setiap kali ada perubahan; bila ada mode berbeda (mis. diagnosis), sediakan sebagai blok utuh terpisah atau jadikan perilaku bawaan. Alasan: sunting manual rawan salah.

## Arsitektur terbaru (menggantikan "CRM berdiri sendiri")
Satu domain, satu login (Maung WO), CRM di jalur `/crm` pada VM yang sama; Caddy milik WO; `crm-web`/`crm-api` di jaringan `maung_edge`; API CRM di `/crm/api` (port 4000); token = `maung_token`; akses = fitur WO `app.crm` + cakupan peran; data pelanggan lewat Export API WO (cermin baca-saja). Detail dan tahap: `docs/RENCANA-INTEGRASI-WO.md`; kontrak sisi WO: `docs/maung-crm/INTEGRASI-WO.md` di repo Maung-Wo-Inv. Satu repo satu penulis: sesi CRM hanya menulis di repo ini.


## Uji sambung CRM→WO (demo:true)
- Penawaran demo TIDAK PERNAH keluar ke WO, kecuali Admin asli memilihnya di Data & Backup → "Uji sambung ke WO" (ketik KIRIM UJI). Payload PUT quotation menambah `demo:true`; hasil di kolom `quotations.wo_test_*` (terpisah dari `wo_synced_*`), tidak lewat antrean.
- Hapus data demo CRM = status uji ikut hilang; respons purge memuat `testSent` (jumlah yang pernah dikirim) — sisi WO dibersihkan lewat purge uji sambung WO.
- Rekonsiliasi (GET /api/integrations/crm/quotations, baca-saja) ada di Data & Backup → "Rekonsiliasi CRM ↔ WO" (reconcile.ts): hilang di WO, status/revisi/total beda, hanya di WO, sisa demo di WO.

## Notifikasi (lonceng)
- Tabel `crm_notifications` (migrasi 013), API `GET /crm/api/notifications`, `POST /crm/api/notifications/read` ({ids?}); `notify.ts` (kegagalan tak pernah menggagalkan proses utama, dedupe_key mencegah ganda). Baris demo tidak menghasilkan notifikasi.
- Pemicu: penawaran diajukan→reviewer; disetujui/dikembalikan→pemilik; report submit→reviewer; review/revisi/selesai→pembuat; komentar→pihak lain; follow-up baru→PIC. Sweep tiap jam: follow-up jatuh tempo/terlambat→PIC, penawaran SENT ≤3 hari kedaluwarsa→pemilik, antrean WO BLOCKED→Admin.
- Belum ada: push Telegram/email dari CRM (butuh endpoint penerima di WO).
