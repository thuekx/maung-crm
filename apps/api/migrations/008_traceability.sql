-- Jejak marketing permanen (aturan pemilik): id + nama tersimpan sebagai snapshot pada lead & penawaran.
-- Nonaktif/pindah peran/dihapus/ganti nama di WO tidak mengubah apa pun di sini.
ALTER TABLE leads ADD COLUMN created_by_name text;
UPDATE leads l SET created_by_name = COALESCE((SELECT c.name FROM wo_user_cache c WHERE c.user_id = l.created_by), l.owner_name, l.created_by);
ALTER TABLE leads ALTER COLUMN created_by_name SET NOT NULL;

ALTER TABLE quotations ADD COLUMN created_by_name text;
UPDATE quotations q SET created_by_name = COALESCE((SELECT c.name FROM wo_user_cache c WHERE c.user_id = q.created_by), q.owner_name, q.created_by);
ALTER TABLE quotations ALTER COLUMN created_by_name SET NOT NULL;

-- Penjaga di tingkat database: kolom jejak tidak boleh diubah oleh kode mana pun.
CREATE FUNCTION forbid_trace_change() RETURNS trigger AS $$
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
CREATE TRIGGER leads_trace BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION forbid_trace_change();
CREATE TRIGGER quotations_trace BEFORE UPDATE ON quotations FOR EACH ROW EXECUTE FUNCTION forbid_trace_change();
