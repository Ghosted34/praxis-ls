-- ============================================================================
-- TENANT DB — 13801 Budget Reconciliation: the line becomes writable, and
-- proof becomes real.
--
-- Owner decisions Q1–Q21, doc/RECONCILIATION_PROGRAMME_QUESTIONNAIRE.md §10.
-- Design: doc/RECONCILIATION_ENGINEERING_GUIDE.md.
--
-- ── THE HOLE THIS FILLS ─────────────────────────────────────────────────────
--
-- `dossier_reconciliation` shipped as a READ-ONLY PROJECTION of the ledger with
-- a signature on top. `actual_ht` is `SUM(cost_entry.amount)`; `doc_ref` is a
-- text column that `buildLines` writes as NULL on every line and no route ever
-- writes again; and there is no line-edit API at all — the service names that
-- absence as a safety property, twice.
--
-- So the three things an operator has to do — say whether a line needed
-- justification, attach the justification, and enter what was actually spent —
-- had no endpoint between them.
--
-- Worse, the one screen in the product that DOES ask for a spent amount is a
-- dead end. `cash_request.justify` refuses to close while a line carries
-- `justification_required` and no `proof_vault_id`; `JustifyForm` sends no
-- `proof_vault_id`, and the field is not even on the `CashLine` type. So a cash
-- request carrying `PORT_CHARGES` (seeded ALWAYS_REQUIRED, 9080:397) can be
-- raised, approved and disbursed, and then closed by nobody, ever.
--
-- ── ONE ROW PER FILE, WHOSE LINES ARE THE COSTING'S LINES (Q6) ─────────────
--
-- The legacy COPIED the costing's lines into `ocr_line` at draft time, and so
-- does today's `buildLines`. A copy is a decision to go stale: amend the
-- costing and the sheet is wrong until somebody rebuilds it, and rebuilding
-- destroys whatever a human typed. That is exactly why
-- `dossier_reconciliation.repo.deleteLines` carries the comment "DRAFT only —
-- there is no line-edit API, so no human-entered field is lost". The copy model
-- is only safe while nothing is typed, and the whole point of this migration is
-- that things get typed.
--
-- So the copy goes. The grid is PROJECTED from `costing_line` at read time
-- (see the guide §4.1), and this table stores ONLY what a person entered:
-- the actual, the date it was spent, the reason for an overrun, and the cash
-- returned. A costing line nobody has touched has NO ROW HERE — it still
-- renders, because the read starts from `costing_line`.
--
-- That is what makes the owner's worked example free: add demurrage to the
-- costing on day 12 and the line is simply there on the next read, on a sheet
-- that was settled last month, with every other line's typed values intact.
-- Nothing to sync, nothing to rebuild, nothing to lose.
--
-- ── TTC, AND EVERY LINE INCLUDING DÉBOURS (Q4, Q5) ─────────────────────────
--
-- 11740 renamed these columns to `*_ht` because they held HT, and excluded
-- débours from the grid citing OHADA_KB §450. Both were right for the MARGIN
-- question and both are wrong for the CASH question, which is the one this
-- module answers: "we disbursed 119 250 — is that what you spent?" Cash is TTC
-- and débours are most of what a cash request ever pays (all three items in the
-- owner's own example are débours). The `*_ht` columns are retired in place,
-- not dropped; the single HT margin figure is derived at read (guide §4.5).
--
-- ADDITIVE except for the duplicate collapse in §1, which is marked and which
-- only runs against mock data — the owner confirmed no real reconciliation
-- exists in any tenant (Q6).
-- SCHEMA-DUAL. Runs UNQUALIFIED, once per schema (live, then sandbox), which is
-- why every constraint guard below is scoped to `current_schema()` and not to
-- `conname` alone (13791).
-- ============================================================================

-- ── 1. One reconciliation per file, for ever (Q6) ───────────────────────────
--
-- "It is One reconciliation per file! Never 2, never more than 1." The old
-- model allowed one OPEN plus any number of closed ones, and the UI offered
-- "New draft" after validation — which is how a file ends up with a history
-- nobody can point at a single row of.
--
-- Owner-confirmed (Q6) that every reconciliation row in every tenant today is
-- mock data, so nothing true is lost; without this the UNIQUE below cannot be
-- added at all.
-- DESTRUCTIVE: collapses duplicate reconciliations per dossier, keeping the newest.
DELETE FROM dossier_reconciliation a
      USING dossier_reconciliation b
      WHERE a.dossier_id = b.dossier_id
        AND a.created_at < b.created_at;

-- A unique INDEX rather than a unique CONSTRAINT, and the difference matters
-- here for one reason: migrations above 13791 must not ADD CONSTRAINT to a
-- table they did not create (tests/unit/migration-constraint-ordering.test.js).
-- 13791 mirrors live's constraints into sandbox during provisioning and aborts
-- on a column it cannot see, so a constraint added up here reddens the
-- `migrations` job for every new tenant.
--
-- Nothing is lost. 13791 copies contype 'c' and 'f' only, so a unique index is
-- outside its remit entirely, and ON CONFLICT infers against a unique index
-- exactly as it does against a unique constraint — which is what repo.open
-- relies on to make two people opening the same file get the same row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reconciliation_one_per_dossier
  ON dossier_reconciliation (dossier_id);

ALTER TABLE dossier_reconciliation
  ADD COLUMN IF NOT EXISTS revision             integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS currency             char(3) NOT NULL DEFAULT 'XAF',
  ADD COLUMN IF NOT EXISTS exchange_rate_to_xaf numeric(18,6) NOT NULL DEFAULT 1,
  -- No REFERENCES: see the note on the unique index above. resolveActorId()
  -- already resolves the writer against the LIVE schema before every write
  -- here, which is the guarantee the FK would have given.
  ADD COLUMN IF NOT EXISTS settled_by           uuid,
  ADD COLUMN IF NOT EXISTS settled_at           timestamptz,
  ADD COLUMN IF NOT EXISTS returned_total       numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reopened_reason      text,
  ADD COLUMN IF NOT EXISTS submitted_note       text;

COMMENT ON COLUMN dossier_reconciliation.revision IS
  'Bumps every time the sheet re-opens after a settlement — a costing amendment, a further disbursement. One row per file for ever (Q6); the closed rounds live in dossier_reconciliation_settlement.';
COMMENT ON COLUMN dossier_reconciliation.returned_total IS
  'Cash disbursed, not spent, and handed back to the vault. Entered by Finance at settlement (Q14) — the answer to "what do operations still owe on this file".';

-- ── 2. The status vocabulary a living sheet needs (Q6) ──────────────────────
--
-- A sheet that never closes is never a DRAFT, and Finance SETTLES rather than
-- validates: the MD is TOLD, not asked (Q6, Q18). REJECTED is not a state a
-- living sheet rests in — a bounced sheet goes straight back to OPEN with the
-- reason on it, which is 12771's Q15 answer for the cash request, here.
--
-- 10715 declared the CHECK inline, so Postgres auto-named it.
-- DROP THE OLD CHECK BEFORE REWRITING THE VALUES, NOT AFTER.
--
-- This was the other way round when 13801 first shipped, and it took the
-- production deploy down (Deploy #437). 10715 declared the CHECK inline, so
-- Postgres auto-named it `dossier_reconciliation_status_check` and it permits
-- only DRAFT/SUBMITTED/VALIDATED/REJECTED. Setting a row to 'OPEN' while that
-- constraint is still in force raises 23514 and rolls the whole file back.
--
-- WHY NEITHER CI NOR `npm run ci` SAW IT. The `migrations` job provisions a
-- FRESH tenant, so `dossier_reconciliation` is empty: both UPDATEs match zero
-- rows, no row is ever checked, and the file passes. It only fails where rows
-- already exist — which is why it went green through CI, green on the live
-- schema (also empty), and failed on `sandbox`, the one schema carrying the
-- demo reconciliations. A migration whose failure needs pre-existing DATA is
-- invisible to a gate that starts from none.
--
-- tests/unit/migration-value-rewrite-ordering.test.js now fails this ordering
-- statically, so the next one costs nothing.
ALTER TABLE dossier_reconciliation DROP CONSTRAINT IF EXISTS dossier_reconciliation_status_check;

-- The old CHECK is NOT replaced with a new one, and that is a deliberate trade
-- rather than an oversight: a CHECK added to a pre-existing table above 13791
-- aborts provisioning for every new tenant.
--
-- So the vocabulary is enforced in code instead, which is what
-- migration-constraint-ordering's header prescribes. That is honest here
-- because `status` has exactly one writer — repo.setStatus, which takes literal
-- SQL from the service's own transitions and never a caller's string. There is
-- no path by which an arbitrary status reaches this column.
UPDATE dossier_reconciliation SET status = 'OPEN'    WHERE status IN ('DRAFT','REJECTED');
UPDATE dossier_reconciliation SET status = 'SETTLED' WHERE status = 'VALIDATED';

ALTER TABLE dossier_reconciliation ALTER COLUMN status SET DEFAULT 'OPEN';

-- ── 3. The line: keyed on the budget line, TTC, human fields only ───────────
--
-- `costing_line_id` is the grain (Q1), and the legacy agrees with itself here:
-- `ocr_line.costing_line_id` was MANDATORY at save (`save_draft.php`). So does
-- 12771, which put the same key on `cash_request_line` so a claim knows which
-- budget line it draws down. Three tables, one key, and the whole
-- budget → cash → actual chain joins without a human in the middle.
--
-- The old grain was `GROUP BY dictionary_item_id`, which fused two Port Charges
-- lines on one costing into one row — and a costing legitimately carries two
-- lines from one catalogue item (per-container demurrage; that is what
-- `container_type_ref_id` is for).
ALTER TABLE dossier_reconciliation_line
  -- No REFERENCES (see the unique-index note above). The service checks every
  -- costing_line_id against the file's own approved costing before it writes —
  -- repo.costingLineOnDossier, on every write path — which is a STRONGER
  -- guarantee than the FK: it refuses a line that exists but belongs to another
  -- file, which an FK would happily accept.
  ADD COLUMN IF NOT EXISTS costing_line_id  uuid,
  ADD COLUMN IF NOT EXISTS actual_ttc       numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actual_source    text NOT NULL DEFAULT 'DERIVED',
  ADD COLUMN IF NOT EXISTS spent_on         date,
  ADD COLUMN IF NOT EXISTS variance_reason  text,
  ADD COLUMN IF NOT EXISTS reason_group_id  uuid,
  ADD COLUMN IF NOT EXISTS returned_amount  numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_by       uuid,
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz;

-- NO CHECKS ON THIS TABLE, for the reason given on the unique index above.
-- Both rules that would have been CHECKs are enforced in code, and each has a
-- single writer, which is what makes that trade honest rather than a hole:
--
--   actual_source IN ('DERIVED','CONFIRMED','OVERRIDDEN')
--     Never taken from a caller. dossier_reconciliation.service.patchLine
--     DERIVES it by comparing the submitted amount against what the grid was
--     showing, and the PATCH validator is .strict() — a payload carrying
--     actual_source is refused outright rather than honoured.
--
--   actual_ttc >= 0 AND returned_amount >= 0
--     The validator's MONEY schema is z.coerce.number().min(0), applied to
--     every amount on the only two routes that write them.
--
-- tests/unit/budget-reconciliation-service.test.js pins both.

-- The sparse-row model depends on this: the writer upserts ON CONFLICT, so a
-- line the user touches twice updates rather than duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_line_costing_line
  ON dossier_reconciliation_line (reconciliation_id, costing_line_id)
  WHERE costing_line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_recon_line_reason_group
  ON dossier_reconciliation_line (reason_group_id)
  WHERE reason_group_id IS NOT NULL;

COMMENT ON COLUMN dossier_reconciliation_line.costing_line_id IS
  'The BUDGET LINE this actual accounts for (Q1). The grain of the whole module: the same key cash_request_line carries (12771), so budget, claim and actual join without a human in the middle.';
COMMENT ON COLUMN dossier_reconciliation_line.actual_ttc IS
  'What was really spent, TTC (Q4). The ONLY amount on this table that is not derived — everything else the grid shows is projected from costing_line and the budget ledger at read time.';
COMMENT ON COLUMN dossier_reconciliation_line.actual_source IS
  'DERIVED = nobody has touched it and the grid is showing the disbursed amount as a hypothesis. CONFIRMED = a person agreed with that number. OVERRIDDEN = a person replaced it. Confirming is a real act and is worth telling apart from never having looked.';
COMMENT ON COLUMN dossier_reconciliation_line.spent_on IS
  'When the money actually left, NOT when this row was written. Becomes journal_entry.entry_date at settlement, so a receipt handed in on Friday for a Tuesday payment posts to Tuesday (owner question under Q3).';
COMMENT ON COLUMN dossier_reconciliation_line.reason_group_id IS
  'One reason, several lines (Q12). A network outage at customs holds a container a day and demurrage, port storage and yard occupancy all move — that is one sentence, typed once, and the group id is what lets the statement say so rather than implying three independent judgements.';
COMMENT ON COLUMN dossier_reconciliation_line.returned_amount IS
  'Cash disbursed against this line, not spent, and returned to the vault. Finance enters it at settlement (Q14).';

-- Columns 11740 named for HT, retired by the TTC decision (Q4). Left in place
-- rather than dropped: dropping an applied column is destructive and buys
-- nothing, and 10741 set the precedent for retiring a structure by comment.
COMMENT ON COLUMN dossier_reconciliation_line.budget_ht IS
  'RETIRED by 13801 (owner decision Q4 — the grid is TTC). Not read, not written. Budget is projected from costing_line at read time.';
COMMENT ON COLUMN dossier_reconciliation_line.actual_ht IS
  'RETIRED by 13801 (owner decision Q4 — the grid is TTC). Not read, not written. See actual_ttc.';
COMMENT ON COLUMN dossier_reconciliation_line.doc_ref IS
  'RETIRED by 13801 (owner decision Q8 — proof is a vault document, not a typed reference). Never written by any code path even before this: buildLines set it NULL on every line. See dossier_reconciliation_document.';
COMMENT ON COLUMN dossier_reconciliation_line.doc_required IS
  'RETIRED by 13801 (owner decision Q9 — the CASH REQUEST is SSOT for the justification tick, not the catalogue). Derived at read from cash_request_line.justification_required.';

-- ── 4. Many documents per line (Q8) ─────────────────────────────────────────
--
-- "The first Maersk invoice for demurrage was for one day only, the second is
-- for two." One `proof_vault_id` column would make the second upload destroy
-- the first, which is the shape that loses evidence quietly. A join table also
-- lets the Operations file 360 group every cost proof by the line it belongs to
-- without a second concept.
CREATE TABLE IF NOT EXISTS dossier_reconciliation_document (
  recon_document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id           uuid NOT NULL REFERENCES dossier_reconciliation_line(line_id) ON DELETE CASCADE,
  doc_id            uuid NOT NULL REFERENCES document_vault(doc_id),
  note              text,
  uploaded_by       uuid REFERENCES app_user(user_id),
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (line_id, doc_id)
);

CREATE INDEX IF NOT EXISTS ix_recon_document_line
  ON dossier_reconciliation_document (line_id);

COMMENT ON TABLE dossier_reconciliation_document IS
  'Supporting documents proving what a budget line was actually spent on. MANY per line, deliberately (Q8): evidence arrives in rounds, and the second invoice must sit beside the first rather than replace it.';

-- ── 5. The settled rounds (Q6) ──────────────────────────────────────────────
--
-- One row per file means the sheet itself cannot carry its own history, and a
-- controlled document that forgets what it said in July is not one. Each
-- settlement writes its four totals here; re-opening bumps the revision and the
-- next settlement writes the next row.
CREATE TABLE IF NOT EXISTS dossier_reconciliation_settlement (
  settlement_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES dossier_reconciliation(reconciliation_id) ON DELETE CASCADE,
  revision          integer NOT NULL,
  budget_ttc        numeric(18,2) NOT NULL DEFAULT 0,
  disbursed_ttc     numeric(18,2) NOT NULL DEFAULT 0,
  actual_ttc        numeric(18,2) NOT NULL DEFAULT 0,
  returned_ttc      numeric(18,2) NOT NULL DEFAULT 0,
  settled_by        uuid REFERENCES app_user(user_id),
  settled_at        timestamptz NOT NULL DEFAULT now(),
  statement_doc_id  uuid REFERENCES document_vault(doc_id),
  UNIQUE (reconciliation_id, revision)
);

CREATE INDEX IF NOT EXISTS ix_recon_settlement
  ON dossier_reconciliation_settlement (reconciliation_id, settled_at DESC);

COMMENT ON TABLE dossier_reconciliation_settlement IS
  'One row per settled round. The sheet is one row per file for ever (Q6), so this is where "what did we close at in July" is answered.';

-- ── 6. cost_entry learns WHEN the money left, and WHICH budget line (Q3) ────
--
-- The owner's question under Q3 — "when do we actually post the entry? the
-- transaction happened 3 days ago" — found a real gap. `cost_entry` has no date
-- column at all (0320:33-42): `entry_date` is handed to
-- `journalEntry.buildAndInsert` and never reaches the cost entry row, so every
-- actual in the system is dated by when its paperwork was typed.
--
-- `costing_line_id` is the other half. Without it a posted actual cannot be
-- matched back to the budget line it belongs to, which is the join the whole
-- module is built on. NULL on entries written by the five orchestration
-- handlers that post against a dossier directly — see the guide §8.1, which is
-- a live policy gap and PR 2's problem.
ALTER TABLE cost_entry
  ADD COLUMN IF NOT EXISTS spent_on        date,
  -- No REFERENCES (see the unique-index note above). PR 2, which is what starts
  -- writing this, takes the id from the reconciliation line it is settling —
  -- and that line's id was already checked against the file's approved costing
  -- before it could be stored.
  ADD COLUMN IF NOT EXISTS costing_line_id uuid;

CREATE INDEX IF NOT EXISTS ix_cost_entry_costing_line
  ON cost_entry (costing_line_id) WHERE costing_line_id IS NOT NULL;

COMMENT ON COLUMN cost_entry.spent_on IS
  'The date the money actually left, as recorded by the person who spent it. NOT created_at, which is when the row was written. Becomes journal_entry.entry_date at posting, so the books date the transaction when it happened.';
COMMENT ON COLUMN cost_entry.costing_line_id IS
  'The budget line this actual belongs to. Written by Budget Reconciliation settlement; NULL on entries posted by other paths (guide §8.1).';

-- ── 7. The overspend allowance (Q13) ────────────────────────────────────────
--
-- "Tenant configure their overrun. They set 1000 and 2% and it permits that."
-- Both must be exceeded before a reason is demanded: 2% of a 2 500 000 customs
-- line is 50 000 and must be explained; 2% of a 5 000 line is 100 and must not.
-- Exact-equality on money that has been through a division is a bug generator —
-- `cash_request.disburse` already uses a ±1 XAF tolerance for the same reason.
--
-- `setting` is (section, key, value jsonb) with UNIQUE (section, key)
-- (0130:28), read through shared/config/settings.getSetting.
INSERT INTO setting (section, key, value)
VALUES ('finance', 'reconciliation',
        '{"overspend_allowance_amount": 1000,
          "overspend_allowance_percent": 2,
          "block_final_invoice": false}'::jsonb)
ON CONFLICT (section, key) DO NOTHING;

-- ── 8. Retire the AI matcher (Q20) ──────────────────────────────────────────
--
-- "From what I have described to you, what needs an AI? Justify. Prove, and I
-- can approve." The matcher existed to guess which dictionary item an untagged
-- cost entry belonged to. With the line keyed on `costing_line_id` and the
-- actual entered by the person who spent the money, there is nothing left to
-- guess.
--
-- DROPPED rather than commented-as-retired, which is the treatment 10741 gave
-- `pricing_variance`. The difference is that this table is inside the orphan
-- sweep's range (tests/security/mail-orphan-sweep.test.js), and that gate is
-- right: a table that no code reads or writes is a hole, not a record. The
-- honest choices were to drop it or to declare it "not built yet", and it IS
-- built — declaring otherwise would put a false statement in the tree to get a
-- gate green.
--
-- Its rows are AI proposals awaiting a human decision; with the matcher gone
-- nothing can ever decide them, so they are not data anybody loses.
-- DESTRUCTIVE: drops dossier_reconciliation_suggestion and every PROPOSED row on it.
DROP TABLE IF EXISTS dossier_reconciliation_suggestion;

-- DOWN
-- Additive except the §1 duplicate collapse, which cannot be undone (the rows
-- are gone; they were mock data). Everything else reverses with no data loss
-- BEYOND the human-entered fields, which is the whole point of the table — so
-- read the warning on the line columns before running any of it.
--
--   -- Recreated from 10741 verbatim. The ROWS are gone and cannot come back;
--   -- re-running the matcher is what would repopulate them.
--   CREATE TABLE IF NOT EXISTS dossier_reconciliation_suggestion (
--     suggestion_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--     reconciliation_id  uuid NOT NULL REFERENCES dossier_reconciliation(reconciliation_id) ON DELETE CASCADE,
--     cost_entry_id      uuid NOT NULL REFERENCES cost_entry(cost_entry_id),
--     suggested_dictionary_item_id uuid NOT NULL REFERENCES dictionary_item(dictionary_item_id),
--     confidence         numeric(5,4),
--     reason             text,
--     status             text NOT NULL DEFAULT 'PROPOSED'
--                          CHECK (status IN ('PROPOSED','CONFIRMED','REJECTED')),
--     decided_by         uuid REFERENCES app_user(user_id),
--     decided_at         timestamptz,
--     created_at         timestamptz NOT NULL DEFAULT now()
--   );
--   CREATE INDEX IF NOT EXISTS ix_recon_suggestion
--     ON dossier_reconciliation_suggestion(reconciliation_id, status);
--   DELETE FROM setting WHERE section = 'finance' AND key = 'reconciliation';
--   DROP INDEX IF EXISTS ix_cost_entry_costing_line;
--   ALTER TABLE cost_entry
--     DROP COLUMN IF EXISTS costing_line_id,
--     DROP COLUMN IF EXISTS spent_on;
--   DROP TABLE IF EXISTS dossier_reconciliation_settlement;
--   DROP TABLE IF EXISTS dossier_reconciliation_document;
--   DROP INDEX IF EXISTS ix_recon_line_reason_group;
--   DROP INDEX IF EXISTS uq_recon_line_costing_line;
--   -- DESTRUCTIVE: these columns hold what people typed — the actuals, the
--   -- dates, the overrun reasons, the cash returned. Nothing else in the
--   -- database holds them. Export before running this.
--   ALTER TABLE dossier_reconciliation_line
--     DROP COLUMN IF EXISTS updated_at, DROP COLUMN IF EXISTS updated_by,
--     DROP COLUMN IF EXISTS returned_amount, DROP COLUMN IF EXISTS reason_group_id,
--     DROP COLUMN IF EXISTS variance_reason, DROP COLUMN IF EXISTS spent_on,
--     DROP COLUMN IF EXISTS actual_source, DROP COLUMN IF EXISTS actual_ttc,
--     DROP COLUMN IF EXISTS costing_line_id;
--   ALTER TABLE dossier_reconciliation ALTER COLUMN status SET DEFAULT 'DRAFT';
--   ALTER TABLE dossier_reconciliation DROP CONSTRAINT IF EXISTS dossier_reconciliation_status_check;
--   UPDATE dossier_reconciliation SET status = 'DRAFT'     WHERE status = 'OPEN';
--   UPDATE dossier_reconciliation SET status = 'VALIDATED' WHERE status = 'SETTLED';
--   ALTER TABLE dossier_reconciliation ADD CONSTRAINT dossier_reconciliation_status_check
--     CHECK (status IN ('DRAFT','SUBMITTED','VALIDATED','REJECTED'));
--   ALTER TABLE dossier_reconciliation
--     DROP COLUMN IF EXISTS submitted_note, DROP COLUMN IF EXISTS reopened_reason,
--     DROP COLUMN IF EXISTS returned_total, DROP COLUMN IF EXISTS settled_at,
--     DROP COLUMN IF EXISTS settled_by, DROP COLUMN IF EXISTS exchange_rate_to_xaf,
--     DROP COLUMN IF EXISTS currency, DROP COLUMN IF EXISTS revision;
--   DROP INDEX IF EXISTS uq_reconciliation_one_per_dossier;
