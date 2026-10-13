# Permintaan perubahan di sisi WO — Lead, Quotation & katalog (usulan dari sesi CRM)

> **Status (diperbarui):** Bagian **A selesai dan live di VM WO (commit `e4b3d59`)**: `customers`/`subscriptions` `since`=`updatedAt`, `subscriptions`+`address`, resource `packages` (`id,name,description,speed,priceSell,active,source,updatedAt` — belum ada `kind`/`unit`) dan `areas` (`id,code,name,active`), `work-orders?type=`, guard `applyPackages` (paket sumber selain MANUAL/RADIUS tidak ditimpa). CRM sudah memakainya (cermin `wo_packages`/`wo_areas`/`wo_work_orders`; Lost otomatis dari WO Pasang Baru `REJECTED`/`CANCELLED`). **Bagian B + D (pintu masuk CRM→WO, `Package.kind/unit/crmId`, `SERVICE_ORDER`) = Tahap 2 WO, belum dikerjakan.**
> **Keputusan pemilik untuk Tahap 2 (dari HANDOFF WO):** semua permintaan dipicu dari Marketing (di CRM: penawaran `ACCEPTED` oleh Marketing); **BA (Berita Acara) tetap wajib**; khusus jasa non-internet, di WO ada **pilihan per order**: (a) pakai stok berjalan (mis. WiFi/router dari stok) atau (b) buat PR baru sebagai proyek sesuai isi penawaran; **harga ikut dikirim ke WO** tetapi tidak masuk Export API. Konsekuensi untuk CRM: badan penawaran memuat tiap baris dengan `kind` (SERVICE/PRODUCT), `qty`, `unit`, `unitPrice`, `note` (cukup bagi WO untuk membentuk PR proyek); pilihan stok-vs-PR dibuat di WO, bukan di CRM. Detail alur `SERVICE_ORDER` (penugasan, peran) masih dirancang di sisi WO.

Status awal dokumen ini: **USULAN, menunggu persetujuan pemilik** lalu dikerjakan sesi WO (satu repo satu penulis: sesi CRM tidak menyentuh repo WO).
Dasar: bacaan hanya-baca atas repo WO commit `e1bafe9` (`radius.ts`, `routes/export.ts`, `routes/integrations.ts`, `workflows.ts`, `schema.prisma`, `settings.ts`). Rencana sisi CRM: `docs/RENCANA-LEAD-QUOTATION.md`.

## Ringkas
| Jalur | Perubahan WO | Tingkat |
|---|---|---|
| Internet (MSRadius → WO → CRM) | **Tidak mengubah alur WO.** Hanya melengkapi Export API agar CRM bisa mencocokkan & mendeteksi "Won". | kecil |
| Non-internet (Quotation) | Pintu masuk baru CRM → WO, perluasan master Paket, tipe WO baru. | sedang |

## A. Export API (baca-saja) — wajib untuk jalur internet
1. **`customers`: tambah `updatedAt`** (kolom + indeks) dan jadikan `sinceField = 'updatedAt'`. Sekarang `since` memfilter `createdAt`, sehingga perubahan Waiting → Online (= *Won*) **tidak terlihat** di tarikan inkremental. Tanpa ini CRM harus tarik penuh tiap siklus (jalan, tapi boros). Alternatif: resource baru `customer-changes` (tabel `CustomerChange` sudah ada).
2. **`subscriptions`: tambah `updatedAt`** (sudah ada di tabel) + `sinceField = 'updatedAt'`; sertakan `customerCode` & `woNumber` (sudah) dan `address` (agar bisa dicocokkan area/alamat; **tetap tanpa biaya**).
3. **Resource baru `packages`**: `id, name, kind, speed, priceSell, unit, active, source, updatedAt` (harga jual dibutuhkan untuk penawaran; kunci export sudah terbatas pada server CRM).
4. **Resource baru `areas`**: `id, code, name, active` (untuk Area Prospect & filter cakupan).
5. **`work-orders`**: pastikan filter `?type=NEW_INSTALL|SERVICE_ORDER` dan kolom `status`, `customerCode`, `updatedAt` ada (alasan *Lost*: REJECTED/CANCELLED pada WO Pasang Baru).
6. Nomor telepon: **format internasional E.164** (digit dengan kode negara, tidak hanya 62; negara bawaan ID). CRM menormalkan sendiri (`libphonenumber-js`), jadi WO cukup tetap mengekspor `phone` apa adanya. Bila WO ingin ikut: simpan nomor luar negeri **dengan kode negara** (`+60…`) agar cocok otomatis; nomor luar negeri tanpa kode negara hanya menjadi saran manual di CRM. Opsional: `phoneNorm` (E.164) di Export API supaya kedua sisi memakai aturan yang sama.

## B. Pintu masuk CRM → WO (baru) — untuk jalur non-internet
Pola mengikuti `integrations/billing/events` (header `x-api-key`, idempoten, audit, `source` khusus). **Kunci terpisah** dari `EXPORT_API_KEY` (kunci export tidak boleh bisa menulis): env WO `CRM_INTEGRATION_KEY`, diisi pemilik, di `.env` kedua sisi saja, tidak pernah di chat/commit.

1. `PUT /api/integrations/crm/catalog/:crmId` — upsert jenis jasa/produk (`name, kind SERVICE|PRODUCT, unit, priceSell, active, description`). Jika nama sudah ada dengan `kind` lain → 409 (jangan pernah menimpa paket MSRadius).
2. `PUT /api/integrations/crm/quotations/:crmId` — upsert penawaran (badan di bawah). Idempoten menurut `crmId`; `rev` lebih kecil dari yang tersimpan → abaikan (200 `stale:true`).
3. Respons: `{ ok, quotationId, status, woNumber? }`. Kesalahan jaringan ditangani CRM (outbox + coba ulang), jadi WO cukup idempoten.
4. Batas laju sendiri (mis. 60/menit), audit `CREATE/UPDATE` bersumber "CRM", tanpa menulis ke tabel pelanggan sebelum status **WON**.

Badan permintaan (usulan):
```json
{
  "crmId": "uuid", "number": "QT-026-0001", "rev": 2, "status": "QUOTED|WON|LOST",
  "validUntil": "2026-11-30", "sentAt": "…", "decidedAt": "…", "lostReason": "…",
  "customer": { "code": null /* kode pelanggan WO bila Lead untuk pelanggan existing; null = pelanggan baru */, "name": "…", "phone": "628…", "email": "…", "address": "…", "lat": null, "lng": null, "areaCode": "…", "picName": "…" },
  "marketingUserId": "id pengguna WO (dari /auth/me saat dibuat)", "marketingName": "snapshot nama saat dibuat",
  "lines": [ { "catalogCrmId": "uuid", "sku": "opsional/null", "name": "…", "kind": "SERVICE", "qty": 1, "unit": "paket", "unitPrice": 0, "note": "…" } ],
  "total": 0, "taxNote": "PPN …", "terms": "…"
}
```
SKU pada baris bersifat **opsional** (kolom `sku` di katalog CRM, unik bila diisi): bila ada, WO memakainya untuk memetakan ke master barang; bila `null`, Marketing memetakan manual di WO.

**Aturan jejak (pemilik):** `marketingUserId` + `marketingName` ada di **setiap** `PUT quotation` (dibangun di `apps/api/src/woPayload.ts`, diuji). Keduanya snapshot permanen di CRM (kolom penawaran/lead dilindungi trigger DB; ganti nama/nonaktif/pindah peran/dihapus di WO tidak mengubahnya). WO diminta menyimpan keduanya apa adanya pada pelanggan CRM/`SERVICE_ORDER`/PR proyek turunan (jangan menimpa dengan nama pengguna WO saat ini) dan menolak (422) permintaan tanpa salah satunya.

Pertanyaan keputusan pemilik: **apakah harga ikut dikirim ke WO?** Rekomendasi: ya (WO butuh angka untuk "trigger invoice"), tetapi **tidak** dimasukkan ke Export API (sama seperti `installFee/monthlyFee` pada `subscriptions`).

## C. Status penawaran (usulan) dan pemetaan ke WO
CRM memakai status internal lengkap; **hanya status yang berarti bagi WO yang dikirim**, supaya WO tidak penuh draf:

| Status CRM | Dikirim ke WO? | Status di WO | Efek di WO |
|---|---|---|---|
| DRAFT, PENDING_APPROVAL, APPROVED | tidak | – | – |
| SENT (sudah dikirim ke pelanggan) | ya | `QUOTED` | hanya tampil (prakiraan pipeline, tanpa aksi) |
| **ACCEPTED** (pelanggan setuju/PO diterima) | ya | **`WON`** | **TRIGGER**: buat Pelanggan (`source='CRM'`) + WO tipe baru `SERVICE_ORDER`, notifikasi ke peran terkait (mis. MKT, FOC supervisor) |
| REJECTED, EXPIRED, CANCELLED | ya (bila pernah `QUOTED`) | `LOST` (+ `lostReason`) | menutup rujukan; tanpa pelanggan/WO |

Aturan: setelah `WON`, penawaran **terkunci** di CRM; perubahan lingkup = penawaran baru bertaut (hindari WO yang tidak sinkron).

## D. Skema & workflow WO
1. **`Package`**: tambah `kind` (`INTERNET` bawaan | `SERVICE` | `PRODUCT`), `unit`, `crmId` (unik, nullable); `source` menerima `'CRM'`. **Guard `applyPackages`** (`radius.ts`): lewati/jangan menimpa baris `kind != INTERNET` atau `source = 'CRM'` (sekarang `source !== 'RADIUS'` akan *diubah menjadi RADIUS* bila nama kebetulan sama). Master Paket di UI WO: tampilkan `kind`, baris sumber CRM hanya-baca.
2. **`Customer`**: `source='CRM'` (kolom sudah string). Konfirmasi bahwa sinkron MSRadius tidak menyentuh `source != 'RADIUS'` (penandaan `missingFromApi` sudah dibatasi `source='RADIUS'` — baik). `packageName`/`address`/`phone` wajib: untuk pelanggan CRM isi `packageName` dengan nama jasa utama dan `address` dari penawaran.
3. **Pelanggan existing (layanan tambahan, mis. sewa WiFi / CCTV):** bila `customer.code` terisi dan ada, status `WON` **menautkan WO `SERVICE_ORDER` ke pelanggan itu tanpa membuat pelanggan baru dan tanpa mengubah `status`/`packageName`/data MSRadius** (`setCustomer` jangan dipanggil untuk tipe ini). Kode tidak ditemukan → 404 (CRM menandai gagal, tidak membuat duplikat). Opsional: tampilkan "Layanan tambahan" (daftar order jasa) di halaman Pelanggan WO.
4. **`WoType` baru `SERVICE_ORDER`** (label "Order Jasa/Produk"), dibuat sistem saat `WON`. Usulan alur minimal (selebihnya diputuskan sesi WO sesuai mesin workflow): `SO_NEW → SO_ASSIGNED → SO_IN_PROGRESS → SO_DONE (BA Digital + trigger invoice) | SO_CANCELLED`. Prefix `WO-SO`. `data` memuat `crmQuotation: { number, rev, lines }`.
5. **Fitur akses**: tidak ada perubahan (`app.crm` sudah ada). Persetujuan penawaran dilakukan CRM sendiri (reviewer = ADMIN / MKT MANAGER|SUPERVISOR).

## E. Kop surat & pengaturan dokumen (periksa/konfirmasi saja)
CRM mencetak penawaran A4 memakai kop yang sama dengan dokumen WO. Mohon dikonfirmasi tetap seperti sekarang:
- `GET /api/branding` (publik) mengembalikan `kopUrl` dan berkas gambarnya terbaca **tanpa token** dari origin yang sama (bawaan `/kop-surat-a4.jpg`), plus `formLogoUrl`, `mgrSignUrl`.
- `GET /api/subscription-settings` (terotentikasi, tanpa fitur khusus) tetap bisa dibaca pengguna CRM: `city, managerName, bankName, accName, accNo, footer, ppnNote` (dipakai ulang di penawaran agar rekening/PPN seragam).
- Bila ada keberatan membuka sebagian ke pengguna CRM, usulan pengganti: endpoint `GET /api/doc-settings` ringan.

## F. Urutan kerja yang disarankan
1. WO: bagian **A** (kecil, tidak berisiko) → CRM mulai sinkron cermin + Lead internet.
2. CRM: Lead, katalog, Quotation + cetak A4 **tidak menunggu WO** (data penawaran tetap di CRM).
3. WO: bagian **B + D** → CRM mengaktifkan outbox sinkron (fase terakhir, sakelar `WO_SYNC_ENABLED`).
4. Uji bersama di server: satu penawaran uji `SENT → ACCEPTED`, lalu cek WO (pelanggan CRM + WO `SERVICE_ORDER`, katalog baru muncul di Master Paket).

## G. Notifikasi dari CRM lewat WO (Telegram / email / kotak masuk) — usulan
CRM sudah punya lonceng notifikasi dalam aplikasi (`crm_notifications`). Agar pengguna juga diberi tahu di luar CRM, **WO yang mengirim** (WO sudah memegang preferensi tiap pengguna: Telegram tertaut, email, kotak masuk), CRM hanya menyerahkan peristiwanya.

`POST /api/integrations/crm/notifications` — header `x-api-key` = `CRM_INTEGRATION_KEY` (kunci yang sama dengan tulis katalog/penawaran), idempoten.
```json
{ "userId": "id pengguna WO", "type": "QUOTATION_SUBMITTED", "title": "Penawaran QT-026-0007 menunggu persetujuan",
  "body": "PT Maju · diajukan Nurman", "link": "/crm/quotations/7", "dedupeKey": "qt-sub:7:1" }
```
- WO meneruskan lewat jalur notifikasinya sendiri (kotak masuk [CRM] + Telegram/email sesuai pengaturan penerima); `link` relatif, WO membentuk URL absolut dari domain Maung.
- Idempoten menurut `(userId, dedupeKey)` → 200 `{ok:true, duplicate:true}`; pengguna tidak ada/nonaktif → 404 (CRM melewati, tidak mengulang); isi tidak valid → 422; batas laju mis. 120/menit.
- Tidak menulis apa pun selain notifikasi. Pesan dari baris demo tidak pernah dikirim CRM.
- Sisi CRM (setelah WO siap): sakelar `WO_NOTIFY_ENABLED`, memakai antrean `wo_outbox` yang sama (coba ulang, tidak pernah menggagalkan proses utama). Mohon kabari commit-nya.

## H. Layanan baru / tambahan untuk pelanggan yang SUDAH ada (internet maupun non-internet) — usulan
Fakta dasar: di WO satu **kode pelanggan = satu layanan/lokasi**. Layanan internet baru untuk pemilik/PIC yang sama tetap mendapat **kode pelanggan baru**; nama dan nomor bisa sama dengan kode lama, jadi pencocokan nomor/nama saja ambigu.

**Non-internet (sewa WiFi, CCTV, dll.) — sudah didukung di D.3:**
1. `customer.code` terisi dan ada → Order Jasa ditautkan ke pelanggan itu, tidak membuat pelanggan baru, tidak menyentuh status/paket/MSRadius. Mohon dikonfirmasi tetap berlaku di implementasi 2b.
2. **Baru:** `customer.parentCode` (opsional, dipakai bila `customer.code` kosong) = kode pelanggan existing yang menjadi induk akun (mis. cabang/lokasi baru dengan PIC sama). WO membuat pelanggan CRM baru untuk lokasi itu dan menyimpan `parentCode` apa adanya. Kode induk tidak ada → 404.

**Internet — layanan baru untuk pelanggan lama:**
3. **Formulir Berlangganan / pelanggan PROSPECT**: tambah dua kolom opsional yang bisa diisi Marketing di WO — `parentCustomerCode` (kode pelanggan lama sebagai induk akun) dan `crmLeadRef` (nomor Lead CRM, mis. `LD-123`). Boleh diisi setelah PROSPECT terbentuk dari MSRadius.
4. **Export API** (`customers` dan `subscriptions`): tambahkan `parentCustomerCode` dan `crmLeadRef`. Dengan itu CRM menautkan Lead ke **kode baru secara pasti** (tanpa menebak dari nomor/nama); bila kosong CRM tetap memakai aturan konservatif sekarang (satu kandidat baru yang dibuat setelah Lead, bukan kode acuan) dan menampilkan saran untuk konfirmasi manual.
5. Opsional UI WO: halaman Pelanggan menampilkan kelompok "akun" (induk + layanan-layanannya) agar semua kode milik pemilik/PIC yang sama terlihat bersama.
6. Pemeriksaan WO berdasarkan `customerCode` tidak berubah: alur Pasang Baru/Online tetap per kode baru; CRM hanya membaca statusnya (`PROSPECT → INSTALLING → ACTIVE`/`REJECTED|CANCELLED`).

Sisi CRM yang sudah ada: Lead menyimpan `relatedCustomerCode` (pelanggan acuan, dipilih lewat pencarian cermin WO) terpisah dari `customerCode` (kode layanan yang dilacak).

## Status G & H (dijawab WO, commit 622891b)
- G: `POST /api/integrations/crm/notifications` tersedia → CRM mengirim lewat antrean `wo_outbox` (jenis NOTIFICATION; sakelar `WO_NOTIFY_ENABLED`, 404/422 dilewati tanpa diulang, WO turun → dicoba ulang).
- H: `customer.parentCode` dipakai CRM untuk Lead non-internet "lokasi/cabang baru"; `parentCustomerCode` + `crmLeadRef` dibaca dari Export API (`crm_lead_ref` dinormalkan huruf besar). Nomor Lead = `LD-<id>` (regex `^LD-[0-9]{1,9}$`; 1 Lead = 1 kode; 409 bila dobel di WO). `crmLeadRef` yang cocok menautkan Lead internet **pasti** ke kode baru (mengalahkan tebakan; tautan manual tidak ditimpa) dan mengisi kode induk bila kosong.

## I. Masukan UAT 13 Okt 2026 — bagian WO (dari sesi CRM)
1. **(9) Label kartu penawaran di halaman order WO**: tulisan "Penawaran CRM" cukup **"Form Penawaran"** (`apps/web/src/app/(app)/work-orders/[id]/page.tsx`, judul kartu).
2. **(11) Sewa WiFi = jasa berperangkat**: WO sudah menerima baris SERVICE yang membawa perangkat (GA memilih "Jasa + perangkat dari stok / PR proyek"; teknisi menetapkan sewa/beli). CRM tidak mengubah kontrak: baris tetap `kind: SERVICE`, marketing boleh menulis catatan baris "termasuk perangkat (sewa)".
3. **(5) Penanda tangan penawaran**: nama diambil dari **WO → Pengaturan Formulir Berlangganan → Nama Manager** (`GET /api/subscription-settings`, `managerName`) dan gambar tanda tangan dari **WO → Branding → tanda tangan Manager** — bukan dari pengaturan CRM. Sejak commit ini CRM **menyalin nama Manager saat penawaran disetujui** (`quotations.signer_name`), jadi cetakan lama tidak ikut berganti bila Manager diganti. Mohon label kolom di WO dibuat jelas, mis. "Nama Manager (penanda tangan formulir & penawaran)".
4. **(12)** Menu profil CRM kini "Pengaturan profil", sama dengan WO.
5. **(3)** Sejalan dengan WO: Lead tetap milik pembuat (`marketingUserId` tunggal); rekan Marketing dicatat sebagai PIC di report; Admin tidak lagi muncul di pilihan PIC.
6. **Nomor penawaran** kini mengikuti format Admin CRM (bawaan `QT/LIV/{BLN}/{YY}{NO}`, mis. `QT/LIV/X/260001`, berisi garis miring). Kontrak tidak berubah (`number` ≤ 60 karakter, teks bebas); mohon pastikan tampilan/pencarian WO tidak memecah nomor bergaris miring.
