-- Data demo (isDemo) dan pengaturan CRM. Baris demo tidak pernah dikirim ke WO (outbox melewatinya) dan tidak ditautkan otomatis ke pelanggan WO.
ALTER TABLE leads ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE quotations ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE catalog_items ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE field_reports ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE field_tasks ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
CREATE INDEX leads_demo ON leads (id) WHERE is_demo;
CREATE INDEX quotations_demo ON quotations (id) WHERE is_demo;
CREATE INDEX catalog_items_demo ON catalog_items (id) WHERE is_demo;
CREATE INDEX field_reports_demo ON field_reports (id) WHERE is_demo;

-- Pengaturan CRM (kunci → JSON). Pengaturan tidak ikut terhapus oleh purge.
CREATE TABLE crm_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
