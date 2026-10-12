-- Cermin BACA-SAJA data Maung WO (Export API). CRM tidak pernah menulis ke WO lewat jalur ini.
-- Hanya kolom yang dibutuhkan CRM (tanpa ODP/port/VLAN/IP/biaya).
CREATE TABLE wo_customers (
  code text PRIMARY KEY,
  name text NOT NULL,
  phone text,
  phone_norm text,              -- E.164 tanpa "+" (null bila tidak valid)
  phone_digits text,
  phone_suffix text,            -- 9 digit terakhir (saran lemah)
  email text,
  address text,
  package_name text,
  status text,                  -- PROSPECT | INSTALLING | ACTIVE | NEED_CHECK | SUSPENDED | TERMINATING | TERMINATED
  radius_status text,           -- WAITING | ONLINE | OFFLINE | ISOLIR | DISABLE
  sales_name text,
  area_name text,
  wo_source text,               -- MANUAL | RADIUS | CRM
  activated_at timestamptz,
  wo_created_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wo_customers_phone_norm ON wo_customers (phone_norm);
CREATE INDEX wo_customers_phone_digits ON wo_customers (phone_digits);
CREATE INDEX wo_customers_phone_suffix ON wo_customers (phone_suffix);
CREATE INDEX wo_customers_name ON wo_customers (lower(name));

CREATE TABLE wo_subscriptions (
  reg_no text PRIMARY KEY,
  form_date timestamptz,
  name text,
  phone text,
  phone_norm text,
  phone_digits text,
  address text,
  package_name text,
  source text,                  -- MANUAL | RADIUS
  marketing_name text,
  customer_code text,
  wo_number text,
  wo_created_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wo_subscriptions_phone_norm ON wo_subscriptions (phone_norm);
CREATE INDEX wo_subscriptions_customer ON wo_subscriptions (customer_code);

CREATE TABLE wo_packages (
  name text PRIMARY KEY,
  kind text NOT NULL DEFAULT 'INTERNET',
  speed text,
  price_sell numeric(18,2),
  unit text,
  active boolean NOT NULL DEFAULT true,
  origin text NOT NULL DEFAULT 'EXPORT',   -- EXPORT (resource packages) | DERIVED (dari nama paket pelanggan)
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wo_areas (
  name text PRIMARY KEY,
  code text,
  origin text NOT NULL DEFAULT 'EXPORT',   -- EXPORT | DERIVED
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wo_sync_state (
  resource text PRIMARY KEY,
  last_ok_at timestamptz,
  last_run_at timestamptz,
  rows integer,
  mode text,                    -- full | derived
  last_error text
);
