#!/usr/bin/env bash
# Instalasi maung-crm dengan interaksi minimal. Aman diulang (tidak menimpa .env yang sudah ada).
#   bash deploy/install.sh                      # uji awal: web di http://IP:3100
#   bash deploy/install.sh --wo-url https://wo.contoh.co.id
#   bash deploy/install.sh --wo-vm              # satu VM dengan Maung WO (web bergabung ke jaringan WO)
#   bash deploy/install.sh --env-only           # hanya siapkan .env (tanpa docker)
# Opsi token registry (bila package GHCR private):  GHCR_TOKEN=xxxx bash deploy/install.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# Pengaman: hanya jalan di dalam repo maung-crm (jangan sampai menyentuh .env aplikasi lain).
grep -q '^name: maung-crm' docker-compose.yml 2>/dev/null || { echo "ERROR: bukan direktori maung-crm"; exit 1; }

WO_URL_ARG=""; WO_VM=0; ENV_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --wo-url) WO_URL_ARG="${2:?--wo-url butuh nilai}"; shift 2 ;;
    --wo-vm) WO_VM=1; shift ;;
    --env-only) ENV_ONLY=1; shift ;;
    *) echo "Opsi tidak dikenal: $1"; exit 1 ;;
  esac
done

setenv() { if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
getenv() { grep -m1 "^$1=" .env 2>/dev/null | cut -d= -f2- || true; }
rand() { openssl rand -hex 32; }

# ---- 1. .env (dibuat sekali; tidak pernah ditimpa) ----
if [ ! -f .env ]; then
  echo "==> Membuat .env dengan secret acak"
  cp .env.example .env
  chmod 600 .env
  for k in POSTGRES_PASSWORD FILE_SIGN_SECRET GARAGE_RPC_SECRET; do setenv "$k" "$(rand)"; done
else
  echo "==> .env sudah ada, dipertahankan"
fi

# ---- 2. WO_URL: argumen > .env > deteksi dari instalasi WO di folder sebelah > tanya ----
detect_wo_url() {
  local d
  for d in ../Maung-Wo-Inv ../maung-wo-inv "$HOME/Maung-Wo-Inv"; do
    [ -f "$d/.env" ] || continue
    local dom url
    dom=$(grep -m1 '^WEB_DOMAIN=' "$d/.env" | cut -d= -f2- | tr -d "'\"" || true)
    if [ -n "$dom" ]; then echo "https://$dom"; return; fi
    url=$(grep -m1 '^WEB_URL=' "$d/.env" | cut -d= -f2- | tr -d "'\"" || true)
    case "$url" in http*) [ "${url#http://localhost}" = "$url" ] && { echo "$url"; return; } ;; esac
  done
}
WO_URL="${WO_URL_ARG:-$(getenv WO_URL)}"
[ -n "$WO_URL" ] || WO_URL="$(detect_wo_url || true)"
if [ -z "$WO_URL" ]; then
  if [ -t 0 ]; then read -r -p "Alamat Maung WO (mis. https://wo.perusahaan.co.id): " WO_URL
  else echo "ERROR: WO_URL tidak terdeteksi. Jalankan dengan --wo-url https://alamat-wo"; exit 1; fi
fi
WO_URL="${WO_URL%/}"
setenv WO_URL "$WO_URL"
echo "==> WO_URL = $WO_URL"
code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$WO_URL/api/auth/introspect" || true)
if [ "$code" = "401" ]; then echo "    introspect WO terjangkau (401 tanpa token = normal)"
else echo "    PERINGATAN: $WO_URL/api/auth/introspect membalas '$code' (diharapkan 401). Periksa WO_URL / jaringan."; fi

if [ "$WO_VM" = 1 ]; then setenv COMPOSE_FILE "docker-compose.yml:docker-compose.wo-vm.yml"; fi

[ "$ENV_ONLY" = 1 ] && { echo "==> .env siap (--env-only)."; exit 0; }

# ---- 3. Tarik image & jalankan ----
command -v docker >/dev/null || { echo "ERROR: docker belum terpasang"; exit 1; }
if ! docker compose pull 2>/tmp/crm-pull.err; then
  if [ -n "${GHCR_TOKEN:-}" ]; then
    echo "==> Login ke GHCR"
    printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:-thuekx}" --password-stdin
    docker compose pull
  else
    cat /tmp/crm-pull.err
    echo "ERROR: gagal menarik image. Bila package GHCR private, jalankan ulang dengan GHCR_TOKEN=<token read:packages>."
    exit 1
  fi
fi
docker compose up -d

# ---- 4. Garage: layout, bucket, kunci (sekali) ----
if [ -z "$(getenv S3_ACCESS_KEY)" ]; then
  echo "==> Inisialisasi Garage"
  G="docker compose exec -T garage /garage"
  BUCKET="$(getenv S3_BUCKET)"; BUCKET="${BUCKET:-crm-photos}"
  for _ in $(seq 1 30); do $G status >/dev/null 2>&1 && break || sleep 2; done
  NODE=$($G status | awk '/^[0-9a-f]{16}/{print $1; exit}')
  [ -n "$NODE" ] || { echo "ERROR: ID node Garage tidak terbaca ($G status)"; exit 1; }
  if ! $G layout show 2>/dev/null | grep -q "$NODE"; then
    $G layout assign -z dc1 -c 10G "$NODE"
    $G layout apply --version 1
  fi
  $G bucket create "$BUCKET" >/dev/null 2>&1 || true
  OUT=$($G key create crm-key 2>&1 || $G key info crm-key --show-secret 2>&1 || true)
  AK=$(printf '%s\n' "$OUT" | awk '/Key ID:/{print $3; exit}')
  SK=$(printf '%s\n' "$OUT" | awk '/Secret key:/{print $3; exit}')
  if [ -z "$AK" ] || [ -z "$SK" ]; then
    echo "ERROR: kunci Garage tidak terbaca dari keluaran berikut (jangan kirim bagian Secret key):"
    printf '%s\n' "$OUT" | sed 's/\(Secret key:\).*/\1 ***/'
    exit 1
  fi
  $G bucket allow --read --write --owner "$BUCKET" --key crm-key >/dev/null
  setenv S3_ACCESS_KEY "$AK"; setenv S3_SECRET_KEY "$SK"
  docker compose up -d api
fi

# ---- 5. Cek ----
echo "==> Menunggu API sehat"
for _ in $(seq 1 30); do
  [ "$(docker compose ps --format '{{.Health}}' api 2>/dev/null)" = "healthy" ] && break || sleep 3
done
docker compose ps
PORT="$(getenv WEB_PORT)"; PORT="${PORT:-3100}"
if [ "$WO_VM" = 0 ]; then
  curl -fsS "http://localhost:$PORT/api/health" && echo && echo "==> OK: buka http://<IP-server>:$PORT/login"
else
  echo "==> OK (mode WO-VM): web CRM tersedia di jaringan WO sebagai crm-web:3000; atur Caddy WO ke domain CRM."
fi
