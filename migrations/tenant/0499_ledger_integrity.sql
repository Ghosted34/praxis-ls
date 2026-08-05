-- 0499 — Multi-currency balance, tax-window overlap, locked-document
--        immutability, and the inventory audit trail.
--
-- DATA 1.3, 1.8, 6.2, 6.4, 6.5. Five findings whose common shape is: the
-- guarantee is described somewhere — a column, a comment, a doc section — and
-- nothing in the database enforces it.

-- ======================= 1.3: multi-currency balance =======================
-- journal_line carries `currency` and `fx_rate`, and NOTHING reads them.
-- assert_entry_balanced sums raw debit/credit with no currency grouping and no
-- conversion, and the app pre-check (journal_entry.rules.js) does not read
-- `currency` at all.
--
-- So an entry with a USD 1000.00 debit and an XAF 1000.00 credit passes BOTH
-- layers as balanced. And because no converted amount is stored, a
-- multi-currency entry cannot be reported in XAF at all — the trial balance
-- adds USD and XAF as though they were the same unit.
--
-- Two changes:
--   1. a stored base-currency amount on the line, so the ledger can be reported
--   2. a balance trigger that sums the BASE amounts, so it actually balances
--
-- debit_base/credit_base are GENERATED, not application-written. A derived
-- column that the app has to remember to fill is the same class of bug as
-- cached_receivables (DATA 1.9) — permanently wrong the first time someone
-- forgets. Generated means it cannot drift.
--
-- fx_rate defaults to 1, so a single-currency ledger is unaffected: base equals
-- face value and the trigger behaves exactly as before.

ALTER TABLE journal_line
  ADD COLUMN IF NOT EXISTS debit_base numeric(18,2)
    GENERATED ALWAYS AS (ROUND(debit * COALESCE(fx_rate, 1), 2)) STORED;
ALTER TABLE journal_line
  ADD COLUMN IF NOT EXISTS credit_base numeric(18,2)
    GENERATED ALWAYS AS (ROUND(credit * COALESCE(fx_rate, 1), 2)) STORED;

COMMENT ON COLUMN journal_line.debit_base IS
  'Debit converted to the entity base currency at fx_rate. GENERATED — never written by the application (DATA 1.3).';
COMMENT ON COLUMN journal_line.credit_base IS
  'Credit converted to the entity base currency at fx_rate. GENERATED (DATA 1.3).';

-- Balance on the BASE amounts. Rounding is why the comparison has a tolerance:
-- two lines each rounded to 2dp can differ by a centime on a mixed-currency
-- entry, and failing a genuinely balanced entry over 0.01 would be worse than
-- the bug. One centime per line is the documented allowance.
CREATE OR REPLACE FUNCTION assert_entry_balanced() RETURNS trigger AS $$
DECLARE
  d numeric; c numeric; n integer; tol numeric;
BEGIN
  SELECT COALESCE(SUM(debit_base),0), COALESCE(SUM(credit_base),0), COUNT(*)
    INTO d, c, n FROM journal_line WHERE entry_id = NEW.entry_id;
  IF n < 2 THEN
    RAISE EXCEPTION 'entry % must have at least two lines', NEW.entry_id;
  END IF;
  tol := 0.01 * n;
  IF ABS(d - c) > tol THEN
    RAISE EXCEPTION 'entry % not balanced in base currency: Dr % <> Cr % (tolerance %) (KB §23.1, DATA 1.3)',
      NEW.entry_id, d, c, tol;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ==================== 1.8: overlapping tax windows ====================
-- tax_code has effective_from/effective_to and a CHECK that one is after the
-- other, but nothing stops TWO overlapping rows for the same
-- (jurisdiction_id, code). The migration's own comment concedes it: "no
-- overlapping windows is enforced in app". The app does not enforce it either —
-- assertEffectiveWindow compares the new row's own two dates and nothing else.
--
-- Two overlapping VAT rows then resolve silently: determination.js takes
-- ORDER BY effective_from DESC LIMIT 1. The WRONG RATE is applied to every
-- invoice from that date, with no error and no flag.
--
-- An EXCLUSION constraint is the right tool — it is the only thing that can
-- express "no two rows may overlap on a range" declaratively. NOT VALID so it
-- cannot fail on historical overlaps; probe and VALIDATE afterwards.
--
-- daterange with '[)' bounds: effective_to is INCLUSIVE in this schema (the
-- supersede path sets it to the day BEFORE the successor starts), so the upper
-- bound is +1 day to make an inclusive end an exclusive range.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE tax_code ADD CONSTRAINT excl_tax_code_no_overlap
  EXCLUDE USING gist (
    jurisdiction_id WITH =,
    code WITH =,
    daterange(effective_from, COALESCE(effective_to + 1, 'infinity'::date), '[)') WITH &&
  ) NOT VALID;

-- expense_rate has the same shape AND lacks even the sanity check.
ALTER TABLE expense_rate ADD CONSTRAINT chk_expense_rate_window
  CHECK (effective_to IS NULL OR effective_to >= effective_from) NOT VALID;

-- ================== 6.2: the tamper-evidence chain ==================
-- immutable_ledger.before_hash / after_hash exist as columns and the only
-- writer never populates either. doc/DB_ARCHITECTURE.md §4.4 describes the
-- ledger as carrying them.
--
-- Without a chain the row trigger prevents in-place edits, but nothing detects
-- a restore-from-backup with rows REMOVED — and TRUNCATE does not fire row
-- triggers at all.
--
-- Computed in the DATABASE, by trigger, not in the application. An app-computed
-- hash is only as good as every call site remembering to compute it, and the
-- whole finding is that one did not. A trigger cannot be bypassed by a write
-- that skips the service layer, which is precisely the gap 6.3 describes.
CREATE OR REPLACE FUNCTION ledger_chain_hash() RETURNS trigger AS $$
DECLARE
  prev text;
BEGIN
  -- before_hash is the previous row's after_hash: that is the chain. Ordering
  -- by ledger_id keeps it deterministic under concurrent inserts.
  SELECT after_hash INTO prev
    FROM immutable_ledger
   ORDER BY ledger_id DESC
   LIMIT 1;

  NEW.before_hash := prev;
  NEW.after_hash := encode(
    digest(
      COALESCE(prev, '') ||
      COALESCE(NEW.actor_user_id::text, '') ||
      COALESCE(NEW.action, '') ||
      COALESCE(NEW.module_key, '') ||
      COALESCE(NEW.entity_ref, '') ||
      COALESCE(NEW.before_json::text, '') ||
      COALESCE(NEW.after_json::text, '') ||
      COALESCE(NEW.created_at::text, now()::text),
      'sha256'),
    'hex');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_chain ON immutable_ledger;
CREATE TRIGGER trg_ledger_chain
  BEFORE INSERT ON immutable_ledger
  FOR EACH ROW EXECUTE FUNCTION ledger_chain_hash();

-- ============ 6.4: stock_movement is not actually append-only ============
-- inventory.repo.js calls it "its append-only movement journal". It had no
-- forbid_mutation trigger — unlike event_log and immutable_ledger, which do —
-- so rows could be updated or deleted freely. 0498 stopped the cascade; this
-- stops direct mutation.
DROP TRIGGER IF EXISTS trg_stock_movement_ro ON stock_movement;
CREATE TRIGGER trg_stock_movement_ro
  BEFORE UPDATE OR DELETE ON stock_movement
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ============ 6.5: locked documents are protected only in code ============
-- invoice/costing/quotation/supplier_invoice totals are updated in place. That
-- is correct for DRAFT. For a locked document the immutability guarantee rested
-- ENTIRELY on service-level status checks — a direct UPDATE on a POSTED_LOCKED
-- invoice succeeded.
--
-- The ledger already has exactly this trigger (protect_validated_entry). This
-- is the same idea for documents: once locked, the money fields freeze.
-- Workflow fields (status, attestation, review) stay editable, because a locked
-- document still has a lifecycle.
CREATE OR REPLACE FUNCTION protect_locked_document() RETURNS trigger AS $$
BEGIN
  IF OLD.status IS NOT NULL AND OLD.status LIKE '%LOCKED%' THEN
    IF NEW.total_ttc IS DISTINCT FROM OLD.total_ttc
       OR NEW.doc_number IS DISTINCT FROM OLD.doc_number THEN
      RAISE EXCEPTION
        'document % is % — totals and document number are immutable once locked (DATA 6.5)',
        OLD.invoice_id, OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_locked ON invoice;
CREATE TRIGGER trg_invoice_locked
  BEFORE UPDATE ON invoice
  FOR EACH ROW EXECUTE FUNCTION protect_locked_document();


-- ================== 1.4: currency typing is inconsistent ==================
-- Eight char(3) currency columns reference currency(code); these seven,
-- identical in shape, do not — and the unconstrained set INCLUDES THE LEDGER.
-- The same logical domain modelled two ways in one database means a typo'd or
-- retired code lands silently, and every FX lookup keyed on it then misses.
--
-- NOT VALID: a historical row carrying a code that is not in the `currency`
-- table must not fail the migration. Probe and VALIDATE afterwards.

ALTER TABLE dictionary_item ADD CONSTRAINT fk_dictionary_item_currency
  FOREIGN KEY (currency) REFERENCES currency(code) NOT VALID;
ALTER TABLE expense_rate ADD CONSTRAINT fk_expense_rate_currency
  FOREIGN KEY (currency) REFERENCES currency(code) NOT VALID;
ALTER TABLE tax_jurisdiction ADD CONSTRAINT fk_tax_jurisdiction_currency
  FOREIGN KEY (currency) REFERENCES currency(code) NOT VALID;
ALTER TABLE journal_line ADD CONSTRAINT fk_journal_line_currency
  FOREIGN KEY (currency) REFERENCES currency(code) NOT VALID;
ALTER TABLE treasury_account ADD CONSTRAINT fk_treasury_account_currency
  FOREIGN KEY (currency) REFERENCES currency(code) NOT VALID;
ALTER TABLE invoice ADD CONSTRAINT fk_invoice_currency
  FOREIGN KEY (currency) REFERENCES currency(code) NOT VALID;
ALTER TABLE costing ADD CONSTRAINT fk_costing_currency
  FOREIGN KEY (currency) REFERENCES currency(code) NOT VALID;

-- DOWN
-- Reversible. Reverting re-opens each finding but loses no data. The generated
-- columns hold no independent information — they are derived from debit/credit
-- and fx_rate, so dropping them discards nothing.
--
-- DROP TRIGGER IF EXISTS trg_invoice_locked ON invoice;
-- DROP FUNCTION IF EXISTS protect_locked_document();
-- DROP TRIGGER IF EXISTS trg_stock_movement_ro ON stock_movement;
-- DROP TRIGGER IF EXISTS trg_ledger_chain ON immutable_ledger;
-- DROP FUNCTION IF EXISTS ledger_chain_hash();
-- ALTER TABLE expense_rate DROP CONSTRAINT IF EXISTS chk_expense_rate_window;
-- ALTER TABLE tax_code DROP CONSTRAINT IF EXISTS excl_tax_code_no_overlap;
-- ALTER TABLE journal_line DROP COLUMN IF EXISTS credit_base;
-- ALTER TABLE journal_line DROP COLUMN IF EXISTS debit_base;
-- -- and restore the pre-0499 assert_entry_balanced(), which summed raw
-- -- debit/credit rather than the base amounts:
-- CREATE OR REPLACE FUNCTION assert_entry_balanced() RETURNS trigger AS $$
-- DECLARE d numeric; c numeric; n integer;
-- BEGIN
--   SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0), COUNT(*)
--     INTO d, c, n FROM journal_line WHERE entry_id = NEW.entry_id;
--   IF n < 2 THEN RAISE EXCEPTION 'entry % must have at least two lines', NEW.entry_id; END IF;
--   IF d <> c THEN RAISE EXCEPTION 'entry % not balanced: Dr % <> Cr %', NEW.entry_id, d, c; END IF;
--   RETURN NULL;
-- END; $$ LANGUAGE plpgsql;
--
-- ALTER TABLE dictionary_item DROP CONSTRAINT IF EXISTS fk_dictionary_item_currency;
-- ALTER TABLE expense_rate DROP CONSTRAINT IF EXISTS fk_expense_rate_currency;
-- ALTER TABLE tax_jurisdiction DROP CONSTRAINT IF EXISTS fk_tax_jurisdiction_currency;
-- ALTER TABLE journal_line DROP CONSTRAINT IF EXISTS fk_journal_line_currency;
-- ALTER TABLE treasury_account DROP CONSTRAINT IF EXISTS fk_treasury_account_currency;
-- ALTER TABLE invoice DROP CONSTRAINT IF EXISTS fk_invoice_currency;
-- ALTER TABLE costing DROP CONSTRAINT IF EXISTS fk_costing_currency;
