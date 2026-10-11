#!/usr/bin/env bash
# MAUNG CRM — setup deploy key read-only (berfase). Setelah ini `git pull` di server tidak butuh token.
# Alur: [1] guard → [2] buat kunci ed25519 (sekali, tidak menimpa) + cetak KUNCI PUBLIK saja → pemilik menempel di
#       GitHub → thuekx/maung-crm → Settings → Deploy keys → Add deploy key (TANPA centang "Allow write access") →
#       jalankan skrip ini lagi → [3] verifikasi git ls-remote, uji read-only, alihkan remote origin ke SSH.
# Jalankan:  cd ~/maung-crm && bash scripts/setup-deploy-key.sh </dev/null
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
. "$HERE/scripts/lib.sh"
N=3; P=0; CUR=""; WARNS=()
EXPECT_HOST="${EXPECT_HOST:-maung-apps}"
APP_DIR="${APP_DIR:-$HOME/maung-crm}"
LOG_DIR="$HOME/maung-crm-logs"; mkdir -p "$LOG_DIR"; chmod 700 "$LOG_DIR"
TS=$(date +%Y%m%d-%H%M%S); LOG="$LOG_DIR/deploy-key-$TS.log"
exec > >(tee -a "$LOG") 2>&1
KEY="$HOME/.ssh/maung-crm-deploy"; ALIAS="github-maung-crm"; REPO_SSH="git@$ALIAS:thuekx/maung-crm.git"
STATUS=FAIL; REASON=""; KEY_STATE=n/a; LS=n/a; RO=n/a; REMOTE=n/a; FPR=n/a

result() {
  banner "RESULT"
  kv status "$STATUS"; kv reason "$REASON"; kv host "$(hostname)"; kv dir "$APP_DIR"
  kv deploy_key "$KEY_STATE"; kv git_ls_remote "$LS"; kv key_read_only "$RO"; kv remote_origin "$REMOTE"; kv github_fingerprint "$FPR"
  kv perubahan_ke_maung_wo TIDAK; kv token_tersimpan TIDAK; kv log "$LOG"
  for w in "${WARNS[@]:-}"; do [ -n "$w" ] && printf '  - %s\n' "$w"; done
  case "$STATUS" in
    PASS) echo "RESULT : DEPLOY KEY PASS / NEXT=cd ~/maung-crm && git pull --ff-only origin main && bash scripts/update.sh </dev/null" ;;
    WAITING_KEY) echo "RESULT : MENUNGGU KUNCI DITAMBAHKAN DI GITHUB / lalu jalankan: cd ~/maung-crm && bash scripts/setup-deploy-key.sh </dev/null" ;;
    *) echo "RESULT : GAGAL — $REASON" ;;
  esac
}
die() { bad "$*"; REASON="$*"; STATUS=FAIL; result; exit 1; }

banner "MAUNG CRM — SETUP DEPLOY KEY  ($TS)"
phase "Guard host & direktori"
echo "  host=$(hostname)  user=$(id -un)  pwd=$PWD"
[ "$(hostname)" = "$EXPECT_HOST" ] || die "HOST SALAH: ini '$(hostname)', seharusnya '$EXPECT_HOST' (tidak ada yang diubah)"
ok "nama host sesuai"
[ "$(id -u)" != 0 ] || die "jangan dijalankan sebagai root"
ok "bukan root"
[ "$HERE" = "$(cd "$APP_DIR" 2>/dev/null && pwd)" ] || die "skrip ini bukan di $APP_DIR (di $HERE)"
git -C "$HERE" remote get-url origin 2>/dev/null | grep -qi 'maung-crm' || die "remote origin bukan maung-crm"
ok "direktori = repo maung-crm di $APP_DIR ($(git -C "$HERE" rev-parse --short HEAD))"
command -v ssh-keygen >/dev/null && command -v ssh >/dev/null || die "ssh/ssh-keygen tidak terpasang"
ok "ssh tersedia"

phase "Kunci deploy (dibuat sekali; tidak pernah menimpa)"
mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
if [ -f "$KEY" ]; then KEY_STATE=ADA; ok "kunci sudah ada: $KEY (dipertahankan)"
else
  ssh-keygen -q -t ed25519 -N "" -C "maung-apps deploy key maung-crm (read-only)" -f "$KEY" || die "ssh-keygen gagal"
  chmod 600 "$KEY"; chmod 644 "$KEY.pub"; KEY_STATE=BARU; ok "kunci ed25519 baru dibuat (izin 600)"
fi
if ! grep -q "^Host $ALIAS\$" "$HOME/.ssh/config" 2>/dev/null; then
  { echo ""; echo "Host $ALIAS"; echo "  HostName github.com"; echo "  HostKeyAlias github.com"; echo "  User git"; echo "  IdentityFile $KEY"; echo "  IdentitiesOnly yes"; echo "  StrictHostKeyChecking yes"; } >> "$HOME/.ssh/config"
  chmod 600 "$HOME/.ssh/config"; ok "alias SSH '$ALIAS' ditambahkan ke ~/.ssh/config"
else ok "alias SSH '$ALIAS' sudah ada"; fi
# host key GitHub: simpan sekali, tampilkan sidik jarinya untuk dibandingkan dengan dokumentasi GitHub
if ! ssh-keygen -F github.com >/dev/null 2>&1; then
  ssh-keyscan -t ed25519 github.com 2>/dev/null >> "$HOME/.ssh/known_hosts" && ok "host key github.com disimpan" || warn "ssh-keyscan github.com gagal"
fi
FPR=$(ssh-keygen -lf <(ssh-keygen -F github.com -f "$HOME/.ssh/known_hosts" 2>/dev/null | grep -v '^#' | head -1) 2>/dev/null | awk '{print $2}')
echo "  sidik jari host key github.com (bandingkan dengan docs.github.com → 'GitHub's SSH key fingerprints'): ${FPR:-tidak terbaca}"
[ "$FPR" = "SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU" ] && ok "cocok dengan sidik jari ED25519 GitHub yang saya ketahui" || warn "sidik jari tidak cocok dengan yang saya ketahui — verifikasi manual di docs.github.com sebelum mempercayai"

phase "Verifikasi akses read-only & alihkan remote ke SSH"
GSSH="ssh -i $KEY -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes"
if GIT_SSH_COMMAND="$GSSH" git ls-remote git@github.com:thuekx/maung-crm.git HEAD >/dev/null 2>&1; then LS=OK; ok "git ls-remote lewat deploy key berhasil"
else
  LS=BELUM
  echo; echo "  KUNCI PUBLIK (salin SELURUH satu baris ini):"; echo; sed 's/^/    /' "$KEY.pub"; echo
  echo "  Langkah di GitHub (browser):"
  echo "    1. buka https://github.com/thuekx/maung-crm → Settings → Deploy keys → Add deploy key"
  echo "    2. Title: maung-apps   |   Key: tempel kunci publik di atas"
  echo "    3. JANGAN centang 'Allow write access'   →   Add key"
  echo "    4. lalu jalankan lagi: cd ~/maung-crm && bash scripts/setup-deploy-key.sh </dev/null"
  STATUS=WAITING_KEY; REASON="kunci publik belum ditambahkan di GitHub"; result; exit 2
fi
# uji read-only: push --dry-run harus DITOLAK (kunci tanpa hak tulis). Tidak ada yang benar-benar dikirim.
PUSHOUT=$(GIT_SSH_COMMAND="$GSSH" git -C "$HERE" push --dry-run git@github.com:thuekx/maung-crm.git HEAD:refs/heads/zz-uji-readonly 2>&1); PRC=$?
if [ "$PRC" != 0 ] && echo "$PUSHOUT" | grep -qiE "read-only|permission|denied|not allowed|403"; then RO=YA; ok "kunci TIDAK punya hak tulis (uji push --dry-run ditolak)"
elif [ "$PRC" = 0 ]; then RO=TIDAK; warn "kunci tampaknya BOLEH menulis — hapus centang 'Allow write access' pada Deploy key di GitHub"
else RO=TIDAK_PASTI; warn "uji read-only tidak konklusif: $(echo "$PUSHOUT" | tail -1 | cut -c1-120)"; fi
[ "$RO" = TIDAK ] && die "deploy key punya hak tulis — hapus centang 'Allow write access' di GitHub (Settings → Deploy keys), lalu ulangi (remote belum diubah)"
git -C "$HERE" remote set-url origin "$REPO_SSH" || die "gagal mengalihkan remote origin"
REMOTE=$(git -C "$HERE" remote get-url origin)
GIT_SSH_COMMAND="$GSSH" git -C "$HERE" fetch -q origin main && ok "git fetch origin main lewat SSH berhasil" || die "git fetch lewat SSH gagal setelah remote dialihkan"
ok "remote origin = $REMOTE (tanpa token tersimpan)"
STATUS=PASS; result
