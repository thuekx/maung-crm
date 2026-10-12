#!/usr/bin/env bash
# MAUNG CRM — diagnosa jalur /crm (BACA-SAJA: tidak mengubah apa pun di CRM maupun WO). Menjawab "kenapa /crm masih 404?".
# Jalankan:  cd ~/maung-crm && git pull --ff-only origin main && bash scripts/check-route.sh </dev/null
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
. "$HERE/scripts/lib.sh"
N=5; P=0; CUR=""; WARNS=()
EXPECT_HOST="${EXPECT_HOST:-maung-apps}"
WO_DIR="${WO_DIR:-$HOME/Maung-Wo-Inv}"
LOG_DIR="$HOME/maung-crm-logs"; mkdir -p "$LOG_DIR"; chmod 700 "$LOG_DIR"
TS=$(date +%Y%m%d-%H%M%S); LOG="$LOG_DIR/check-route-$TS.log"
exec > >(tee -a "$LOG") 2>&1
cd "$HERE" || exit 1
dc() { docker compose "$@"; }
http() { curl -s -o /dev/null -m 15 -w '%{http_code}' "$1" 2>/dev/null || echo 000; }
hdr() { curl -s -m 15 -D - -o /dev/null "$1" 2>/dev/null | tr -d '\r' | grep -iE "^(server|x-powered-by|content-type|location):" | tr '\n' ' ' | cut -c1-200; }
cid() { dc ps -aq "$1" 2>/dev/null | head -1; }
hstat() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || echo none; }
STATUS=FAIL; REASON=""; NEXT=""
S_CRMAPI=n/a; S_CRMWEB=n/a; S_EDGE=n/a; S_FILE=n/a; S_SAME=n/a; S_CADDY_FILE=n/a; S_CADDY_IMPORT=n/a; H_CRM=n/a; H_API=n/a; H_LOGIN=n/a; H_BRAND=n/a
result() {
  banner "RESULT"
  kv status "$STATUS"; kv host "$(hostname)"
  kv crm_api "$S_CRMAPI"; kv crm_web "$S_CRMWEB"; kv crm_di_maung_edge "$S_EDGE"
  kv wo_proxy_apps_crm_caddy "$S_FILE"; kv isi_sama_dengan_deploy_crm_caddy "$S_SAME"
  kv caddy_memuat_berkas_di_container "$S_CADDY_FILE"; kv caddy_import_apps_di_Caddyfile "$S_CADDY_IMPORT"
  kv https_crm "$H_CRM"; kv https_crm_api_health "$H_API"; kv wo_login "$H_LOGIN"; kv wo_api_branding "$H_BRAND"
  kv perubahan_ke_sistem TIDAK_ADA; kv log "$LOG"
  for w in "${WARNS[@]:-}"; do [ -n "$w" ] && printf '  - %s\n' "$w"; done
  echo "RESULT : DIAGNOSA ${STATUS} / NEXT=${NEXT:-tidak-ada}"
}
fail() { bad "$*"; REASON="$*"; STATUS=FAIL; result; exit 1; }

banner "MAUNG CRM — DIAGNOSA JALUR /crm  ($TS)  [baca-saja]"
phase "Guard"
echo "  host=$(hostname)  user=$(id -un)"
[ "$(hostname)" = "$EXPECT_HOST" ] || fail "HOST SALAH: ini '$(hostname)', seharusnya '$EXPECT_HOST'"
[ "$(id -u)" != 0 ] || fail "jangan dijalankan sebagai root"
docker info >/dev/null 2>&1 || fail "docker tidak dapat diakses user ini"
[ -f "$HERE/.env" ] || fail ".env CRM tidak ada — jalankan scripts/update.sh dulu"
WO_URL=$(grep -m1 '^WO_URL=' "$HERE/.env" | cut -d= -f2- | tr -d "'\"")
[ -n "$WO_URL" ] || fail "WO_URL kosong di .env CRM"
ok "guard lolos (WO_URL=$WO_URL)"

phase "Container CRM"
a=$(cid crm-api); w=$(cid crm-web)
S_CRMAPI=$([ -n "$a" ] && hstat "$a" || echo tidak-ada); S_CRMWEB=$([ -n "$w" ] && hstat "$w" || echo tidak-ada)
echo "  crm-api=$S_CRMAPI  crm-web=$S_CRMWEB"
if [ "$S_CRMAPI" = healthy ] && [ "$S_CRMWEB" = healthy ]; then ok "crm-api & crm-web healthy"; else warn "container CRM tidak sehat → jalankan: cd ~/maung-crm && bash scripts/update.sh </dev/null (cetak DIAGNOSIS)"; NEXT="PERBAIKI_CONTAINER_CRM(update.sh)"; fi
nn=""; [ -n "$a" ] && nn=$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$a" 2>/dev/null)
echo "$nn" | grep -qw maung_edge && { S_EDGE=ya; ok "crm-api di jaringan maung_edge"; } || { S_EDGE=TIDAK; warn "crm-api TIDAK di maung_edge"; }

phase "Jalur di sisi WO (baca-saja)"
F="$WO_DIR/proxy/apps/crm.caddy"
norm() { sed 's/#.*//' "$1" | tr -s ' \t' ' ' | sed 's/^ //; s/ $//' | grep -v '^$'; }
if [ -f "$F" ]; then S_FILE=ada; ok "berkas $F ada"
  if cmp -s "$F" "$HERE/deploy/crm.caddy"; then S_SAME="ya (identik)"; ok "isinya identik dengan deploy/crm.caddy"
  elif [ "$(norm "$F")" = "$(norm "$HERE/deploy/crm.caddy")" ]; then S_SAME="ya (aturan sama; hanya komentar/spasi berbeda)"; ok "aturan identik dengan deploy/crm.caddy (hanya komentar berbeda — tidak berpengaruh)"
  else S_SAME="BEDA-ATURAN"; warn "ATURAN berbeda dari deploy/crm.caddy (diubah manual / versi lama) — pasang ulang: cd ~/Maung-Wo-Inv && bash scripts/app-route.sh add crm </dev/null"; fi
else S_FILE=TIDAK-ADA; warn "proxy/apps/crm.caddy belum ada di $WO_DIR — jalur belum dipasang"; fi
ls "$WO_DIR/proxy/apps" 2>/dev/null | sed 's/^/    proxy\/apps: /'
cc=$(docker ps -q --filter "label=com.docker.compose.project=maung-wo-inv" --filter "label=com.docker.compose.service=caddy" | head -1)
if [ -n "$cc" ]; then
  if docker exec "$cc" ls /etc/caddy/apps 2>/dev/null | grep -qx 'crm.caddy'; then S_CADDY_FILE=ya; else S_CADDY_FILE=TIDAK; fi
  imp=$(docker exec "$cc" grep -c 'import /etc/caddy/apps/' /etc/caddy/Caddyfile 2>/dev/null | tr -dc '0-9'); S_CADDY_IMPORT="${imp:-0} baris"
  echo "  di container Caddy WO: crm.caddy terpasang=$S_CADDY_FILE; Caddyfile aktif punya $S_CADDY_IMPORT 'import /etc/caddy/apps/'"
else warn "container Caddy WO tidak ditemukan"; fi

phase "HTTP publik"
H_CRM=$(http "$WO_URL/crm"); H_API=$(http "$WO_URL/crm/api/health"); H_LOGIN=$(http "$WO_URL/login"); H_BRAND=$(http "$WO_URL/api/branding")
echo "  /crm=$H_CRM  /crm/api/health=$H_API  | WO: /login=$H_LOGIN /api/branding=$H_BRAND"
echo "  header /crm: $(hdr "$WO_URL/crm")"

phase "Diagnosa"
if [ "$H_API" = 200 ] && [ "$H_CRM" = 200 ]; then STATUS=PASS; NEXT="UJI_MANUAL_PEMILIK (login WO → /apps → ikon CRM)"; ok "jalur /crm bekerja (Caddy → crm-web & crm-api)"
elif [ -n "$NEXT" ]; then REASON="container CRM bermasalah"; bad "$REASON"
elif [ "$S_FILE" != ada ]; then REASON="jalur belum dipasang di Caddy WO (404 berasal dari aplikasi WO)"; NEXT="cd ~/Maung-Wo-Inv && bash scripts/app-route.sh add crm </dev/null"; bad "$REASON"
elif [ "$S_CADDY_FILE" != ya ]; then REASON="berkas ada di repo WO tetapi belum dimuat container Caddy (reload belum jalan)"; NEXT="cd ~/Maung-Wo-Inv && bash scripts/app-route.sh add crm </dev/null (ulang; skrip melakukan reload + bukti)"; bad "$REASON"
elif [ "${S_CADDY_IMPORT%% *}" = 0 ]; then REASON="Caddyfile aktif WO belum memuat 'import /etc/caddy/apps/*.caddy' (WO belum diperbarui/dideploy)"; NEXT="minta sesi WO: update WO (update-safe.sh) lalu app-route.sh add crm"; bad "$REASON"
else REASON="jalur terpasang tetapi /crm tidak 200 (crm=$H_CRM health=$H_API) — periksa log Caddy WO / aturan handle"; NEXT="kirim blok RESULT ini ke sesi WO (docker compose logs caddy | tail)"; bad "$REASON"; fi
[ "$H_LOGIN" = 200 ] && [ "$H_BRAND" = 200 ] || warn "WO sendiri tidak 200 (login=$H_LOGIN branding=$H_BRAND)"
result
[ "$STATUS" = PASS ]
