#!/usr/bin/env bash
# maung-crm — instalasi otomatis berfase (aman diulang, tidak menimpa .env, tidak menyentuh Maung WO).
#   bash deploy/install.sh                    # penuh (7 fase)
#   bash deploy/install.sh --check            # hanya fase 1-2 (guard + pemeriksaan WO, tanpa mengubah apa pun)
#   bash deploy/install.sh --env-only         # fase 1-3 (siapkan .env saja)
#   opsi: --wo-url URL | --wo-vm | env GHCR_TOKEN=... (package GHCR private)
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"

WO_URL_ARG=""; WO_VM=0; MODE=full
while [ $# -gt 0 ]; do
  case "$1" in
    --wo-url) WO_URL_ARG="${2:?--wo-url butuh nilai}"; shift 2 ;;
    --wo-vm) WO_VM=1; shift ;;
    --check) MODE=check; shift ;;
    --env-only) MODE=env; shift ;;
    *) echo "Opsi tidak dikenal: $1"; exit 1 ;;
  esac
done

STAMP=$(date +%Y%m%d_%H%M%S)
LOGDIR="${CRM_LOG_DIR:-$HOME/maung-crm-logs}"; mkdir -p "$LOGDIR"
LOG="$LOGDIR/INSTALL-$STAMP.log"
exec > >(tee -a "$LOG") 2>&1

TOTAL=7; P=0; CUR=""; WARNS=()
line() { printf '%*s\n' 60 '' | tr ' ' '='; }
phase() { P=$((P+1)); CUR="$1"; echo; echo "[$P/$TOTAL] $1"; }
ok() { echo "✓ $*"; }
warn() { echo "! $*"; WARNS+=("$*"); }
die() { echo "✗ $*"; echo; line; echo "RESULT"; line
  echo "CRM_INSTALL=FAIL"; echo "failed_phase=[$P/$TOTAL] $CUR"; echo "audit_log=$LOG"
  echo "RESULT : GAGAL — kirim baris ✗ di atas (tanpa nilai secret)"; exit 1; }

setenv() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
getenv() { grep -m1 "^$1=" .env 2>/dev/null | cut -d= -f2- | tr -d "'\"" || true; }
rand() { openssl rand -hex 32; }
dc() { docker compose "$@"; }

line; echo "MAUNG-CRM INSTALL"; echo "MODE=$MODE  WO_VM=$WO_VM  $(date '+%F %T %Z')"; line

# ───────────────────────── 1. Guard direktori & lingkungan ─────────────────────────
phase "Guard direktori & lingkungan"
echo "pwd=$ROOT"; echo "user=$(id -un)"; echo "log=$LOG"
grep -q '^name: maung-crm' docker-compose.yml 2>/dev/null || die "bukan direktori maung-crm (docker-compose.yml tidak sesuai)"
ok "direktori adalah repo maung-crm"
case "$ROOT" in *Maung-Wo-Inv*|*maung-wo-inv*) die "direktori berada di dalam folder Maung WO — pindah ke folder CRM sendiri" ;; esac
ok "terpisah dari folder Maung WO"
if [ -d .git ] && git remote get-url origin 2>/dev/null | grep -qi 'maung-crm'; then ok "remote git = maung-crm ($(git rev-parse --short HEAD))"; else warn "remote git bukan maung-crm / bukan repo git"; fi
if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  ok "docker dapat diakses ($(docker --version | cut -d, -f1))"
  cv=$(docker compose version --short 2>/dev/null | tr -d v); echo "compose=$cv"
  [ "$(printf '%s\n2.24\n' "$cv" | sort -V | head -1)" = "2.24" ] && ok "compose >= 2.24" || die "docker compose $cv terlalu lama (butuh >= 2.24)"
  DOCKER_OK=1
else
  DOCKER_OK=0
  if [ "$MODE" = full ]; then die "docker tidak terpasang / tidak bisa diakses user ini"; else warn "docker tidak dapat diakses — pemeriksaan kontainer dilewati"; fi
fi
FREE_MB=$(df -Pm "$ROOT" | awk 'NR==2{print $4}'); echo "disk_free_mb=$FREE_MB"
[ "${FREE_MB:-0}" -ge 3000 ] && ok "ruang disk cukup" || warn "ruang disk < 3 GB"
if [ -f .env ]; then WEB_PORT_CUR=$(grep -m1 '^WEB_PORT=' .env | cut -d= -f2-); fi
WEB_PORT_CUR="${WEB_PORT_CUR:-3100}"
if (ss -ltn 2>/dev/null || true) | grep -qE "[:.]$WEB_PORT_CUR[[:space:]]"; then
  if [ "$DOCKER_OK" = 1 ] && dc ps -q web 2>/dev/null | grep -q .; then ok "port $WEB_PORT_CUR dipakai stack CRM ini (pembaruan)"; else warn "port $WEB_PORT_CUR sudah dipakai proses lain"; fi
else ok "port $WEB_PORT_CUR bebas"; fi

# ───────────────────────── 2. Pemeriksaan Maung WO (baca-saja) ─────────────────────────
phase "Pemeriksaan Maung WO (baca-saja, tidak mengubah apa pun)"
WO_DIR=""
for d in "$HOME/Maung-Wo-Inv" "$ROOT/../Maung-Wo-Inv" "$HOME/maung-wo-inv"; do [ -d "$d/.git" ] && { WO_DIR="$(cd "$d" && pwd)"; break; }; done
WO_CHECKOUT="TIDAK_DITEMUKAN"; WO_DEPLOY="TIDAK_DIKETAHUI"
if [ -n "$WO_DIR" ]; then
  echo "wo_dir=$WO_DIR"
  LOCAL=$(git -C "$WO_DIR" rev-parse HEAD); LOCALS=$(git -C "$WO_DIR" rev-parse --short HEAD)
  REMOTE=$(timeout 20 git -C "$WO_DIR" ls-remote origin refs/heads/main 2>/dev/null | awk '{print $1}')
  echo "wo_head_lokal=$LOCALS  wo_head_remote=${REMOTE:0:7}"
  if [ -z "$REMOTE" ]; then WO_CHECKOUT="REMOTE_TIDAK_TERJANGKAU"; warn "tidak bisa membaca origin/main WO"
  elif [ "$LOCAL" = "$REMOTE" ]; then WO_CHECKOUT="TERBARU"; ok "checkout WO = origin/main (sudah pull terakhir)"
  else WO_CHECKOUT="TERTINGGAL"; warn "checkout WO tertinggal dari origin/main → perlu: cd $WO_DIR && git pull origin main && bash scripts/deploy.sh"; fi
  DIRTY=$(git -C "$WO_DIR" status --porcelain | grep -v '^??' | wc -l); echo "wo_perubahan_lokal=$DIRTY"
  if [ "$DOCKER_OK" = 1 ]; then
    CTS=$(git -C "$WO_DIR" log -1 --format=%ct)
    for s in api worker web; do
      cid=$(docker ps -q --filter "label=com.docker.compose.project=maung-wo-inv" --filter "label=com.docker.compose.service=$s" | head -1)
      if [ -z "$cid" ]; then warn "WO service $s TIDAK berjalan"; continue; fi
      img=$(docker inspect -f '{{.Image}}' "$cid"); built=$(date -d "$(docker inspect -f '{{.Created}}' "$img")" +%s 2>/dev/null || echo 0)
      st=$(docker inspect -f '{{.State.Status}}{{if .State.Health}}/{{.State.Health.Status}}{{end}}' "$cid")
      if [ "$built" -ge "$CTS" ]; then echo "  $s: $st — image dibangun SETELAH commit terakhir (deploy terkini)"; [ "$s" = api ] && WO_DEPLOY="TERKINI"
      else echo "  $s: $st — image LEBIH TUA dari commit terakhir"; [ "$s" = api ] && { WO_DEPLOY="BELUM_DI_DEPLOY"; warn "image WO $s lebih tua dari checkout → jalankan scripts/deploy.sh"; }; fi
    done
  fi
  if [ -f "$WO_DIR/.env" ]; then
    bad=$(grep -E '^(JWT_SECRET|BILLING_API_KEY|BILLING_WEBHOOK_SECRET|TELEGRAM_WEBHOOK_SECRET)=ganti' "$WO_DIR/.env" | cut -d= -f1 | tr '\n' ' ')
    if [ -n "$bad" ]; then warn "WO .env masih berisi nilai TEMPLATE untuk: $bad"; else ok "WO .env tanpa nilai template pada secret utama"; fi
  fi
else
  warn "folder Maung WO tidak ditemukan di lokasi umum (lewati)"
fi

if [ "$MODE" = check ]; then
  echo; line; echo "RESULT"; line
  echo "CRM_CHECK=DONE"; echo "wo_checkout=$WO_CHECKOUT"; echo "wo_deploy=$WO_DEPLOY"; echo "peringatan=${#WARNS[@]}"
  for w in "${WARNS[@]:-}"; do [ -n "$w" ] && echo "  - $w"; done
  echo "perubahan_ke_sistem=TIDAK_ADA"; echo "audit_log=$LOG"; exit 0
fi

# ───────────────────────── 3. .env & WO_URL ─────────────────────────
phase "Konfigurasi .env (dibuat sekali, tidak pernah ditimpa)"
if [ ! -f .env ]; then
  cp .env.example .env; chmod 600 .env
  for k in POSTGRES_PASSWORD FILE_SIGN_SECRET GARAGE_RPC_SECRET; do setenv "$k" "$(rand)"; done
  ok ".env dibuat dengan secret acak (3)"
else ok ".env sudah ada, dipertahankan"; fi
detect_wo_url() {
  [ -n "$WO_DIR" ] && [ -f "$WO_DIR/.env" ] || return 0
  local dom url
  dom=$(grep -m1 '^WEB_DOMAIN=' "$WO_DIR/.env" | cut -d= -f2- | tr -d "'\"" || true)
  [ -n "$dom" ] && { echo "https://$dom"; return; }
  url=$(grep -m1 '^WEB_URL=' "$WO_DIR/.env" | cut -d= -f2- | tr -d "'\"" || true)
  case "$url" in http://localhost*|"") ;; http*) echo "$url" ;; esac
}
WO_URL="${WO_URL_ARG:-$(getenv WO_URL)}"; [ -n "$WO_URL" ] || WO_URL="$(detect_wo_url)"
if [ -z "$WO_URL" ]; then
  if [ -t 0 ]; then read -r -p "Alamat Maung WO (mis. https://wo.perusahaan.co.id): " WO_URL; else die "WO_URL tidak terdeteksi — jalankan dengan --wo-url https://alamat-wo"; fi
fi
WO_URL="${WO_URL%/}"; setenv WO_URL "$WO_URL"; echo "WO_URL=$WO_URL"
code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$WO_URL/api/auth/introspect" || true)
[ "$code" = "401" ] && ok "introspect WO terjangkau (401 tanpa token = normal)" || warn "introspect WO membalas '$code' (diharapkan 401)"
if [ "$WO_VM" = 1 ]; then setenv COMPOSE_FILE "docker-compose.yml:docker-compose.wo-vm.yml"; ok "mode WO-VM (COMPOSE_FILE diatur)"; fi
echo "variabel_secret: POSTGRES_PASSWORD=terisi($(getenv POSTGRES_PASSWORD | wc -c)) FILE_SIGN_SECRET=terisi GARAGE_RPC_SECRET=terisi"
if [ "$MODE" = env ]; then echo; line; echo "RESULT"; line; echo "CRM_ENV=READY"; echo "audit_log=$LOG"; exit 0; fi

# ───────────────────────── 4. Tarik image ─────────────────────────
phase "Tarik image dari GHCR"
if ! dc pull 2>"$LOGDIR/.pull.err"; then
  if [ -n "${GHCR_TOKEN:-}" ]; then
    echo "login GHCR…"; printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:-thuekx}" --password-stdin >/dev/null 2>&1 || die "login GHCR ditolak (token salah / tanpa scope read:packages)"
    dc pull || die "pull image gagal setelah login"
  else cat "$LOGDIR/.pull.err"; die "pull gagal; bila package private jalankan dengan GHCR_TOKEN=<token read:packages>"; fi
fi
for s in api web; do img=$(dc config --images | grep "maung-crm-$s"); echo "  $s: $img  dibuat $(docker image inspect -f '{{.Created}}' "$img" 2>/dev/null | cut -c1-19)"; done
ok "image api & web siap"

# ───────────────────────── 5. Jalankan stack ─────────────────────────
phase "Jalankan stack (postgres, garage, api, web)"
dc up -d 2>&1 | sed 's/^/  /' ; [ "${PIPESTATUS[0]}" = 0 ] || die "docker compose up gagal"
for _ in $(seq 1 40); do h=$(dc ps --format '{{.Health}}' api 2>/dev/null); [ "$h" = healthy ] && break; sleep 3; done
dc ps --format 'table {{.Service}}\t{{.Status}}'
[ "$(dc ps --format '{{.Health}}' api 2>/dev/null)" = healthy ] && ok "api healthy" || { dc logs --tail 25 api; die "api tidak healthy dalam 2 menit (log di atas)"; }

# ───────────────────────── 6. Garage ─────────────────────────
phase "Inisialisasi Garage (layout, bucket, kunci)"
if [ -n "$(getenv S3_ACCESS_KEY)" ]; then ok "kunci S3 sudah ada di .env — dilewati"; else
  G="dc exec -T garage /garage"
  BUCKET="$(getenv S3_BUCKET)"; BUCKET="${BUCKET:-crm-photos}"
  for _ in $(seq 1 30); do $G status >/dev/null 2>&1 && break; sleep 2; done
  NODE=$($G status 2>/dev/null | awk '/^[0-9a-f]{16}/{print $1; exit}'); [ -n "$NODE" ] || die "ID node Garage tidak terbaca"
  echo "node=$NODE"
  if ! $G layout show 2>/dev/null | grep -q "$NODE"; then $G layout assign -z dc1 -c 10G "$NODE" >/dev/null && $G layout apply --version 1 >/dev/null || die "layout Garage gagal"; ok "layout diterapkan"; else ok "layout sudah ada"; fi
  $G bucket create "$BUCKET" >/dev/null 2>&1 || true; ok "bucket $BUCKET"
  OUT=$($G key create crm-key 2>&1 || $G key info crm-key --show-secret 2>&1 || true)
  AK=$(printf '%s\n' "$OUT" | awk '/Key ID:/{print $3; exit}'); SK=$(printf '%s\n' "$OUT" | awk '/Secret key:/{print $3; exit}')
  if [ -z "$AK" ] || [ -z "$SK" ]; then printf '%s\n' "$OUT" | sed 's/\(Secret key:\).*/\1 ***/'; die "kunci Garage tidak terbaca dari keluaran di atas"; fi
  $G bucket allow --read --write --owner "$BUCKET" --key crm-key >/dev/null || die "izin bucket gagal"
  setenv S3_ACCESS_KEY "$AK"; setenv S3_SECRET_KEY "$SK"; ok "kunci akses dibuat dan disimpan ke .env (nilai tidak ditampilkan)"
  dc up -d api >/dev/null 2>&1; for _ in $(seq 1 30); do [ "$(dc ps --format '{{.Health}}' api)" = healthy ] && break; sleep 3; done
fi

# ───────────────────────── 7. Verifikasi ─────────────────────────
phase "Verifikasi end-to-end"
PORT="$(getenv WEB_PORT)"; PORT="${PORT:-3100}"
HEALTH=FAIL; WEBP=SKIP; WO_FROM=FAIL; STORE=FAIL
if [ "$WO_VM" = 0 ]; then
  curl -fsS -m 10 "http://localhost:$PORT/api/health" | grep -q '"ok":true' && HEALTH=PASS
  [ "$(curl -s -o /dev/null -m 10 -w '%{http_code}' "http://localhost:$PORT/login")" = 200 ] && WEBP=PASS || WEBP=FAIL
else HEALTH=$(dc exec -T api node -e "fetch('http://127.0.0.1:4100/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))" >/dev/null 2>&1 && echo PASS || echo FAIL); fi
echo "api_health=$HEALTH  web_login_page=$WEBP"
dc exec -T api node -e "fetch(process.env.WO_URL+'/api/auth/introspect').then(r=>process.exit(r.status===401?0:1),()=>process.exit(1))" >/dev/null 2>&1 && WO_FROM=PASS
echo "wo_introspect_dari_container=$WO_FROM"
dc exec -T api node -e "import('./dist/storage.js').then(async m=>{const s=m.storage();await s.put('_selftest/x.txt',Buffer.from('ok'),'text/plain');process.exit((await s.get('_selftest/x.txt')).toString()==='ok'?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})" 2>&1 | sed 's/^/  /'
[ "${PIPESTATUS[0]}" = 0 ] && STORE=PASS
echo "storage_roundtrip_garage=$STORE"
[ "$HEALTH" = PASS ] && ok "API sehat" || die "API health gagal"
[ "$STORE" = PASS ] && ok "tulis/baca objek ke Garage berhasil" || die "uji tulis/baca Garage gagal (periksa kunci S3 / garage logs)"
[ "$WO_FROM" = PASS ] && ok "container CRM dapat menjangkau WO" || warn "container CRM tidak dapat menjangkau WO_URL"

echo; line; echo "RESULT"; line
echo "CRM_INSTALL=COMPLETE"
echo "web_url=http://<IP-server>:$PORT/login  (HTTPS menunggu perubahan Caddy WO)"
echo "wo_checkout=$WO_CHECKOUT"; echo "wo_deploy=$WO_DEPLOY"
echo "api_health=$HEALTH"; echo "storage_garage=$STORE"; echo "wo_introspect=$WO_FROM"
echo "env_ditimpa=TIDAK"; echo "wo_dimodifikasi=TIDAK"
echo "peringatan=${#WARNS[@]}"; for w in "${WARNS[@]:-}"; do [ -n "$w" ] && echo "  - $w"; done
echo "audit_log=$LOG"
echo; echo "RESULT : CRM INSTALL PASS / NEXT=HTTPS_CADDY_WO + MODUL_LEAD"
