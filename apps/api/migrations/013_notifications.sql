-- Notifikasi dalam aplikasi (ikon lonceng). userId merujuk pengguna WO. dedupe_key mencegah pemberitahuan ganda untuk kejadian yang sama.
CREATE TABLE crm_notifications (
  id bigserial PRIMARY KEY,
  user_id text NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  href text,
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE UNIQUE INDEX crm_notifications_dedupe ON crm_notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX crm_notifications_user ON crm_notifications (user_id, created_at DESC);
