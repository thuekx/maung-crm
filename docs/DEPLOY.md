# Deploy maung-crm — jalur `/crm` pada domain Maung WO

Satu domain (`https://maung.liv.net.id`), satu login (Maung WO), CRM di `/crm`. Caddy milik WO; CRM **tidak** membuka port host dan tidak menjalankan proxy. `crm-web` (3000) dan `crm-api` (4000) bergabung ke jaringan eksternal `maung_edge`; PostgreSQL/PostGIS hanya di jaringan privat CRM. **Foto disimpan di Garage BERSAMA** (stack `maung-garage`, repo WO) yang dijangkau `crm-api` lewat jaringan eksternal `maung_storage` (`http://maung-garage:3900`); CRM tidak lagi menjalankan Garage. Rencana dan keputusan: `docs/RENCANA-INTEGRASI-WO.md`; kontrak sisi WO: `docs/maung-crm/INTEGRASI-WO.md` (repo Maung-Wo-Inv).

Semua perintah server = skrip di repo + satu perintah salin-tempel, berfase, dengan blok RESULT dan log di `~/maung-crm-logs/`. Guard: host `maung-apps`, **bukan root, tanpa sudo**, jaringan `maung_edge` ada. **Tidak pernah membuat/menimpa/mengubah `.env` WO** (diverifikasi checksum). Sekali: image bertag **SHA commit** (`IMAGE_TAG` wajib; `latest` tidak dipakai).

## A. Sekali (peralihan dari CRM uji lama + pemasangan deploy key)
1. **Bootstrap token** — satu-satunya langkah yang butuh token GitHub (classic; scope `repo` + `read:packages`), karena repo private dan skrip baru belum ada di server. Tempel blok `bash <<'BOOT' … BOOT` berisi `scripts/bootstrap-token.sh` (token hanya di memori; `docker login ghcr.io` tersimpan untuk tarik image). Skrip lanjut ke `setup-deploy-key.sh` dan berhenti `WAITING_KEY` sambil mencetak **kunci publik**.
2. **Browser (GitHub):** `thuekx/maung-crm` → Settings → Deploy keys → Add deploy key → Title `maung-apps`, tempel kunci publik, **JANGAN centang "Allow write access"**.
3. `cd ~/maung-crm && bash scripts/setup-deploy-key.sh </dev/null` — verifikasi `git ls-remote`, uji kunci read-only, remote `origin` beralih ke SSH.

## B. Update (setiap kali; tanpa token)
```
cd ~/maung-crm && git pull --ff-only origin main && bash scripts/update.sh </dev/null
```
Fase: guard → snapshot WO baca-saja → `.env` CRM (backup dulu) → backup (`pg_dump`; Garage dicadangkan skrip WO) → tarik image → jalankan `crm-api`/`crm-web` (`--remove-orphans`) → penyimpanan objek (Garage bersama) → **bukti terhadap sistem asli** → finalisasi. **Rollback otomatis** bila gagal (tag sebelumnya; pada migrasi pertama container CRM uji lama tidak pernah dihentikan sampai bukti lolos). Data (volume Postgres/Garage) tidak pernah dibuang.

Bukti di RESULT (tanpa token): (a) dari container `crm-api`: `GET {WO_URL}/api/auth/me` tanpa token = 401; (b) via Caddy: `/crm/api/health` dan `/crm/` (status **PENDING** selama `deploy/crm.caddy` belum dipasang di WO — bukan kegagalan); (c) `/login` dan `/api/branding` WO tetap 200 serta `.env`/container WO tidak berubah; (d) `crm-web`/`crm-api` ada di `maung_edge` dan terjangkau dari jaringan itu, tidak ada port CRM di host.

## C. Urutan go-live (disepakati dengan sesi WO)
1. Daftarkan CRM di Admin WO → Pengaturan → Aplikasi (ID `crm`, jalur `/crm`; **"Tampil di beranda" MATI**).
2. Admin WO → Hak Akses → "Aplikasi: CRM": beri divisi/sub-role yang boleh.
3. Jalankan update (bagian B). Lalu pasang jalur dengan skrip WO (validasi aturan + `caddy validate`, backup, reload, rollback otomatis): `cd ~/Maung-Wo-Inv && bash scripts/app-route.sh add crm </dev/null` (sumber bawaan `~/maung-crm/deploy/crm.caddy`; `status` untuk melihat jalur terpasang). Jalankan `update.sh` lagi: bukti (b) harus `PASS`. Prasyarat: Maung WO sudah diperbarui/dideploy ke versi dengan beranda `/apps`, Admin → Aplikasi, dan `scripts/app-route.sh` (perintah update WO diberikan sesi WO).
4. Penerimaan manual pemilik: login WO → `/apps` → ikon CRM → CRM terbuka tanpa login ulang; 35 menit aktif tidak keluar sesi; kamera/GPS bekerja (HTTPS).
5. Baru nyalakan "Tampil di beranda".

## C2. `/crm` masih 404? (diagnosa baca-saja)
404 itu wajar sampai jalur dipasang di Caddy WO: yang menjawab adalah aplikasi WO, bukan CRM. Satu perintah menunjukkan Anda di tahap mana (tidak mengubah apa pun di CRM maupun WO):
```
cd ~/maung-crm && git pull --ff-only origin main && bash scripts/check-route.sh </dev/null
```
Diagnosa yang mungkin: container CRM tidak sehat → `update.sh`; `proxy/apps/crm.caddy` belum ada → `cd ~/Maung-Wo-Inv && bash scripts/app-route.sh add crm </dev/null`; berkas ada tetapi belum dimuat Caddy → ulangi `app-route.sh add crm`; Caddyfile aktif WO belum memuat `import /etc/caddy/apps/*.caddy` → WO perlu diperbarui/dideploy oleh sesi WO. Yang tidak bisa diperiksa dari server: pendaftaran aplikasi dan Hak Akses di Admin WO (lakukan di browser).

## D. Rollback manual, backup, log
- Otomatis saat gagal; manual: set `IMAGE_TAG` ke SHA terakhir-baik (`~/maung-crm-logs/state/last_ok_tag`) lalu `docker compose up -d crm-api crm-web` di `~/maung-crm`.
- Backup: `~/maung-crm-logs/backup/` (7 `pg_dump` terakhir dan `.env` CRM). Garage (foto) dicadangkan skrip WO: `cd ~/Maung-Wo-Inv && bash scripts/garage-backup.sh` (satu node tanpa replika — jadwalkan dan salin keluar VM).
- Bila `docker pull` ditolak: token GHCR di `~/.docker` kedaluwarsa → ulangi bagian A.1.

## E0. Cutover Garage bersama (pemisahan Garage dari CRM) — urutan, dijalankan pemilik
Kontrak (sisi WO: `platform/garage/README.md`, `scripts/garage-platform.sh`, `garage-app.sh`, `garage-backup.sh`): project `maung-garage`, container & alias `maung-garage`, jaringan eksternal `maung_storage` (bukan `maung_edge`), tanpa port host, endpoint `http://maung-garage:3900` (region `garage`, path-style), bucket `crm-photos` dan kunci `crm-key` TETAP (volume Garage CRM diadopsi tanpa menyalin data).
1. (CRM, repo) perubahan compose/skrip ini di-push — **belum dijalankan di server**.
2. WO: `cd ~/Maung-Wo-Inv && bash scripts/garage-platform.sh adopt-crm </dev/null` (CRM tetap berjalan lewat alias sementara `garage`).
3. CRM: `cd ~/maung-crm && git pull --ff-only origin main && bash scripts/update.sh </dev/null` — guard: `maung-garage` harus running & healthy, jaringan `maung_storage` ada, compose tanpa service `garage`, tidak ada Garage CRM lama yang berjalan. `up --remove-orphans` membersihkan container garage lama (volume tidak terhapus).
4. WO: `bash scripts/garage-platform.sh finalize </dev/null` (lepas alias sementara).
**Jangan** menjalankan `update.sh` CRM versi lama setelah langkah 2 (menyalakan Garage kedua pada volume yang sama), dan jangan pernah `docker compose down -v` di CRM selama volume Garage lama belum difinalisasi. Selama langkah 2–3 jangan memicu pembaruan CRM lain; `GARAGE_RPC_SECRET` lama di `.env` CRM dibiarkan (aman dihapus setelah `finalize`).

## E1. Cermin pelanggan WO (Export API, baca-saja) — pasang kunci
Prasyarat: `update.sh` versi ini sudah dijalankan (compose meneruskan `WO_EXPORT_API_KEY`), dan di WO `EXPORT_API_KEY` sudah terisi (Admin WO → API Sistem).
1. Di SSH `maung-apps` (user biasa, **bukan** root), satu perintah:
```
cd ~/maung-crm && git pull --ff-only origin main && bash scripts/set-export-key.sh
```
2. Saat diminta, **ketik/tempel kunci Export WO** lalu Enter — layar tidak menampilkannya (tidak masuk riwayat shell, chat, atau log). Skrip menguji kunci ke WO (baca-saja), membackup `.env`, menyimpan kunci (mode 600), membuat ulang `crm-api`, menunggu sinkron pertama, dan **rollback otomatis** bila gagal.
3. RESULT: `cermin=customers=… subscriptions=… packages=… areas=…`. `packages/areas` bermode `derived` sampai WO menambah resource `packages`/`areas` (lihat `docs/PERMINTAAN-PERUBAHAN-WO.md`).
Sinkron berjalan tiap `SYNC_INTERVAL_MIN` (30) menit, tarik penuh; data jaringan (ODP/port/VLAN/IP) dan biaya tidak disalin. Nomor telepon dinormalkan ke E.164 (`PHONE_DEFAULT_REGION=ID`).

## E. Yang sudah dan belum teruji
- Teruji otomatis (CI): tes API, tes web (termasuk larangan HTML mentah), tes aturan compose, validasi compose, **alur `update.sh` dan `setup-deploy-key.sh` dengan docker/curl/ssh/git tiruan** (`tests/server-scripts/`: migrasi sukses, tiap jenis kegagalan + rollback, update kedua, host salah, root, `.env`/container WO berubah, secret tidak tercetak).
- **Belum pernah dijalankan di server asli**: container sungguhan, Garage asli, Caddy `crm.caddy`, `/api/auth/me` WO asli (E2E memakai mock). Risiko ini dicatat; RESULT `update.sh` adalah buktinya.
