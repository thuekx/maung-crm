# maung-crm

Sales & Marketing CRM untuk ekosistem **Maung Super Apps** — modul pertama: **Field Activities / Canvassing** (laporan kunjungan, foto bertanda GPS, prospek & follow-up, peta).

- Spesifikasi lengkap: [`SPEC-FIELD-ACTIVITIES.md`](SPEC-FIELD-ACTIVITIES.md)
- Serah-terima untuk sesi Claude baru: [`HANDOFF.md`](HANDOFF.md)
- Aplikasi induk (WO + Inventori): `thuekx/Maung-Wo-Inv`

## Status
Skeleton + MVP awal Field Report berjalan dan teruji (14 tes API + uji browser E2E): login via Maung WO (introspect), RBAC (ADMIN/MKT; MANAGER/SUPERVISOR = reviewer), report multi-PIC, GPS check-in, foto kamera + watermark (original & watermark terpisah, sumber LIVE/EXIF/UPLOAD/MANUAL, hanya LIVE yang bisa Verified), Map View, Follow-up Task (PIC + due date wajib), audit log, soft delete.

Belum dikerjakan (tahap berikutnya): review manager, dashboard KPI, prospek/partnership, reimbursement→Finance, offline sync, baca EXIF otomatis dari foto galeri, CI.

Deploy (image GHCR, Garage, PostGIS, CI): lihat [`docs/DEPLOY.md`](docs/DEPLOY.md). Permintaan perubahan untuk repo WO: [`docs/PERMINTAAN-KE-WO.md`](docs/PERMINTAAN-KE-WO.md).

## Menjalankan (pengembangan)
```
npm install
createdb maung_crm            # PostgreSQL 16
cp apps/api/.env.example apps/api/.env   # atur DATABASE_URL, WO_URL
npm start -w apps/api         # :4100, migrasi otomatis
npm run build -w apps/web && npm start -w apps/web   # :3100, /api diproksikan ke API_URL
npm test                      # butuh DB maung_crm_test
```
Catatan: akses data memakai `pg` + migrasi SQL (bukan Prisma) agar sederhana; foto disimpan lewat antarmuka storage (`STORAGE_DRIVER=local` volume `UPLOAD_DIR`, atau `s3` untuk Garage) dan disajikan lewat signed URL. Kamera/GPS butuh HTTPS di produksi.
