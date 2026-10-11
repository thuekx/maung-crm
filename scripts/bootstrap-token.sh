#!/usr/bin/env bash
# MAUNG CRM — bootstrap TRANSISI (sekali): satu-satunya langkah yang butuh token GitHub, karena repo private dan skrip baru
# belum ada di server. Isi file ini ditempel sebagai blok `bash <<'BOOT' ... BOOT` (lihat docs/DEPLOY.md). Setelah deploy key
# terpasang (scripts/setup-deploy-key.sh), update berikutnya TANPA token.
# Guard host & direktori → minta token (disembunyikan) → git pull --ff-only (token hanya di memori, tidak disimpan) →
# docker login ghcr.io (kredensial untuk tarik image) → lanjut ke setup-deploy-key.sh.
set -uo pipefail
APP="${CRM_DIR:-$HOME/maung-crm}"
REPO="${CRM_REPO:-https://github.com/thuekx/maung-crm.git}"
EXPECT_HOST="${EXPECT_HOST:-maung-apps}"
WO_DIR="${WO_DIR:-$HOME/Maung-Wo-Inv}"
line() { printf '%*s\n' 66 '' | tr ' ' '='; }
fail() { echo "✗ $*"; echo; line; echo "RESULT"; line; echo "status=FAIL"; echo "reason=$*"; echo "perubahan_ke_maung_wo=TIDAK"; echo "RESULT : BOOTSTRAP GAGAL — tidak ada perubahan pada Maung WO"; exit 1; }
line; echo "  MAUNG CRM — BOOTSTRAP TRANSISI  ($(date '+%F %T %Z'))"; line
echo; echo "[1/3] Guard host & direktori"
echo "  host=$(hostname)  user=$(id -un)  pwd=$PWD  target=$APP"
[ "$(hostname)" = "$EXPECT_HOST" ] || fail "HOST SALAH: ini '$(hostname)', seharusnya '$EXPECT_HOST' — pindah ke server WO (belum ada yang diubah)"
echo "  ✓ nama host sesuai"
[ "$(id -u)" != 0 ] || fail "jangan dijalankan sebagai root (dan tanpa sudo)"
echo "  ✓ bukan root"
command -v docker >/dev/null && docker info >/dev/null 2>&1 || fail "docker tidak terpasang / user '$(id -un)' tidak punya izin docker"
echo "  ✓ docker dapat diakses tanpa sudo"
[ -d "$WO_DIR/.git" ] || fail "folder Maung WO ($WO_DIR) tidak ada — bukan server WO?"
echo "  ✓ Maung WO ada di host ini (hanya diperiksa keberadaannya)"
case "$APP" in *Maung-Wo-Inv*|*maung-wo-inv*) fail "target berada di folder Maung WO — dibatalkan" ;; esac
if [ -e "$APP" ]; then
  if [ -d "$APP/.git" ] && git -C "$APP" remote get-url origin 2>/dev/null | grep -qi 'maung-crm'; then echo "  ✓ $APP = repo maung-crm → mode PEMBARUAN"; MODE=update
  elif [ -d "$APP" ] && [ -z "$(ls -A "$APP")" ]; then echo "  ✓ $APP kosong → mode INSTALASI BARU"; MODE=clone
  else fail "$APP sudah ada, berisi file lain dan bukan repo maung-crm — dihentikan, tidak ada yang diubah"; fi
else echo "  ✓ $APP belum ada → dibuat baru"; MODE=clone; fi
echo; echo "[2/3] Ambil kode terbaru (butuh token GitHub classic sekali; tidak disimpan)"
T="${GITHUB_TOKEN:-}"
if [ -z "$T" ]; then read -rsp "  Token GitHub classic (repo + read:packages; input disembunyikan): " T </dev/tty; echo; fi
[ -n "$T" ] || fail "token kosong"
AUTH="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$T" | base64 -w0)"
if [ "$MODE" = clone ]; then
  mkdir -p "$(dirname "$APP")"; git -c http.extraheader="$AUTH" clone -q "$REPO" "$APP" 2>&1 | sed 's/^/  /'
  [ -f "$APP/docker-compose.yml" ] || { rmdir "$APP" 2>/dev/null; fail "clone gagal (token salah / tanpa akses repo)"; }
else
  git -C "$APP" -c http.extraheader="$AUTH" pull -q --ff-only origin main 2>&1 | sed 's/^/  /'
  [ "${PIPESTATUS[0]}" = 0 ] || fail "git pull --ff-only gagal (token salah / riwayat lokal menyimpang)"
fi
echo "  ✓ kode siap: $(git -C "$APP" rev-parse --short HEAD)  remote=$(git -C "$APP" remote get-url origin)"
SC=$(curl -s -m 10 -D - -o /dev/null -H "Authorization: Bearer $T" https://api.github.com/user | tr -d '\r' | awk -F': ' 'tolower($1)=="x-oauth-scopes"{print $2}')
echo "  token_scopes=${SC:-(kosong/fine-grained)}"
if printf '%s' "$T" | docker login ghcr.io -u "${GHCR_USER:-thuekx}" --password-stdin >/dev/null 2>&1; then echo "  ✓ docker login ghcr.io tersimpan di ~/.docker (untuk tarik image; bila token kedaluwarsa, ulangi bootstrap ini)"; else echo "  ! docker login ghcr.io gagal — update.sh bisa gagal menarik image"; fi
case ",$(printf '%s' "$SC" | tr -d ' ')," in *,read:packages,*|*,write:packages,*) ;; *) echo "  ! token tanpa scope read:packages — pull image dapat ditolak" ;; esac
echo; echo "[3/3] Lanjut: setup deploy key (tanpa token ke depan)"
cd "$APP" || fail "tidak bisa masuk $APP"
unset T AUTH
exec bash scripts/setup-deploy-key.sh </dev/null
