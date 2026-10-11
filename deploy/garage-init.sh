#!/usr/bin/env bash
# Inisialisasi Garage SEKALI setelah `docker compose up -d`: layout node, bucket, dan kunci akses.
# Hasilnya (S3_ACCESS_KEY / S3_SECRET_KEY) dicetak; salin ke .env lalu `docker compose up -d api`.
set -euo pipefail
cd "$(dirname "$0")/.."
G="docker compose exec -T garage /garage"
BUCKET="${S3_BUCKET:-crm-photos}"

for i in $(seq 1 20); do $G status >/dev/null 2>&1 && break || sleep 2; done
NODE=$($G status | awk '/^[0-9a-f]{16}/{print $1; exit}')
[ -n "$NODE" ] || { echo "ID node Garage tidak terbaca"; exit 1; }

if ! $G layout show 2>/dev/null | grep -q "$NODE"; then
  $G layout assign -z dc1 -c 10G "$NODE"
  $G layout apply --version 1
fi
$G bucket create "$BUCKET" 2>/dev/null || true
OUT=$($G key create crm-key 2>&1 || true)
echo "$OUT"
$G bucket allow --read --write --owner "$BUCKET" --key crm-key
echo
echo ">> Salin Key ID dan Secret key di atas ke .env sebagai S3_ACCESS_KEY dan S3_SECRET_KEY,"
echo ">> lalu jalankan: docker compose up -d api"
