-- ============================================================================
-- TENANT DB — 0641 Financial dictionary recycle bin, retire, and purge.
--
-- THE RULE THIS IMPLEMENTS
--
-- A dictionary item is never physically deleted. dictionary_item is referenced
-- by posting_rule, expense_rate, service_type_dictionary_item, and by the line
-- tables of every document the company has ever issued — quotation_line,
-- invoice_line, journal_line, cash_request_line. A real DELETE would either be
-- blocked by a foreign key or, worse, succeed against a line whose FK is
-- nullable and leave a posted invoice pointing at nothing. So "delete" here
-- means "becomes permanently unreachable to every user", and the row stays for
-- the historical documents that still have to render.
--
-- THREE STATES beyond ordinary is_active:
--
--   BINNED   binned_at set, purge_after = binned_at + 14 days. Gone from every
--            picker and search immediately, restorable by the permitted role
--            until purge_after passes. This is the only reversible state.
--
--   PURGED   hidden_at set, hidden_reason 'PURGED'. What the 14-day timer does
--            when it expires. To every user this is deletion: the item can
--            never again be searched, picked, restored through the UI, or
--            attached to a new document. The row survives so historical
--            documents keep resolving their labels, and only a DBA reaching
--            past the application can see it.
--
--   RETIRED  hidden_at set, hidden_reason 'RETIRED'. The escape hatch for an
--            item that is ALREADY on a posted document and therefore cannot go
--            in the bin at all (§below). Same permanent invisibility, no timer
--            — it is immediate, because there is nothing to undo: the item was
--            never going to be removable in the first place.
--
-- WHY BINNING IS BLOCKED ONCE AN ITEM IS USED
--
-- A 14-day countdown attached to something a posted invoice references is a
-- promise the system cannot keep: at day 14 the item must vanish, but the
-- invoice still needs it. So is_dictionary_item_used() is checked at bin time
-- and a used item is refused. The user gets RETIRE instead — the same practical
-- outcome (invisible forever) without pretending the row is disposable. This
-- matters immediately, because the mis-classified items this release corrects
-- are precisely the ones already in use.
--
-- ENFORCEMENT IS AT THE DATABASE, NOT IN A QUERY FILTER
--
-- "They should never see it again" is only true if it cannot be re-attached,
-- so a trigger on each line table rejects a hidden item at INSERT/UPDATE time.
-- A missed WHERE clause in one repo method would otherwise quietly reopen the
-- door. Existing rows are untouched — the trigger fires on the incoming
-- dictionary_item_id, never on history.
-- ============================================================================

-- ── 1. Lifecycle columns ────────────────────────────────────────────────────
ALTER TABLE dictionary_item
  ADD COLUMN IF NOT EXISTS binned_at     timestamptz,
  ADD COLUMN IF NOT EXISTS binned_by     uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS purge_after   timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_at     timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_by     uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS hidden_reason text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_dict_hidden_reason') THEN
    ALTER TABLE dictionary_item ADD CONSTRAINT chk_dict_hidden_reason
      CHECK (hidden_reason IS NULL OR hidden_reason IN ('PURGED','RETIRED'));
  END IF;
  -- hidden_at and hidden_reason travel together or not at all; a hidden row
  -- with no reason is unexplainable to whoever finds it in three years.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_dict_hidden_pair') THEN
    ALTER TABLE dictionary_item ADD CONSTRAINT chk_dict_hidden_pair
      CHECK ((hidden_at IS NULL) = (hidden_reason IS NULL));
  END IF;
  -- A binned row must carry its deadline, or the purge job cannot see it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_dict_bin_pair') THEN
    ALTER TABLE dictionary_item ADD CONSTRAINT chk_dict_bin_pair
      CHECK ((binned_at IS NULL) = (purge_after IS NULL));
  END IF;
END $$;

-- The one predicate every picker, search and report filters on. Partial so it
-- stays small: the overwhelming majority of rows are live.
CREATE INDEX IF NOT EXISTS ix_dict_visible ON dictionary_item(direction, code)
  WHERE hidden_at IS NULL AND binned_at IS NULL;

-- The purge job's working set: only ever the handful currently in the bin.
CREATE INDEX IF NOT EXISTS ix_dict_purge_due ON dictionary_item(purge_after)
  WHERE binned_at IS NOT NULL AND hidden_at IS NULL;

-- ── 2. Audit trail ──────────────────────────────────────────────────────────
-- Who removed what, when, and why. Separate from ledger_audit because this is
-- master-data governance, queried by the bin screen itself rather than by the
-- compliance export, and it must survive the purge that empties the bin.
CREATE TABLE IF NOT EXISTS dictionary_item_bin_event (
  bin_event_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dictionary_item_id uuid NOT NULL REFERENCES dictionary_item(dictionary_item_id) ON DELETE CASCADE,
  action             text NOT NULL CHECK (action IN ('BINNED','RESTORED','PURGED','RETIRED')),
  actor_id           uuid REFERENCES app_user(user_id),
  actor_name         text,                    -- snapshot: the actor may later be deactivated
  reason             text,
  item_code          text NOT NULL,           -- snapshot, so the trail reads without a join
  item_label_en      text,
  occurred_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_dict_bin_event_item ON dictionary_item_bin_event(dictionary_item_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_dict_bin_event_when ON dictionary_item_bin_event(occurred_at DESC);

-- ── 3. "Is this item already used?" ─────────────────────────────────────────
-- The single definition of used, so the bin guard, the UI's pre-flight warning
-- and the purge job cannot drift apart. Deliberately counts DRAFT quotations
-- and costing lines as usage, not just posted documents: a draft quote that
-- silently loses a line when the timer expires is the same broken promise.
CREATE OR REPLACE FUNCTION is_dictionary_item_used(p_item uuid) RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM invoice_line       WHERE dictionary_item_id = p_item)
      OR EXISTS (SELECT 1 FROM journal_line       WHERE dictionary_item_id = p_item)
      OR EXISTS (SELECT 1 FROM quotation_line     WHERE dictionary_item_id = p_item)
      OR EXISTS (SELECT 1 FROM cash_request_line  WHERE dictionary_item_id = p_item);
$$ LANGUAGE sql STABLE;

-- ── 4. Bin / restore / retire / purge ───────────────────────────────────────
-- Written as functions rather than left to the service layer because the state
-- machine (which transitions are legal, what the timer is) is an invariant of
-- the data, and a second caller — the cron purge — has to obey exactly the same
-- rules as the HTTP endpoint.

CREATE OR REPLACE FUNCTION bin_dictionary_item(
  p_item uuid, p_actor uuid, p_actor_name text, p_reason text DEFAULT NULL
) RETURNS void AS $$
DECLARE it RECORD;
BEGIN
  SELECT * INTO it FROM dictionary_item WHERE dictionary_item_id = p_item FOR UPDATE;
  IF it IS NULL THEN
    RAISE EXCEPTION 'dictionary item % not found', p_item;
  END IF;
  IF it.hidden_at IS NOT NULL THEN
    RAISE EXCEPTION 'dictionary item % is already removed (%)', it.code, it.hidden_reason;
  END IF;
  IF it.binned_at IS NOT NULL THEN
    RAISE EXCEPTION 'dictionary item % is already in the recycle bin', it.code;
  END IF;
  -- The block that sends the caller to RETIRE instead.
  IF is_dictionary_item_used(p_item) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'raise_exception',
      MESSAGE = format('dictionary item %s is used on existing documents and cannot be binned', it.code),
      HINT    = 'RETIRE it instead: it disappears from every picker and search permanently, and existing documents keep resolving it.';
  END IF;

  UPDATE dictionary_item
     SET binned_at = now(), binned_by = p_actor, purge_after = now() + interval '14 days'
   WHERE dictionary_item_id = p_item;

  INSERT INTO dictionary_item_bin_event (dictionary_item_id, action, actor_id, actor_name, reason, item_code, item_label_en)
  VALUES (p_item, 'BINNED', p_actor, p_actor_name, p_reason, it.code, it.label_en)
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION restore_dictionary_item(
  p_item uuid, p_actor uuid, p_actor_name text
) RETURNS void AS $$
DECLARE it RECORD;
BEGIN
  SELECT * INTO it FROM dictionary_item WHERE dictionary_item_id = p_item FOR UPDATE;
  IF it IS NULL THEN
    RAISE EXCEPTION 'dictionary item % not found', p_item;
  END IF;
  -- Purged and retired are both terminal through the application. Restoring
  -- either is a data-engineering act, not a user action, and deliberately has
  -- no code path here.
  IF it.hidden_at IS NOT NULL THEN
    RAISE EXCEPTION 'dictionary item % was permanently removed and cannot be restored', it.code;
  END IF;
  IF it.binned_at IS NULL THEN
    RAISE EXCEPTION 'dictionary item % is not in the recycle bin', it.code;
  END IF;

  UPDATE dictionary_item
     SET binned_at = NULL, binned_by = NULL, purge_after = NULL
   WHERE dictionary_item_id = p_item;

  INSERT INTO dictionary_item_bin_event (dictionary_item_id, action, actor_id, actor_name, item_code, item_label_en)
  VALUES (p_item, 'RESTORED', p_actor, p_actor_name, it.code, it.label_en)
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION retire_dictionary_item(
  p_item uuid, p_actor uuid, p_actor_name text, p_reason text DEFAULT NULL
) RETURNS void AS $$
DECLARE it RECORD;
BEGIN
  SELECT * INTO it FROM dictionary_item WHERE dictionary_item_id = p_item FOR UPDATE;
  IF it IS NULL THEN
    RAISE EXCEPTION 'dictionary item % not found', p_item;
  END IF;
  IF it.hidden_at IS NOT NULL THEN
    RAISE EXCEPTION 'dictionary item % is already removed (%)', it.code, it.hidden_reason;
  END IF;

  UPDATE dictionary_item
     SET hidden_at = now(), hidden_by = p_actor, hidden_reason = 'RETIRED',
         is_active = false, binned_at = NULL, binned_by = NULL, purge_after = NULL
   WHERE dictionary_item_id = p_item;

  INSERT INTO dictionary_item_bin_event (dictionary_item_id, action, actor_id, actor_name, reason, item_code, item_label_en)
  VALUES (p_item, 'RETIRED', p_actor, p_actor_name, p_reason, it.code, it.label_en)
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- The timer. Called by the daily cron; returns how many it took so the job can
-- log a number. Sets hidden_at — it does NOT delete, which is the whole point.
CREATE OR REPLACE FUNCTION purge_dictionary_bin() RETURNS integer AS $$
DECLARE n integer;
BEGIN
  WITH due AS (
    SELECT dictionary_item_id, code, label_en
      FROM dictionary_item
     WHERE binned_at IS NOT NULL AND hidden_at IS NULL AND purge_after <= now()
     FOR UPDATE
  ), gone AS (
    UPDATE dictionary_item d
       SET hidden_at = now(), hidden_reason = 'PURGED', is_active = false,
           binned_at = NULL, purge_after = NULL
      FROM due WHERE d.dictionary_item_id = due.dictionary_item_id
    RETURNING d.dictionary_item_id, due.code, due.label_en
  )
  INSERT INTO dictionary_item_bin_event (dictionary_item_id, action, reason, item_code, item_label_en)
  SELECT dictionary_item_id, 'PURGED', '14-day retention elapsed', code, label_en FROM gone
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

-- ── 5. The door, bolted ─────────────────────────────────────────────────────
-- A hidden or binned item may not be attached to anything new. Enforced on the
-- four line tables that carry a dictionary_item_id, so no repo method can
-- reopen it by forgetting a filter. UPDATE is guarded too: moving an existing
-- line onto a removed item is the same act as creating one.
CREATE OR REPLACE FUNCTION assert_dictionary_item_selectable() RETURNS trigger AS $$
DECLARE it RECORD;
BEGIN
  IF NEW.dictionary_item_id IS NULL THEN RETURN NEW; END IF;
  -- Only re-check when the reference actually changes, so back-office updates
  -- to price or quantity on a historical line are never blocked by it.
  IF TG_OP = 'UPDATE' AND NEW.dictionary_item_id IS NOT DISTINCT FROM OLD.dictionary_item_id THEN
    RETURN NEW;
  END IF;
  SELECT code, hidden_at, hidden_reason, binned_at INTO it
    FROM dictionary_item WHERE dictionary_item_id = NEW.dictionary_item_id;
  IF it.hidden_at IS NOT NULL THEN
    RAISE EXCEPTION 'dictionary item % is no longer available', it.code;
  END IF;
  IF it.binned_at IS NOT NULL THEN
    RAISE EXCEPTION 'dictionary item % is in the recycle bin and cannot be used', it.code;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoice_line','journal_line','quotation_line','cash_request_line'] LOOP
    EXECUTE format(
      'CREATE OR REPLACE TRIGGER trg_%s_dict_selectable
         BEFORE INSERT OR UPDATE OF dictionary_item_id ON %I
         FOR EACH ROW EXECUTE FUNCTION assert_dictionary_item_selectable()', t, t);
  END LOOP;
END $$;

-- DOWN
-- Reversible, with one thing to weigh first: rolling back restores every
-- binned and retired item to full visibility, because the flags that hide them
-- are the columns being dropped. If anything has already been retired, capture
-- dictionary_item_bin_event before dropping it — that table is the only record
-- of which rows were removed and by whom.
--
--   CREATE TABLE dictionary_item_bin_event_backup AS
--     SELECT * FROM dictionary_item_bin_event;
--
-- DROP TRIGGER IF EXISTS trg_invoice_line_dict_selectable      ON invoice_line;
-- DROP TRIGGER IF EXISTS trg_journal_line_dict_selectable      ON journal_line;
-- DROP TRIGGER IF EXISTS trg_quotation_line_dict_selectable    ON quotation_line;
-- DROP TRIGGER IF EXISTS trg_cash_request_line_dict_selectable ON cash_request_line;
-- DROP FUNCTION IF EXISTS assert_dictionary_item_selectable();
-- DROP FUNCTION IF EXISTS purge_dictionary_bin();
-- DROP FUNCTION IF EXISTS retire_dictionary_item(uuid, uuid, text, text);
-- DROP FUNCTION IF EXISTS restore_dictionary_item(uuid, uuid, text);
-- DROP FUNCTION IF EXISTS bin_dictionary_item(uuid, uuid, text, text);
-- DROP FUNCTION IF EXISTS is_dictionary_item_used(uuid);
-- DROP TABLE IF EXISTS dictionary_item_bin_event;
-- DROP INDEX IF EXISTS ix_dict_purge_due;
-- DROP INDEX IF EXISTS ix_dict_visible;
-- ALTER TABLE dictionary_item
--   DROP CONSTRAINT IF EXISTS chk_dict_bin_pair,
--   DROP CONSTRAINT IF EXISTS chk_dict_hidden_pair,
--   DROP CONSTRAINT IF EXISTS chk_dict_hidden_reason,
--   DROP COLUMN IF EXISTS hidden_reason, DROP COLUMN IF EXISTS hidden_by,
--   DROP COLUMN IF EXISTS hidden_at,     DROP COLUMN IF EXISTS purge_after,
--   DROP COLUMN IF EXISTS binned_by,     DROP COLUMN IF EXISTS binned_at;
