# Rencana Lead, Katalog & Quotation (sisi CRM)

Keputusan pemilik: satu entitas **Lead** (tanpa objek Opportunity terpisah; berakhir `WON` atau `LOST`). Dibuat di CRM oleh user baru juga. **Tidak mengubah alur WO.** Dua jalur menurut jenis layanan. Perubahan yang diminta dari WO: `docs/PERMINTAAN-PERUBAHAN-WO.md`.

## 1. Jalur Internet (sumber kebenaran: MSRadius → WO)
`Lead (CRM) ··· pencocokan ··· MSRadius ⇒ WO sync (Pelanggan Waiting = PROSPECT + Formulir Berlangganan otomatis) ⇒ Pasang Baru ⇒ Online = ACTIVE`
- CRM **tidak** mendaftarkan pelanggan internet dan tidak menulis ke WO; Lead hanya melacak prospek sebelum/selagi pendaftaran dilakukan di MSRadius.
- **Kunci pencocokan: nomor telepon dinormalkan ke format internasional E.164** (hanya digit dengan kode negara, mis. `628123…`, `60123…`, `6581…`), bukan hanya 62. Pustaka `libphonenumber-js` (data resmi per negara), negara bawaan `PHONE_DEFAULT_REGION=ID` (env). Aturan: awalan `+` atau `00` = internasional apa adanya; awalan `0` = nasional negara bawaan (`0812…`→`62812…`); awalan lain dicoba sebagai internasional lalu nasional. Satu fungsi `normalizePhone()` dipakai untuk Lead, kontak, dan cermin WO, jadi nomor luar negeri apa pun yang didaftarkan kelak tetap cocok tanpa ubah kode. Nomor tak valid disimpan apa adanya (hanya digit) dan tetap bisa dicocokkan persis, ditandai `phoneValid=false`. Data pembanding: cermin baca-saja `customers` + `subscriptions` dari Export API WO.
- Nomor luar negeri yang di WO tersimpan **tanpa kode negara** (mis. `012-3456789` untuk Malaysia) terbaca sebagai nasional Indonesia dan tidak akan cocok otomatis; sistem hanya menampilkannya sebagai **saran** (kecocokan 9 digit terakhir + kemiripan nama) untuk dikonfirmasi manual. Tidak pernah menebak negara.
- Aturan tautan otomatis (konservatif): tepat **satu** kandidat, pelanggan itu dibuat ≥ 1 hari sebelum Lead dibuat (yaitu pendaftar baru, bukan pelanggan lama), status `PROSPECT|INSTALLING`. Sinyal pendukung (tidak menentukan): `salesName` = nama marketing pemilik Lead, `areaName`, kemiripan nama.
- Selain itu → **saran** untuk dikonfirmasi manual (HP sama dengan >1 pelanggan). Bila HP cocok dengan pelanggan lama yang sudah `ACTIVE`, Lead internet ditandai **"sudah pelanggan"** dan CRM menawarkan menjadikannya Lead layanan tambahan (bagian 1b), bukan Won.
- Setelah tertaut (`customerCode` tersimpan, kunci stabil): Stage mengikuti WO — `PROSPECT`→`REGISTERED`, `INSTALLING`→`INSTALLING`, **`ACTIVE` (radiusStatus ONLINE) → `WON`** (mengisi `activatedAt`), `TERMINATED` sebelum aktif / WO Pasang Baru `REJECTED|CANCELLED` → `LOST` (alasan otomatis). Tutup manual tetap bisa (alasan wajib).

## 1b. Lead untuk pelanggan yang SUDAH ada (layanan tambahan: sewa WiFi, beli/pasang CCTV, dll.)
Lead mewakili **minat layanan**, bukan orang, sehingga satu pelanggan boleh punya banyak Lead dari waktu ke waktu.
- Saat membuat Lead, CRM mencari pelanggan existing dengan nomor ternormalisasi / nama (cermin WO). Bila ditemukan, Lead **ditautkan sejak awal** (`customerCode` terisi, tanpa menunggu pencocokan) dan kartu Lead menampilkan ringkasan pelanggan (paket internet, status, area, riwayat Lead/penawaran).
- Layanan tambahan memakai **jalur Non-Internet** (bagian 2): katalog jasa/produk → Quotation → `ACCEPTED`. Bedanya hanya di WO: karena Lead sudah punya `customerCode`, WO **menautkan Order Jasa ke pelanggan yang ada dan tidak membuat pelanggan baru**; status pelanggan (`ACTIVE`, paket internet, data MSRadius) tidak disentuh.
- Contoh: **sewa WiFi** = baris katalog `SERVICE` berulang (satuan `bulan`/`unit`); **beli + pasang CCTV** = baris `PRODUCT` (perangkat) + baris `SERVICE` (instalasi) dalam satu penawaran.
- Di luar lingkup (tetap di MSRadius/WO): ganti/naik paket internet, pindah alamat, tambah titik internet bawaan WO.
- Satu kontak/nomor milik beberapa pelanggan (mis. perusahaan dengan beberapa cabang): Lead memilih pelanggan manual dari daftar kandidat; tidak pernah otomatis.

## 2. Jalur Non-Internet (sumber kebenaran: CRM → disinkron ke WO)
`Lead → Quotation (CRM, kop surat WO) → ACCEPTED → sinkron ke WO (Pelanggan CRM + WO Order Jasa)`
- Katalog **jenis jasa/produk**: dibuat/diubah di CRM (peran reviewer), di-push ke WO sebelum/bersamaan dengan penawaran pertama yang memakainya, sehingga data di Master Paket WO sama. Paket internet = master WO (CRM baca-saja).
- Nomor penawaran diterbitkan CRM (`QT-<3 digit tahun>-<urut>`, unik), revisi `rev` 1,2,… dengan riwayat.
- Cetak A4 dari halaman CRM memakai `kopUrl` dari `/api/branding` WO sebagai latar (cara yang sama dengan `DocSheet` WO: Cetak/Simpan PDF), rekening/PPN dari `subscription-settings`.

### Status Lead
`NEW → CONTACTED → QUALIFIED → (Internet) REGISTERED → INSTALLING → WON` · `(Non-internet) QUOTING → NEGOTIATION → WON` · `LOST` dari tahap mana pun (alasan wajib).

### Status Quotation dan yang dikirim ke WO
`DRAFT → PENDING_APPROVAL → APPROVED → SENT → ACCEPTED | REJECTED | EXPIRED | CANCELLED`
| Status CRM | ke WO |
|---|---|
| DRAFT/PENDING_APPROVAL/APPROVED | tidak dikirim |
| SENT | `QUOTED` (informasi pipeline) |
| **ACCEPTED** | **`WON` = trigger** WO (pelanggan CRM + WO `SERVICE_ORDER`); penawaran terkunci |
| REJECTED/EXPIRED/CANCELLED | `LOST` |
Lead non-internet menjadi `WON` saat penawarannya `ACCEPTED`.

### Sinkron CRM → WO (andal)
Tabel `sync_outbox` (satu baris per perubahan yang perlu dikirim), pekerja latar mengirim berurutan, coba ulang bertahap (backoff), idempoten (`crmId` + `rev`), kunci terpisah `WO_CRM_INTEGRATION_KEY` di `.env` CRM, sakelar `WO_SYNC_ENABLED`. Penawaran gagal terkirim tampil "menunggu sinkron" di UI, tidak menghalangi kerja.

## 3. Tahap pengerjaan CRM
1. Cermin pelanggan/langganan/paket/area dari Export API (tarik berkala, kunci `WO_EXPORT_API_KEY` hanya di `.env` CRM) — baca-saja.
2. Lead (kedua jalur) + pencocokan HP + halaman pipeline & saran tautan.
3. Katalog + Quotation + revisi + persetujuan + cetak A4.
4. Outbox sinkron ke WO (setelah sisi WO selesai).
5. Review manager + dashboard KPI Field Activities & pipeline.
Tahap 1–3 tidak menunggu WO; hanya tahap 1 (kolom `updatedAt` agar efisien) dan 4 bergantung pada WO.

## 4. Status pengerjaan (CRM)
- Tahap 1 (cermin WO + normalisasi nomor E.164 + `scripts/set-export-key.sh`): selesai di repo, belum dipasang di server (menunggu pemilik/WO).
- Tahap 2 (Lead): selesai di repo — API `/crm/api/leads` (buat/ubah/tahap/tautan/kandidat), tautan otomatis sesuai aturan bagian 1/1b, tahap internet mengikuti status pelanggan WO setelah tiap sinkron, UI `/leads`. Belum ada: alasan *Lost* otomatis dari WO Pasang Baru `REJECTED/CANCELLED` (butuh `work-orders` di cermin) dan dashboard.
