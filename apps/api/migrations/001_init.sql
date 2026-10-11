-- Skema awal Field Activities. userId merujuk user Maung WO (tanpa tabel user sendiri).
CREATE TABLE IF NOT EXISTS wo_user_cache (
  user_id text PRIMARY KEY,
  name text NOT NULL,
  email text,
  role text NOT NULL,
  sub_role text,
  seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE field_reports (
  id bigserial PRIMARY KEY,
  company_id text NOT NULL DEFAULT 'default',
  branch_id text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','REVIEWED','REVISION_REQUIRED','COMPLETED')),
  activity_type text NOT NULL,
  activity_at timestamptz NOT NULL DEFAULT now(),
  counterpart text,
  account_name text,
  area text,
  summary text,
  agreement text,
  issues text,
  next_action text,
  -- GPS check-in; null bila tidak tersedia (tidak pernah dikarang)
  gps_lat double precision,
  gps_lng double precision,
  gps_accuracy double precision,
  gps_at timestamptz,
  gps_source text CHECK (gps_source IN ('LIVE','EXIF','UPLOAD','MANUAL')),
  location_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK (location_status IN ('VERIFIED','UNVERIFIED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  deleted_at timestamptz
);
CREATE INDEX ON field_reports (activity_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE field_report_pics (
  report_id bigint NOT NULL REFERENCES field_reports(id),
  user_id text NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (report_id, user_id)
);

CREATE TABLE field_report_items (
  id bigserial PRIMARY KEY,
  report_id bigint NOT NULL REFERENCES field_reports(id),
  kind text NOT NULL CHECK (kind IN ('DISCUSSION','AGREEMENT','ISSUE')),
  text text NOT NULL,
  position int NOT NULL DEFAULT 0
);

CREATE TABLE field_photos (
  id bigserial PRIMARY KEY,
  report_id bigint NOT NULL REFERENCES field_reports(id),
  caption text,
  original_path text NOT NULL,
  watermark_path text,
  mime text NOT NULL,
  size_bytes int NOT NULL,
  taken_at timestamptz NOT NULL,
  gps_lat double precision,
  gps_lng double precision,
  gps_accuracy double precision,
  gps_at timestamptz,
  gps_source text CHECK (gps_source IN ('LIVE','EXIF','UPLOAD','MANUAL')),
  location_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK (location_status IN ('VERIFIED','UNVERIFIED')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE field_tasks (
  id bigserial PRIMARY KEY,
  report_id bigint NOT NULL REFERENCES field_reports(id),
  title text NOT NULL,
  pic_user_id text NOT NULL,
  pic_name text NOT NULL,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DONE')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_id text NOT NULL,
  entity text NOT NULL,
  entity_id bigint NOT NULL,
  action text NOT NULL,
  before jsonb,
  after jsonb
);
CREATE INDEX ON audit_log (entity, entity_id);
