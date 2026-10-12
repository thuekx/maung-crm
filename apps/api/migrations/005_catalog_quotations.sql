-- Katalog jasa/produk non-internet (master di CRM, disinkron ke WO pada tahap berikutnya) dan penawaran (Quotation).
CREATE TABLE catalog_items (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('SERVICE','PRODUCT')),
  unit text NOT NULL DEFAULT 'unit',
  price numeric(18,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  description text,
  active boolean NOT NULL DEFAULT true,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  wo_synced_at timestamptz,
  wo_sync_error text
);
CREATE UNIQUE INDEX catalog_items_name ON catalog_items (lower(name));

CREATE TABLE quotation_counters (year int PRIMARY KEY, value int NOT NULL);

CREATE TABLE quotations (
  id bigserial PRIMARY KEY,
  number text NOT NULL UNIQUE,
  rev int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT','ACCEPTED','REJECTED','EXPIRED','CANCELLED')),
  lead_id bigint NOT NULL REFERENCES leads(id),
  owner_id text NOT NULL,
  owner_name text NOT NULL,
  customer_code text,
  customer_name text NOT NULL,
  customer_phone text,
  customer_email text,
  customer_address text,
  pic_name text,
  subject text,
  valid_until date,
  terms text,
  notes text,
  tax_rate numeric(5,2) NOT NULL DEFAULT 11 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  discount numeric(18,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  subtotal numeric(18,2) NOT NULL DEFAULT 0,
  tax_amount numeric(18,2) NOT NULL DEFAULT 0,
  total numeric(18,2) NOT NULL DEFAULT 0,
  sent_at timestamptz,
  decided_at timestamptz,
  decision_note text,
  approved_by text,
  approved_by_name text,
  approved_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX quotations_lead ON quotations (lead_id) WHERE deleted_at IS NULL;
CREATE INDEX quotations_status ON quotations (status) WHERE deleted_at IS NULL;
CREATE INDEX quotations_owner ON quotations (owner_id) WHERE deleted_at IS NULL;

CREATE TABLE quotation_lines (
  id bigserial PRIMARY KEY,
  quotation_id bigint NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  position int NOT NULL,
  catalog_id bigint NOT NULL REFERENCES catalog_items(id),
  name text NOT NULL,
  kind text NOT NULL,
  unit text NOT NULL,
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_price numeric(18,2) NOT NULL CHECK (unit_price >= 0),
  note text
);
CREATE INDEX quotation_lines_q ON quotation_lines (quotation_id, position);

-- Salinan tetap tiap revisi sebelum diubah (isi yang pernah dikirim tidak hilang).
CREATE TABLE quotation_revisions (
  id bigserial PRIMARY KEY,
  quotation_id bigint NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  rev int NOT NULL,
  snapshot jsonb NOT NULL,
  reason text,
  actor_id text,
  actor_name text,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quotation_events (
  id bigserial PRIMARY KEY,
  quotation_id bigint NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  type text NOT NULL,
  from_status text,
  to_status text,
  note text,
  actor_id text,
  actor_name text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quotation_events_q ON quotation_events (quotation_id, at);
