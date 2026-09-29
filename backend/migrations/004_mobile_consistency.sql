ALTER TABLE suppliers ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE plots ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
ALTER TABLE sync_operations ADD COLUMN request_hash text;
CREATE OR REPLACE FUNCTION ordered_sync_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('sync:' || NEW.organization_id::text, 0));
 NEW.sequence_id := nextval('sync_changes_sequence_id_seq');
 RETURN NEW;
END $$;
ALTER TABLE sync_changes ALTER COLUMN sequence_id DROP DEFAULT;
CREATE TRIGGER ordered_sync_change_insert BEFORE INSERT ON sync_changes
 FOR EACH ROW EXECUTE FUNCTION ordered_sync_change();
ALTER TABLE documents ADD COLUMN upload_expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours');
