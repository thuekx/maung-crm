-- Lead (satu entitas; berakhir WON/LOST). kind: INTERNET (kebenaran di MSRadius→WO) | NON_INTERNET (penawaran di CRM).
CREATE TABLE leads (
  id bigserial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('INTERNET','NON_INTERNET')),
  stage text NOT NULL DEFAULT 'NEW' CHECK (stage IN ('NEW','CONTACTED','QUALIFIED','REGISTERED','INSTALLING','QUOTING','NEGOTIATION','WON','LOST')),
  name text NOT NULL,
  phone text,
  phone_norm text,
  phone_digits text,
  email text,
  address text,
  area text,
  interest text,                 -- minat layanan (mis. "Home 20", "Sewa WiFi", "CCTV 4 titik")
  source text,                   -- asal lead (referral, canvassing, walk-in, dst.)
  notes text,
  owner_id text NOT NULL,        -- marketing pemilik (user WO)
  owner_name text NOT NULL,
  customer_code text,            -- tautan ke pelanggan WO (cermin)
  link_state text NOT NULL DEFAULT 'NONE' CHECK (link_state IN ('NONE','AUTO','MANUAL')),
  existing_customer boolean NOT NULL DEFAULT false, -- saat dibuat, nomor sudah milik pelanggan WO yang ACTIVE
  lost_reason text,
  lost_auto boolean NOT NULL DEFAULT false,
  won_at timestamptz,
  closed_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX leads_stage ON leads (stage) WHERE deleted_at IS NULL;
CREATE INDEX leads_owner ON leads (owner_id) WHERE deleted_at IS NULL;
CREATE INDEX leads_phone_norm ON leads (phone_norm) WHERE deleted_at IS NULL;
CREATE INDEX leads_customer ON leads (customer_code) WHERE deleted_at IS NULL;

CREATE TABLE lead_events (
  id bigserial PRIMARY KEY,
  lead_id bigint NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type text NOT NULL,            -- CREATED | STAGE | LINKED | UNLINKED | UPDATED | NOTE
  from_stage text,
  to_stage text,
  note text,
  actor_id text,                 -- null = otomatis (sinkron WO)
  actor_name text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_events_lead ON lead_events (lead_id, at);
