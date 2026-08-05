-- 0505 — Close the §23.14 dictionary invariant (DATA 1.7) and record the
--        ON UPDATE decision on natural-key foreign keys (DATA 2.3).
--
-- ══ PART 1 — DATA 1.7 ═══════════════════════════════════════════════════════
--
-- KB §23 rule 14: "a dictionary item cannot exist without at least one complete
-- posting rule". 0200 enforces that with a DEFERRABLE constraint trigger — but
-- only `AFTER INSERT ON dictionary_item`.
--
-- The invariant is therefore ONE-DIRECTIONAL. It stops you creating an item
-- with no rule; it does nothing about deleting the last rule out from under an
-- item that already exists. `DELETE FROM posting_rule WHERE ...` leaves the
-- item rule-less and the documented invariant broken, silently.
--
-- The consequence is not cosmetic: an item with no posting rule has no account
-- to post to, so a costing line referencing it fails at posting time — long
-- after the delete, in a different module, with an error that names neither.
--
-- Closed from the other side: a constraint trigger AFTER DELETE OR UPDATE on
-- posting_rule re-checks the item it just orphaned.
--
--   * DEFERRABLE INITIALLY DEFERRED, matching 0200, so a legitimate
--     "replace this item's rules" transaction (delete all, insert new) is fine
--     — the check runs at COMMIT, by which time the new rules exist.
--   * AFTER DELETE OR UPDATE, because re-pointing a rule's
--     `dictionary_item_id` orphans the OLD item just as surely as deleting it.
--   * Skips the check when the item itself is gone: deleting an item and its
--     rules together is legitimate, and the invariant is about items that
--     EXIST having rules, not about rules having items (that is the FK's job).
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_postrule_keeps_dict_rule ON posting_rule;
--   DROP FUNCTION IF EXISTS assert_dictionary_still_has_rule();

CREATE OR REPLACE FUNCTION assert_dictionary_still_has_rule() RETURNS trigger AS $$
BEGIN
  -- The item may have been deleted in the same transaction, which is fine:
  -- the invariant constrains items that exist, not rules that don't.
  IF NOT EXISTS (
    SELECT 1 FROM dictionary_item di
     WHERE di.dictionary_item_id = OLD.dictionary_item_id
  ) THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM posting_rule pr
     WHERE pr.dictionary_item_id = OLD.dictionary_item_id
  ) THEN
    RAISE EXCEPTION
      'dictionary_item % would be left with no posting_rule (KB §23.14)',
      OLD.dictionary_item_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Guarded for the same reason 0496/0499/0500 now are: this tenant estate has
-- proven schema drift (DATA 3.3), and a missing table would roll the whole
-- file back — taking the DATA 2.3 column comments with it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_name = 'posting_rule'
  ) THEN
    RAISE WARNING '[0505] %: posting_rule absent — the §23.14 invariant is NOT enforced on this tenant.', current_schema();
    RETURN;
  END IF;
  EXECUTE 'DROP TRIGGER IF EXISTS trg_postrule_keeps_dict_rule ON posting_rule';
  EXECUTE 'CREATE CONSTRAINT TRIGGER trg_postrule_keeps_dict_rule '
       || 'AFTER DELETE OR UPDATE ON posting_rule '
       || 'DEFERRABLE INITIALLY DEFERRED '
       || 'FOR EACH ROW EXECUTE FUNCTION assert_dictionary_still_has_rule()';
  RAISE NOTICE '[0505] %: §23.14 invariant now enforced on delete/update.', current_schema();
END $$;


-- ══ PART 2 — DATA 2.3 ═══════════════════════════════════════════════════════
--
-- Zero of 351 foreign keys declare ON UPDATE. For UUID surrogate keys that is
-- irrelevant — nothing renames a uuid. It matters only for the NATURAL TEXT
-- keys: `chart_of_accounts.code` and `currency.code`, which are referenced by
-- twelve and several columns respectively.
--
-- THE DECISION, recorded rather than left as a default:
--
--   ON UPDATE stays NO ACTION. A posted account code is immutable.
--
-- The audit is right that `NO ACTION` here is arguably the CORRECT behaviour
-- for a statutory chart of accounts — OHADA account codes are prescribed, and a
-- code that has been posted to identifies those postings forever. Renaming it
-- would silently rewrite the meaning of history: a trial balance re-run over a
-- prior period would attribute old entries to the new code, and no audit record
-- would show that the account had ever been called anything else.
--
-- ON UPDATE CASCADE would make that rename SUCCEED silently across twelve
-- tables, which is the genuinely dangerous option. The status quo blocks it
-- with a foreign-key violation.
--
-- So the fix here is NOT to change the behaviour. It is to make the behaviour
-- INTENTIONAL AND DISCOVERABLE, because the audit's actual complaint was that
-- it is "undocumented, and the COA service exposes edit paths" — a maintainer
-- reading the schema could not tell a deliberate restriction from an oversight,
-- and the next person to hit the FK violation would have been quite likely to
-- "fix" it by adding CASCADE.
--
-- COMMENT ON is the right instrument: it lives in the database, survives
-- dump/restore, and shows up in \d+ and every schema browser.
--
-- ROLLBACK: comments only; `COMMENT ON ... IS NULL` removes them. No data or
-- constraint is touched by this part.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'chart_of_accounts'
       AND column_name = 'code'
  ) THEN
    EXECUTE format(
      'COMMENT ON COLUMN %I.chart_of_accounts.code IS %L',
      current_schema(),
      'Statutory OHADA account code. IMMUTABLE ONCE POSTED TO, by design '
      || '(DATA 2.3): every FK referencing it is ON UPDATE NO ACTION, so a '
      || 'rename is refused rather than cascaded. Renaming a posted code would '
      || 'silently rewrite the meaning of historical entries. To retire an '
      || 'account, deactivate it and create the replacement.'
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'currency'
       AND column_name = 'code'
  ) THEN
    EXECUTE format(
      'COMMENT ON COLUMN %I.currency.code IS %L',
      current_schema(),
      'ISO 4217 code. IMMUTABLE ONCE REFERENCED, by design (DATA 2.3): FKs are '
      || 'ON UPDATE NO ACTION. ISO codes do not get renamed in place; a '
      || 'redenomination is a new code.'
    );
  END IF;
END $$;
