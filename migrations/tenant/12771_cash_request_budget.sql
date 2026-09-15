-- ============================================================================
-- TENANT DB — 12771 The costing IS the budget: line-level consumption for the
-- cash request, and the permission vocabulary that gates it.
--
-- ── THE HOLE THIS FILLS ─────────────────────────────────────────────────────
--
-- `cash_request_line` (0342:79) carries a label and an amount and NOTHING that
-- says which budget line the money is being drawn from. `importCostingLines`
-- reads the approved costing, copies `label` and `qty × unit_cost`, and throws
-- the provenance away. So selecting the same costing twice yields the same
-- lines at their full value, twice, with nothing anywhere objecting.
--
-- The legacy had the identical hole — `cash_request_lines` has no
-- `costing_line_id` — and it is why the legacy's own reconciliation module
-- (`api/ocr/save_draft.php`) made `costing_line_id` MANDATORY on `ocr_line` and
-- then had a human RE-TYPE `actual_ttc`: the one system that knew what had been
-- disbursed against that budget line could not say so.
--
-- ── WHAT A COSTING LINE IS WORTH, AND WHAT IS LEFT OF IT ────────────────────
--
--   Budget     the costing line, TTC — `qty × unit_cost` plus the line's own
--              VAT (its tax code for a service, `upstream_vat_amount` for a
--              débours). TTC because `computeCosting`'s own comment settles it:
--              "A costing is a cash budget, not a fiscal invoice, so the VAT we
--              hand the carrier is money we will spend". That is the cash a
--              cash request draws down.
--   Committed  Σ of the claims against it from cash requests that have been
--              APPROVED and not settled short. COMMITMENT accounting, not
--              cash: between approval and payment the budget must NOT read as
--              free, or a second request is approved against headroom the first
--              was already promised.
--   Remaining  Budget − Committed. May go NEGATIVE — amending a costing line
--              below what is already committed is legal and shows as
--              over-consumed rather than being refused retroactively.
--
-- ── WHY THE COSTING'S OWN LINES HAD TO STOP CHURNING THEIR IDs ─────────────
--
-- `costing.service.replaceLines` deleted every line and re-inserted, so every
-- `costing_line_id` changed on every DRAFT save. A budget link to a uuid that
-- is regenerated whenever the sheet is amended is a link that breaks at exactly
-- the moment it matters — the amendment. The service now upserts in place,
-- keyed on the logical identity `diffLines` has always used
-- (dictionary item + container type, label as the fallback), so a line that
-- survives an amendment keeps its id and its claims.
--
-- The FK is therefore RESTRICT (the default): a budget line with live claims
-- cannot be deleted out from under them. The service raises LINE_HAS_CLAIMS
-- with the requests that hold it, so the user is told to reduce the line to
-- zero rather than getting a raw 23503.
--
-- ── THE PERMISSION COLUMNS ─────────────────────────────────────────────────
--
-- `permission` (0110:39) has five booleans. `rbac.js` has carried two TODOs
-- since it was written — `export` mapped to `can_read`, `publish` to
-- `can_update` — and there was no way at all to say "may validate" or "may hand
-- over cash" separately from "may approve". Owner decision (Q19): three real
-- columns.
--
-- BACKFILLED FROM WHAT GATED THEM YESTERDAY, so no grant is lost on deploy:
-- `can_export := can_read` (what `export` resolved to), and
-- `can_validate := can_disburse := can_approve` (what those routes required).
--
-- ADDITIVE ONLY. No column dropped or retyped; the status CHECK is widened,
-- never narrowed, so the rewrite cannot fail on existing data.
-- ============================================================================

-- ── 1. The budget link, and the line shape it needs ─────────────────────────
--
-- `qty` / `unit_cost`: the legacy carried both (`cash_request_lines.qty`,
-- `unit_cost`) and so does `costing_line`. Ours flattened them, so a 2-container
-- THC line at 99 000 became "198 000" and an approver could not see what moved
-- when the count changed. `budget_amount` is KEPT and is now the derived net
-- (`qty × unit_cost`) — every existing reader stays correct.
--
-- `line_no`: without it lines read back in `cash_request_line_id` order and
-- reshuffle on every save. Exactly the defect 12766 fixed on `costing_line`.
ALTER TABLE cash_request_line
  ADD COLUMN IF NOT EXISTS costing_line_id uuid REFERENCES costing_line(costing_line_id),
  ADD COLUMN IF NOT EXISTS qty             numeric(18,4) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unit_cost       numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS line_no         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source          text NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS settled_amount  numeric(18,2);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cash_request_line_source') THEN
    ALTER TABLE cash_request_line ADD CONSTRAINT chk_cash_request_line_source
      CHECK (source IN ('IMPORTED','MANUAL'));
  END IF;
END $$;

-- Money added here follows the same non-negative rule as 0497.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cash_request_line_qty_positive') THEN
    ALTER TABLE cash_request_line
      ADD CONSTRAINT chk_cash_request_line_qty_positive CHECK (qty > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cash_request_line_unit_cost_nonneg') THEN
    ALTER TABLE cash_request_line
      ADD CONSTRAINT chk_cash_request_line_unit_cost_nonneg CHECK (unit_cost >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cash_request_line_settled_nonneg') THEN
    ALTER TABLE cash_request_line
      ADD CONSTRAINT chk_cash_request_line_settled_nonneg
      CHECK (settled_amount IS NULL OR settled_amount >= 0) NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN cash_request_line.costing_line_id IS
  'The BUDGET LINE this claim draws down. NULL on an overhead (OVH) request, which has no operations file and therefore no costing. An OPS request must carry one on every line before it can be submitted — owner decision Q4: no money leaves without a costing.';
COMMENT ON COLUMN cash_request_line.qty IS
  'Legacy cash_request_lines.qty. budget_amount is the derived net (qty x unit_cost); both are stored so the sheet can show what an approver needs to see change.';
COMMENT ON COLUMN cash_request_line.line_no IS
  'Position on the sheet, 1-based. Same rule as costing_line.line_no (12766): without it lines read by uuid and reshuffle on every save.';
COMMENT ON COLUMN cash_request_line.source IS
  'IMPORTED = came from the linked costing (label and item locked to the budget line); MANUAL = typed. The legacy''s is_imported flag, done as a vocabulary.';
COMMENT ON COLUMN cash_request_line.settled_amount IS
  'Set ONLY by CLOSE_BALANCE: this line''s pro-rata share of what was actually disbursed before the request was settled short. NULL means the line still commits its full amount. Budget consumption reads COALESCE(settled_amount, amount) so a settled request stops holding budget it will never spend.';

-- Backfill the line shape. Existing rows carried one amount, so the honest
-- reading is 1 x that amount; line_no follows the order they are being READ in
-- today, so no existing request visibly reorders on deploy (12766's rule).
UPDATE cash_request_line
   SET unit_cost = budget_amount
 WHERE unit_cost = 0 AND budget_amount <> 0;

WITH ordered AS (
  SELECT cash_request_line_id,
         row_number() OVER (PARTITION BY cash_request_id ORDER BY cash_request_line_id) AS n
    FROM cash_request_line
)
UPDATE cash_request_line l
   SET line_no = ordered.n
  FROM ordered
 WHERE ordered.cash_request_line_id = l.cash_request_line_id
   AND l.line_no = 0;

-- The consumption read is "every claim against this budget line", so the index
-- is on the FK alone and partial — an OVH request's lines carry no budget line
-- and would only bloat it.
CREATE INDEX IF NOT EXISTS ix_cash_request_line_costing_line
  ON cash_request_line (costing_line_id)
  WHERE costing_line_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_cash_request_line_order
  ON cash_request_line (cash_request_id, line_no);

-- ── 2. The request: money unit, the settle-short state, and attribution ─────
--
-- CURRENCY. `costing` carries `currency` + `exchange_rate_to_xaf` (0320,
-- 12766) and every cross-costing sum is required to use `total_ttc_xaf`.
-- `cash_request` had neither, so importing a EUR costing produced bare numbers
-- that the régie advance and the ledger posting then agreed with — all wrong
-- together, which is the kind of defect that survives testing.
--
-- No FK to currency(code), deliberately: `costing.currency` (0320:10) has none
-- either, and this value is COPIED from the costing. A FK here would create a
-- valid costing that cannot produce a valid cash request.
ALTER TABLE cash_request
  ADD COLUMN IF NOT EXISTS currency             char(3) NOT NULL DEFAULT 'XAF',
  ADD COLUMN IF NOT EXISTS exchange_rate_to_xaf numeric(18,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS amount_xaf           numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS costing_revision     integer,
  ADD COLUMN IF NOT EXISTS approved_at          timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by          uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS rejected_at          timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason     text,
  ADD COLUMN IF NOT EXISTS over_budget_reason   text,
  ADD COLUMN IF NOT EXISTS settled_at           timestamptz,
  ADD COLUMN IF NOT EXISTS settled_by           uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS settlement_reason    text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cash_request_rate_positive') THEN
    ALTER TABLE cash_request
      ADD CONSTRAINT chk_cash_request_rate_positive CHECK (exchange_rate_to_xaf > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cash_request_amount_xaf_nonneg') THEN
    ALTER TABLE cash_request
      ADD CONSTRAINT chk_cash_request_amount_xaf_nonneg CHECK (amount_xaf >= 0) NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN cash_request.currency IS
  'The money this request is denominated in. An OPS request INHERITS the linked costing''s currency and cannot differ from it — comparing a claim against a budget in another currency is not arithmetic. An OVH request (no costing) may name its own.';
COMMENT ON COLUMN cash_request.amount_xaf IS
  'amount converted at THIS request''s own exchange_rate_to_xaf. The only column any cross-request sum may use — same rule as costing.total_ttc_xaf (12766).';
COMMENT ON COLUMN cash_request.costing_revision IS
  'Which approval revision of the costing this request was raised against (costing_approval_snapshot.revision). AUDIT ONLY: the budget bar always reads the CURRENT costing line, because amending the budget is exactly how the remaining balance is meant to move.';
COMMENT ON COLUMN cash_request.over_budget_reason IS
  'Required at submission when any line claims more than its budget line has left. The request may still be submitted with one — it may not be APPROVED (owner decision Q3): the reason tells the approver to go and amend the costing.';
COMMENT ON COLUMN cash_request.settlement_reason IS
  'Why a partially-disbursed request was closed at what was actually paid. CLOSE_BALANCE releases the unpaid commitment back to the budget, so this is the audit answer to "where did that headroom come from".';

-- CLOSED_SHORT: a request the treasury funded in part and will not complete.
-- Without it a part-paid request holds committed budget for ever against cash
-- that will never move — a slow leak under commitment accounting.
--
-- 0342 declared the CHECK inline, so Postgres auto-named it
-- `cash_request_status_check` (10719 and 10722 rewrote it the same way).
ALTER TABLE cash_request DROP CONSTRAINT IF EXISTS cash_request_status_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_request_status_check') THEN
    ALTER TABLE cash_request ADD CONSTRAINT cash_request_status_check CHECK (status IN (
      'DRAFT',
      'SUBMITTED',
      'VALIDATED',
      'APPROVED',
      'PARTIALLY_DISBURSED',
      'DISBURSED',
      'CLOSED_SHORT',
      'JUSTIFIED',
      'REJECTED'
    ));
  END IF;
END $$;

-- Existing rows are XAF at 1:1 — the only reading available, since nothing
-- recorded a currency. Idempotent: the WHERE excludes anything already set.
UPDATE cash_request SET amount_xaf = amount WHERE amount_xaf = 0 AND amount > 0;

-- ── 3. Who took the cash, per instalment ───────────────────────────────────
--
-- The third signature. On the PAYMENT, not on the request: each tranche is
-- physically handed over separately, and the legacy's single `disbursed_time`
-- on the header is precisely the shape that cannot express it.
ALTER TABLE cash_request_payment
  ADD COLUMN IF NOT EXISTS received_by       uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS received_at       timestamptz,
  ADD COLUMN IF NOT EXISTS received_ack_kind text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cash_request_payment_ack_kind') THEN
    ALTER TABLE cash_request_payment ADD CONSTRAINT chk_cash_request_payment_ack_kind
      CHECK (received_ack_kind IS NULL OR received_ack_kind IN ('IN_APP','WET_SCAN'));
  END IF;
END $$;

COMMENT ON COLUMN cash_request_payment.received_by IS
  'The régie holder who took this tranche. Dr 581 (holder) / Cr treasury places the money in THEIR hands and regie.retireCore reconciles against THEIR receipts, so they are the party whose acknowledgement is worth recording — not an external beneficiary they later pay.';
COMMENT ON COLUMN cash_request_payment.received_ack_kind IS
  'IN_APP = acknowledged in the product; WET_SCAN = signed on the printed voucher and scanned back. A cash window at 06:00 is a paper transaction and always will be.';

-- ── 4. The permission vocabulary ───────────────────────────────────────────
ALTER TABLE permission
  ADD COLUMN IF NOT EXISTS can_export   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_validate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_disburse boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN permission.can_export IS
  'May take this module''s data OUT of the building. Does not follow from read: an accountant may legitimately read payroll on screen and not download it. Closes the standing TODO in middleware/rbac.js that mapped export onto can_read.';
COMMENT ON COLUMN permission.can_validate IS
  'May record the finance visa (SUBMITTED -> VALIDATED). A visa, not a signature — the three signatories on the voucher are the requester, the approving authority and the disbursing authority.';
COMMENT ON COLUMN permission.can_disburse IS
  'May hand over the cash. Separated from can_approve because the manager who approves a spend should not be the cashier who releases it — the one pair maker-checker most wants apart.';

-- Backfill from whatever gated these yesterday, so no role loses access on
-- deploy. Guarded on the column still being at its default, so a re-run after
-- an administrator has edited a grant does not silently restore it.
UPDATE permission SET can_export   = true WHERE can_export   = false AND can_read    = true;
UPDATE permission SET can_validate = true WHERE can_validate = false AND can_approve = true;
UPDATE permission SET can_disburse = true WHERE can_disburse = false AND can_approve = true;

-- DOWN
-- The status CHECK widening is reversible only while no row sits in
-- CLOSED_SHORT; narrowing it back with one present fails the rewrite, which is
-- correct — rewriting those rows would misstate a request the treasury settled
-- short. Settle or fully disburse them first, then:
--
--   DROP INDEX IF EXISTS ix_cash_request_line_order;
--   DROP INDEX IF EXISTS ix_cash_request_line_costing_line;
--   ALTER TABLE permission
--     DROP COLUMN IF EXISTS can_disburse,
--     DROP COLUMN IF EXISTS can_validate,
--     DROP COLUMN IF EXISTS can_export;
--   ALTER TABLE cash_request_payment
--     DROP CONSTRAINT IF EXISTS chk_cash_request_payment_ack_kind;
--   ALTER TABLE cash_request_payment
--     DROP COLUMN IF EXISTS received_ack_kind,
--     DROP COLUMN IF EXISTS received_at,
--     DROP COLUMN IF EXISTS received_by;
--   ALTER TABLE cash_request DROP CONSTRAINT IF EXISTS cash_request_status_check;
--   ALTER TABLE cash_request ADD CONSTRAINT cash_request_status_check CHECK (status IN (
--     'DRAFT','SUBMITTED','VALIDATED','APPROVED','PARTIALLY_DISBURSED',
--     'DISBURSED','JUSTIFIED','REJECTED'));
--   ALTER TABLE cash_request
--     DROP CONSTRAINT IF EXISTS chk_cash_request_amount_xaf_nonneg,
--     DROP CONSTRAINT IF EXISTS chk_cash_request_rate_positive;
--   ALTER TABLE cash_request
--     DROP COLUMN IF EXISTS settlement_reason,
--     DROP COLUMN IF EXISTS settled_by,
--     DROP COLUMN IF EXISTS settled_at,
--     DROP COLUMN IF EXISTS over_budget_reason,
--     DROP COLUMN IF EXISTS rejection_reason,
--     DROP COLUMN IF EXISTS rejected_at,
--     DROP COLUMN IF EXISTS rejected_by,
--     DROP COLUMN IF EXISTS approved_at,
--     DROP COLUMN IF EXISTS costing_revision,
--     DROP COLUMN IF EXISTS amount_xaf,
--     DROP COLUMN IF EXISTS exchange_rate_to_xaf,
--     DROP COLUMN IF EXISTS currency;
--   -- DESTRUCTIVE: drops the budget link, so every claim loses the line it was
--   -- drawn against and consumption becomes unanswerable again.
--   ALTER TABLE cash_request_line
--     DROP CONSTRAINT IF EXISTS chk_cash_request_line_settled_nonneg,
--     DROP CONSTRAINT IF EXISTS chk_cash_request_line_unit_cost_nonneg,
--     DROP CONSTRAINT IF EXISTS chk_cash_request_line_qty_positive,
--     DROP CONSTRAINT IF EXISTS chk_cash_request_line_source;
--   ALTER TABLE cash_request_line
--     DROP COLUMN IF EXISTS settled_amount,
--     DROP COLUMN IF EXISTS source,
--     DROP COLUMN IF EXISTS line_no,
--     DROP COLUMN IF EXISTS unit_cost,
--     DROP COLUMN IF EXISTS qty,
--     DROP COLUMN IF EXISTS costing_line_id;
