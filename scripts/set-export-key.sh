#!/usr/bin/env bash
# MAUNG CRM — pasang kunci Export API WO (WO_EXPORT_API_KEY) ke .env CRM untuk cermin pelanggan (baca-saja). Berfase, dengan backup + rollback.
# Kunci DIKETIK di layar tanpa tampil (tidak masuk riwayat shell/chat/log). Nilainya tidak pernah dicetak.
# Prasyarat: update.sh versi terbaru sudah dijalankan (compose meneruskan WO_EXPORT_API_KEY ke crm-api).
# Jalankan:  cd ~/maung-crm && git pull --ff-only origin main && bash scripts/set-export-key.sh
#   (opsional untuk otomasi: KEY_FILE=/jalur/berkas-mode-600 bash scripts/set-export-key.sh)
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
. "$HERE/scripts/lib.sh"
N=5; P=0; CUR=""; WARNS=()
EXPECT_HOST="${EXPECT_HOST:-maung-apps}"
WAIT_API="${WAIT_API:-120}"; WAIT_SYNC="${WAIT_SYNC:-90}"; POLL="${POLL_INTERVAL:-3}"
LOG_DIR="$HOME/maung-crm-logs"; BK_DIR="$LOG_DIR/backup"; mkdir -p "$BK_DIR"; chmod 700 "$LOG_DIR"
TS=$(date +%Y%m%d-%H%M%S); LOG="$LOG_DIR/set-export-key-$TS.log"
exec > >(tee -a "$LOG") 2>&1
cd "$HERE" || exit 1
ENVF="$HERE/.env"; ENV_BAK="$BK_DIR/crm-env-$TS.bak"
STATUS=FAIL; REASON=""; ROLL_ARMED=0; ROLLED=no
V_WOHTTP=n/a; V_API=n/a; V_MIRROR=n/a; KEY=""
dc() { docker compose "$@"; }
getenv() { grep -m1 "^$1=" "$ENVF" 2>/dev/null | cut -d= -f2- | tr -d "'\"" || true; }
setenv() { local t; t=$(mktemp "$ENVF.XXXXXX"); chmod 600 "$t"; { grep -v "^$1=" "$ENVF" || true; printf '%s=%s\n' "$1" "$2"; } > "$t" && mv "$t" "$ENVF"; }
cid() { dc ps -aq "$1" 2>/dev/null | head -1; }
hstat() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || echo none; }
# Panggil WO dengan kunci lewat stdin curl (-K -): kunci tidak muncul di daftar proses/argumen.
wo_export_status() { printf 'header = "x-api-key: %s"\n' "$KEY" | curl -s -o /dev/null -m 20 -w '%{http_code}' -K - "$WO_URL/api/export/customers?limit=1" 2>/dev/null | head -c3 || true; }
result() {
  banner "RESULT"
  kv status "$STATUS"; kv reason "${REASON:--}"; kv host "$(hostname)"; kv dir "$HERE"
  kv export_api_wo_http "$V_WOHTTP"; kv crm_api "$V_API"; kv cermin "$V_MIRROR"
  kv kunci_dicetak TIDAK; kv rollback "$ROLLED"; kv backup_env "$([ -f "$ENV_BAK" ] && echo "$ENV_BAK" || echo -)"
  kv perubahan_ke_WO TIDAK_ADA; kv log "$LOG"
  for w in "${WARNS[@]:-}"; do [ -n "$w" ] && printf '  - %s\n' "$w"; done
  echo "RESULT : PASANG KUNCI EXPORT ${STATUS} / NEXT=${NEXT:-tidak-ada}"
}
rollback() {
  [ "$ROLL_ARMED" = 1 ] || return 0
  warn "ROLLBACK: .env dikembalikan dari backup, crm-api dibuat ulang"
  cp -p "$ENV_BAK" "$ENVF" && chmod 600 "$ENVF"; ROLLED=ya
  dc up -d crm-api >/dev/null 2>&1 || warn "crm-api gagal dibuat ulang — periksa: cd ~/maung-crm && docker compose ps"
}
fail() { bad "$*"; REASON="$*"; STATUS=FAIL; rollback; result; exit 1; }
NEXT=""

banner "MAUNG CRM — PASANG KUNCI EXPORT WO  ($TS)"
phase "Guard"
echo "  host=$(hostname)  user=$(id -un)  dir=$HERE"
[ "$(hostname)" = "$EXPECT_HOST" ] || fail "HOST SALAH: ini '$(hostname)', seharusnya '$EXPECT_HOST'"
[ "$(id -u)" != 0 ] || fail "jangan dijalankan sebagai root"
docker info >/dev/null 2>&1 || fail "docker tidak dapat diakses user ini"
[ -f "$ENVF" ] || fail ".env CRM tidak ada — jalankan scripts/update.sh dulu"
[ -f "$HERE/docker-compose.yml" ] && grep -q 'WO_EXPORT_API_KEY' "$HERE/docker-compose.yml" || fail "docker-compose.yml belum meneruskan WO_EXPORT_API_KEY — jalankan dulu: cd ~/maung-crm && git pull --ff-only origin main && bash scripts/update.sh </dev/null"
WO_URL=$(getenv WO_URL); [ -n "$WO_URL" ] || fail "WO_URL kosong di .env CRM"
[ -n "$(getenv IMAGE_TAG)" ] || fail "IMAGE_TAG kosong di .env — jalankan scripts/update.sh dulu"
[ -n "$(cid crm-api)" ] || fail "container crm-api belum ada — jalankan scripts/update.sh dulu"
ok "guard lolos (WO_URL=$WO_URL)"

phase "Kunci Export (tidak ditampilkan)"
if [ -n "${KEY_FILE:-}" ]; then
  [ -f "$KEY_FILE" ] || fail "KEY_FILE tidak ada"
  [ "$(stat -c%a "$KEY_FILE")" = 600 ] || fail "KEY_FILE harus mode 600 (chmod 600 $KEY_FILE)"
  KEY=$(head -n1 "$KEY_FILE" | tr -d '\r\n ')
elif [ -r /dev/tty ] && [ -w /dev/tty ]; then
  printf '  Ketik/tempel kunci Export API WO lalu Enter (tidak akan tampil): ' > /dev/tty
  IFS= read -rs KEY < /dev/tty; echo > /dev/tty; KEY=$(printf '%s' "$KEY" | tr -d '\r\n ')
else fail "tidak ada terminal untuk mengetik kunci (jalankan langsung di SSH, atau pakai KEY_FILE=…)"; fi
[ -n "$KEY" ] || fail "kunci kosong"
[ "${#KEY}" -ge 16 ] || fail "kunci terlalu pendek (<16 karakter) — salah tempel?"
printf '%s' "$KEY" | grep -Eq '^[A-Za-z0-9._~+/=-]+$' || fail "kunci memuat karakter yang tidak diizinkan (spasi/kutip/simbol) — salah tempel?"
ok "kunci diterima (${#KEY} karakter; nilai tidak ditampilkan)"

phase "Uji kunci ke Export API WO (baca-saja)"
V_WOHTTP=$(wo_export_status); V_WOHTTP=${V_WOHTTP:-000}
case "$V_WOHTTP" in
  200) ok "WO menerima kunci (GET /api/export/customers?limit=1 = 200)" ;;
  401) fail "WO menolak kunci (401) — kunci salah / bukan EXPORT_API_KEY WO. Tidak ada yang diubah." ;;
  503) fail "Export API nonaktif di WO (503) — EXPORT_API_KEY belum diisi di .env WO (urusan sesi/pemilik WO). Tidak ada yang diubah." ;;
  000) fail "WO tidak terjangkau dari server ini (WO_URL=$WO_URL). Tidak ada yang diubah." ;;
  *) fail "Respons tak terduga dari WO ($V_WOHTTP). Tidak ada yang diubah." ;;
esac

phase "Simpan ke .env (backup dulu) dan buat ulang crm-api"
cp -p "$ENVF" "$ENV_BAK" && chmod 600 "$ENV_BAK" && ok "backup .env → $ENV_BAK"
ROLL_ARMED=1
setenv WO_EXPORT_API_KEY "$KEY"; chmod 600 "$ENVF"
[ "$(getenv WO_EXPORT_API_KEY)" = "$KEY" ] && ok "WO_EXPORT_API_KEY tersimpan di .env (mode 600)" || fail "gagal menulis .env"
[ -n "$(getenv SYNC_INTERVAL_MIN)" ] || setenv SYNC_INTERVAL_MIN 30
[ -n "$(getenv PHONE_DEFAULT_REGION)" ] || setenv PHONE_DEFAULT_REGION ID
dc up -d crm-api >/dev/null 2>&1 || fail "docker compose up crm-api gagal"
a=$(cid crm-api); n=$((WAIT_API / POLL)); [ "$n" -ge 1 ] || n=1
for _ in $(seq 1 "$n"); do V_API=$(hstat "$a"); [ "$V_API" = healthy ] && break; sleep "$POLL"; done
[ "$V_API" = healthy ] && ok "crm-api healthy" || fail "crm-api tidak sehat setelah dibuat ulang ($V_API)"

phase "Cermin pelanggan terisi (tunggu sinkron pertama)"
q() { dc exec -T postgres psql -U crm -d maung_crm -Atc "$1" 2>/dev/null | tr -d '\r'; }
n=$((WAIT_SYNC / POLL)); [ "$n" -ge 1 ] || n=1; ERRS=""
for _ in $(seq 1 "$n"); do
  V_MIRROR=$(q "SELECT string_agg(resource||'='||COALESCE(rows,0)||'('||COALESCE(mode,'?')||')', ' ' ORDER BY resource) FROM wo_sync_state WHERE last_ok_at IS NOT NULL AND last_run_at >= now() - interval '10 minutes'")
  ERRS=$(q "SELECT string_agg(resource||': '||last_error, ' | ') FROM wo_sync_state WHERE last_error IS NOT NULL")
  echo "$V_MIRROR" | grep -q 'customers=' && echo "$V_MIRROR" | grep -q 'subscriptions=' && break
  sleep "$POLL"
done
echo "$V_MIRROR" | grep -q 'customers=' && echo "$V_MIRROR" | grep -q 'subscriptions=' || { V_MIRROR="${V_MIRROR:-kosong}"; fail "cermin belum terisi dalam ${WAIT_SYNC}s (${ERRS:-tanpa pesan galat}) — sinkron pertama berjalan ±20 dtk setelah crm-api naik"; }
ok "cermin terisi: $V_MIRROR"
[ -z "$ERRS" ] || warn "sebagian resource galat: $ERRS"
ROLL_ARMED=0; STATUS=PASS; NEXT="CEK_HALAMAN_CRM"
result
