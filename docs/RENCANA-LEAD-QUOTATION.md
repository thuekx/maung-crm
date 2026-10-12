# Rencana Lead, Katalog & Quotation (sisi CRM)

Keputusan pemilik: satu entitas **Lead** (tanpa objek Opportunity terpisah; berakhir `WON` atau `LOST`). Dibuat di CRM oleh user baru juga. **Tidak mengubah alur WO.** Dua jalur menurut jenis layanan. Perubahan yang diminta dari WO: `docs/PERMINTAAN-PERUBAHAN-WO.md`.

## 1. Jalur Internet (sumber kebenaran: MSRadius → WO)
`Lead (CRM) ··· pencocokan ··· MSRadius ⇒ WO sync (Pelanggan Waiting = PROSPECT + Formulir Berlangganan otomatis) ⇒ Pasang Baru ⇒ Online = ACTIVE`
- CRM **tidak** mendaftarkan pelanggan internet dan tidak menulis ke WO; Lead hanya melacak prospek sebelum/selagi pendaftaran dilakukan di MSRadius.
- **Kunci pencocokan: nomor HP ternormalisasi** (hanya digit; `0…`→`62…`; `+62…`→`62…`; `8…`→`628…`). Data pembanding: cermin baca-saja `customers` + `subscriptions` dari Export API WO.
- Aturan tautan otomatis (konservatif): tepat **satu** kandidat, pelanggan itu dibuat ≥ 1 hari sebelum Lead dibuat (yaitu pendaftar baru, bukan pelanggan lama), status `PROSPECT|INSTALLING`. Sinyal pendukung (tidak menentukan): `salesName` = nama marketing pemilik Lead, `areaName`, kemiripan nama.
- Selain itu → **saran** untuk dikonfirmasi manual (HP sama dengan >1 pelanggan, atau pelanggan lama sudah ACTIVE → ditandai "sudah pelanggan", bukan Won).
- Setelah tertaut (`customerCode` tersimpan, kunci stabil): Stage mengikuti WO — `PROSPECT`→`REGISTERED`, `INSTALLING`→`INSTALLING`, **`ACTIVE` (radiusStatus ONLINE) → `WON`** (mengisi `activatedAt`), `TERMINATED` sebelum aktif / WO Pasang Baru `REJECTED|CANCELLED` → `LOST` (alasan otomatis). Tutup manual tetap bisa (alasan wajib).

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
