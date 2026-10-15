#!/usr/bin/env bash
# MAUNG CRM — diagnosa "Maung WO tidak dapat dihubungi" (BACA-SAJA: tidak mengubah apa pun di CRM maupun WO).
# CRM memvalidasi setiap login lewat GET {WO_URL}/api/auth/me dari DALAM container crm-api; skrip ini menguji jalur itu.
# Jalankan:  cd ~/maung-crm && git pull --ff-only origin main && bash scripts/check-wo-auth.sh </dev/null
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
. "$HERE/scripts/lib.sh"
N=5; P=0; CUR=""; WARNS=()
EXPECT_HOST="${EXPECT_HOST:-maung-apps}"
LOG_DIR="$HOME/maung-crm-logs"; mkdir -p "$LOG_DIR"; chmod 700 "$LOG_DIR"
TS=$(date +%Y%m%d-%H%M%S); LOG="$LOG_DIR/check-wo-auth-$TS.log"
exec > >(tee -a "$LOG") 2>&1
cd "$HERE" || exit 1
dc() { docker compose "$@"; }
STATUS=FAIL; NEXT=""
WO_URL_V=n/a; S_API=n/a; IN_DNS=n/a; IN_ME=n/a; IN_MS=n/a; IN_ERR=n/a; IN_LOOP=n/a; HOST_ME=n/a; HOST_LOCAL=n/a; LOG_HITS=n/a; WO_CT=n/a
result() {
  banner "RESULT"
  kv status "$STATUS"; kv host "$(hostname)"
  kv wo_url "$WO_URL_V"; kv crm_api "$S_API"
  kv dari_crm_api_dns "$IN_DNS"; kv dari_crm_api_auth_me "$IN_ME"; kv dari_crm_api_ms "$IN_MS"; kv dari_crm_api_galat "$IN_ERR"
  kv dari_crm_api_5x_berturut "$IN_LOOP"; kv dari_host_auth_me "$HOST_ME"; kv dari_host_lokal_auth_me "$HOST_LOCAL"
  kv log_crm_api_24jam_galat_auth "$LOG_HITS"; kv container_wo "$WO_CT"
  kv perubahan_ke_sistem TIDAK_ADA; kv log "$LOG"
  for w in "${WARNS[@]:-}"; do [ -n "$w" ] && printf '  - %s\n' "$w"; done
  echo "RESULT : DIAGNOSA ${STATUS} / NEXT=${NEXT:-kirim-blok-RESULT-ke-Claude}"
}
fail() { bad "$*"; STATUS=FAIL; result; exit 1; }

banner "MAUNG CRM — DIAGNOSA CRM → WO /api/auth/me  ($TS)  [baca-saja]"
phase "Guard"
echo "  host=$(hostname)  user=$(id -un)"
[ "$(hostname)" = "$EXPECT_HOST" ] || fail "HOST SALAH: ini '$(hostname)', seharusnya '$EXPECT_HOST'"
[ "$(id -u)" != 0 ] || fail "jangan dijalankan sebagai root"
docker info >/dev/null 2>&1 || fail "docker tidak dapat diakses user ini"
[ -f "$HERE/.env" ] || fail ".env CRM tidak ada"
ok "lokasi $HERE"

phase "Container crm-api & WO_URL"
CID=$(dc ps -q crm-api 2>/dev/null | head -1)
[ -n "$CID" ] || fail "container crm-api tidak berjalan"
S_API=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}} sejak {{.State.StartedAt}}' "$CID" 2>/dev/null | cut -c1-60)
WO_URL_V=$(docker exec "$CID" printenv WO_URL 2>/dev/null)   # alamat, bukan rahasia
[ -n "$WO_URL_V" ] || fail "WO_URL kosong di crm-api"
ok "crm-api $S_API"; ok "WO_URL=$WO_URL_V"
WO_CT=$(docker ps -a --format '{{.Names}}:{{.Status}}' | grep -iE 'maung-wo-inv' | sed 's/ (healthy)/+h/;s/  */_/g' | tr '\n' ' ' | cut -c1-300)
echo "  WO: ${WO_CT:-tidak ditemukan}"

phase "Dari DALAM crm-api ke WO (jalur yang dipakai login CRM)"
# tanpa token: WO yang sehat menjawab 401 JSON. Tidak ada token/kunci yang dikirim atau dicetak.
OUT=$(docker exec "$CID" node -e '
const u=process.env.WO_URL.replace(/\/$/,""); const h=new URL(u).hostname;
const dns=require("dns").promises;
(async()=>{
  let d="-"; try{ d=(await dns.lookup(h,{all:true})).map(a=>a.address).join(","); }catch(e){ d="GAGAL:"+(e.code||e.message); }
  const one=async()=>{ const t=Date.now(); try{ const r=await fetch(u+"/api/auth/me",{signal:AbortSignal.timeout(10000)}); const ct=r.headers.get("content-type")||"-"; return [r.status+"("+ct.split(";")[0]+")",Date.now()-t,"-"]; }catch(e){ return ["000",Date.now()-t,(e.name==="TimeoutError"?"timeout":(e.cause&&e.cause.code)||e.message).toString().slice(0,80)]; } };
  const a=await one(); const loop=[]; for(let i=0;i<5;i++) loop.push((await one())[0].split("(")[0]);
  console.log([d,a[0],a[1],a[2],loop.join("/")].join("|"));
})();' 2>&1 | tail -1)
IFS='|' read -r IN_DNS IN_ME IN_MS IN_ERR IN_LOOP <<<"$OUT"
echo "  dns=$IN_DNS  auth/me=$IN_ME  ${IN_MS}ms  galat=$IN_ERR  5x=$IN_LOOP"

phase "Dari host VM (pembanding)"
HOST_ME=$(curl -s -o /dev/null -m 15 -w '%{http_code} %{time_total}s ip=%{remote_ip}' "$WO_URL_V/api/auth/me" 2>/dev/null || echo 000)
H=$(printf '%s' "$WO_URL_V" | sed -E 's#^[a-z]+://##; s#[/:].*$##')
HOST_LOCAL=$(curl -s -o /dev/null -m 15 --resolve "$H:443:127.0.0.1" -w '%{http_code}' "$WO_URL_V/api/auth/me" 2>/dev/null || echo 000)
echo "  lewat IP publik: $HOST_ME"
echo "  lewat Caddy lokal (127.0.0.1): $HOST_LOCAL"

phase "Log crm-api 24 jam terakhir"
HITS=$(dc logs --since 24h crm-api 2>/dev/null | grep -iE 'auth/me|\[auth\]|ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|UND_ERR' | tail -15)
LOG_HITS=$(printf '%s' "$HITS" | grep -c . || true)
[ -n "$HITS" ] && printf '%s\n' "$HITS" | cut -c1-220 | sed 's/^/  /' || ok "tidak ada catatan galat auth"

case "$IN_ME" in
  401*) if [ "$IN_LOOP" = "401/401/401/401/401" ]; then STATUS=PASS; NEXT="jalur-sehat-saat-ini-kirim-RESULT"; else STATUS=WARN; warn "jawaban WO tidak stabil: $IN_LOOP"; fi ;;
  000)  STATUS=FAIL; warn "crm-api tidak bisa menjangkau $WO_URL_V ($IN_ERR)" ;;
  *)    STATUS=FAIL; warn "WO menjawab $IN_ME, seharusnya 401 untuk permintaan tanpa token" ;;
esac
result
