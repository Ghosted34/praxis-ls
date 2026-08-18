-- ============================================================================
-- TENANT DB — 10719 Cash request: disbursement in instalments.
--
-- WHAT WAS WRONG
--
-- `cash_request_payment` (0342:89) has existed since the module shipped, is
-- one-to-many on `cash_request`, carries `treasury_account_id`, `amount`,
-- `paid_on` and `entry_id`, and got a FK hardening in 0498 and a non-negative
-- CHECK in 0497. NOTHING HAS EVER WRITTEN A ROW TO IT. `insertPayment` exists in
-- the repo and has exactly two references — its own definition and its export.
--
-- Meanwhile `disburse` took no amount at all: it issued ONE régie advance for
-- the whole of `cash_request.amount` and set the status straight to DISBURSED.
-- A request paid in two instalments — which is normal when the treasury cannot
-- release the full float at once — had nowhere to record the first payment, and
-- read as fully DISBURSED the moment any money moved.
--
-- WHY `PARTIALLY_DISBURSED` COULD NOT SIMPLY BE ADDED TO THE CHECK
--
-- It was proposed as "a CHECK change plus a NEXT entry". That would have
-- produced A STATE NOTHING CAN WRITE, because no code path computes how much of
-- a request has been paid. That is the same defect Landing A had to repair on
-- `regie_advance` (`justified_amount` / `returned_amount` were read by
-- `openBalance` and written by nothing, leaving three of five states
-- unreachable). The state is only meaningful once the payments it is derived
-- from are actually recorded, so this migration adds the recording first.
--
-- ── WHAT THIS ADDS ──────────────────────────────────────────────────────────
--
-- 1. `PARTIALLY_DISBURSED` in the status CHECK. Widening only; every existing
--    row still satisfies it.
--
-- 2. `disbursed_amount` on `cash_request` — a DERIVED CACHE of
--    `SUM(cash_request_payment.amount)`, recomputed from the children under
--    `SELECT … FOR UPDATE` on every payment, never incremented. Landing A's
--    reasoning applies unchanged: an increment drifts the first time a payment
--    is voided, and a running total cannot say WHICH payment it came from.
--
-- 3. `regie_advance_id` on `cash_request_payment`. THIS IS THE STRUCTURAL
--    CHANGE. `cash_request.regie_advance_id` (0342:71) is a single uuid, so one
--    request could reference exactly one advance. But a régie advance is a
--    quantity of cash placed in a holder's hands on a date — two disbursements
--    a fortnight apart are two advances, each with its own issue posting, its
--    own policy window and its own aging clock. Collapsing them onto one row
--    would either restate an advance's amount after issue (which its ledger
--    entry already contradicts) or lose the second posting entirely.
--
--    So the payment row — which already models "one movement of money" — gains
--    the link to the advance that movement created. `cash_request.regie_advance_id`
--    is KEPT and still points at the FIRST advance, so every existing row and
--    every existing reader stays correct.
--
-- WHY NOT A JOIN TABLE
--
-- A `cash_request_advance` join table would model the same many-to-one
-- relationship with an extra hop. `cash_request_payment` already IS that row:
-- it exists per movement, it already has the treasury account and the date, and
-- it already has `entry_id` for the posting. Adding a second table to hold one
-- FK that belongs on an existing row would be redundant structure.
--
-- ADDITIVE ONLY. No column is dropped or retyped; the CHECK is widened, never
-- narrowed, so the rewrite cannot fail on existing data.
-- ============================================================================

-- ── 1. The status ───────────────────────────────────────────────────────────
-- 0342 declared the CHECK inline, so Postgres auto-named it
-- `cash_request_status_check` (same situation as 0671:48 and 10718).
ALTER TABLE cash_request DROP CONSTRAINT IF EXISTS cash_request_status_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_request_status_check') THEN
    ALTER TABLE cash_request ADD CONSTRAINT cash_request_status_check CHECK (status IN (
      'DRAFT',
      'SUBMITTED',
      'APPROVED',
      'PARTIALLY_DISBURSED',
      'DISBURSED',
      'JUSTIFIED',
      'REJECTED'
    ));
  END IF;
END $$;

-- ── 2. The derived total ────────────────────────────────────────────────────
ALTER TABLE cash_request
  ADD COLUMN IF NOT EXISTS disbursed_amount numeric(18,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN cash_request.disbursed_amount IS
  'Σ cash_request_payment.amount. A DERIVED CACHE recomputed from the child rows under FOR UPDATE, never incremented — see regie_advance.justified_amount (10717) for the same rule and the reason for it.';

-- Money added here follows the same non-negative rule as 0497.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cash_request_disbursed_amount_nonneg') THEN
    ALTER TABLE cash_request
      ADD CONSTRAINT chk_cash_request_disbursed_amount_nonneg CHECK (disbursed_amount >= 0) NOT VALID;
  END IF;
END $$;

-- ── 3. Each payment's own advance ───────────────────────────────────────────
ALTER TABLE cash_request_payment
  ADD COLUMN IF NOT EXISTS regie_advance_id uuid REFERENCES regie_advance(regie_advance_id),
  ADD COLUMN IF NOT EXISTS memo             text,
  ADD COLUMN IF NOT EXISTS created_by       uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS created_at       timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN cash_request_payment.regie_advance_id IS
  'The régie advance THIS instalment issued. cash_request.regie_advance_id still holds the first one, for readers that predate 10719.';

-- An advance belongs to exactly one payment: it is created by that instalment
-- and its amount is that instalment's amount. Partial (not every historical row
-- has one) and UNIQUE, so a second payment can never be pointed at an advance
-- another payment already issued.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_request_payment_advance
  ON cash_request_payment (regie_advance_id)
  WHERE regie_advance_id IS NOT NULL;

-- The list-payments read is per request and ordered by date (repo.listPayments).
CREATE INDEX IF NOT EXISTS ix_cash_request_payment_request
  ON cash_request_payment (cash_request_id, paid_on);

-- ── 4. Backfill ─────────────────────────────────────────────────────────────
-- Requests already DISBURSED under the old all-or-nothing path have no payment
-- rows, so their derived total would read 0 against a full disbursement and the
-- status logic would want to move them BACKWARDS. Seed the cache from the
-- amount actually disbursed, which for those rows is the whole request.
--
-- Idempotent: the WHERE clause excludes anything already carrying a total, so a
-- re-run is a no-op. No payment rows are synthesised — inventing a payment date
-- and treasury account that were never recorded would be fabrication; the cache
-- is set from the fact we do have (the request was fully disbursed).
UPDATE cash_request
   SET disbursed_amount = amount
 WHERE status IN ('DISBURSED', 'JUSTIFIED')
   AND disbursed_amount = 0
   AND amount > 0;

-- DOWN
-- The CHECK widening is reversible only while no row sits in
-- PARTIALLY_DISBURSED; narrowing it back with one present fails the rewrite,
-- which is correct — silently rewriting those rows would misstate how much cash
-- is actually in a holder's hands. Settle or fully disburse them first, then:
--
--   DROP INDEX IF EXISTS ix_cash_request_payment_request;
--   DROP INDEX IF EXISTS ux_cash_request_payment_advance;
--   ALTER TABLE cash_request DROP CONSTRAINT IF EXISTS chk_cash_request_disbursed_amount_nonneg;
--   ALTER TABLE cash_request DROP CONSTRAINT IF EXISTS cash_request_status_check;
--   ALTER TABLE cash_request
--     ADD CONSTRAINT cash_request_status_check CHECK (status IN (
--       'DRAFT','SUBMITTED','APPROVED','DISBURSED','JUSTIFIED','REJECTED'));
--   -- DESTRUCTIVE: drops the per-instalment advance link and the payment audit
--   -- columns. Requests disbursed in more than one instalment lose every
--   -- advance after the first, since cash_request.regie_advance_id holds only
--   -- the first.
--   ALTER TABLE cash_request_payment
--     DROP COLUMN IF EXISTS created_at,
--     DROP COLUMN IF EXISTS created_by,
--     DROP COLUMN IF EXISTS memo,
--     DROP COLUMN IF EXISTS regie_advance_id;
--   ALTER TABLE cash_request DROP COLUMN IF EXISTS disbursed_amount;
