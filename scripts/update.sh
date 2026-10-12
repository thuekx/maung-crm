#!/usr/bin/env bash
# MAUNG CRM — update aman (berfase): guard → snapshot WO (baca-saja) → .env → backup DB → tarik image → up → penyimpanan objek → bukti → finalisasi.
# Garage = stack BERSAMA `maung-garage` (repo WO; scripts/garage-platform.sh) — CRM tidak lagi menjalankan/mencadangkan Garage sendiri.
# Rollback otomatis bila gagal. Tidak menyentuh Maung WO (tidak membuat/menimpa/mengubah .env WO; diverifikasi dengan checksum).
# Jalankan:  cd ~/maung-crm && git pull --ff-only origin main && bash scripts/update.sh </dev/null
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
. "$HERE/scripts/lib.sh"
N=9; P=0; CUR=""; WARNS=()
EXPECT_HOST="${EXPECT_HOST:-maung-apps}"
APP_DIR="${APP_DIR:-$HOME/maung-crm}"
WO_DIR="${WO_DIR:-$HOME/Maung-Wo-Inv}"
# Batas tunggu (detik) — bawaan produksi; hanya tes yang memperpendek lewat env.
WAIT_API="${WAIT_API:-150}"; WAIT_WEB="${WAIT_WEB:-90}"; WAIT_BACK="${WAIT_BACK:-90}"; POLL="${POLL_INTERVAL:-3}"
LOG_DIR="$HOME/maung-crm-logs"; BK_DIR="$LOG_DIR/backup"; STATE_DIR="$LOG_DIR/state"
mkdir -p "$BK_DIR" "$STATE_DIR"; chmod 700 "$LOG_DIR"
TS=$(date +%Y%m%d-%H%M%S); LOG="$LOG_DIR/update-$TS.log"
exec > >(tee -a "$LOG") 2>&1
cd "$HERE" || exit 1
ENVF="$HERE/.env"; ENV_BAK="$BK_DIR/crm-env-$TS.bak"
STATUS=FAIL; REASON=""; ROLL_ARMED=0; ROLLED=no; FIRST_RUN=no
COMMIT=""; TAG=""; PREV_TAG=""; WO_URL=""; LEGACY_IDS=""; PREV_MODE=no
V_HOST=n/a; V_WOENV=n/a; V_WOCT=n/a; V_LOGIN_B=n/a; V_BRAND_B=n/a; V_LOGIN_A=n/a; V_BRAND_A=n/a
V_PGDUMP=n/a; V_GARAGEBK=n/a; V_PULL=n/a; V_UP=n/a; V_GARAGE=n/a
E_ME=n/a; E_INT=n/a; E_ME_NOTOKEN=n/a; E_PROBE_API=n/a; E_PROBE_WEB=n/a; E_NET=n/a; E_PORTS=n/a
C_HEALTH=n/a; C_CRM=n/a; E_KEYENV=n/a; E_KEYAPI=n/a; E_PROBE_INT=n/a; E_OUTBOX=n/a; LEGACY_REMOVED=n/a; PORT3100=n/a; E_S3=n/a; G_EDGE=n/a

dc() { docker compose "$@"; }
getenv() { grep -m1 "^$1=" "$ENVF" 2>/dev/null | cut -d= -f2- | tr -d "'\"" || true; }
setenv() { if grep -q "^$1=" "$ENVF"; then sed -i "s|^$1=.*|$1=$2|" "$ENVF"; else echo "$1=$2" >> "$ENVF"; fi; }
delenv() { sed -i "/^$1=/d" "$ENVF"; }
cid() { dc ps -aq "$1" 2>/dev/null | head -1; }
hstat() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || echo none; }
http() { curl -s -o /dev/null -m 15 -w '%{http_code}' "$1" 2>/dev/null || echo 000; }
sha() { sha256sum "$1" 2>/dev/null | cut -d' ' -f1; }
wo_ids() { docker ps -a --filter "label=com.docker.compose.project=maung-wo-inv" --format '{{.Names}} {{.ID}} {{.State}}' 2>/dev/null | sort; }
wait_healthy() { # wait_healthy <service> <detik>
  local c i n=$(( $2 / POLL )); [ "$n" -ge 1 ] || n=1
  for i in $(seq 1 "$n"); do c=$(cid "$1"); [ -n "$c" ] && [ "$(hstat "$c")" = healthy ] && return 0; sleep "$POLL"; done; return 1; }
mask() { sed -E 's#(://[^:/@ ]+:)[^@ ]+@#\1***@#g; s/((secret|password|token|passwd|key)[A-Za-z_]*[=:] *)[^ ,"]+/\1***/Ig'; }

diag() {
  echo; echo "── DIAGNOSIS (baca-saja, secret disamarkan) ──"
  dc ps -a --format 'table {{.Service}}\t{{.Status}}' 2>&1 | head -12
  for s in crm-api crm-web postgres; do echo "log_$s (25 baris):"; dc logs --no-color --tail 25 "$s" 2>&1 | mask | sed 's/^/  /'; done
  echo "── akhir diagnosis ──"
}

restore_env() { [ -f "$ENV_BAK" ] && cp -p "$ENV_BAK" "$ENVF" && ok ".env CRM dikembalikan dari backup"; }
rollback() {
  [ "$ROLL_ARMED" = 1 ] || return 0
  warn "ROLLBACK: mengembalikan keadaan sebelum update (data/volume tidak disentuh)"
  dc rm -sf crm-web crm-api >/dev/null 2>&1 && ok "container CRM baru dihentikan & dihapus"   # (.env masih memuat IMAGE_TAG baru → compose valid)
  restore_env
  if [ "$PREV_MODE" = yes ]; then
    setenv IMAGE_TAG "$PREV_TAG"
    dc up -d crm-api crm-web >/dev/null 2>&1
    wait_healthy crm-api "$WAIT_BACK" && ok "versi sebelumnya (${PREV_TAG:0:12}…) berjalan kembali" || warn "versi sebelumnya belum sehat — periksa manual"
    ROLLED="ya (kembali ke tag ${PREV_TAG:0:12})"
  else
    for c in $LEGACY_IDS; do docker start "$c" >/dev/null 2>&1; done
    ROLLED="ya (CRM uji lama tidak pernah dihentikan; masih berjalan)"
    [ -n "$LEGACY_IDS" ] && ok "CRM uji lama tidak tersentuh" || ok "tidak ada versi lama; stack baru dibersihkan"
  fi
}

result() {
  banner "RESULT"
  kv status "$STATUS"; kv reason "$REASON"; kv host "$(hostname)"; kv dir "$HERE"
  kv commit "${COMMIT:0:12}"; kv image_tag "${TAG:0:12}"; kv tag_sebelumnya "${PREV_TAG:0:12}"; kv instalasi_pertama "$FIRST_RUN"
  echo "# bukti (a) container crm-api -> WO"
  kv a_api_ke_wo_auth_me_tanpa_token "$E_ME"; kv a_api_health_internal "$E_INT"; kv a_api_me_tanpa_token "$E_ME_NOTOKEN"
  echo "# bukti (d) jaringan & port"
  kv d_probe_maung_edge_crm_api "$E_PROBE_API"; kv d_probe_maung_edge_crm_web "$E_PROBE_WEB"; kv d_jaringan "$E_NET"; kv d_port_host_crm "$E_PORTS"
  echo "# bukti (b) via Caddy WO (PENDING = crm.caddy belum dipasang di WO)"
  kv b_https_crm_api_health "$C_HEALTH"; kv b_https_crm "$C_CRM"
  echo "# bukti (c) WO tidak terganggu"
  kv c_wo_login_sebelum "$V_LOGIN_B"; kv c_wo_login_sesudah "$V_LOGIN_A"; kv c_wo_api_branding_sebelum "$V_BRAND_B"; kv c_wo_api_branding_sesudah "$V_BRAND_A"
  kv wo_env_tidak_berubah "$V_WOENV"; kv wo_container_tidak_berubah "$V_WOCT"
  echo "# bukti (e) integrasi CRM -> WO (nilai kunci TIDAK pernah dicetak)"
  kv e_crm_integration_key_di_env "$E_KEYENV"; kv e_kunci_terbaca_crm_api "$E_KEYAPI"; kv e_wo_integrasi_probe "$E_PROBE_INT"; kv e_antrean_kirim_ke_wo "$E_OUTBOX"
  echo "# lain-lain"
  kv backup_pg_dump "$V_PGDUMP"; kv backup_garage "$V_GARAGEBK"; kv pull_image "$V_PULL"; kv garage_bersama "$V_GARAGE"; kv crm_api_ke_maung_garage_s3 "$E_S3"; kv d_maung_garage_di_maung_edge "${G_EDGE:-n/a}"
  kv container_lama_dihapus "$LEGACY_REMOVED"; kv port_3100_lama "$PORT3100"; kv rollback "$ROLLED"; kv log "$LOG"
  for w in "${WARNS[@]:-}"; do [ -n "$w" ] && printf '  - %s\n' "$w"; done
  case "$STATUS" in
    PASS) if [ "$C_HEALTH" = PASS ]; then echo "RESULT : UPDATE CRM PASS / NEXT=UJI_MANUAL_PEMILIK (login WO → /apps → ikon CRM)"; else echo "RESULT : UPDATE CRM PASS / NEXT=PASANG_JALUR_CRM_DI_WO (b masih PENDING): cd ~/Maung-Wo-Inv && bash scripts/app-route.sh add crm </dev/null"; fi ;;
    *) echo "RESULT : GAGAL — $REASON (rollback: $ROLLED)" ;;
  esac
}
fail() { bad "$*"; REASON="$*"; STATUS=FAIL; if [ "$ROLL_ARMED" = 1 ]; then rollback; elif [ "$P" -ge 3 ]; then restore_env; fi; result; exit 1; }

banner "MAUNG CRM — UPDATE AMAN  ($TS)"

# ───────────────────────── 1. Guard ─────────────────────────
phase "Guard host, direktori, docker, jaringan"
echo "  host=$(hostname)  user=$(id -un)  pwd=$PWD"
[ "$(hostname)" = "$EXPECT_HOST" ] || fail "HOST SALAH: ini '$(hostname)', seharusnya '$EXPECT_HOST' (tidak ada yang diubah)"
ok "nama host sesuai"
[ "$(id -u)" != 0 ] || fail "jangan dijalankan sebagai root (dan tanpa sudo untuk docker)"
ok "bukan root"
[ "$HERE" = "$(cd "$APP_DIR" 2>/dev/null && pwd)" ] || fail "skrip ini bukan di $APP_DIR (di $HERE)"
git remote get-url origin 2>/dev/null | grep -qi 'maung-crm' || fail "remote origin bukan maung-crm"
grep -q '^name: maung-crm' docker-compose.yml || fail "docker-compose.yml bukan milik maung-crm"
ok "direktori = repo maung-crm di $APP_DIR"
COMMIT=$(git rev-parse HEAD); echo "  commit=$COMMIT"
git remote get-url origin | grep -q '^git@' && ok "remote origin lewat SSH (deploy key)" || warn "remote origin masih HTTPS — jalankan scripts/setup-deploy-key.sh agar git pull tanpa token"
docker info >/dev/null 2>&1 || fail "docker tidak dapat diakses user '$(id -un)' (butuh grup docker; jangan pakai sudo)"
cv=$(docker compose version --short 2>/dev/null | tr -d v); [ "$(printf '%s\n2.24\n' "${cv:-0}" | sort -V | head -1)" = "2.24" ] || fail "docker compose '$cv' terlalu lama (butuh >= 2.24)"
ok "docker dapat diakses tanpa sudo (compose $cv)"
docker network inspect maung_edge >/dev/null 2>&1 || fail "jaringan maung_edge TIDAK ada — dibuat oleh deploy WO; CRM tidak membuatnya (jalankan deploy WO dulu)"
ok "jaringan maung_edge ada"
[ -f "$WO_DIR/.env" ] || fail "folder Maung WO ($WO_DIR) tidak ada — bukan server WO?"
ok "Maung WO ada di host ini"
git diff --quiet HEAD -- 2>/dev/null || warn "ada perubahan lokal pada berkas terlacak di repo CRM"
# --- Garage bersama (stack maung-garage, dikelola repo WO). Semua guard di sini terjadi SEBELUM ada yang diubah.
# BAHAYA: compose lama (dengan service `garage`) setelah adopsi akan menyalakan Garage kedua pada volume yang sama.
if grep -qE '^  garage:' docker-compose.yml; then fail "docker-compose.yml masih memuat service 'garage' — DITOLAK (dua Garage pada volume yang sama berbahaya). Gunakan versi repo yang menghapusnya (git pull) — tidak ada yang diubah"; fi
ok "compose tidak memuat service garage lokal"
OLDG=$(docker ps --filter "label=com.docker.compose.project=maung-crm" --filter "label=com.docker.compose.service=garage" --format '{{.Names}}' 2>/dev/null | head -1)
[ -z "$OLDG" ] || fail "container Garage CRM lama ($OLDG) MASIH berjalan — jangan jalankan dua Garage pada volume yang sama. Jalankan dulu: cd ~/Maung-Wo-Inv && bash scripts/garage-platform.sh adopt-crm </dev/null"
docker network inspect maung_storage >/dev/null 2>&1 || fail "jaringan maung_storage TIDAK ada — jalankan dulu: cd ~/Maung-Wo-Inv && bash scripts/garage-platform.sh adopt-crm </dev/null"
G_STATE=$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' maung-garage 2>/dev/null || echo ada-tidak)
[ "$G_STATE" = "running/healthy" ] || fail "Garage bersama 'maung-garage' tidak berjalan & healthy (keadaan: $G_STATE) — jalankan dulu: cd ~/Maung-Wo-Inv && bash scripts/garage-platform.sh adopt-crm </dev/null"
V_GARAGE="maung-garage $G_STATE"; ok "Garage bersama: maung-garage running/healthy; jaringan maung_storage ada"

# ───────────────────────── 2. Snapshot WO (baca-saja) ─────────────────────────
phase "Snapshot Maung WO (baca-saja)"
WO_ENV_SHA=$(sha "$WO_DIR/.env"); WO_IDS_BEFORE=$(wo_ids)
echo "  wo_env_sha256=${WO_ENV_SHA:0:12}…  (hanya dibaca; dibandingkan lagi di akhir)"
echo "$WO_IDS_BEFORE" | awk '{print "  WO " $1 ": " $3}'
if [ -f "$ENVF" ]; then WO_URL=$(getenv WO_URL); fi
if [ -z "$WO_URL" ]; then dom=$(grep -m1 '^WEB_DOMAIN=' "$WO_DIR/.env" | cut -d= -f2- | tr -d "'\""); [ -n "$dom" ] && WO_URL="https://$dom"; fi
[ -n "$WO_URL" ] || fail "WO_URL tidak dapat ditentukan (WEB_DOMAIN kosong di WO dan .env CRM belum ada)"
echo "  WO_URL=$WO_URL"
V_LOGIN_B=$(http "$WO_URL/login"); V_BRAND_B=$(http "$WO_URL/api/branding")
echo "  sebelum: /login=$V_LOGIN_B  /api/branding=$V_BRAND_B"
[ "$V_LOGIN_B" = 200 ] && [ "$V_BRAND_B" = 200 ] && ok "WO sehat sebelum update" || warn "WO tidak 200 sebelum update (login=$V_LOGIN_B branding=$V_BRAND_B) — bukan akibat skrip ini"

# ───────────────────────── 3. .env CRM ─────────────────────────
phase "Konfigurasi .env CRM (backup dulu; hanya menambah/mengganti kunci tertentu)"
if [ ! -f "$ENVF" ]; then
  FIRST_RUN=ya-env-baru; cp .env.example "$ENVF"; chmod 600 "$ENVF"
  for k in POSTGRES_PASSWORD FILE_SIGN_SECRET; do setenv "$k" "$(openssl rand -hex 32)"; done
  ok ".env dibuat dengan secret acak (2)"
fi
chmod 600 "$ENVF"; cp -p "$ENVF" "$ENV_BAK"; ok "backup .env → $ENV_BAK"
PREV_TAG=$(cat "$STATE_DIR/last_ok_tag" 2>/dev/null || true)
[ -n "$PREV_TAG" ] && [ -n "$(cid crm-api)" ] && PREV_MODE=yes
setenv WO_URL "$WO_URL"
for k in WEB_PORT CRM_DOMAIN WO_NETWORK; do grep -q "^$k=" "$ENVF" && { delenv "$k"; echo "  (kunci usang $k dihapus dari .env CRM)"; }; done
getenv COMPOSE_FILE | grep -q 'wo-vm\|caddy' && { delenv COMPOSE_FILE; echo "  (COMPOSE_FILE usang dihapus)"; }
TAG="$COMMIT"; setenv IMAGE_TAG "$TAG"
echo "  image_tag=${TAG:0:12}…  tag_sebelumnya=${PREV_TAG:+${PREV_TAG:0:12}…}${PREV_TAG:-(tidak ada)}"
for k in POSTGRES_PASSWORD FILE_SIGN_SECRET WO_URL IMAGE_TAG; do [ -n "$(getenv "$k")" ] || fail ".env: $k kosong"; done
{ [ -n "$(getenv S3_ACCESS_KEY)" ] && [ -n "$(getenv S3_SECRET_KEY)" ]; } || fail ".env: S3_ACCESS_KEY/S3_SECRET_KEY kosong — buat kunci di Garage bersama: cd ~/Maung-Wo-Inv && bash scripts/garage-app.sh crm --env-file ~/maung-crm/.env </dev/null (rahasia tidak dicetak)"
[ -z "$(getenv GARAGE_RPC_SECRET)" ] || echo "  (GARAGE_RPC_SECRET lama di .env tidak dipakai lagi; dibiarkan agar rollback cutover tetap mungkin — aman dihapus setelah garage-platform.sh finalize)"
ok "variabel wajib terisi (nilai secret tidak ditampilkan)"
dc config -q 2>/tmp/crm-cfg.err || { sed 's/^/  /' /tmp/crm-cfg.err; fail "docker compose config tidak valid"; }
dc config --services 2>/dev/null | grep -qx garage && fail "compose (terinterpolasi) memuat service garage — ditolak"
ok "docker compose config valid (services: $(dc config --services | tr '\n' ' '))"
# container lama (compose lama): service api/web — dipertahankan sampai bukti lolos
LEGACY_IDS=$(docker ps -a --filter "label=com.docker.compose.project=maung-crm" --format '{{.ID}} {{.Label "com.docker.compose.service"}}' | awk '$2=="api"||$2=="web"{print $1}' | tr '\n' ' ')
[ -n "$LEGACY_IDS" ] && { FIRST_RUN="ya-migrasi-dari-CRM-uji"; echo "  container CRM uji lama ditemukan (api/web) — tidak disentuh sampai bukti lolos"; }
ROLL_ARMED=1

# ───────────────────────── 4. Backup ─────────────────────────
phase "Backup (DB CRM; Garage dicadangkan skrip WO: garage-backup.sh)"
if [ -n "$(cid postgres)" ] && [ "$(docker inspect -f '{{.State.Status}}' "$(cid postgres)" 2>/dev/null)" = running ]; then
  F="$BK_DIR/crm-db-$TS.sql.gz"
  if dc exec -T postgres pg_dump -U crm maung_crm 2>/dev/null | gzip > "$F" && gzip -t "$F" 2>/dev/null && [ "$(stat -c%s "$F")" -gt 200 ]; then V_PGDUMP="OK ($(stat -c%s "$F") byte) $F"; ok "pg_dump → $F"; chmod 600 "$F"
  else V_PGDUMP=GAGAL; rm -f "$F"; fail "pg_dump gagal / kosong — update dibatalkan agar data aman"; fi
else V_PGDUMP="dilewati (postgres belum berjalan: instalasi baru)"; ok "$V_PGDUMP"; fi
V_GARAGEBK="dikelola skrip WO (cd ~/Maung-Wo-Inv && bash scripts/garage-backup.sh)"; ok "foto: cadangan Garage = $V_GARAGEBK"
ls -1t "$BK_DIR"/crm-db-*.sql.gz 2>/dev/null | tail -n +8 | xargs -r rm -f; ls -1t "$BK_DIR"/crm-env-*.bak 2>/dev/null | tail -n +8 | xargs -r rm -f

# ───────────────────────── 5. Tarik image ─────────────────────────
phase "Tarik image CRM (tag = SHA commit)"
if dc pull crm-api crm-web >/tmp/crm-pull.out 2>&1; then
  V_PULL=OK
  for s in crm-api crm-web; do im=$(dc config --images | grep "maung-crm-${s#crm-}:"); echo "  $s: $im  digest=$(docker image inspect -f '{{index .RepoDigests 0}}' "$im" 2>/dev/null | cut -d@ -f2 | cut -c1-19)"; done
  ok "image api & web siap"
else
  V_PULL=GAGAL; sed 's/^/  /' /tmp/crm-pull.out | mask | tail -6
  if grep -qiE "not found|manifest unknown" /tmp/crm-pull.out; then fail "image untuk commit ${COMMIT:0:12} belum ada di GHCR — tunggu CI hijau lalu ulangi"
  else fail "pull ditolak/gagal — kredensial GHCR di ~/.docker mungkin kedaluwarsa (docker login ghcr.io dengan token read:packages) atau jaringan"; fi
fi

# ───────────────────────── 6. Jalankan ─────────────────────────
phase "Jalankan stack baru (crm-api, crm-web; --remove-orphans membersihkan container garage CRM lama yang sudah berhenti)"
dc up -d --remove-orphans crm-api crm-web >/tmp/crm-up.out 2>&1; URC=$?
sed 's/^/  /' /tmp/crm-up.out | tail -12
[ "$URC" = 0 ] || { diag; fail "docker compose up gagal"; }
wait_healthy crm-api "$WAIT_API" && ok "crm-api healthy" || { diag; fail "crm-api tidak healthy dalam ${WAIT_API} detik"; }
wait_healthy crm-web "$WAIT_WEB" && ok "crm-web healthy" || { diag; fail "crm-web tidak healthy dalam ${WAIT_WEB} detik"; }
V_UP=OK

# ───────────────────────── 7. Garage ─────────────────────────
phase "Penyimpanan objek (Garage bersama)"
[ "$(docker inspect -f '{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}-{{end}}' maung-garage 2>/dev/null)" = "running/healthy" ] && ok "maung-garage masih running/healthy" || fail "maung-garage tidak sehat selama update — jalankan: cd ~/Maung-Wo-Inv && bash scripts/garage-platform.sh status </dev/null"
r=$(dc exec -T crm-api node -e "fetch('http://maung-garage:3900/').then(r=>{console.log('HTTP '+r.status);process.exit(0)}).catch(e=>{console.log('ERR');process.exit(1)})" 2>/dev/null | tr -d '\r\n'); E_S3="${r:-ERR}"
case "$E_S3" in HTTP*) ok "crm-api → http://maung-garage:3900 menjawab ($E_S3)" ;; *) fail "crm-api tidak menjangkau http://maung-garage:3900 ($E_S3) — crm-api harus di jaringan maung_storage" ;; esac
dc exec -T crm-api node -e "import('./dist/storage.js').then(async m=>{const s=m.storage();await s.put('_selftest/x.txt',Buffer.from('ok'),'text/plain');process.exit((await s.get('_selftest/x.txt')).toString()==='ok'?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})" >/dev/null 2>&1 \
  && ok "uji tulis/baca objek ke Garage bersama dari crm-api berhasil (bucket crm-photos, kunci crm-key)" || fail "uji tulis/baca Garage dari crm-api gagal (kunci S3 salah / bucket tidak ada?)"
echo "  (setelah adopsi: lanjutkan di folder WO → bash scripts/garage-platform.sh finalize </dev/null)"

# ───────────────────────── 8. Bukti ─────────────────────────
phase "Bukti terhadap sistem asli (tanpa token)"
IMG=$(dc config --images | grep 'maung-crm-web:')
# (a) crm-api → WO
r=$(dc exec -T crm-api node -e "fetch(process.env.WO_URL+'/api/auth/me').then(r=>{console.log(r.status);process.exit(0)}).catch(e=>{console.log('ERR');process.exit(1)})" 2>/dev/null | tr -d '\r\n')
E_ME="${r:-ERR}"; [ "$E_ME" = 401 ] && ok "(a) crm-api → $WO_URL/api/auth/me tanpa token = 401 (terjangkau, rute benar)" || fail "(a) /api/auth/me dari crm-api = '$E_ME' (diharapkan 401) — WO_URL tidak terjangkau dari container? (opsi: extra_hosts host-gateway)"
r=$(dc exec -T crm-api node -e "fetch('http://127.0.0.1:4000/crm/api/health').then(r=>{console.log(r.status);process.exit(0)}).catch(()=>{console.log('ERR')})" 2>/dev/null | tr -d '\r\n'); E_INT="${r:-ERR}"
r=$(dc exec -T crm-api node -e "fetch('http://127.0.0.1:4000/crm/api/me').then(r=>{console.log(r.status);process.exit(0)}).catch(()=>{console.log('ERR')})" 2>/dev/null | tr -d '\r\n'); E_ME_NOTOKEN="${r:-ERR}"
[ "$E_INT" = 200 ] && [ "$E_ME_NOTOKEN" = 401 ] && ok "(a) /crm/api/health=200 dan /crm/api/me tanpa token=401 (internal)" || fail "(a) rute API internal: health=$E_INT me=$E_ME_NOTOKEN"
# (d) jaringan maung_edge: probe dari container sementara di jaringan itu (nama service harus terselesaikan)
probe() { docker run --rm --network maung_edge --entrypoint node "$IMG" -e "fetch('$1').then(r=>{console.log(r.status);process.exit(0)}).catch(e=>{console.log('ERR');process.exit(1)})" 2>/dev/null | tr -d '\r\n'; }
E_PROBE_API=$(probe http://crm-api:4000/crm/api/health); E_PROBE_WEB=$(probe http://crm-web:3000/crm)
[ "$E_PROBE_API" = 200 ] && ok "(d) dari jaringan maung_edge: http://crm-api:4000/crm/api/health = 200" || fail "(d) crm-api tidak terjangkau di maung_edge (hasil '$E_PROBE_API')"
case "$E_PROBE_WEB" in 2??|3??|4??) ok "(d) dari jaringan maung_edge: http://crm-web:3000/crm = $E_PROBE_WEB" ;; *) fail "(d) crm-web tidak terjangkau di maung_edge (hasil '$E_PROBE_WEB')" ;; esac
nets_ok=1; ports_ok=1
netsof() { docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$1" 2>/dev/null; }
c=$(cid crm-api); nn=$(netsof "$c"); echo "  crm-api: jaringan=[ ${nn}]"
echo "$nn" | grep -qw maung_edge && echo "$nn" | grep -qw maung_storage || nets_ok=0
c=$(cid crm-web); nn=$(netsof "$c"); echo "  crm-web: jaringan=[ ${nn}]"
echo "$nn" | grep -qw maung_edge && ! echo "$nn" | grep -qw maung_storage || nets_ok=0
c=$(cid postgres); nn=$(netsof "$c"); echo "  postgres: jaringan=[ ${nn}]"
echo "$nn" | grep -qwE 'maung_edge|maung_storage' && nets_ok=0
nn=$(netsof maung-garage); echo "  maung-garage: jaringan=[ ${nn}]"
echo "$nn" | grep -qw maung_storage || nets_ok=0
if echo "$nn" | grep -qw maung_edge; then nets_ok=0; G_EDGE="TIDAK-BOLEH (ada di maung_edge)"; else G_EDGE=ok; fi
for s in crm-api crm-web; do
  c=$(cid "$s"); pp=$(docker inspect -f '{{range $p,$b := .NetworkSettings.Ports}}{{if $b}}{{$p}}→host {{end}}{{end}}' "$c" | tr -d ' ')
  [ -z "$pp" ] || ports_ok=0
  echo "  $s: port_host=[${pp:-tidak ada}]"
done
[ $nets_ok = 1 ] && E_NET="crm-api: edge+storage; crm-web: edge saja; postgres privat; maung-garage tidak di maung_edge" || E_NET=SALAH
[ $ports_ok = 1 ] && E_PORTS="tidak ada" || E_PORTS="ADA"
[ $nets_ok = 1 ] && ok "(d) jaringan benar: crm-api di maung_edge+maung_storage, crm-web hanya maung_edge, postgres privat, maung-garage TIDAK di maung_edge" || fail "(d) keanggotaan jaringan salah (lihat daftar di atas)"
[ $ports_ok = 1 ] && ok "(d) tidak ada port CRM terbuka di host" || fail "(d) ada port CRM terbuka di host"
# (b) via Caddy WO — PENDING bila crm.caddy belum dipasang (urutan go-live: deploy CRM dulu, lalu crm.caddy)
C_HEALTH_CODE=$(http "$WO_URL/crm/api/health"); C_CRM_CODE=$(http "$WO_URL/crm")
if [ "$C_HEALTH_CODE" = 200 ]; then C_HEALTH=PASS; ok "(b) $WO_URL/crm/api/health = 200 (Caddy → crm-api)"; else C_HEALTH="PENDING($C_HEALTH_CODE)"; warn "(b) /crm/api/health via Caddy = $C_HEALTH_CODE → crm.caddy belum dipasang di WO (wajar sebelum langkah itu)"; fi
# /crm (tanpa slash): 200 hanya bila Caddy meneruskan ke crm-web; sebelum jalur dipasang WO sendiri menjawab 404/308 (redirect slash) → bukan bukti.
if [ "$C_CRM_CODE" = 200 ]; then C_CRM=PASS; ok "(b) $WO_URL/crm = 200 (Caddy → crm-web; login dilakukan sisi klien ke /login?next=)"; else C_CRM="PENDING($C_CRM_CODE)"; fi
# (c) WO tidak terganggu
V_LOGIN_A=$(http "$WO_URL/login"); V_BRAND_A=$(http "$WO_URL/api/branding")
[ "$V_LOGIN_A" = 200 ] && [ "$V_BRAND_A" = 200 ] && ok "(c) WO tetap: /login=200 /api/branding=200" || { [ "$V_LOGIN_B" = 200 ] && [ "$V_BRAND_B" = 200 ] && fail "(c) WO berubah: /login=$V_LOGIN_A /api/branding=$V_BRAND_A"; warn "(c) WO tidak 200 sebelum maupun sesudah ($V_LOGIN_A/$V_BRAND_A)"; }
[ "$(sha "$WO_DIR/.env")" = "$WO_ENV_SHA" ] && { V_WOENV=YA; ok ".env WO tidak berubah (checksum sama)"; } || { V_WOENV=TIDAK; fail ".env WO BERUBAH (checksum beda) — hentikan dan periksa"; }
[ "$(wo_ids)" = "$WO_IDS_BEFORE" ] && { V_WOCT=YA; ok "container WO sama (nama, ID, status) seperti sebelum update"; } || { V_WOCT=TIDAK; fail "daftar/status container WO berubah selama update"; }

# (e) Integrasi CRM → WO (PUT /api/integrations/crm/*): kunci hanya diperiksa keberadaannya; probe baca-saja dari DALAM crm-api (kunci tidak lewat argumen host)
if [ -n "$(getenv CRM_INTEGRATION_KEY)" ]; then
  E_KEYENV=terisi
  r=$(dc exec -T crm-api node -e "console.log(process.env.CRM_INTEGRATION_KEY?'ada':'kosong')" 2>/dev/null | tr -d '\r\n'); E_KEYAPI="${r:-ERR}"
  [ "$E_KEYAPI" = ada ] && ok "(e) kunci integrasi terbaca oleh crm-api (nilai tidak ditampilkan)" || warn "(e) crm-api tidak menerima CRM_INTEGRATION_KEY ($E_KEYAPI) — compose lama? jalankan update.sh versi terbaru"
  r=$(dc exec -T crm-api node -e "fetch(process.env.WO_URL+'/api/integrations/crm/quotations/probe-crm-tidak-ada',{headers:{'x-api-key':process.env.CRM_INTEGRATION_KEY||''}}).then(r=>{console.log(r.status)}).catch(()=>console.log('ERR'))" 2>/dev/null | tr -d '\r\n'); E_PROBE_INT="${r:-ERR}"
  case "$E_PROBE_INT" in
    404) E_PROBE_INT="404 (OK: kunci diterima WO, penawaran uji tidak ada)"; ok "(e) WO menerima kunci integrasi (probe GET quotation tak dikenal = 404)" ;;
    401) E_PROBE_INT="401 (kunci DITOLAK WO)"; warn "(e) WO menolak kunci integrasi (401) — nilai CRM_INTEGRATION_KEY di .env CRM harus SAMA dengan di .env WO. Kirim ke WO tidak berjalan; CRM lain normal." ;;
    503) E_PROBE_INT="503 (integrasi nonaktif di WO)"; warn "(e) integrasi CRM nonaktif di WO (503: CRM_INTEGRATION_KEY belum terisi di .env WO / WO belum diperbarui)" ;;
    *) warn "(e) probe integrasi ke WO tidak konklusif ($E_PROBE_INT)" ;;
  esac
  q() { dc exec -T postgres psql -U crm -d maung_crm -Atc "$1" 2>/dev/null | tr -d '\r'; }
  E_OUTBOX=$(q "SELECT 'pending:'||count(*) FILTER (WHERE status='PENDING')||' blocked:'||count(*) FILTER (WHERE status='BLOCKED') FROM wo_outbox"); E_OUTBOX="${E_OUTBOX:-tidak-terbaca}"
  case "$E_OUTBOX" in *blocked:0) ok "(e) antrean kirim ke WO: $E_OUTBOX" ;; *blocked:*) warn "(e) ada item kirim ke WO yang DITOLAK WO ($E_OUTBOX) — lihat CRM → Dashboard → Kirim ke WO" ;; *) warn "(e) antrean kirim tidak terbaca ($E_OUTBOX)" ;; esac
else
  E_KEYENV=kosong; warn "(e) CRM_INTEGRATION_KEY kosong di .env CRM → katalog/penawaran belum dikirim ke WO (isi kunci yang SAMA dengan WO, lalu jalankan ulang update.sh)"
fi

# ───────────────────────── 9. Finalisasi ─────────────────────────
phase "Finalisasi (hapus container uji lama setelah semua bukti lolos)"
ROLL_ARMED=0
if [ -n "$LEGACY_IDS" ]; then
  for c in $LEGACY_IDS; do docker rm -f "$c" >/dev/null 2>&1; done; LEGACY_REMOVED=ya; ok "container CRM uji lama (api/web) dihapus; volume Postgres/Garage dipertahankan"
else LEGACY_REMOVED=tidak-ada; ok "tidak ada container lama"; fi
if (ss -ltn 2>/dev/null || true) | grep -qE '[:.]3100[[:space:]]'; then PORT3100=MASIH-TERBUKA; warn "port 3100 masih terbuka di host (proses lain?)"; else PORT3100=tertutup; ok "port 3100 tertutup"; fi
echo "$TAG" > "$STATE_DIR/last_ok_tag"; ok "tag ${TAG:0:12}… dicatat sebagai terakhir-baik (untuk rollback berikutnya)"
STATUS=PASS; result
