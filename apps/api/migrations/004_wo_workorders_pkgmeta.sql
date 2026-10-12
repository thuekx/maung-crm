-- WO Export API (e4b3d59): paket membawa source/description; resource work-orders?type=NEW_INSTALL dipakai untuk alasan Lost lead internet.
ALTER TABLE wo_packages ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE wo_packages ADD COLUMN IF NOT EXISTS description text;

CREATE TABLE wo_work_orders (
  number text PRIMARY KEY,
  type text NOT NULL,
  status text,
  customer_code text,
  wo_created_at timestamptz,
  wo_updated_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wo_work_orders_customer ON wo_work_orders (customer_code, wo_created_at DESC);
