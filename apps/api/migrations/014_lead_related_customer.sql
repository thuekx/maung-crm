-- Lead untuk pelanggan yang SUDAH ada (layanan baru/tambahan). related_customer_code = kode pelanggan WO yang menjadi acuan (pelanggan induk).
-- Hanya acuan: TIDAK diikuti statusnya (customer_code tetap kode layanan baru yang dilacak — untuk internet, kode baru yang dibuat WO).
ALTER TABLE leads ADD COLUMN related_customer_code text;
CREATE INDEX leads_related_customer ON leads (related_customer_code) WHERE related_customer_code IS NOT NULL;
