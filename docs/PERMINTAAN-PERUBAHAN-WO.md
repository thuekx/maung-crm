# Permintaan perubahan di sisi WO — Lead, Quotation & katalog (usulan dari sesi CRM)

Status: **USULAN, menunggu persetujuan pemilik** lalu dikerjakan sesi WO (satu repo satu penulis: sesi CRM tidak menyentuh repo WO).
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
6. Nomor telepon: biarkan apa adanya; CRM yang menormalkan (62…). Bila WO bisa menambah `phoneNorm` (digit saja, awalan 62), lebih baik agar kedua sisi memakai aturan sama.

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
  "customer": { "name": "…", "phone": "628…", "email": "…", "address": "…", "lat": null, "lng": null, "areaCode": "…", "picName": "…" },
  "marketingName": "…",
  "lines": [ { "catalogCrmId": "uuid", "name": "…", "kind": "SERVICE", "qty": 1, "unit": "paket", "unitPrice": 0, "note": "…" } ],
  "total": 0, "taxNote": "PPN …", "terms": "…"
}
```
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
3. **`WoType` baru `SERVICE_ORDER`** (label "Order Jasa/Produk"), dibuat sistem saat `WON`. Usulan alur minimal (selebihnya diputuskan sesi WO sesuai mesin workflow): `SO_NEW → SO_ASSIGNED → SO_IN_PROGRESS → SO_DONE (BA Digital + trigger invoice) | SO_CANCELLED`. Prefix `WO-SO`. `data` memuat `crmQuotation: { number, rev, lines }`.
4. **Fitur akses**: tidak ada perubahan (`app.crm` sudah ada). Persetujuan penawaran dilakukan CRM sendiri (reviewer = ADMIN / MKT MANAGER|SUPERVISOR).

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
