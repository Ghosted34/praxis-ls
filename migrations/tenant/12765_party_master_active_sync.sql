-- Keep client_master/supplier_master `is_active` derived from `registration_status`,
-- mirroring trg_entity_sync_active on corporate_entity (0515).
--
-- Bug #10: When a client is created as DRAFT the boolean `is_active` stayed at its
-- DEFAULT true (set in 0300), so the list pill rendered "Active" next to a draft
-- record and the /clients?q.active=true filter returned rows that were not live.
-- Same gap applied to suppliers. Without a trigger the two columns drift whichever
-- side a caller writes.
--
-- Backfill first: existing rows that have a registration_status set get an
-- is_active that matches it; pre-ladder rows keep whatever they had.
UPDATE client_master
   SET is_active = (registration_status = 'ACTIVE')
 WHERE registration_status IS NOT NULL;

UPDATE supplier_master
   SET is_active = (registration_status = 'ACTIVE')
 WHERE registration_status IS NOT NULL;

CREATE OR REPLACE FUNCTION party_sync_active() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A new party defaults to ACTIVE when the caller did not say otherwise, to
    -- match the column DEFAULT true set in 0300. When a ladder value IS supplied
    -- (e.g. DRAFT from the create form), `is_active` derives from it.
    IF NEW.registration_status IS NULL THEN
      NEW.registration_status := 'ACTIVE';
    END IF;
    NEW.is_active := (NEW.registration_status = 'ACTIVE');
  ELSIF NEW.registration_status IS DISTINCT FROM OLD.registration_status THEN
    NEW.is_active := (NEW.registration_status = 'ACTIVE');
  ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    -- Legacy callers flipping the boolean (if any survive) keep working: the
    -- ladder follows. Anything non-ACTIVE (including DRAFT) becomes DEACTIVATED
    -- through this path, which matches how corporate_entity behaves.
    NEW.registration_status := CASE WHEN NEW.is_active THEN 'ACTIVE' ELSE 'DEACTIVATED' END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_client_sync_active ON client_master;
CREATE TRIGGER trg_client_sync_active
BEFORE INSERT OR UPDATE ON client_master
FOR EACH ROW EXECUTE FUNCTION party_sync_active();

DROP TRIGGER IF EXISTS trg_supplier_sync_active ON supplier_master;
CREATE TRIGGER trg_supplier_sync_active
BEFORE INSERT OR UPDATE ON supplier_master
FOR EACH ROW EXECUTE FUNCTION party_sync_active();
