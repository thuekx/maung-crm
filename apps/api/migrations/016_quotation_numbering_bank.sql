-- Rekening pembayaran yang dipilih per penawaran (salinan saat disimpan, tidak berubah bila pengaturan Admin diubah)
-- dan nama penandatangan saat disetujui (Manager di Pengaturan Formulir WO pada saat itu).
ALTER TABLE quotations ADD COLUMN bank_account jsonb;
ALTER TABLE quotations ADD COLUMN signer_name text;
