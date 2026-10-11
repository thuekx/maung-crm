#!/usr/bin/env bash
# Bootstrap maung-crm di server WO: guard host/direktori → ambil kode (butuh token GitHub classic) → jalankan deploy/install.sh.
# Dipakai dengan menempel blok `bash <<'BOOT' ... BOOT` (lihat docs/DEPLOY.md); salinan ini = isi blok tersebut.
set -uo pipefail
APP="${CRM_DIR:-$HOME/maung-crm}"
REPO="${CRM_REPO:-https://github.com/thuekx/maung-crm.git}"
export CRM_EXPECT_HOST="${CRM_EXPECT_HOST:-maung-apps}"
line() { printf '%*s\n' 60 '' | tr ' ' '='; }
fail() { echo "✗ $*"; echo; line; echo "RESULT : BOOTSTRAP GAGAL — tidak ada perubahan (Maung WO tidak disentuh)"; exit 1; }
line; echo "MAUNG-CRM BOOTSTRAP"; echo "$(date '+%F %T %Z')"; line
echo; echo "[1/3] Guard host & direktori"
echo "host=$(hostname)  diharapkan=$CRM_EXPECT_HOST"
[ "$(hostname)" = "$CRM_EXPECT_HOST" ] || fail "HOST SALAH: ini '$(hostname)', seharusnya '$CRM_EXPECT_HOST' — pindah ke server WO (belum ada yang diubah)"
echo "✓ nama host sesuai"
command -v docker >/dev/null || fail "docker tidak terpasang di host ini"
docker info >/dev/null 2>&1 || fail "user '$(id -un)' tidak punya izin docker di host ini"
echo "✓ docker dapat diakses"
[ -d "$HOME/Maung-Wo-Inv/.git" ] || fail "folder Maung WO ($HOME/Maung-Wo-Inv) tidak ada — bukan server WO?"
echo "✓ Maung WO ada di host ini ($HOME/Maung-Wo-Inv)"
echo "cwd=$PWD"; echo "target=$APP"
case "$APP" in *Maung-Wo-Inv*|*maung-wo-inv*) fail "target berada di folder Maung WO — dibatalkan" ;; esac
if [ -e "$APP" ]; then
  if [ -d "$APP/.git" ] && git -C "$APP" remote get-url origin 2>/dev/null | grep -qi 'maung-crm'; then
    echo "✓ $APP sudah berisi repo maung-crm → mode PEMBARUAN"; MODE=update
  elif [ -d "$APP" ] && [ -z "$(ls -A "$APP")" ]; then
    echo "✓ $APP ada dan kosong → mode INSTALASI BARU"; MODE=clone
  else fail "$APP sudah ada, berisi file lain dan bukan repo maung-crm — dihentikan, tidak ada yang diubah"; fi
else
  echo "✓ $APP belum ada → dibuat baru"; MODE=clone
fi
echo; echo "[2/3] Ambil kode (repo private: butuh token GitHub classic sekali)"
T="${GITHUB_TOKEN:-}"
if [ -z "$T" ]; then read -rsp "Token GitHub classic (repo + read:packages, input disembunyikan): " T </dev/tty; echo; fi
[ -n "$T" ] || fail "token kosong"
AUTH="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$T" | base64 -w0)"
if [ "$MODE" = clone ]; then
  mkdir -p "$(dirname "$APP")"
  git -c http.extraheader="$AUTH" clone -q "$REPO" "$APP" 2>&1 | sed 's/^/  /'
  [ -f "$APP/docker-compose.yml" ] || { rmdir "$APP" 2>/dev/null; fail "clone gagal (token salah / tanpa akses repo)"; }
  echo "✓ clone selesai"
else
  git -C "$APP" -c http.extraheader="$AUTH" pull -q --ff-only origin main 2>&1 | sed 's/^/  /'
  echo "✓ pembaruan selesai"
fi
echo "head=$(git -C "$APP" rev-parse --short HEAD)  remote=$(git -C "$APP" remote get-url origin)"
echo; echo "[3/3] Jalankan installer berfase"
cd "$APP" || fail "tidak bisa masuk $APP"
GHCR_TOKEN="$T" exec bash deploy/install.sh ${CRM_ARGS:-}
