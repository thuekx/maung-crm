-- Antrean kirim CRM → WO (Tahap 4). Satu baris per entitas (katalog / penawaran) = "perlu disinkronkan"; payload dibangun saat dikirim dari keadaan terkini.
CREATE TABLE wo_outbox (
  id bigserial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('CATALOG','QUOTATION')),
  ref_id bigint NOT NULL,
  crm_id text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DONE','BLOCKED')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_http int,
  last_error text,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz
);
-- Satu baris "belum selesai" per entitas (coalescing); riwayat DONE/BLOCKED lama boleh banyak.
CREATE UNIQUE INDEX wo_outbox_open ON wo_outbox (kind, ref_id) WHERE status = 'PENDING';
CREATE INDEX wo_outbox_due ON wo_outbox (next_attempt_at) WHERE status = 'PENDING';
CREATE INDEX wo_outbox_ref ON wo_outbox (kind, ref_id, id DESC);

-- Keadaan terakhir yang diketahui berhasil di WO (untuk UI dan pencegahan kirim ulang yang sama).
ALTER TABLE quotations ADD COLUMN wo_synced_at timestamptz;
ALTER TABLE quotations ADD COLUMN wo_synced_rev int;
ALTER TABLE quotations ADD COLUMN wo_synced_status text;
ALTER TABLE quotations ADD COLUMN wo_number text;
ALTER TABLE quotations ADD COLUMN wo_warnings jsonb;
