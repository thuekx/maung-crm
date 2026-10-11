# Pustaka bersama skrip server maung-crm (di-source oleh scripts/*.sh). Format keluaran mengikuti konvensi pemilik.
line() { printf '%*s\n' 66 '' | tr ' ' '='; }
banner() { printf '\n'; line; printf '  %s\n' "$1"; line; }
phase() { P=$((P+1)); CUR="$1"; printf '\n[%s/%s] %s\n' "$P" "$N" "$1"; }
ok() { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; WARNS+=("$*"); }
bad() { printf '  ✗ %s\n' "$*"; }
kv() { printf '%s=%s\n' "$1" "${2:--}"; }
