#!/usr/bin/env bash
# MAUNG CRM — cek penawaran di CRM vs di WO (BACA-SAJA; tidak mengubah apa pun di CRM maupun WO). Untuk uji SENT → ACCEPTED → order WO (WO-SO-…).
# Jalankan:  cd ~/maung-crm && bash scripts/check-quotation-wo.sh            (5 penawaran terbaru)
#            cd ~/maung-crm && bash scripts/check-quotation-wo.sh QT-026-0001 (satu nomor penawaran)
# Kunci integrasi dipakai di DALAM container crm-api; nilainya tidak pernah dicetak.
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
. "$HERE/scripts/lib.sh"
N=3; P=0; CUR=""; WARNS=()
EXPECT_HOST="${EXPECT_HOST:-maung-apps}"
LOG_DIR="$HOME/maung-crm-logs"; mkdir -p "$LOG_DIR"; chmod 700 "$LOG_DIR"
TS=$(date +%Y%m%d-%H%M%S); LOG="$LOG_DIR/check-quotation-wo-$TS.log"
exec > >(tee -a "$LOG") 2>&1
cd "$HERE" || exit 1
FILTER="${1:-}"
STATUS=FAIL; REASON=""; NEXT=""; N_ALL=0; N_OK=0; N_ORDER=0; N_PROBLEM=0
dc() { docker compose "$@"; }
result() {
  banner "RESULT"
  kv status "$STATUS"; kv reason "${REASON:--}"; kv host "$(hostname)"; kv filter "${FILTER:-5 terbaru}"
  kv penawaran_diperiksa "$N_ALL"; kv ada_di_wo "$N_OK"; kv order_wo_terbentuk "$N_ORDER"; kv bermasalah "$N_PROBLEM"
  kv kunci_dicetak TIDAK; kv perubahan_ke_sistem TIDAK_ADA; kv log "$LOG"
  for w in "${WARNS[@]:-}"; do [ -n "$w" ] && printf '  - %s\n' "$w"; done
  echo "RESULT : CEK PENAWARAN-WO ${STATUS} / NEXT=${NEXT:-tidak-ada}"
}
fail() { bad "$*"; REASON="$*"; STATUS=FAIL; result; exit 1; }

banner "MAUNG CRM — CEK PENAWARAN DI CRM vs WO  ($TS)  [baca-saja]"
phase "Guard"
echo "  host=$(hostname)  user=$(id -un)"
[ "$(hostname)" = "$EXPECT_HOST" ] || fail "HOST SALAH: ini '$(hostname)', seharusnya '$EXPECT_HOST'"
[ "$(id -u)" != 0 ] || fail "jangan dijalankan sebagai root"
docker info >/dev/null 2>&1 || fail "docker tidak dapat diakses user ini"
[[ "$FILTER" =~ ^[A-Za-z0-9-]*$ ]] || fail "filter hanya boleh huruf/angka/tanda minus (contoh: QT-026-0001)"
[ -n "$(dc ps -q crm-api 2>/dev/null)" ] || fail "container crm-api tidak berjalan — jalankan scripts/update.sh"
ok "guard lolos"

phase "Penawaran di CRM"
q() { dc exec -T postgres psql -U crm -d maung_crm -Atc "$1" 2>/dev/null | tr -d '\r'; }
CNT=$(q "SELECT count(*) FROM quotations WHERE deleted_at IS NULL"); CNT="${CNT:-x}"
[[ "$CNT" =~ ^[0-9]+$ ]] || fail "tabel penawaran tidak terbaca dari database CRM — jalankan dulu: cd ~/maung-crm && git pull --ff-only origin main && bash scripts/update.sh </dev/null"
if [ "$CNT" = 0 ]; then
  STATUS=BELUM_ADA; NEXT="BUAT_PENAWARAN_UJI"
  ok "database CRM sehat, tetapi BELUM ADA penawaran sama sekali (wajar sebelum uji)"
  echo "  Langkah (di CRM, akun Marketing): Lead non-internet → Buat penawaran (alamat & telepon valid) → Ajukan → (Manager) Setujui → Tandai terkirim → Pelanggan menyetujui."
  echo "  Beri nama pelanggan uji yang jelas (mis. \"UJI CRM-WO\"); order uji di WO dibatalkan sesudahnya. Lalu jalankan skrip ini lagi."
  result; exit 0
fi
ROWS=$(q "SELECT id||'|'||number||'|rev'||rev||'|'||status||'|WO:'||COALESCE(wo_synced_status,'-')||' rev'||COALESCE(wo_synced_rev::text,'-')||'|'||COALESCE(wo_number,'-')||'|'||marketing FROM (SELECT id, number, rev, status, wo_synced_status, wo_synced_rev, wo_number, owner_name||' ('||owner_id||')' AS marketing FROM quotations WHERE deleted_at IS NULL AND ('${FILTER}'='' OR number='${FILTER}') ORDER BY id DESC LIMIT 5) t")
[ -n "$ROWS" ] || fail "tidak ada penawaran ${FILTER:+bernomor $FILTER}"
echo "  id|nomor|rev|status CRM|terakhir terkirim ke WO|nomor order WO (tersimpan di CRM)|marketing"
printf '%s\n' "$ROWS" | sed 's/^/  /'
ok "$(printf '%s\n' "$ROWS" | wc -l) penawaran dibaca dari database CRM"

phase "Tanya WO (GET /api/integrations/crm/quotations/:crmId, baca-saja)"
while IFS='|' read -r id number rev status wo ordno mkt; do
  [ -n "$id" ] || continue
  N_ALL=$((N_ALL+1))
  case "$status" in DRAFT|PENDING_APPROVAL|APPROVED) echo "  - $number ($status): belum dikirim ke WO (dikirim saat Terkirim) — dilewati"; N_ALL=$((N_ALL-1)); continue ;; esac
  r=$(dc exec -T crm-api node -e "fetch(process.env.WO_URL+'/api/integrations/crm/quotations/quotation-$id',{headers:{'x-api-key':process.env.CRM_INTEGRATION_KEY||''},signal:AbortSignal.timeout(20000)}).then(async r=>{const d=await r.json().catch(()=>({}));console.log(r.status+' '+(d.status||'-')+' rev'+(d.rev||'-')+' '+(d.woNumber||'-'))}).catch(()=>console.log('ERR - - -'))" 2>/dev/null | tr -d '\r\n')
  set -- $r; code="${1:-ERR}"; wst="${2:--}"; wrev="${3:--}"; won="${4:--}"
  case "$code" in
    200) N_OK=$((N_OK+1)); echo "  ✓ $number: ada di WO — status WO=$wst $wrev, order=$won"
         if [ "$status" = ACCEPTED ]; then if [ "$won" != "-" ]; then N_ORDER=$((N_ORDER+1)); ok "$number: order WO terbentuk ($won)"; else N_PROBLEM=$((N_PROBLEM+1)); warn "$number: DITERIMA tetapi WO belum membentuk order — tunggu 1–2 menit (antrean kirim) lalu cek ulang; bila tetap '-' hubungi admin WO"; fi; fi ;;
    404) N_PROBLEM=$((N_PROBLEM+1)); warn "$number ($status): TIDAK ada di WO — belum terkirim (cek CRM → Dashboard → Kirim ke WO; kunci integrasi?)" ;;
    401) N_PROBLEM=$((N_PROBLEM+1)); warn "$number: WO menolak kunci integrasi (401) — nilai CRM_INTEGRATION_KEY harus sama dengan di WO" ;;
    503) N_PROBLEM=$((N_PROBLEM+1)); warn "$number: integrasi nonaktif di WO (503)" ;;
    *) N_PROBLEM=$((N_PROBLEM+1)); warn "$number: jawaban WO tak terduga ($code)" ;;
  esac
done <<EOT
$ROWS
EOT
[ "$N_ALL" -gt 0 ] || { warn "tidak ada penawaran berstatus Terkirim/Diterima/… untuk dicek di WO"; NEXT="KIRIM_PENAWARAN_UJI(Terkirim)"; }
if [ "$N_PROBLEM" = 0 ]; then STATUS=PASS; [ -n "$NEXT" ] || NEXT=CEK_ORDER_DI_WO_UI; ok "tidak ada masalah"; else STATUS=ATTENTION; NEXT="PERIKSA_PERINGATAN_DI_ATAS"; fi
result
