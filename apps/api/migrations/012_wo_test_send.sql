-- Uji sambung CRM→WO: penawaran demo yang SENGAJA dikirim ke WO dengan demo:true (aksi eksplisit Admin). Dipisah dari status kirim nyata (wo_synced_*).
ALTER TABLE quotations ADD COLUMN wo_test_at timestamptz;
ALTER TABLE quotations ADD COLUMN wo_test_rev int;
ALTER TABLE quotations ADD COLUMN wo_test_status text;
ALTER TABLE quotations ADD COLUMN wo_test_number text;
ALTER TABLE quotations ADD COLUMN wo_test_error text;
