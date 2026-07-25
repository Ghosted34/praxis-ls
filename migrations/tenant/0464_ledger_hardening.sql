-- ============================================================================
-- TENANT DB — 0464 ledger hardening (KB §23 defence-in-depth). Closes the gaps
-- where an invariant was enforced only in the app layer (finance/journal_entry),
-- so a bad write is rejected regardless of which service — or direct SQL —
-- issues it. Idempotent. KB governs.
-- ============================================================================

-- §23.6 no compensation — an account may not be both debited and credited within
-- one entry (post the net). Was app-only (journal_entry.rules); now DB-enforced.
-- Deferred so the entry + all its lines can be assembled inside one transaction.
CREATE OR REPLACE FUNCTION assert_no_compensation() RETURNS trigger AS $$
DECLARE dup text;
BEGIN
  SELECT account_code INTO dup FROM (
    SELECT account_code FROM journal_line WHERE entry_id = NEW.entry_id AND debit  > 0
    INTERSECT
    SELECT account_code FROM journal_line WHERE entry_id = NEW.entry_id AND credit > 0
  ) x LIMIT 1;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'account % is both debited and credited in entry % — post the net (KB §23.6)', dup, NEW.entry_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_entry_no_compensation ON journal_entry;
CREATE CONSTRAINT TRIGGER trg_entry_no_compensation
  AFTER INSERT OR UPDATE ON journal_entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.status = 'validated')
  EXECUTE FUNCTION assert_no_compensation();

-- Period discipline — a VALIDATED entry must sit in an OPEN period and its date
-- must fall within that period's bounds. Blocks posting into a FROZEN/CLOSED
-- period (§ period lock / §23.9) no matter the caller. Drafts are unconstrained.
CREATE OR REPLACE FUNCTION assert_period_open() RETURNS trigger AS $$
DECLARE p RECORD;
BEGIN
  IF NEW.status <> 'validated' THEN RETURN NEW; END IF;
  SELECT status, starts_on, ends_on INTO p FROM accounting_period WHERE period_id = NEW.period_id;
  IF p IS NULL THEN
    RAISE EXCEPTION 'entry % references a missing accounting period', NEW.entry_id;
  END IF;
  IF p.status <> 'OPEN' THEN
    RAISE EXCEPTION 'cannot post a validated entry into a % period (KB §23.9)', p.status;
  END IF;
  IF NEW.entry_date < p.starts_on OR NEW.entry_date > p.ends_on THEN
    RAISE EXCEPTION 'entry_date % is outside its period [% .. %]', NEW.entry_date, p.starts_on, p.ends_on;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_entry_period_open ON journal_entry;
CREATE TRIGGER trg_entry_period_open
  BEFORE INSERT OR UPDATE ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION assert_period_open();

-- §23.16 corrections are ONE linked reversal — never over-reverse. At most one
-- validated reversal may target a given entry.
CREATE UNIQUE INDEX IF NOT EXISTS ux_one_reversal_per_entry
  ON journal_entry(corrects_entry_id)
  WHERE corrects_entry_id IS NOT NULL AND status = 'validated';

-- A posted line's FX rate must be positive (foreign-currency lines carry a real
-- rate; XAF stays 1). Guarded so re-running the migration is safe.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_line_fx_rate_positive') THEN
    ALTER TABLE journal_line ADD CONSTRAINT chk_line_fx_rate_positive CHECK (fx_rate > 0);
  END IF;
END $$;
