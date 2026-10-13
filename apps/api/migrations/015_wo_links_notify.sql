-- Tautan akun/Lead dari WO (parentCustomerCode, crmLeadRef pada Export API), lokasi baru untuk Lead non-internet, dan antrean notifikasi ke WO.
ALTER TABLE wo_customers ADD COLUMN parent_customer_code text;
ALTER TABLE wo_customers ADD COLUMN crm_lead_ref text;
ALTER TABLE wo_subscriptions ADD COLUMN parent_customer_code text;
ALTER TABLE wo_subscriptions ADD COLUMN crm_lead_ref text;
CREATE INDEX wo_customers_crm_lead_ref ON wo_customers (crm_lead_ref) WHERE crm_lead_ref IS NOT NULL;
ALTER TABLE leads ADD COLUMN new_location boolean NOT NULL DEFAULT false; -- non-internet: lokasi/cabang baru di bawah akun induk (customer.parentCode), bukan pelanggan yang sama
ALTER TABLE wo_outbox DROP CONSTRAINT wo_outbox_kind_check;
ALTER TABLE wo_outbox ADD CONSTRAINT wo_outbox_kind_check CHECK (kind IN ('CATALOG','QUOTATION','NOTIFICATION'));
