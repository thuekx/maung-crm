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
- **Perintah ke server = SATU skrip otomatis berfase**, bukan langkah manual terpisah. Format keluaran seperti contoh pemilik: banner `====`, `[n/N] nama fase`, baris `✓`/`!`/`✗`, lalu blok `RESULT` berisi `kunci=nilai` (status, proof/audit log, apa yang TIDAK diubah) dan baris akhir `RESULT : ... PASS/GAGAL / NEXT=...`. Contoh: `deploy/install.sh`.
- **Guard dulu sebelum eksekusi**: tampilkan `pwd`, cek direktori (kosong / repo yang benar / bukan folder aplikasi lain), buat direktori baru khusus untuk aplikasi, dan hentikan tanpa mengubah apa pun bila ragu. Jangan jalankan perintah di direktori yang belum diperiksa (insiden: `cp .env.example .env` menimpa `.env` Maung WO saat `cd` gagal).
- Skrip menulis log audit ke `~/maung-crm-logs/`, tidak pernah mencetak secret, dan tidak menimpa `.env`.
- Minta pemilik mengetik/menjalankan perintah manual hanya bila benar-benar tidak mungkin (mis. token GitHub untuk repo private); jelaskan alasannya.

