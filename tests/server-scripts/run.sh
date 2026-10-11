#!/bin/bash
# Uji alur skrip server (scripts/update.sh, scripts/setup-deploy-key.sh) dengan docker/curl/ssh/git TIRUAN yang stateful.
# Membuktikan logika guard, bukti, backup, rollback, dan penyamaran secret — BUKAN pengganti uji di server asli.
# Bila dijalankan sebagai root, skrip diuji sebagai user `nobody` (karena skrip menolak root); selain itu langsung.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
S=$(mktemp -d /tmp/crm-script-tests.XXXXXX); chmod 755 $S; trap 'rm -rf $S' EXIT
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
  git clone -q $S/maung-crm.git $H/maung-crm; cp -r "$REPO/scripts/." "$H/maung-crm/scripts/"  # uji berkas kerja saat ini (di CI = isi commit)
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
chk "b: PENDING(404) (crm.caddy belum dipasang) tetap PASS" "has s1 'b_https_crm_api_health=PENDING(404)'"
chk "c: WO login/branding 200 sebelum & sesudah" "has s1 'c_wo_login_sesudah=200' && has s1 'c_wo_api_branding_sesudah=200'"
chk ".env WO & container WO tak berubah" "has s1 'wo_env_tidak_berubah=YA' && has s1 'wo_container_tidak_berubah=YA'"
chk "container lama dihapus SETELAH bukti" "has s1 'container_lama_dihapus=ya' && calls s1 'rm -f legacy_api_id'"
chk "NEXT=PASANG crm.caddy" "has s1 'NEXT=PASANG_deploy/crm.caddy_DI_WO'"
chk "IMAGE_TAG di .env = SHA HEAD" "grep -q '^IMAGE_TAG=$HEAD' $S/home-s1/maung-crm/.env"
chk "kunci usang WEB_PORT/CRM_DOMAIN dihapus; secret lama dipertahankan" "! grep -q WEB_PORT $S/home-s1/maung-crm/.env && grep -q 'pgpass_asli_123' $S/home-s1/maung-crm/.env && grep -q 'skLama_rahasia' $S/home-s1/maung-crm/.env"
chk "last_ok_tag = HEAD" "[ \"\$(cat $S/home-s1/maung-crm-logs/state/last_ok_tag)\" = $HEAD ]"
chk "backup pg_dump + env + garage ada" "ls $S/home-s1/maung-crm-logs/backup/ | grep -q crm-db && ls $S/home-s1/maung-crm-logs/backup/ | grep -q crm-env && ls $S/home-s1/maung-crm-logs/backup/ | grep -q garage"
chk "secret TIDAK tercetak di log" "! grep -qE 'pgpass_asli_123|skLama_rahasia|signsecret_asli|rpcsecret_asli|SUPERSECRET|RAHASIA_WO' $S/out-s1.txt"
chk "tidak ada sudo; compose up hanya crm-api crm-web" "! calls s1 'sudo' && calls s1 'compose up -d crm-api crm-web'"

echo "### S1b Caddy sudah dipasang"; setup s1b; touch $S/stub-s1b/x; printf 200 > $S/stub-s1b/caddy_health; printf 302 > $S/stub-s1b/caddy_crm; own $S/stub-s1b; run s1b
chk "PASS + NEXT=UJI_MANUAL" "has s1b 'status=PASS' && has s1b 'NEXT=UJI_MANUAL_PEMILIK' && has s1b 'b_https_crm_api_health=PASS'"

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
