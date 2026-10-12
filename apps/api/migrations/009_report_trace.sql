-- Jejak pembuat permanen pada Field Report (aturan pemilik, sama seperti lead/penawaran): id + nama snapshot, tidak bisa diubah.
-- Berlaku untuk report, foto (pengunggah), dan follow-up task (pembuat). Nama PIC sudah snapshot (field_report_pics.name, field_tasks.pic_name).
ALTER TABLE field_reports ADD COLUMN created_by_name text;
UPDATE field_reports r SET created_by_name = COALESCE(
  (SELECT c.name FROM wo_user_cache c WHERE c.user_id = r.created_by),
  (SELECT p.name FROM field_report_pics p WHERE p.report_id = r.id AND p.user_id = r.created_by LIMIT 1), r.created_by);
ALTER TABLE field_reports ALTER COLUMN created_by_name SET NOT NULL;

ALTER TABLE field_photos ADD COLUMN created_by_name text;
UPDATE field_photos f SET created_by_name = COALESCE(
  (SELECT c.name FROM wo_user_cache c WHERE c.user_id = f.created_by),
  (SELECT p.name FROM field_report_pics p WHERE p.report_id = f.report_id AND p.user_id = f.created_by LIMIT 1), f.created_by);
ALTER TABLE field_photos ALTER COLUMN created_by_name SET NOT NULL;

ALTER TABLE field_tasks ADD COLUMN created_by_name text;
UPDATE field_tasks t SET created_by_name = COALESCE(
  (SELECT c.name FROM wo_user_cache c WHERE c.user_id = t.created_by),
  (SELECT p.name FROM field_report_pics p WHERE p.report_id = t.report_id AND p.user_id = t.created_by LIMIT 1), t.created_by);
ALTER TABLE field_tasks ALTER COLUMN created_by_name SET NOT NULL;

-- Penjaga yang sama dengan lead/penawaran. Fungsi 008 membaca NEW.owner_id di semua tabel (tabel field_* tidak punya kolom itu) → dibuat ulang
-- dengan pemeriksaan bertingkat agar kolom owner hanya dibaca untuk `quotations`.
CREATE OR REPLACE FUNCTION forbid_trace_change() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'quotations' THEN
    IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.owner_name IS DISTINCT FROM OLD.owner_name THEN
      RAISE EXCEPTION 'Marketing penawaran (id + nama) tidak boleh diubah — jejak permanen';
    END IF;
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_by_name IS DISTINCT FROM OLD.created_by_name THEN
    RAISE EXCEPTION 'Pembuat (id + nama) tidak boleh diubah — jejak permanen';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER field_reports_trace BEFORE UPDATE ON field_reports FOR EACH ROW EXECUTE FUNCTION forbid_trace_change();
CREATE TRIGGER field_photos_trace BEFORE UPDATE ON field_photos FOR EACH ROW EXECUTE FUNCTION forbid_trace_change();
CREATE TRIGGER field_tasks_trace BEFORE UPDATE ON field_tasks FOR EACH ROW EXECUTE FUNCTION forbid_trace_change();
