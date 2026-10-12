-- Review manager atas Field Report: komentar & keputusan (Reviewed / Revision Required / Completed) tercatat bertanggal.
CREATE TABLE field_report_comments (
  id bigserial PRIMARY KEY,
  report_id bigint NOT NULL REFERENCES field_reports(id),
  kind text NOT NULL CHECK (kind IN ('COMMENT','REVIEWED','REVISION_REQUIRED','COMPLETED')),
  note text,
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX field_report_comments_report ON field_report_comments (report_id, at);
