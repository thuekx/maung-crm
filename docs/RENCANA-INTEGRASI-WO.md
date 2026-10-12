# Rencana integrasi maung-crm ↔ Maung WO (jalur satu domain)

Sumber kebenaran sisi WO: `docs/maung-crm/INTEGRASI-WO.md` di repo Maung-Wo-Inv (dibaca HEAD `b864723`). Dokumen ini = rencana sisi CRM. Status: rencana **DISETUJUI**. **Tahap 1 (kode), Tahap 2 (compose + CI) dan Tahap 3 (skrip server: `scripts/bootstrap-token.sh`, `setup-deploy-key.sh`, `update.sh`, tes `tests/server-scripts/`) SELESAI di repo** — belum dijalankan di server; menunggu pemilik menjalankan alur `docs/DEPLOY.md` bagian A–B, lalu Tahap 4 (serah-terima `crm.caddy`/pendaftaran di Admin WO) dan Tahap 5 (sinkron Export API). CSP `unsafe-inline` diterima; versi nonce = tahap opsional terpisah (tidak dikerjakan).
Prinsip: satu repo satu penulis (sesi CRM hanya menulis di repo ini; sesi WO hanya di repo WO; saling membaca lewat berkas di `main`).

## Keputusan pemilik (dicatat)
1. Akses = gerbang fitur WO **`app.crm`** + cakupan data per peran/sub-role di CRM. Cukup `GET /api/auth/me` (Bearer): memvalidasi token (401 bila salah) dan memuat `role`, `subRole`, `features[]`. Cache ±60 dtk. (Fitur `app.crm` baru ada setelah aplikasi didaftarkan di Admin WO → Pengaturan → Aplikasi, ID `crm`; bawaan hanya ADMIN sampai diatur di Hak Akses.)
2. `crm-api` terpisah di jaringan `maung_edge`; Caddy langsung: `handle /crm/api/*` → `crm-api:4000` (lebih dulu), `handle /crm/*` → `crm-web:3000`. Berkas/unggahan CRM di bawah `/crm/...`.
3. Folder server tetap `~/maung-crm`.
4. Akses repo di server: **deploy key read-only** (`ed25519`), tanpa token tersimpan; repo tetap private.
5. Master pelanggan CRM = **cermin baca-saja** Export API WO (`customers`, `subscriptions`; kunci hanya di `.env` CRM). Lead/Opportunity milik CRM, menaut `customerCode` / `regNo`. `?since` WO memakai `createdAt` ⇒ perubahan status pelanggan lama tidak terlihat; **tarik penuh berkala** (mis. tiap 3 jam, limit 5000, upsert menurut `code`/`regNo`). Tidak meminta perubahan di WO.
6. Tetap: foto di Garage, PostGIS (image sudah dipakai; skema belum diaktifkan).

## Daftar perubahan terhadap kode yang ada (a–e + data)
| | Kondisi sekarang (repo CRM) | Perubahan |
|---|---|---|
| a | `deploy/crm.caddy` blok subdomain | **Sudah diganti** isinya (dua `handle`) — untuk ditaruh di `proxy/apps/crm.caddy` repo WO oleh sesi WO. Jangan dipasang sebelum Tahap 2. |
| b | `docker-compose.wo-vm.yml` → jaringan `maung-wo-inv_default`; service `web`/`api`; `ports: 3100` | Hapus overlay lama dan `ports`. Service **`crm-web`** (3000) dan **`crm-api`** (**4000**, menyesuaikan Caddy) bergabung ke `maung_edge` (`external: true`); `postgres`/`garage` hanya jaringan privat CRM. Hapus `WEB_PORT`, `WO_NETWORK`, `CRM_DOMAIN` dari `.env.example`. Healthcheck API → `/crm/api/health`. |
| c | `next.config.mjs`: tanpa basePath; rewrite `/api` → API | `basePath: '/crm'`. Rewrite hanya untuk `npm run dev`; produksi lewat Caddy. Semua `fetch` klien → `/crm/api/...` (manual, basePath tidak otomatis). API memasang semua rute di **`/crm/api`** (konfigurasi `API_BASE`), termasuk URL foto bertanda tangan `/crm/api/photos/:id/file`. Tidak ada `/uploads`. |
| d | Halaman `/login` + rute `POST /api/auth/login` + kunci `crm_token` | Hapus keduanya. Token = `maung_token` (localStorage, lalu sessionStorage). Tanpa token/401 → `/login?next=<jalur CRM>`. `keepAlive`: `POST /api/auth/refresh` tiap ≤5 mnt saat aktif + `maung_last_active`. Logout = hapus `maung_token` → `/login`. Tautan **Beranda Maung → `/apps`**. Server memakai `/api/auth/me` (bukan introspect), gerbang `app.crm` (ADMIN dikecualikan), cakupan data seperti sekarang. Tes: mock WO `/auth/me` + `/auth/refresh`; E2E Playwright di jalur `/crm`. |
| e | `docker-compose.caddy.yml` (Caddy sendiri) | Usulan: **dihapus**, bukan dipertahankan sebagai `--standalone` — tanpa halaman login WO di domain yang sama, CRM tak bisa dipakai mandiri (token ada di penyimpanan domain WO). *Perlu konfirmasi pemilik.* |
| f | Belum ada sinkron data WO | Tahap 5 (di bawah). |
| g | `docs/PERMINTAAN-KE-WO.md` | **Dihapus** (usang; digantikan dokumen ini). `DEPLOY.md` ditulis ulang (folder `~/maung-crm`; contoh `~/Maung-CRM` tidak dipakai). |

## Tahap bertahap (tiap tahap diuji sebelum push; berhenti untuk persetujuan di antara tahap)
1. **Kode CRM (tanpa infrastruktur):** basePath, auth satu login + keepAlive, basis `/crm/api`, port 4000, gerbang `app.crm`, tes API + E2E browser di `/crm` dengan mock WO.
2. **Image & compose:** `crm-web`/`crm-api` di `maung_edge`, tanpa port host, validasi `docker compose config`, CI membangun image.
3. **Skrip server** (`scripts/`, satu perintah salin-tempel `cd ~/maung-crm && git pull --ff-only origin main && bash scripts/update.sh </dev/null`): `setup-deploy-key.sh` (cetak kunci publik saja; pemilik menempel di GitHub → Deploy keys tanpa write; verifikasi `git ls-remote`; remote beralih ke SSH) dan `update.sh` (berfase; guard host `maung-apps`, bukan root, tanpa sudo; jaringan `maung_edge` ada; checksum `.env` WO sebelum/sesudah = tidak berubah; backup `pg_dump` + catat tag image sebelumnya; rollback otomatis; blok RESULT; log `~/maung-crm-logs/`; 6 pemeriksaan §4 dokumen WO). Transisi: satu kali terakhir lewat bootstrap berbasis token untuk membawa skrip baru, lalu deploy key, setelah itu tanpa token (login GHCR tersimpan di `~/.docker`; bila token kedaluwarsa, update gagal dengan pesan jelas).
4. **Serah-terima:** `deploy/crm.caddy` dipasang sesi WO di `proxy/apps/` + muat ulang Caddy; pemilik mendaftarkan CRM di Admin WO (Pengaturan → Aplikasi: ID `crm`, jalur `/crm`) dan memberi hak "Aplikasi: CRM" pada divisi/sub-role terkait.
5. **Sinkron Export API:** tabel cermin `wo_customers`, `wo_subscriptions`, `wo_sync_runs`; tarik penuh berkala + tombol manual (reviewer/ADMIN); kunci `WO_EXPORT_API_KEY` hanya di `.env` CRM (diisi pemilik, tidak dicetak/di-log); batas 120 req/mnt dihormati; tidak menulis ke DB WO, tidak memakai `JWT_SECRET` WO; tes dengan mock Export API.
Setelahnya (terpisah, perlu persetujuan sendiri): modul Lead / Opportunity / Quotation + penaut `customerCode`.

## Catatan risiko
- `maung_token` ada di penyimpanan origin yang sama dengan WO ⇒ XSS di CRM berarti token WO bocor. Aturan CRM: tanpa HTML mentah (hanya render teks React), CSP dipertimbangkan.
- Daftar PIC CRM berasal dari user WO yang pernah memanggil CRM (cache dari `/auth/me`); tidak ada endpoint daftar user di WO.
- Migrasi dari deployment uji sekarang (port 3100): data CRM masih uji; volume Postgres/Garage dipertahankan, container `web`/`api` lama dibuang (`--remove-orphans`).

## Bukti wajib di RESULT `update.sh` (Tahap 3) — disepakati dengan sesi WO, tanpa menempel token
a. dari container `crm-api`: `GET {WO_URL}/api/auth/me` tanpa token = **401** (terjangkau & rute benar);
b. via Caddy: `https://maung.liv.net.id/crm/api/health` = 200 dan `/crm/` = 200 atau alih ke login;
c. `https://maung.liv.net.id/login` dan `/api/branding` tetap 200 (WO tak terganggu);
d. `crm-web` & `crm-api` ada di jaringan `maung_edge`; tidak ada port CRM terbuka di host.
Penerimaan akhir (manual, pemilik): login WO → `/apps` → ikon CRM → CRM terbuka tanpa login ulang; 35 menit aktif tidak keluar sesi.
Urutan go-live: daftarkan CRM di Admin WO ("Tampil di beranda" MATI) → atur Hak Akses "Aplikasi: CRM" → deploy CRM + `crm.caddy` → baru nyalakan ikon.

## Pembaruan dari sesi WO (2026-10-12)
- **Pemasangan jalur `/crm`**: pakai `scripts/app-route.sh add crm` di repo WO (aturan: hanya `handle /crm… → reverse_proxy <layanan>:<port>`, upstream bukan layanan WO). `deploy/crm.caddy` sudah diuji lolos aturan itu (dan dua kasus negatif ditolak).
- **Tombol kembali**: WO mewajibkan aplikasi lain menyediakan tautan ke `/apps` (CRM sudah: "← Beranda Maung"). Label seragam dari `GET /api/launcher` → `home.backLabel` bersifat opsional (belum dikerjakan).
- **Keputusan pemilik — Garage bersama (SETELAH CRM go-live)**: stack tersendiri `maung-garage`, jaringan eksternal `maung_storage` (bukan `maung_edge`), satu bucket + satu kunci per aplikasi, port S3 tidak dibuka ke host, adopsi volume `maung-crm_garage_meta/data` sebagai volume eksternal (kunci `crm-key` dan bucket `crm-photos` ikut). **Sisi CRM SUDAH dikerjakan di repo (belum dijalankan di server)**: service `garage` dan volume `garage_*` keluar dari compose CRM, `crm-api` di `maung_storage`, `S3_ENDPOINT=http://maung-garage:3900`, `update.sh` menolak bila Garage bersama belum siap atau compose masih memuat `garage`. Urutan cutover: `docs/DEPLOY.md` bagian E0.
