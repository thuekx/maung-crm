#!/bin/bash
# Uji alur skrip server (scripts/update.sh, scripts/setup-deploy-key.sh) dengan docker/curl/ssh/git TIRUAN yang stateful.
# Membuktikan logika guard, bukti, backup, rollback, dan penyamaran secret — BUKAN pengganti uji di server asli.
# Bila dijalankan sebagai root, skrip diuji sebagai user `nobody` (karena skrip menolak root); selain itu langsung.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
S=$(mktemp -d /tmp/crm-script-tests.XXXXXX); chmod 755 $S; [ "${KEEP:-0}" = 1 ] || trap 'rm -rf $S' EXIT
cp -r "$HERE/bin" "$S/bin"; cp -r "$HERE/bin-ssh" "$S/bin-ssh"; chmod -R a+rX $S
own() { [ "$(id -u)" = 0 ] && chown -R nobody:nogroup "$@"; return 0; }
as_user() { if [ "$(id -u)" = 0 ]; then su -s /bin/bash nobody -c "$1"; else bash -c "$1"; fi; }
chk() { if eval "$2"; then echo "   ✓ $1"; PASS=$((PASS+1)); else echo "   ✗ $1   [$2]"; FAILC=$((FAILC+1)); fi; }
rm -rf $S/maung-crm.git; git clone -q --bare "$REPO" $S/maung-crm.git; chmod -R a+rX $S/maung-crm.git; git config --global --add safe.directory "*" 2>/dev/null
HEAD=$(git -C "$REPO" rev-parse HEAD)
RC=0
(
PASS=0; FAILC=0
chk() { if eval "$2"; then echo "   ✓ $1"; PASS=$((PASS+1)); else echo "   ✗ $1   [$2]"; FAILC=$((FAILC+1)); fi; }
setup() { # setup <nama>
  H=$S/home-$1; STUB=$S/stub-$1; rm -rf $H $STUB; mkdir -p $H $STUB $H/Maung-Wo-Inv
  git clone -q $S/maung-crm.git $H/maung-crm; cp -r "$REPO/scripts/." "$H/maung-crm/scripts/"; cp "$REPO/docker-compose.yml" "$REPO/.env.example" "$H/maung-crm/"; cp -r "$REPO/deploy/." "$H/maung-crm/deploy/"  # uji berkas kerja saat ini (di CI = isi commit)
  git -C $H/Maung-Wo-Inv init -q; printf 'WEB_DOMAIN=maung.liv.net.id\nJWT_SECRET=RAHASIA_WO\n' > $H/Maung-Wo-Inv/.env
  printf 'wo-api-1 aaa running\nwo-web-1 bbb running\nwo-caddy-1 ccc running\n' > $STUB/wo_ids
  cat > $H/maung-crm/.env <<EOT
POSTGRES_PASSWORD=pgpass_asli_123
WO_URL=https://maung.liv.net.id
FILE_SIGN_SECRET=signsecret_asli
GARAGE_RPC_SECRET=rpcsecret_asli
S3_BUCKET=crm-photos
S3_ACCESS_KEY=GKlama
S3_SECRET_KEY=skLama_rahasia
IMAGE_TAG=0c467c861404dc1076d3f501fc2a1b262e56c5ef
WEB_PORT=3100
CRM_DOMAIN=
EOT
  chmod 600 $H/maung-crm/.env; cp $H/maung-crm/.env $S/env-asli-$1
  mkdir -p $H/maung-crm-logs/state; own $H $STUB; chmod 755 $H
  as_user "HOME=$H git config --global --add safe.directory '*'"
}
run() { # run <nama> [ENV=...]
  local n=$1; shift; local t0=$(date +%s)
  as_user "cd $S/home-$n/maung-crm && HOME=$S/home-$n STUB=$S/stub-$n PATH=$S/bin:\$PATH EXPECT_HOST=\${EXPECT_HOST_OVERRIDE:-$(hostname)} WAIT_API=4 WAIT_WEB=4 WAIT_BACK=4 POLL_INTERVAL=1 $* bash scripts/update.sh </dev/null" > $S/out-$n.txt 2>&1; echo $? > $S/rc-$n; echo "   (waktu: $(( $(date +%s) - t0 ))s)"
}
has() { grep -qF -- "$2" $S/out-$1.txt; }
calls() { grep -qF -- "$2" $S/stub-$1/calls.log; }
ncalls() { grep -cF -- "$2" $S/stub-$1/calls.log; }

echo "### S1 migrasi sukses dari CRM uji lama (Caddy belum dipasang)"; setup s1; run s1
chk "exit 0, status=PASS" "has s1 'status=PASS'"
chk "instalasi_pertama=ya-migrasi" "has s1 'instalasi_pertama=ya-migrasi'"
chk "a: crm-api→WO /auth/me = 401" "has s1 'a_api_ke_wo_auth_me_tanpa_token=401'"
chk "d: probe maung_edge crm-api=200" "has s1 'd_probe_maung_edge_crm_api=200'"
chk "d: tidak ada port host" "has s1 'd_port_host_crm=tidak ada'"
chk "b: PENDING(404) (crm.caddy belum dipasang) tetap PASS" "has s1 'b_https_crm_api_health=PENDING(404)' && has s1 'b_https_crm=PENDING(308)'"
chk "c: WO login/branding 200 sebelum & sesudah" "has s1 'c_wo_login_sesudah=200' && has s1 'c_wo_api_branding_sesudah=200'"
chk ".env WO & container WO tak berubah" "has s1 'wo_env_tidak_berubah=YA' && has s1 'wo_container_tidak_berubah=YA'"
chk "container lama dihapus SETELAH bukti" "has s1 'container_lama_dihapus=ya' && calls s1 'rm -f legacy_api_id'"
chk "NEXT=PASANG crm.caddy" "has s1 'NEXT=PASANG_JALUR_CRM_DI_WO' && has s1 'scripts/app-route.sh add crm'"
chk "IMAGE_TAG di .env = SHA HEAD" "grep -q '^IMAGE_TAG=$HEAD' $S/home-s1/maung-crm/.env"
chk "kunci usang WEB_PORT/CRM_DOMAIN dihapus; secret lama dipertahankan" "! grep -q WEB_PORT $S/home-s1/maung-crm/.env && grep -q 'pgpass_asli_123' $S/home-s1/maung-crm/.env && grep -q 'skLama_rahasia' $S/home-s1/maung-crm/.env"
chk "last_ok_tag = HEAD" "[ \"\$(cat $S/home-s1/maung-crm-logs/state/last_ok_tag)\" = $HEAD ]"
chk "backup pg_dump + env ada; TIDAK ada arsip Garage (dikelola skrip WO)" "ls $S/home-s1/maung-crm-logs/backup/ | grep -q crm-db && ls $S/home-s1/maung-crm-logs/backup/ | grep -q crm-env && ! ls $S/home-s1/maung-crm-logs/backup/ | grep -q garage && has s1 'garage-backup.sh'"
chk "Garage bersama: guard lolos, crm-api→maung-garage:3900, jaringan benar, maung-garage tidak di edge" "has s1 'garage_bersama=maung-garage running/healthy' && has s1 'crm_api_ke_maung_garage_s3=HTTP 403' && has s1 'd_maung_garage_di_maung_edge=ok' && has s1 'crm-api: edge+storage; crm-web: edge saja'"
chk "up memakai --remove-orphans; CRM tidak mengelola Garage (tanpa exec garage/layout/key/volume/alpine)" "calls s1 'compose up -d --remove-orphans crm-api crm-web' && ! calls s1 'exec -T garage' && ! calls s1 'layout' && ! calls s1 'key create' && ! calls s1 'alpine' && ! calls s1 'volume ls'"
chk "GARAGE_RPC_SECRET lama dibiarkan (rollback cutover) tetapi tidak dicetak" "grep -q 'rpcsecret_asli' $S/home-s1/maung-crm/.env && has s1 'tidak dipakai lagi'"
chk "secret TIDAK tercetak di log" "! grep -qE 'pgpass_asli_123|skLama_rahasia|signsecret_asli|rpcsecret_asli|SUPERSECRET|RAHASIA_WO' $S/out-s1.txt"
chk "tidak ada sudo" "! calls s1 'sudo'"

echo "### S1b Caddy sudah dipasang"; setup s1b; touch $S/stub-s1b/x; printf 200 > $S/stub-s1b/caddy_health; printf 200 > $S/stub-s1b/caddy_crm; own $S/stub-s1b; run s1b
chk "PASS + NEXT=UJI_MANUAL" "has s1b 'status=PASS' && has s1b 'NEXT=UJI_MANUAL_PEMILIK' && has s1b 'b_https_crm_api_health=PASS' && has s1b 'b_https_crm=PASS'"

echo "### S2 gagal bukti (a): WO tak terjangkau dari container → rollback (CRM uji lama utuh)"; setup s2; echo 502 > $S/stub-s2/me_status; own $S/stub-s2; run s2
chk "FAIL + alasan jelas" "has s2 'status=FAIL' && has s2 '(a)'"
chk "rollback: container baru dihapus" "calls s2 'compose rm -sf crm-web crm-api'"
chk "container uji lama TIDAK dihapus" "! calls s2 'rm -f legacy' && has s2 'CRM uji lama tidak pernah dihentikan'"
chk ".env dikembalikan persis seperti semula" "cmp -s $S/home-s2/maung-crm/.env $S/env-asli-s2"

echo "### S3 pull ditolak (kredensial GHCR)"; setup s3; touch $S/stub-s3/pull_denied; own $S/stub-s3; run s3
chk "FAIL: kredensial GHCR" "has s3 'status=FAIL' && has s3 'kredensial GHCR'"
chk "tidak ada compose up; .env dikembalikan" "! calls s3 'compose up' && cmp -s $S/home-s3/maung-crm/.env $S/env-asli-s3"
echo "### S3b image belum ada di GHCR"; setup s3b; touch $S/stub-s3b/pull_notfound; own $S/stub-s3b; run s3b
chk "pesan: belum ada di GHCR / tunggu CI" "has s3b 'belum ada di GHCR'"

echo "### S4 update kedua gagal sehat → rollback ke tag sebelumnya"; setup s4; touch $S/stub-s4/crm_up $S/stub-s4/legacy_gone $S/stub-s4/unhealthy_crmapi_id; echo OLDTAG123 > $S/home-s4/maung-crm-logs/state/last_ok_tag; own $S/stub-s4 $S/home-s4; run s4
chk "FAIL + rollback ke tag sebelumnya" "has s4 'status=FAIL' && has s4 'kembali ke tag OLDTAG123'"
chk "IMAGE_TAG dikembalikan ke tag lama" "grep -q '^IMAGE_TAG=OLDTAG123' $S/home-s4/maung-crm/.env"
chk "DIAGNOSIS dicetak, secret disamarkan" "has s4 'DIAGNOSIS' && ! grep -q 'SUPERSECRET' $S/out-s4.txt && has s4 'postgresql://crm:***@'"

echo "### S5 update kedua sukses"; setup s5; touch $S/stub-s5/crm_up $S/stub-s5/legacy_gone; echo OLDTAG123 > $S/home-s5/maung-crm-logs/state/last_ok_tag; own $S/stub-s5 $S/home-s5; run s5
chk "PASS, tag sebelumnya tercatat, tak ada container lama" "has s5 'status=PASS' && has s5 'tag_sebelumnya=OLDTAG123' && has s5 'container_lama_dihapus=tidak-ada'"

echo "### S6 host salah"; setup s6; EXPECT_HOST_OVERRIDE=salah-host run s6
chk "ditolak sebelum menyentuh apa pun" "has s6 'HOST SALAH' && [ ! -f $S/stub-s6/calls.log ] && cmp -s $S/home-s6/maung-crm/.env $S/env-asli-s6"
echo "### S7 dijalankan sebagai root"; if [ "$(id -u)" != 0 ]; then echo "   (dilewati: pengujian ini hanya bermakna bila runner = root)"; else setup s7; (cd $S/home-s7/maung-crm && HOME=$S/home-s7 STUB=$S/stub-s7 PATH=$S/bin:$PATH EXPECT_HOST=$(hostname) bash scripts/update.sh </dev/null > $S/out-s7.txt 2>&1)
chk "ditolak: jangan root" "has s7 'jangan dijalankan sebagai root'"; fi
echo "### S8 jaringan maung_edge tidak ada"; setup s8; touch $S/stub-s8/no_edge; own $S/stub-s8; run s8
chk "berhenti di guard, tidak ada up" "has s8 'maung_edge TIDAK ada' && ! calls s8 'compose up'"

echo "### S9 .env WO berubah selama update"; setup s9; touch $S/stub-s9/mutate_wo_env; own $S/stub-s9; run s9
chk "terdeteksi → FAIL + rollback" "has s9 'wo_env_tidak_berubah=TIDAK' && has s9 'status=FAIL' && calls s9 'compose rm -sf crm-web crm-api'"
echo "### S10 container WO berubah"; setup s10; touch $S/stub-s10/mutate_wo_ct; own $S/stub-s10; run s10
chk "terdeteksi → FAIL" "has s10 'wo_container_tidak_berubah=TIDAK' && has s10 'status=FAIL'"
echo "### S11 probe maung_edge gagal"; setup s11; echo ERR > $S/stub-s11/probe_api; own $S/stub-s11; run s11
chk "FAIL (d)" "has s11 'status=FAIL' && has s11 '(d) crm-api tidak terjangkau'"
echo "### S12 port host terbuka"; setup s12; touch $S/stub-s12/ports_open; own $S/stub-s12; run s12
chk "FAIL (d) port" "has s12 'ada port CRM terbuka di host' && has s12 'status=FAIL'"
echo "### S13 pg_dump kosong"; setup s13; touch $S/stub-s13/pgdump_empty; own $S/stub-s13; run s13
chk "dibatalkan sebelum mengubah apa pun" "has s13 'pg_dump gagal' && ! calls s13 'compose pull' && cmp -s $S/home-s13/maung-crm/.env $S/env-asli-s13"
echo "### S14 up gagal"; setup s14; touch $S/stub-s14/up_fail; own $S/stub-s14; run s14
chk "FAIL + diagnosis + rollback" "has s14 'docker compose up gagal' && has s14 'DIAGNOSIS' && calls s14 'compose rm -sf crm-web crm-api'"
echo "### G* Garage bersama (pemisahan dari CRM) — semua guard terjadi SEBELUM ada perubahan"
gset() { setup $1; for f in "${@:2}"; do touch $S/stub-$1/$f; done; own $S/stub-$1 $S/home-$1; }
gnochange() { cmp -s $S/home-$1/maung-crm/.env $S/env-asli-$1 && ! calls $1 'compose pull' && ! calls $1 'compose up' && ! calls $1 'pg_dump'; }
gset g1 no_garage; run g1
chk "G1 maung-garage tidak ada → berhenti + perintah adopt-crm; tidak ada yang diubah" "has g1 'status=FAIL' && has g1 'garage-platform.sh adopt-crm' && gnochange g1"
gset g2 garage_unhealthy; run g2
chk "G2 maung-garage tidak healthy → ditolak" "has g2 'tidak berjalan & healthy' && has g2 'running/unhealthy' && gnochange g2"
gset g3 no_storage; run g3
chk "G3 jaringan maung_storage tidak ada → ditolak + adopt-crm" "has g3 'maung_storage TIDAK ada' && has g3 'adopt-crm' && gnochange g3"
setup g4; sed -i 's/^services:/services:\n  garage:\n    image: x/' $S/home-g4/maung-crm/docker-compose.yml; own $S/home-g4 $S/stub-g4; run g4
chk "G4 compose masih memuat service garage → DITOLAK (bahaya dua Garage)" "has g4 \"masih memuat service 'garage'\" && has g4 'DITOLAK' && gnochange g4"
gset g5 old_garage_running; run g5
chk "G5 container Garage CRM lama masih berjalan → ditolak" "has g5 'MASIH berjalan' && has g5 'adopt-crm' && gnochange g5"
setup g6; sed -i 's/^S3_ACCESS_KEY=.*/S3_ACCESS_KEY=/' $S/home-g6/maung-crm/.env; cp $S/home-g6/maung-crm/.env $S/env-asli-g6; own $S/home-g6 $S/stub-g6; run g6
chk "G6 kunci S3 kosong → petunjuk garage-app.sh; .env dikembalikan; tanpa up" "has g6 'garage-app.sh crm --env-file' && cmp -s $S/home-g6/maung-crm/.env $S/env-asli-g6 && ! calls g6 'compose up'"
gset g7 s3_unreachable; run g7
chk "G7 crm-api tak menjangkau maung-garage:3900 → FAIL + rollback" "has g7 'status=FAIL' && has g7 'tidak menjangkau http://maung-garage:3900' && calls g7 'compose rm -sf crm-web crm-api'"
gset g8 crmapi_no_storage; run g8
chk "G8 crm-api tidak di maung_storage → FAIL (d)" "has g8 'status=FAIL' && has g8 'keanggotaan jaringan salah'"
gset g9 garage_on_edge; run g9
chk "G9 maung-garage ada di maung_edge → FAIL (d) + ditandai" "has g9 'status=FAIL' && has g9 'd_maung_garage_di_maung_edge=TIDAK-BOLEH'"
gset g10 crmweb_on_storage; run g10
chk "G10 crm-web ikut maung_storage → FAIL (d)" "has g10 'status=FAIL' && has g10 'keanggotaan jaringan salah'"

echo "### C* diagnosa jalur /crm (scripts/check-route.sh, baca-saja)"
runc() { n=$1; shift; as_user "cd $S/home-$n/maung-crm && HOME=$S/home-$n STUB=$S/stub-$n PATH=$S/bin:\$PATH EXPECT_HOST=\${EXPECT_HOST_OVERRIDE:-$(hostname)} $* bash scripts/check-route.sh </dev/null" > $S/out-$n.txt 2>&1; echo $? > $S/rc-$n; }
cprep() { setup $1; touch $S/stub-$1/crm_up; mkdir -p $S/home-$1/Maung-Wo-Inv/proxy/apps; own $S/stub-$1 $S/home-$1; }
cprep c1; own $S/stub-c1; runc c1
chk "C1 jalur belum dipasang → NEXT app-route.sh add crm (container sehat)" "has c1 'jalur belum dipasang' && has c1 'scripts/app-route.sh add crm' && has c1 'crm_api=healthy' && has c1 'perubahan_ke_sistem=TIDAK_ADA'"
cprep c2; cp $REPO/deploy/crm.caddy $S/home-c2/Maung-Wo-Inv/proxy/apps/crm.caddy; own $S/home-c2; runc c2
chk "C2 berkas ada tetapi belum dimuat Caddy → ulang app-route.sh" "has c2 'belum dimuat container Caddy' && has c2 'isi_sama_dengan_deploy_crm_caddy=ya (identik)'"
cprep c3; cp $REPO/deploy/crm.caddy $S/home-c3/Maung-Wo-Inv/proxy/apps/crm.caddy; touch $S/stub-c3/route_in_container; own $S/home-c3 $S/stub-c3; runc c3
chk "C3 Caddyfile aktif tanpa import → WO belum diperbarui" "has c3 \"belum memuat 'import /etc/caddy/apps/*.caddy'\""
cprep c4; cp $REPO/deploy/crm.caddy $S/home-c4/Maung-Wo-Inv/proxy/apps/crm.caddy; touch $S/stub-c4/route_in_container $S/stub-c4/caddy_import; printf 200 > $S/stub-c4/caddy_health; printf 200 > $S/stub-c4/caddy_crm; own $S/home-c4 $S/stub-c4; runc c4
chk "C4 semua beres → PASS, exit 0" "has c4 'status=PASS' && has c4 'UJI_MANUAL_PEMILIK' && [ \"\$(cat $S/rc-c4)\" = 0 ]"
cprep c5; touch $S/stub-c5/unhealthy_crmapi_id; own $S/stub-c5; runc c5
chk "C5 container CRM tidak sehat → diarahkan ke update.sh" "has c5 'container CRM bermasalah' && has c5 'PERBAIKI_CONTAINER_CRM'"
cprep c6; EXPECT_HOST_OVERRIDE=salah runc c6
chk "C6 host salah ditolak" "has c6 'HOST SALAH'"
cprep c7; { echo "# komentar lama berbeda"; sed 's/^#.*//' $REPO/deploy/crm.caddy; } > $S/home-c7/Maung-Wo-Inv/proxy/apps/crm.caddy; own $S/home-c7; runc c7
chk "C7 hanya komentar berbeda → tidak diperingatkan sebagai BEDA" "has c7 'ya (aturan sama; hanya komentar/spasi berbeda)' && ! has c7 'BEDA-ATURAN'"
cprep c8; printf 'handle /crm/* {\n\treverse_proxy crm-web:3001\n}\n' > $S/home-c8/Maung-Wo-Inv/proxy/apps/crm.caddy; own $S/home-c8; runc c8
chk "C8 aturan berbeda (port lain) → BEDA-ATURAN + saran pasang ulang" "has c8 'isi_sama_dengan_deploy_crm_caddy=BEDA-ATURAN' && has c8 'app-route.sh add crm'"
chk "C* tidak ada perintah yang mengubah (hanya baca: tak ada up/rm/stop/start/restart/pull)" "! grep -qE 'compose (up|rm|stop|start|restart|pull)|docker (rm|stop|start|restart)' $S/stub-c1/calls.log $S/stub-c4/calls.log"

echo "### K* scripts/set-export-key.sh (pasang kunci Export WO; kunci tidak pernah tercetak)"
SECRET_K="kunciExportRAHASIA_1234567890abcdef"
runk() { n=$1; shift; as_user "cd $S/home-$n/maung-crm && HOME=$S/home-$n STUB=$S/stub-$n PATH=$S/bin:\$PATH EXPECT_HOST=\${EXPECT_HOST_OVERRIDE:-$(hostname)} WAIT_API=4 WAIT_SYNC=4 POLL_INTERVAL=1 $* bash scripts/set-export-key.sh </dev/null" > $S/out-$n.txt 2>&1; echo $? > $S/rc-$n; }
kprep() { # kprep <nama> [isi-kunci]
  setup $1; touch $S/stub-$1/crm_up; printf '%s' "$SECRET_K" > $S/stub-$1/export_key; printf '%s\n' "${2-$SECRET_K}" > $S/home-$1/keyfile; chmod 600 $S/home-$1/keyfile; own $S/stub-$1 $S/home-$1; }
kprep k1; runk k1 "KEY_FILE=$S/home-k1/keyfile"
chk "K1 PASS: kunci diterima WO (200), tersimpan di .env mode 600, cermin terisi" "has k1 'status=PASS' && has k1 'export_api_wo_http=200' && grep -q \"^WO_EXPORT_API_KEY=$SECRET_K\\$\" $S/home-k1/maung-crm/.env && [ \"\$(stat -c%a $S/home-k1/maung-crm/.env)\" = 600 ] && has k1 'cermin=customers=5(full)' && has k1 'NEXT=CEK_HALAMAN_CRM'"
chk "K1 kunci TIDAK tercetak di layar/log dan TIDAK ada di argumen perintah" "! grep -qF \"$SECRET_K\" $S/out-k1.txt && ! grep -rqF \"$SECRET_K\" $S/home-k1/maung-crm-logs/*.log && ! grep -qF \"$SECRET_K\" $S/stub-k1/curl_args.log && ! grep -qF \"$SECRET_K\" $S/stub-k1/calls.log && has k1 'kunci_dicetak=TIDAK'"
chk "K1 backup .env ada (mode 600), secret lain di .env utuh, crm-api dibuat ulang tanpa sentuh WO" "ls $S/home-k1/maung-crm-logs/backup/crm-env-*.bak >/dev/null && [ \"\$(stat -c%a \$(ls $S/home-k1/maung-crm-logs/backup/crm-env-*.bak | head -1))\" = 600 ] && grep -q pgpass_asli_123 $S/home-k1/maung-crm/.env && calls k1 'compose up -d crm-api' && has k1 'perubahan_ke_WO=TIDAK_ADA' && grep -q '^SYNC_INTERVAL_MIN=30' $S/home-k1/maung-crm/.env"
kprep k2; printf 401 > $S/stub-k2/export_status; printf '%s' "lain" > $S/stub-k2/export_key; own $S/stub-k2; runk k2 "KEY_FILE=$S/home-k2/keyfile"
chk "K2 kunci ditolak WO (401) → FAIL, .env TIDAK diubah, tanpa up" "has k2 'status=FAIL' && has k2 'WO menolak kunci (401)' && cmp -s $S/home-k2/maung-crm/.env $S/env-asli-k2 && ! calls k2 'compose up'"
kprep k3; printf 503 > $S/stub-k3/export_status; own $S/stub-k3; runk k3 "KEY_FILE=$S/home-k3/keyfile"
chk "K3 Export API nonaktif di WO (503) → FAIL jelas, .env utuh" "has k3 'status=FAIL' && has k3 'nonaktif di WO' && cmp -s $S/home-k3/maung-crm/.env $S/env-asli-k3"
kprep k4; touch $S/stub-k4/sync_empty; printf 'customers: Export API menolak kunci (401)' > $S/stub-k4/sync_err; own $S/stub-k4; runk k4 "KEY_FILE=$S/home-k4/keyfile"
chk "K4 cermin tak terisi → FAIL + ROLLBACK .env + crm-api dibuat ulang; galat sinkron ditampilkan" "has k4 'status=FAIL' && has k4 'rollback=ya' && cmp -s $S/home-k4/maung-crm/.env $S/env-asli-k4 && has k4 'Export API menolak kunci' && [ \"\$(ncalls k4 'compose up -d crm-api')\" -ge 2 ]"
kprep k5; sed -i '/WO_EXPORT_API_KEY/d' $S/home-k5/maung-crm/docker-compose.yml; own $S/home-k5; runk k5 "KEY_FILE=$S/home-k5/keyfile"
chk "K5 compose belum meneruskan WO_EXPORT_API_KEY → diarahkan ke update.sh, tanpa perubahan" "has k5 'status=FAIL' && has k5 'scripts/update.sh' && cmp -s $S/home-k5/maung-crm/.env $S/env-asli-k5"
kprep k6 "pendek"; runk k6 "KEY_FILE=$S/home-k6/keyfile"
chk "K6 kunci terlalu pendek ditolak" "has k6 'terlalu pendek' && cmp -s $S/home-k6/maung-crm/.env $S/env-asli-k6"
kprep k7 'ada spasi&simbol|x1234567890123456'; runk k7 "KEY_FILE=$S/home-k7/keyfile"
chk "K7 karakter terlarang ditolak" "has k7 'tidak diizinkan' && cmp -s $S/home-k7/maung-crm/.env $S/env-asli-k7"
kprep k8; chmod 644 $S/home-k8/keyfile; runk k8 "KEY_FILE=$S/home-k8/keyfile"
chk "K8 KEY_FILE bukan mode 600 ditolak" "has k8 'harus mode 600'"
kprep k9; EXPECT_HOST_OVERRIDE=salah runk k9 "KEY_FILE=$S/home-k9/keyfile"
chk "K9 host salah ditolak" "has k9 'HOST SALAH'"

echo "### H* integrasi CRM → WO (bukti (e) di update.sh; kunci tidak pernah tercetak)"
SECRET_I="kunciIntegrasiRAHASIA_9876543210abcdef"
hprep() { setup $1; printf 'CRM_INTEGRATION_KEY=%s\nWO_SYNC_ENABLED=1\n' "$SECRET_I" >> $S/home-$1/maung-crm/.env; cp $S/home-$1/maung-crm/.env $S/env-asli-$1; own $S/home-$1 $S/stub-$1; }
hprep h1; run h1
chk "H1 kunci terisi: terbaca crm-api, WO menerima (404), antrean kosong → PASS" "has h1 'status=PASS' && has h1 'e_crm_integration_key_di_env=terisi' && has h1 'e_kunci_terbaca_crm_api=ada' && has h1 'e_wo_integrasi_probe=404 (OK' && has h1 'e_antrean_kirim_ke_wo=pending:0 blocked:0'"
chk "H1 nilai kunci TIDAK tercetak di layar/log/panggilan docker; .env dipertahankan" "! grep -qF \"$SECRET_I\" $S/out-h1.txt && ! grep -rqF \"$SECRET_I\" $S/home-h1/maung-crm-logs/*.log && ! grep -qF \"$SECRET_I\" $S/stub-h1/calls.log && grep -q \"^CRM_INTEGRATION_KEY=$SECRET_I\\$\" $S/home-h1/maung-crm/.env"
hprep h2; printf 401 > $S/stub-h2/crm_probe; own $S/stub-h2; run h2
chk "H2 WO menolak kunci (401): update tetap PASS, peringatan jelas (kunci harus sama dengan WO)" "has h2 'status=PASS' && has h2 'kunci DITOLAK WO' && has h2 'harus SAMA'"
hprep h3; printf 503 > $S/stub-h3/crm_probe; own $S/stub-h3; run h3
chk "H3 integrasi nonaktif di WO (503): PASS + peringatan" "has h3 'status=PASS' && has h3 'integrasi nonaktif di WO'"
setup h4; own $S/home-h4 $S/stub-h4; run h4
chk "H4 kunci kosong: PASS + petunjuk isi kunci yang sama dengan WO" "has h4 'status=PASS' && has h4 'e_crm_integration_key_di_env=kosong' && has h4 'CRM_INTEGRATION_KEY kosong'"
hprep h5; touch $S/stub-h5/key_not_in_api; own $S/stub-h5; run h5
chk "H5 crm-api tidak menerima kunci (compose lama): diperingatkan" "has h5 'tidak menerima CRM_INTEGRATION_KEY'"
hprep h6; printf 'pending:2 blocked:1' > $S/stub-h6/outbox; own $S/stub-h6; run h6
chk "H6 ada item DITOLAK WO di antrean: peringatan + arah ke Dashboard" "has h6 'e_antrean_kirim_ke_wo=pending:2 blocked:1' && has h6 'DITOLAK WO'"

echo; echo "UPDATE.SH TOTAL: lulus=$PASS gagal=$FAILC"; [ "$FAILC" = 0 ]

) || RC=1
(
PASS=0; FAILC=0
setup() { H=$S/dk-$1; STUB=$S/dkstub-$1; rm -rf $H $STUB; mkdir -p $H $STUB; git clone -q $S/maung-crm.git $H/maung-crm; cp -r "$REPO/scripts/." "$H/maung-crm/scripts/"; git -C $H/maung-crm remote set-url origin https://github.com/thuekx/maung-crm.git; own $H $STUB; chmod 755 $H; }
run() { n=$1; shift; as_user "cd $S/dk-$n/maung-crm && HOME=$S/dk-$n STUB=$S/dkstub-$n PATH=$S/bin-ssh:\$PATH EXPECT_HOST=\${EH:-$(hostname)} $* bash scripts/setup-deploy-key.sh </dev/null" > $S/dkout-$n.txt 2>&1; echo $? > $S/dkrc-$n; }
has() { grep -qF -- "$2" $S/dkout-$1.txt; }
echo "### T1 kunci belum ditambahkan → WAITING_KEY"; setup t1; run t1
chk "exit 2 + status=WAITING_KEY" "[ \"\$(cat $S/dkrc-t1)\" = 2 ] && has t1 'status=WAITING_KEY'"
chk "kunci PUBLIK dicetak, instruksi GitHub (tanpa write)" "has t1 'ssh-ed25519 AAAAC3NzaTESTKEY' && has t1 \"JANGAN centang 'Allow write access'\""
chk "kunci PRIVAT tidak pernah tercetak" "! has t1 'PRIVATE-KEY-RAHASIA'"
chk "izin kunci 600, ~/.ssh 700, alias SSH ditambahkan" "[ \"\$(stat -c%a $S/dk-t1/.ssh/maung-crm-deploy)\" = 600 ] && [ \"\$(stat -c%a $S/dk-t1/.ssh)\" = 700 ] && grep -q 'Host github-maung-crm' $S/dk-t1/.ssh/config && grep -q 'IdentitiesOnly yes' $S/dk-t1/.ssh/config && grep -q 'HostKeyAlias github.com' $S/dk-t1/.ssh/config"
chk "remote origin BELUM diubah" "[ \"\$(git -C $S/dk-t1/maung-crm remote get-url origin)\" = https://github.com/thuekx/maung-crm.git ]"
chk "sidik jari host key cocok" "has t1 'cocok dengan sidik jari ED25519'"
echo "### T2 kunci ditambahkan (read-only) → PASS, remote ke SSH; idempoten"; touch $S/dkstub-t1/key_added; own $S/dkstub-t1/key_added; run t1
chk "PASS + remote SSH + read-only terbukti" "has t1 'status=PASS' && has t1 'key_read_only=YA' && [ \"\$(git -C $S/dk-t1/maung-crm remote get-url origin)\" = git@github-maung-crm:thuekx/maung-crm.git ]"
chk "kunci lama dipertahankan (idempoten), alias tidak digandakan" "has t1 'deploy_key=ADA' && [ \"\$(grep -c 'Host github-maung-crm' $S/dk-t1/.ssh/config)\" = 1 ]"
chk "NEXT = perintah update tanpa token" "has t1 'git pull --ff-only origin main && bash scripts/update.sh'"
chk "tidak ada token tersimpan / WO tidak disentuh" "has t1 'token_tersimpan=TIDAK' && has t1 'perubahan_ke_maung_wo=TIDAK'"
echo "### T3 kunci punya hak tulis → FAIL"; setup t3; touch $S/dkstub-t3/key_added $S/dkstub-t3/key_write; own $S/dkstub-t3/*; run t3
chk "ditolak SEBELUM remote dialihkan" "has t3 'status=FAIL' && has t3 'hak tulis' && [ \"\$(git -C $S/dk-t3/maung-crm remote get-url origin)\" = https://github.com/thuekx/maung-crm.git ]"
echo "### T4 host salah / root"; setup t4; EH=salah run t4; chk "host salah ditolak" "has t4 'HOST SALAH'"
if [ "$(id -u)" = 0 ]; then setup t5; (cd $S/dk-t5/maung-crm && HOME=$S/dk-t5 STUB=$S/dkstub-t5 PATH=$S/bin-ssh:$PATH EXPECT_HOST=$(hostname) bash scripts/setup-deploy-key.sh </dev/null > $S/dkout-t5.txt 2>&1); chk "root ditolak" "has t5 'jangan dijalankan sebagai root'"; fi
echo; echo "SETUP-DEPLOY-KEY.SH TOTAL: lulus=$PASS gagal=$FAILC"; [ "$FAILC" = 0 ]

) || RC=1
exit $RC
