# Maung CRM — Draf Dokumentasi Teknis

> **Status: DRAF MENTAH** (17 Okt 2026, dari analisis struktur kode di commit `05e8885`). Belum ditinjau. Rujukan yang lebih rinci dan sudah dipakai: `HANDOFF.md`, `docs/ALUR-CRM.md`, `docs/DEPLOY.md`, `docs/PERMINTAAN-PERUBAHAN-WO.md`, `SPEC-FIELD-ACTIVITIES.md`.

## 1. Gambaran umum
Maung CRM adalah aplikasi Sales & Marketing, aplikasi kedua di ekosistem **Maung Super Apps**. Aplikasi induknya **Maung WO** (Work Order + Inventori, repo `thuekx/Maung-Wo-Inv`). CRM berjalan di jalur `/crm` pada domain WO (`https://maung.liv.net.id/crm`) di VM yang sama (`maung-apps`).

CRM **tidak punya login sendiri**. Pengguna login di WO, dan token WO dipakai juga oleh CRM. Data pelanggan, langganan, paket, area, dan work order dicerminkan dari WO. Data milik CRM sendiri: aktivitas lapangan, lead, katalog, dan penawaran. Penawaran yang diterima pelanggan dikirim ke WO dan menjadi Order Jasa.

```
Browser ──HTTPS──► Caddy (milik WO) ──┬─► /crm/api/* ─► crm-api (Express, :4000) ─► PostgreSQL CRM
                                      │                       │  ├─► Garage S3 bersama (foto)
                                      │                       │  └─► WO /api/* (auth, export, integrasi)
                                      └─► /crm/*     ─► crm-web (Next.js, :3000)
```

## 2. Struktur repositori
| Path | Isi |
|---|---|
| `apps/api/` | Backend: Express 5 + TypeScript, `pg` tanpa ORM, validasi `zod` |
| `apps/api/src/` | Kode API (±4.300 baris termasuk tes) |
| `apps/api/migrations/` | Migrasi SQL berurutan `001`–`016`, dijalankan otomatis saat start (`migrate.ts`) |
| `apps/web/` | Frontend: Next.js 16 (App Router), React 19, `basePath: /crm`, `output: standalone`, Leaflet untuk peta |
| `apps/web/src/app/` | Halaman per menu |
| `apps/web/src/components/` | Komponen bersama (AppShell, LeadForm, QuoteEditor, ReportForm, Notifications, dll.) |
| `scripts/` | Skrip server untuk pemilik (update, diagnosa, kunci); keluaran berfase + blok `RESULT` |
| `tests/` | Tes skrip server dengan docker/curl/ssh tiruan (`tests/server-scripts/run.sh`) dan `tests/compose.test.mjs` (validasi compose) |
| `deploy/` | Potongan konfigurasi Caddy untuk jalur `/crm` di WO |
| `docker-compose.yml` | Stack produksi: `postgres`, `crm-api`, `crm-web` |
| `.github/workflows/ci.yml` | CI: typecheck, tes, tes skrip, validasi compose, build & push image GHCR |

## 3. Backend (`apps/api/src`)
### 3.1 Berkas utama
| Berkas | Peran |
|---|---|
| `index.ts` | Entry: migrasi → listen → menyalakan job latar |
| `app.ts` | `createApp()`: middleware, router di bawah `API_BASE` (`/crm/api`), rute report/foto/tugas/peta/PIC/pelanggan |
| `auth.ts` | Validasi token ke WO (`GET {WO_URL}/api/auth/me`), cache 60 dtk per token, cadangan ≤10 menit saat WO sesaat tidak terjangkau, gerbang `app.crm`, peran reviewer |
| `leads.ts` | Lead: CRUD, tahap, tautan ke pelanggan WO (otomatis/manual), kandidat |
| `quotations.ts` | Penawaran: hitung total di server, alur status, revisi + arsip, penomoran, rekening, penanda tangan, sapu kedaluwarsa |
| `catalog.ts` | Katalog jasa/produk (SKU opsional) |
| `dashboard.ts` | KPI: rentang tanggal, filter marketing/area, pipeline lead & penawaran |
| `woSync.ts` | Tarik cermin data WO lewat Export API (berhalaman, `since`) |
| `woPush.ts`, `woPayload.ts` | Outbox kirim ke WO (katalog, penawaran, notifikasi), coba ulang, `BLOCKED` |
| `reconcile.ts` | Rekonsiliasi lead/penawaran CRM terhadap WO |
| `notify.ts` | Notifikasi dalam aplikasi (persetujuan, review, follow-up jatuh tempo, kedaluwarsa) |
| `adminData.ts`, `settings.ts` | Admin: pengaturan (`crm_settings`), Data & Backup, purge, data demo |
| `backup.ts`, `autoBackup.ts` | Backup/restore `.json.gz` manual + otomatis harian (02:30, simpan 7) |
| `storage.ts`, `files.ts` | Penyimpanan foto (driver `local` atau `s3`/Garage), signed URL |
| `gps.ts`, `phone.ts` | Validasi koordinat; normalisasi nomor telepon E.164 |
| `demo.ts` | Pembuat data demo (`is_demo`, tidak pernah dikirim ke WO) |

### 3.2 Autentikasi & otorisasi
- Header `Authorization: Bearer <token WO>`. Token tidak valid → 401. WO tidak terjangkau → 502 dengan alasan dalam kurung.
- Masuk CRM: peran `ADMIN`, atau fitur WO `app.crm` (Admin WO → Hak Akses → "Aplikasi: CRM").
- **Reviewer** = `ADMIN`, atau `MKT` dengan sub-peran `MANAGER`/`SUPERVISOR`. Reviewer melihat semua data; selain itu hanya data milik sendiri (pembuat atau PIC).
- Menu Admin CRM hanya untuk Admin asli (bukan yang sedang "bertindak sebagai").

### 3.3 Daftar rute (prefiks `/crm/api`)
| Area | Rute |
|---|---|
| Umum | `GET /health`, `GET /me`, `GET /pics`, `GET /notifications`, `POST /notifications/read` |
| Field Report | `GET/POST /reports`, `GET/PUT/DELETE /reports/:id`, `POST /reports/:id/checkin`, `POST /reports/:id/photos`, `DELETE /reports/:id/photos/:photoId`, `POST /reports/:id/submit`, `POST /reports/:id/comments`, `POST /reports/:id/tasks`, `GET /tasks`, `PATCH /tasks/:id`, `GET /photos/:id/file`, `GET /map` |
| Cermin WO | `GET /customers`, `GET /customers/lookup`, `GET /customers/:code`, `GET /wo/packages`, `GET /wo/areas`, `GET /sync/status`, `POST /sync/run` |
| Lead | `/leads`: `GET /`, `POST /`, `GET /:id`, `PATCH /:id`, `DELETE /:id`, `POST /:id/stage`, `POST /:id/link`, `GET /:id/candidates` |
| Katalog | `/catalog`: `GET /`, `POST /` (semua pengguna CRM), `PATCH /:id` (reviewer) |
| Penawaran | `/quotations`: `GET /`, `POST /`, `GET /options`, `GET /:id`, `PUT /:id`, `POST /:id/:action` (`submit`, `approve`, `return`, `send`, `accept`, `reject`, `cancel`, `revise`), `GET /:id/revisions/:rev` |
| Dashboard | `GET /dashboard` (KPI) |
| Kirim ke WO | `GET /wo-sync`, `POST /wo-sync/run`, `POST /wo-sync/:id/retry` |
| Admin | `GET/PUT /admin/settings`, `GET /admin/data/overview`, `POST /admin/data/backup`, `PUT /admin/data/auto`, `POST /admin/data/backups/upload`, `GET /admin/data/backups/:name/download`, `POST /admin/data/backups/:name/restore`, `DELETE /admin/data/backups/:name`, `POST /admin/data/purge`, `POST /admin/data/demo`, `GET /admin/data/demo-quotations`, `POST /admin/data/demo-quotations/send-test`, `GET /admin/data/reconcile` |

### 3.4 Status & alur data
- **Field Report:** `DRAFT → SUBMITTED → REVIEWED | REVISION_REQUIRED → COMPLETED`. Foto dan GPS memakai sumber `LIVE/EXIF/UPLOAD/MANUAL`, dan hanya `LIVE` yang bisa `VERIFIED`. Follow-up wajib punya PIC dan tanggal jatuh tempo.
- **Lead:** jenis `INTERNET | NON_INTERNET`. Tahapnya `NEW, CONTACTED, QUALIFIED, REGISTERED, INSTALLING, QUOTING, NEGOTIATION, WON, LOST`. Tautan ke pelanggan WO punya status `NONE | AUTO | MANUAL`. Untuk lead internet, tahapnya mengikuti status pelanggan di WO.
- **Penawaran:** `DRAFT → PENDING_APPROVAL → APPROVED → SENT → ACCEPTED | REJECTED`, plus `EXPIRED` (otomatis) dan `CANCELLED`. Revisi menaikkan `rev`, dan isi revisi lama disimpan sebagai arsip baca-saja. `ACCEPTED` membuat Lead menjadi WON dan dikirim ke WO sebagai Order Jasa.
- **Penomoran penawaran:** template Admin (bawaan `QT/LIV/{BLN}/{YY}{NO}`, token `{BLN} {MM} {YY} {YYYY} {NO}`). Penghitung disimpan per tahun di `quotation_counters` dan menolak nomor ganda.

## 4. Basis data (PostgreSQL 16)
Migrasi: `apps/api/migrations/*.sql`, tercatat di tabel migrasi dan diterapkan saat API start.

| Kelompok | Tabel |
|---|---|
| Aktivitas lapangan | `field_reports`, `field_report_pics`, `field_report_items`, `field_photos`, `field_tasks`, `field_report_comments` |
| Lead | `leads`, `lead_events` |
| Katalog & penawaran | `catalog_items`, `quotations`, `quotation_lines`, `quotation_revisions`, `quotation_events`, `quotation_counters` |
| Cermin WO (baca-saja dari WO) | `wo_customers`, `wo_subscriptions`, `wo_packages`, `wo_areas`, `wo_work_orders`, `wo_sync_state`, `wo_user_cache` |
| Integrasi keluar | `wo_outbox` |
| Sistem | `crm_settings` (kunci: `quotation`, `woSync`, `backup`, `numbering`, `bankAccounts`), `crm_notifications`, `audit_log` |

Jejak marketing (id + nama) disalin permanen ke lead, penawaran, dan report, sehingga tetap ada walau pengguna WO diganti nama atau dihapus. Hapus data bersifat *soft delete*.

## 5. Integrasi dengan Maung WO
| Arah | Mekanisme | Kunci |
|---|---|---|
| Login | `GET {WO_URL}/api/auth/me` dengan token pengguna | – |
| WO → CRM (cermin) | Export API `GET /api/export/{customers,subscriptions,packages,areas,work-orders}` berhalaman (`cursor`, `since`), tiap `SYNC_INTERVAL_MIN` (bawaan 30, min 5) | `WO_EXPORT_API_KEY` (`x-api-key`) |
| CRM → WO (outbox) | `PUT /api/integrations/crm/catalog/:crmId` lalu `PUT /api/integrations/crm/quotations/:crmId`, idempoten per `crmId`+`rev`, diproses tiap 1 menit, backfill tiap 1 jam | `CRM_INTEGRATION_KEY` |
| Notifikasi | `POST /api/integrations/crm/notifications` (idempoten per pengguna + `dedupeKey`), bila diaktifkan | `WO_NOTIFY_ENABLED` |
| Pengaturan formulir | `GET /api/subscription-settings` (nama Manager penanda tangan, rekening utama) | token pengguna |

Sakelar: `WO_SYNC_ENABLED`, `WO_NOTIFY_ENABLED`. Permintaan perubahan ke WO ditulis di `docs/PERMINTAAN-PERUBAHAN-WO.md`. Satu repo hanya punya satu penulis.

Catatan jaringan (15 Okt 2026): `crm-api` menjangkau WO lewat Caddy di host yang sama (`extra_hosts: ${WO_HOST}:host-gateway`), tidak lewat IP publik, supaya tidak bergantung pada hairpin NAT router.

## 6. Job latar (dalam proses `crm-api`)
| Job | Interval |
|---|---|
| Sinkron cermin WO (`startWoSync`) | `SYNC_INTERVAL_MIN` menit |
| Outbox kirim ke WO (`startWoPush`) | 1 menit; backfill 1 jam |
| Sapu penawaran kedaluwarsa | 1 jam |
| Notifikasi follow-up/jatuh tempo | 1 jam |
| Backup otomatis | dicek tiap 10 menit, jalan sekali sehari (bawaan 02:30) |

## 7. Frontend (`apps/web`)
- Halaman: `/` (beranda), `/dashboard`, `/reports/[id]`, `/new` (report baru), `/leads`, `/leads/new`, `/leads/[id]`, `/quotations`, `/quotations/[id]`, `/quotations/[id]/print` (cetak; `?rev=N` untuk arsip), `/catalog`, `/map`, `/profile`, `/admin/settings`, `/admin/data`.
- Token dibaca dari `localStorage` `maung_token` (hasil login di WO). `SessionGuard` mengalihkan ke login WO bila sesi habis.
- `EmbedHeight` dipakai saat halaman Admin CRM tertanam di Pusat Admin WO (iframe).
- Kamera dan GPS butuh HTTPS. Foto diberi watermark di klien, lalu original dan watermark diunggah terpisah.

## 8. Konfigurasi (env `crm-api`)
`DATABASE_URL`, `WO_URL`, `WO_HOST`, `FILE_SIGN_SECRET`, `STORAGE_DRIVER` (`s3`|`local`), `S3_*` (Garage bersama `http://maung-garage:3900`, bucket `crm-photos`), `UPLOAD_DIR`, `BACKUP_DIR`, `WO_EXPORT_API_KEY`, `CRM_INTEGRATION_KEY`, `WO_SYNC_ENABLED`, `WO_NOTIFY_ENABLED`, `SYNC_INTERVAL_MIN`, `PHONE_DEFAULT_REGION`, `API_BASE`, `PORT`. Nilai produksi ada di `~/maung-crm/.env` di VM (jangan di-commit, jangan dicetak).

## 9. Build, deploy, CI
- CI (`ubuntu-24.04`, action versi Node 24) menjalankan typecheck, tes API dengan Postgres, tes web, tes skrip server, dan validasi compose. Lalu ia membangun image `ghcr.io/thuekx/maung-crm-{api,web}:<sha>`.
- Deploy oleh pemilik di VM: `cd ~/maung-crm && git pull --ff-only origin main && bash scripts/update.sh </dev/null`. Skrip ini berjalan dalam 9 fase: guard, snapshot WO, `.env`, backup DB, tarik image, up, cek storage, bukti, finalisasi. Bila bukti gagal, ia rollback otomatis.
- Jaringan: `crm-api` dan `crm-web` ikut di `maung_edge` (bersama Caddy WO). `crm-api` juga di `maung_storage` (Garage). Postgres privat. Tidak ada port CRM yang dibuka di host.
- Skrip diagnosa baca-saja: `check-route.sh` (jalur `/crm`), `check-wo-auth.sh` (CRM → WO auth), `check-quotation-wo.sh` (penawaran terkirim).

## 10. Pengujian
- API: `DATABASE_URL=postgresql://…/maung_crm_test npm test`. Tes integrasi memakai Postgres sungguhan dan WO tiruan (auth, export, integrasi), sekitar 37 tes.
- Skrip server: `bash tests/server-scripts/run.sh` (update.sh 88 cek, setup-deploy-key.sh 13 cek).
- Web: `npx next build`. Uji browser dilakukan manual dengan Playwright di balik proxy.

## 11. Catatan terbuka (draf)
- Dashboard Eksekutif ala Lintas Satu Visi dan klasifikasi pelanggan Corporate/Government/Retail masih menunggu keputusan pemilik (analisis di folder project `crm/`).
- Impor data historis dari Excel belum dibuat. Templatnya sudah ada.
- Belum ada: reimbursement ke Finance, offline sync, baca EXIF otomatis dari foto galeri.
- `README.md` bagian "Status" sudah usang dibanding fitur saat ini dan perlu diperbarui.
