-- ============================================================================
-- TENANT DB — 10717 Régie d'avance: retirement, and the columns the workflow
-- needs to be reversible, multi-currency and re-postable (KB §6.8).
--
-- WHAT WAS WRONG
--
-- `regie_advance` (0230:22) carries `justified_amount` and `returned_amount`.
-- `regie.rules.js:14` reads both to compute the open balance. NOTHING IN `src/`
-- EVER WRITES EITHER. They are 0 on insert and 0 forever.
--
-- The consequences compound:
--
--   * `openBalance()` is therefore identically equal to `amount`, so 581 never
--     clears for any advance ever issued;
--   * three of the five states in the CHECK constraint — PARTIALLY_JUSTIFIED,
--     JUSTIFIED, QUERIED — are unreachable, because the only writer of `state`
--     is `ageOne`, which writes AGED_UNJUSTIFIED;
--   * KB §6.8 steps 2, 3, 4 and 5 have no implementation at all;
--   * `cash_request.justify` (cash_request.service.js:149) marks the REQUEST
--     justified while its advance stays open, so the holder who accounted for
--     the money is later aged into 4211 as if they had not.
--
-- The missing piece is a place to record a retirement. Without a child table
-- there is nowhere to put "on the 3rd, 120,000 of this advance was spent on
-- dossier X and here is the receipt". This migration adds it.
--
-- WHY A CHILD TABLE AND NOT TWO RUNNING TOTALS
--
-- The totals already exist and are exactly the problem: a running total cannot
-- be audited, cannot be corrected, and cannot say WHICH dossier consumed the
-- money. `cash_request_payment` (0342) already models the same relationship on
-- the disbursal side — many payments against one request — so this is the
-- established shape, not a new idea. The totals on `regie_advance` stay, but
-- become a DERIVED CACHE recomputed from these rows (see regie.service.retire),
-- never incremented. An increment drifts the first time a retirement is voided.
--
-- WHY THREE `kind`s
--
-- KB §6.8 gives three distinct postings, and which account is debited is not
-- inferable from the amount alone:
--
--   RECEIPT      step 2   Dr 4731 Mandants (per dossier) / Cr 581
--   CASH_RETURN  step 3   Dr 571 Caisse                  / Cr 581
--   WRITE_OFF    step 5   Dr <write-off expense>         / Cr 581
--
-- Collapsing them would force the service to guess the debit account.
--
-- WHY dossier_id IS NULLABLE HERE BUT REQUIRED FOR RECEIPT
--
-- Only a RECEIPT is analytical — it is the line that lands in 4731, and 4731 is
-- `requires_analytic` (9001:113), so the ledger trigger `assert_line_valid`
-- (0640:159) will REFUSE a 4731 line with a NULL dossier_id anyway. A CASH_RETURN
-- to 571 has no dossier. The per-kind requirement is enforced in the validator
-- rather than as a table CHECK: a two-column conditional CHECK is harder to read
-- than one line of zod, and the DB already backstops the case that matters.
-- Deliberate, not an oversight.
--
-- ADDITIVE ONLY. No column is dropped or retyped; every ALTER is IF NOT EXISTS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS regie_retirement (
  regie_retirement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  regie_advance_id uuid NOT NULL REFERENCES regie_advance(regie_advance_id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('RECEIPT','CASH_RETURN','WRITE_OFF')),
  dossier_id       uuid REFERENCES dossier(dossier_id),
  amount           numeric(18,2) NOT NULL CHECK (amount > 0),
  proof_vault_id   uuid REFERENCES document_vault(doc_id),
  entry_id         uuid REFERENCES journal_entry(entry_id),
  memo             text,
  retired_on       date NOT NULL DEFAULT CURRENT_DATE,
  created_by       uuid REFERENCES app_user(user_id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE regie_retirement IS
  'One retirement of part (or all) of a régie advance — KB §6.8 steps 2/3/5. The advance''s justified_amount and returned_amount are RECOMPUTED from these rows, never incremented.';
COMMENT ON COLUMN regie_retirement.kind IS
  'RECEIPT → Dr 4731 per dossier; CASH_RETURN → Dr 571; WRITE_OFF → Dr write-off expense. All Cr 581.';
COMMENT ON COLUMN regie_retirement.dossier_id IS
  'Required for RECEIPT (validator-enforced): 4731 is requires_analytic, so the ledger trigger rejects a NULL dossier anyway. NULL for CASH_RETURN.';
COMMENT ON COLUMN regie_retirement.proof_vault_id IS
  'The receipt. KB §6.8 step 5: never invent a 4731 line without a document. Enforced by finance.regie.require_proof_for_receipt (seed 9094).';

-- The two reads this table gets: "all retirements of one advance" (detail view,
-- and the recompute in retire()) and the dossier roll-up.
CREATE INDEX IF NOT EXISTS ix_regie_retirement_advance ON regie_retirement(regie_advance_id);
CREATE INDEX IF NOT EXISTS ix_regie_retirement_dossier ON regie_retirement(dossier_id) WHERE dossier_id IS NOT NULL;

-- ── Columns regie_advance needs to close the loop ───────────────────────────
--
-- entity_id  — `issue()` takes an entityId to post with and then THROWS IT AWAY.
--              Every later posting for that advance (aging, retirement) needs
--              the same entity, which is why `ageDue` demands `entity_id` in its
--              request body — the schema gap leaking into the API. Storing it
--              lets the worker age an advance without being told which entity it
--              belongs to. Nullable: rows issued before this migration have none,
--              and the services fall back to the supplied argument.
--
-- closed_on  — when the advance reached JUSTIFIED. `updated_at` cannot answer
--              this; it moves on every touch.
--
-- aged_entry_id — the reclassification entry, so aging can be REVERSED. Without
--              it, aging is a one-way door: the balance sits in 4211 and a late
--              receipt cannot post against 581 because 581 is already flat.
--              Mirrors the existing `issue_entry_id`.
ALTER TABLE regie_advance ADD COLUMN IF NOT EXISTS entity_id     uuid REFERENCES corporate_entity(entity_id);
ALTER TABLE regie_advance ADD COLUMN IF NOT EXISTS closed_on     date;
ALTER TABLE regie_advance ADD COLUMN IF NOT EXISTS aged_entry_id uuid REFERENCES journal_entry(entry_id);

COMMENT ON COLUMN regie_advance.entity_id IS
  'Corporate entity the advance was posted against. Was passed to issue() and discarded; stored so later postings need not be told again.';
COMMENT ON COLUMN regie_advance.aged_entry_id IS
  'The Dr 4211 / Cr 581 aging entry, so unage() can reverse it. NULL unless the advance is (or was) AGED_UNJUSTIFIED.';

-- ── Multi-currency ──────────────────────────────────────────────────────────
--
-- `regie_advance.amount` is a bare numeric with NO CURRENCY — the only money
-- table in the costing set without one (`costing` carries both, 0320:10-11, and
-- 10692:95 notes the transit order does too). An advance drawn in EUR is
-- unrepresentable, and amount-threshold approval routing
-- (workflow_step.min_amount_xaf / max_amount_xaf, 0120:31) has nothing to
-- convert against. Defaults keep every existing row and the common case exact.
ALTER TABLE regie_advance ADD COLUMN IF NOT EXISTS currency char(3) NOT NULL DEFAULT 'XAF' REFERENCES currency(code);
ALTER TABLE regie_advance ADD COLUMN IF NOT EXISTS exchange_rate_to_xaf numeric(18,8) NOT NULL DEFAULT 1;

COMMENT ON COLUMN regie_advance.exchange_rate_to_xaf IS
  'Rate at issue. amount * this = XAF, which is what workflow_step threshold routing compares against.';

DO $$ BEGIN
  -- Same shape as chk_costing_fx_positive (0497:122) and chk_line_fx_rate_positive (0464).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_regie_advance_fx_positive') THEN
    ALTER TABLE regie_advance
      ADD CONSTRAINT chk_regie_advance_fx_positive CHECK (exchange_rate_to_xaf > 0) NOT VALID;
  END IF;
END $$;

-- NOTE — the constraint this design must respect, NOT re-add:
-- 0497_money_constraints.sql:137 already enforces
--   chk_regie_advance_consumed_within_amount
--     CHECK (justified_amount + returned_amount <= amount) NOT VALID
-- so over-retirement is already refused by the database. regie.service.retire
-- rejects it BEFORE the UPDATE so the caller gets a 422 naming the overage
-- rather than a raw constraint violation surfacing from inside a transaction.

-- DOWN
-- Additive: one table, five columns, one CHECK, two indexes.
-- DESTRUCTIVE — dropping regie_retirement destroys the audit trail of every
-- receipt, cash return and write-off ever recorded, and the advance totals
-- recomputed from them become unexplainable.
--
--   ALTER TABLE regie_advance DROP CONSTRAINT IF EXISTS chk_regie_advance_fx_positive;
--   ALTER TABLE regie_advance
--     DROP COLUMN IF EXISTS exchange_rate_to_xaf,
--     DROP COLUMN IF EXISTS currency,
--     DROP COLUMN IF EXISTS aged_entry_id,
--     DROP COLUMN IF EXISTS closed_on,
--     DROP COLUMN IF EXISTS entity_id;
--   DROP TABLE IF EXISTS regie_retirement;
