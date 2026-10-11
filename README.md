# maung-crm

Sales & Marketing CRM untuk ekosistem **Maung Super Apps** — modul pertama: **Field Activities / Canvassing** (laporan kunjungan, foto bertanda GPS, prospek & follow-up, peta).

- Spesifikasi lengkap: [`SPEC-FIELD-ACTIVITIES.md`](SPEC-FIELD-ACTIVITIES.md)
- Serah-terima untuk sesi Claude baru: [`HANDOFF.md`](HANDOFF.md)
- Aplikasi induk (WO + Inventori): `thuekx/Maung-Wo-Inv`

## Status
Skeleton + MVP awal Field Report berjalan dan teruji (14 tes API + uji browser E2E): login via Maung WO (introspect), RBAC (ADMIN/MKT; MANAGER/SUPERVISOR = reviewer), report multi-PIC, GPS check-in, foto kamera + watermark (original & watermark terpisah, sumber LIVE/EXIF/UPLOAD/MANUAL, hanya LIVE yang bisa Verified), Map View, Follow-up Task (PIC + due date wajib), audit log, soft delete.

Belum dikerjakan (tahap berikutnya): review manager, dashboard KPI, prospek/partnership, reimbursement→Finance, offline sync, baca EXIF otomatis dari foto galeri, CI.

Deploy (jalur `/crm` pada domain Maung WO; image GHCR bertag SHA, Garage, PostGIS): [`docs/DEPLOY.md`](docs/DEPLOY.md). Rencana integrasi: [`docs/RENCANA-INTEGRASI-WO.md`](docs/RENCANA-INTEGRASI-WO.md).

## Menjalankan (pengembangan)
```
npm install
createdb maung_crm            # PostgreSQL 16
cp apps/api/.env.example apps/api/.env   # atur DATABASE_URL, WO_URL
PORT=4100 npm start -w apps/api   # API di /crm/api, migrasi otomatis (image produksi: port 4000)
API_URL=http://localhost:4100 npm run build -w apps/web && npm start -w apps/web   # :3100/crm — rewrite /crm/api → API hanya jika API_URL diisi (produksi: Caddy)
npm test                      # butuh DB maung_crm_test
# Tanpa login sendiri: token Maung WO dibaca dari localStorage `maung_token` (login di WO). Dev tanpa WO: isi manual lewat DevTools.
```
Catatan: akses data memakai `pg` + migrasi SQL (bukan Prisma) agar sederhana; foto disimpan lewat antarmuka storage (`STORAGE_DRIVER=local` volume `UPLOAD_DIR`, atau `s3` untuk Garage) dan disajikan lewat signed URL. Kamera/GPS butuh HTTPS di produksi.
