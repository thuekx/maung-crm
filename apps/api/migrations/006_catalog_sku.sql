-- SKU opsional di katalog (kunci pemetaan ke master barang WO). Kosong = Marketing memetakan manual di WO.
ALTER TABLE catalog_items ADD COLUMN sku text;
CREATE UNIQUE INDEX catalog_items_sku ON catalog_items (lower(sku)) WHERE sku IS NOT NULL;
-- Baris penawaran menyimpan salinan SKU saat dibuat (seperti nama/harga).
ALTER TABLE quotation_lines ADD COLUMN sku text;
