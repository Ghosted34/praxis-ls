-- ============================================================================
-- TENANT DB — 0640 "débours" → "disbursement" (terminology, full stack).
--
-- WHY
--
-- The schema was half-translated. posting_rule.applies_context has always spelt
-- the third leg in English ('sale' | 'purchase' | 'disbursement', 0200), while
-- everything around it kept the French: dictionary_item.direction 'DEBOURS',
-- dictionary_item.category 'debours', and an is_debours boolean on six tables.
-- The English UI then rendered the French word back at the user, so a Cameroon
-- forwarder reading an English screen met "Débours" sitting next to "Revenue"
-- and "Expense".
--
-- "Débours" is the correct FRENCH term and stays the French label. What this
-- migration removes is the French token from the stored vocabulary, so the
-- column and enum names match the language the rest of the schema is written
-- in. The user-facing strings are handled in the client (EN "Disbursement",
-- FR "Débours"); nothing here decides what a human reads.
--
-- WHAT THIS TOUCHES
--
--   is_debours  ->  is_disbursement    dictionary_item, posting_rule,
--                                      journal_line, invoice_line,
--                                      quotation_line, cash_request_line,
--                                      costing_line, margin_simulation_line
--                                      (discovered from information_schema, not
--                                       from a hand-written list — see §2)
--   invoice.debours_total            -> disbursement_total
--   dictionary_item.debours_vat_transparent
--                                    -> disbursement_vat_transparent
--   direction 'DEBOURS'              -> 'DISBURSEMENT'   (+ CHECK)
--   category  'debours'              -> 'disbursement'   (+ CHECK)
--   chk_debours_no_tax               -> chk_disbursement_no_tax
--   chk_invoice_debours_total_nonneg -> chk_invoice_disbursement_total_nonneg
--   assert_line_valid()              -> rewritten against the new column
--
-- NO COMPATIBILITY SHIM. There is no view or generated column preserving the
-- old names: a half-renamed schema is exactly the state this migration exists
-- to end, and leaving is_debours readable would let un-migrated code keep
-- compiling while silently reading a column that no longer moves. The server
-- and client are renamed in the same change.
--
-- ORDERING. ALTER ... RENAME COLUMN rewrites no rows and takes ACCESS EXCLUSIVE
-- only for the catalogue update, so this is fast on a populated tenant. The
-- data UPDATEs on direction/category do rewrite dictionary_item, which is ~180
-- rows — trivial. The CHECK constraints are dropped BEFORE the data update and
-- re-added after, because the old CHECK would reject 'DISBURSEMENT' mid-flight.
-- ============================================================================

-- ── 1. Drop the CHECKs that would reject the new vocabulary ─────────────────
-- Dropped first, re-added in §4 against the new values. IF EXISTS covers a
-- tenant provisioned before 0630 added chk_dict_direction.
ALTER TABLE dictionary_item DROP CONSTRAINT IF EXISTS chk_dict_direction;

DO $$ BEGIN
  -- category's CHECK is inline from 0200 and therefore system-named; find it
  -- by the column it guards rather than guessing the generated name.
  EXECUTE (
    SELECT string_agg(format('ALTER TABLE dictionary_item DROP CONSTRAINT %I', conname), '; ')
      FROM pg_constraint
     WHERE conrelid = 'dictionary_item'::regclass
       AND contype  = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%debours%'
       AND pg_get_constraintdef(oid) ILIKE '%category%'
  );
EXCEPTION WHEN OTHERS THEN NULL;   -- nothing matched: already migrated
END $$;

-- ── 2. Rename the columns ───────────────────────────────────────────────────
-- Driven off information_schema rather than a hand-written table list. The
-- first draft of this migration DID hand-write the list, built by grepping the
-- migration files, and missed costing_line and margin_simulation_line because
-- both declare the column with a trailing comment:
--
--     is_debours  boolean NOT NULL DEFAULT false,   -- excluded from margin (§6.7)
--
-- The schema is the only authority on which tables carry the column, so ask it.
-- This also means a tenant carrying a column some migration added out-of-band
-- is caught rather than silently left on the old name.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.columns
            WHERE table_schema = current_schema() AND column_name = 'is_debours'
  LOOP
    EXECUTE format('ALTER TABLE %I RENAME COLUMN is_debours TO is_disbursement', r.table_name);
    RAISE NOTICE '0640: renamed %.is_debours', r.table_name;
  END LOOP;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'invoice' AND column_name = 'debours_total') THEN
    ALTER TABLE invoice RENAME COLUMN debours_total TO disbursement_total;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema()
                AND table_name = 'dictionary_item'
                AND column_name = 'debours_vat_transparent') THEN
    ALTER TABLE dictionary_item
      RENAME COLUMN debours_vat_transparent TO disbursement_vat_transparent;
  END IF;
END $$;

-- ── 3. Rewrite the stored vocabulary ────────────────────────────────────────
-- DESTRUCTIVE, deliberately: the old tokens must not survive anywhere, or the
-- new CHECK in §4 fails and the picker filters silently miss rows. Both
-- statements are no-ops on a tenant that has already been migrated.
UPDATE dictionary_item SET direction = 'DISBURSEMENT' WHERE direction = 'DEBOURS';
UPDATE dictionary_item SET category  = 'disbursement' WHERE category  = 'debours';

-- ── 4. Re-add the CHECKs against the new vocabulary ─────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_dict_direction') THEN
    ALTER TABLE dictionary_item ADD CONSTRAINT chk_dict_direction
      CHECK (direction IN ('REVENUE','EXPENSE','DISBURSEMENT','ASSET'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_dict_category') THEN
    ALTER TABLE dictionary_item ADD CONSTRAINT chk_dict_category
      CHECK (category IN ('disbursement','service','overhead','asset','other'));
  END IF;
END $$;

-- ── 5. Rename the two constraints that carry the word in their own name ─────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_debours_no_tax') THEN
    ALTER TABLE invoice_line RENAME CONSTRAINT chk_debours_no_tax TO chk_disbursement_no_tax;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_invoice_debours_total_nonneg') THEN
    ALTER TABLE invoice RENAME CONSTRAINT chk_invoice_debours_total_nonneg
                                      TO chk_invoice_disbursement_total_nonneg;
  END IF;
END $$;

-- ── 6. The ledger invariant trigger ─────────────────────────────────────────
-- assert_line_valid() (0220) reads NEW.is_debours by name; a renamed column
-- would make it raise at runtime, not at migration time, so it is replaced
-- here rather than left to be discovered by a failing posting. Rules §23.3,
-- §23.4, §23.5 and §23.10 are carried across unchanged — only the identifier
-- and the two message strings move to English.
CREATE OR REPLACE FUNCTION assert_line_valid() RETURNS trigger AS $$
DECLARE acc RECORD;
BEGIN
  SELECT class, is_postable, requires_analytic INTO acc
    FROM chart_of_accounts WHERE code = NEW.account_code;
  IF acc IS NULL THEN
    RAISE EXCEPTION 'unknown account %', NEW.account_code;
  END IF;
  IF NOT acc.is_postable THEN
    RAISE EXCEPTION 'account % is not postable (KB §23.3)', NEW.account_code;
  END IF;
  IF NEW.is_disbursement AND acc.class IN (6,7) THEN
    RAISE EXCEPTION 'disbursement line may not post to class 6/7 (account %, KB §23.4)', NEW.account_code;
  END IF;
  IF NEW.is_disbursement AND NEW.tax_code_id IS NOT NULL THEN
    RAISE EXCEPTION 'no VAT/tax may attach to a disbursement line (KB §23.5)';
  END IF;
  IF acc.requires_analytic AND NEW.dossier_id IS NULL THEN
    RAISE EXCEPTION 'account % requires a dossier_id (analytical completeness, KB §23.10)', NEW.account_code;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 7. The same leak in the chart of accounts ───────────────────────────────
-- 4731 was seeded twice with two different English labels, both of which put
-- the French word in the English column: 'Principals (débours account)' (9000)
-- and 'Re-billable débours' (9001). Whichever ran last, an English trial
-- balance prints the French term. The FRENCH labels are correct and untouched.
UPDATE chart_of_accounts SET label_en = 'Principals (disbursement clearing account)'
 WHERE code = '4731' AND label_en IN ('Principals (débours account)','Re-billable débours');
UPDATE chart_of_accounts SET label_en = replace(label_en, 'débours', 'disbursement')
 WHERE label_en LIKE '%débours%';

-- ── 8. Indexes carrying the old name ────────────────────────────────────────
-- ix_dict_direction (0630) indexes the values we just rewrote. The index itself
-- is still correct — Postgres reindexes on UPDATE — so nothing to rebuild; only
-- a partial index WITH the literal in its predicate would need attention, and
-- there is none. Recorded so the next reader does not go looking.

-- DOWN
-- Reversible in full: this migration moves names, not data. Every value that
-- changes ('DEBOURS' -> 'DISBURSEMENT', 'debours' -> 'disbursement') is drawn
-- from a closed set, so the reverse mapping is exact and loses nothing.
--
-- The application must be rolled back FIRST — server and client are renamed in
-- the same release, and code expecting is_disbursement against a reverted
-- schema fails on every dictionary read.
--
-- ALTER TABLE dictionary_item   DROP CONSTRAINT IF EXISTS chk_dict_direction;
-- ALTER TABLE dictionary_item   DROP CONSTRAINT IF EXISTS chk_dict_category;
-- UPDATE dictionary_item SET direction = 'DEBOURS'  WHERE direction = 'DISBURSEMENT';
-- UPDATE dictionary_item SET category  = 'debours'  WHERE category  = 'disbursement';
-- ALTER TABLE dictionary_item   ADD CONSTRAINT chk_dict_direction
--   CHECK (direction IN ('REVENUE','EXPENSE','DEBOURS','ASSET'));
-- ALTER TABLE dictionary_item   ADD CONSTRAINT chk_dict_category
--   CHECK (category IN ('debours','service','overhead','asset','other'));
-- ALTER TABLE dictionary_item   RENAME COLUMN is_disbursement TO is_debours;
-- ALTER TABLE posting_rule      RENAME COLUMN is_disbursement TO is_debours;
-- ALTER TABLE journal_line      RENAME COLUMN is_disbursement TO is_debours;
-- ALTER TABLE invoice_line      RENAME COLUMN is_disbursement TO is_debours;
-- ALTER TABLE quotation_line    RENAME COLUMN is_disbursement TO is_debours;
-- ALTER TABLE cash_request_line RENAME COLUMN is_disbursement TO is_debours;
-- ALTER TABLE costing_line      RENAME COLUMN is_disbursement TO is_debours;
-- ALTER TABLE margin_simulation_line RENAME COLUMN is_disbursement TO is_debours;
-- ALTER TABLE invoice           RENAME COLUMN disbursement_total TO debours_total;
-- ALTER TABLE dictionary_item   RENAME COLUMN disbursement_vat_transparent TO debours_vat_transparent;
-- ALTER TABLE invoice_line RENAME CONSTRAINT chk_disbursement_no_tax TO chk_debours_no_tax;
-- ALTER TABLE invoice      RENAME CONSTRAINT chk_invoice_disbursement_total_nonneg
--                                         TO chk_invoice_debours_total_nonneg;
-- -- and restore assert_line_valid() from 0220 verbatim (it reads the column by
-- -- name, so the renamed body raises at posting time, not at rollback time).
-- -- The chart_of_accounts label_en edits in §7 are cosmetic English text; they
-- -- need no undo, and reverting them would only put the French word back.
