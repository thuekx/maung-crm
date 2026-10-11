> ⚠️ **SEDANG DIROMBAK — integrasi jalur satu domain `/crm` (lihat `docs/RENCANA-INTEGRASI-WO.md`).** Tahap 1 (kode) dan Tahap 2 (compose + CI) selesai **di repo saja**. Compose baru: `crm-web`/`crm-api` di jaringan eksternal `maung_edge`, tanpa port host, `IMAGE_TAG` wajib (SHA commit). **Skrip server baru (`scripts/update.sh`, deploy key) baru ada di Tahap 3.** Sampai itu selesai:
> - **jangan `git pull` / jalankan bootstrap di `~/maung-crm` di server** dan jangan menjalankan `docker compose` di sana (compose baru mewajibkan `IMAGE_TAG` dan jaringan `maung_edge`; CRM uji di port 3100 tetap berjalan dengan container lamanya dan tidak disentuh);
> - `install.sh`/`bootstrap.sh` lama sengaja diblokir (`CRM_ALLOW_LEGACY=1` untuk membuka; tidak disarankan).
> Isi di bawah adalah panduan LAMA dan akan ditulis ulang di Tahap 3.

# Deploy maung-crm (image siap tarik)

Image dibangun otomatis oleh GitHub Actions (`.github/workflows/ci.yml`) setiap push ke `main` yang lulus tes, lalu di-push ke GHCR:
`ghcr.io/thuekx/maung-crm-api` dan `ghcr.io/thuekx/maung-crm-web` (tag `latest` dan SHA commit).

> Status verifikasi: Dockerfile & compose divalidasi sintaks (`docker compose config`) dan langkah-langkahnya disimulasikan manual (build API, `npm ci --omit=dev`, start + migrasi; build Next standalone + start). **Belum pernah dijalankan sebagai image/container, belum diuji dengan Garage asli, dan workflow CI belum pernah berjalan.** Uji pertama di staging.

## Cara cepat (disarankan)
Blok bootstrap kanonik ada di `deploy/bootstrap.sh` (dibungkus `bash <<'BOOT' … BOOT` saat ditempel di server WO). Guard host/WO/direktori jalan sebelum token diminta.

```
git clone https://github.com/thuekx/maung-crm.git && cd maung-crm
bash deploy/install.sh --wo-url https://wo.perusahaan.co.id     # tambahkan --wo-vm bila satu VM dengan WO
```
Skrip membuat `.env` (secret acak, tidak menimpa yang ada), mendeteksi/memeriksa `WO_URL`, menarik image, menjalankan stack, menginisialisasi Garage, dan mengecek kesehatan. Bila package GHCR private: awali dengan `GHCR_TOKEN=<token read:packages>`. Bagian di bawah adalah langkah manualnya.

## A. Sekali: jadikan image bisa ditarik
1. Setelah workflow pertama sukses, buka GitHub → Packages → `maung-crm-api` dan `maung-crm-web` → *Package settings*: set visibilitas (private → server perlu login) atau public.
2. Server private: `echo <PAT read:packages> | docker login ghcr.io -u thuekx --password-stdin` (jangan tempel token di chat).

## B. Persiapan server
1. DNS A record `CRM_DOMAIN` → IP server (HTTPS wajib: kamera & GPS HP tidak jalan tanpa HTTPS).
2. `git clone https://github.com/thuekx/maung-crm && cd maung-crm && cp .env.example .env`, isi `POSTGRES_PASSWORD`, `WO_URL`, `FILE_SIGN_SECRET`, `GARAGE_RPC_SECRET` (`openssl rand -hex 32`).

## C. Jalankan
Pilih satu mode:

**C1. VM terpisah dari WO (Caddy sendiri):**
`docker compose -f docker-compose.yml -f docker-compose.caddy.yml pull && docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d`

**C2. VM SAMA dengan Maung WO** (80/443 sudah dipakai Caddy WO): web CRM bergabung ke jaringan WO dengan alias `crm-web`.
`docker compose -f docker-compose.yml -f docker-compose.wo-vm.yml up -d` (cek nama jaringan: `docker network ls | grep maung-wo-inv`, isi `WO_NETWORK` bila beda).
Lalu Caddy WO harus meneruskan `CRM_DOMAIN` ke `crm-web:3000` — butuh perubahan kecil di WO (Caddyfile yang dikelola otomatis oleh API WO akan menimpa edit manual). Lihat `deploy/crm.caddy` dan permintaan ke repo WO di bawah.

## D. Inisialisasi Garage (sekali)
`bash deploy/garage-init.sh` → salin `Key ID` dan `Secret key` ke `.env` (`S3_ACCESS_KEY`, `S3_SECRET_KEY`) → `docker compose up -d api`.

## E. Cek
`curl https://CRM_DOMAIN/api/health` → `{"ok":true}`; login dengan akun Maung WO (divisi MKT/ADMIN); buat report, ambil foto → foto tampil (tersimpan di Garage).

## F. Update & rollback
- Update: `docker compose pull && docker compose up -d` (migrasi DB berjalan otomatis saat api start).
- Rollback: `IMAGE_TAG=<sha-sebelumnya> docker compose up -d` (migrasi bersifat maju-saja; backup DB dulu bila skema berubah).
- Backup: `docker compose exec postgres pg_dump -U crm maung_crm | gzip > crm-$(date +%F).sql.gz` dan snapshot volume `garage_data`/`garage_meta`.

## Build image manual (tanpa CI)
```
docker build -f apps/api/Dockerfile -t ghcr.io/thuekx/maung-crm-api:dev .
docker build -f apps/web/Dockerfile -t ghcr.io/thuekx/maung-crm-web:dev .
```
