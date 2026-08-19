-- ============================================================================
-- TENANT DB — 10743 Margin simulation: workflow + LINK COSTING + per-line
-- VAT/notes (§3.1).
--
-- THE WORKFLOW WAS MISSING FROM THE SCHEMA. The legacy margin simulator has
-- submit / approve / reject / unlock / validate / quote / events;
-- margin_simulation (0345) had NO status column at all, so DRAFT → Submit →
-- Approve could not even be represented. This adds the controlled-document
-- columns in the same shape the other documents use (dossier_reconciliation
-- 10715, costing 0320): a status, who did what when, and a reject reason.
--
-- LINK COSTING IS THE POINT OF THE SCREEN. Legacy
-- api/marginpricing/link-costing.php:132 does SELECT … FROM costing_line
-- WHERE costing_id = ? and copies the lines in, converting when the costing
-- currency is not XAF (:148). costing_id below records WHICH costing a
-- simulation was priced from, so the pricer's real workflow (cost the file,
-- then price it) leaves a trail. quotation_id records the other end: the
-- quote the simulation became.
--
-- PER-LINE VAT + NOTES, as legacy has: a VAT toggle per line (the tenant VAT
-- rate comes from settings finance.vat at compute time — no rate is stored or
-- hardcoded) and a free-text note. Simulation is rapid-quote maths with no GL
-- impact (KB §7), so a boolean toggle is the right weight — a full
-- tax_code_id joins the picture on the quotation, where the tax posting
-- actually happens.
-- ============================================================================

-- ── 1. Workflow ──────────────────────────────────────────────────────────────
ALTER TABLE margin_simulation
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS reject_reason text;

-- Named CHECK under a DO guard (style: 0671_dossier_draft.sql:48).
ALTER TABLE margin_simulation
  DROP CONSTRAINT IF EXISTS margin_simulation_status_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'margin_simulation_status_check') THEN
    ALTER TABLE margin_simulation ADD CONSTRAINT margin_simulation_status_check
      CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED'));
  END IF;
END $$;

-- ── 2. Provenance: the costing it priced, the quotation it became ───────────
ALTER TABLE margin_simulation
  ADD COLUMN IF NOT EXISTS costing_id uuid REFERENCES costing(costing_id),
  ADD COLUMN IF NOT EXISTS quotation_id uuid REFERENCES quotation(quotation_id);

COMMENT ON COLUMN margin_simulation.costing_id IS
  'LINK COSTING (§3.1): the costing whose lines this simulation imported. NULL for ad-hoc simulations.';
COMMENT ON COLUMN margin_simulation.quotation_id IS
  'The DRAFT quotation generated from this simulation (legacy ''quote'' action). NULL until quoted.';

-- ── 3. Per-line VAT toggle + notes (legacy parity) ───────────────────────────
ALTER TABLE margin_simulation_line
  ADD COLUMN IF NOT EXISTS vat_applicable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN margin_simulation_line.vat_applicable IS
  'Legacy per-line VAT toggle. The rate itself is settings finance.vat at compute time — never stored, never hardcoded.';

-- DOWN
-- Additive only; reversible with no data loss.
--
--   ALTER TABLE margin_simulation_line
--     DROP COLUMN IF EXISTS notes,
--     DROP COLUMN IF EXISTS vat_applicable;
--   ALTER TABLE margin_simulation
--     DROP COLUMN IF EXISTS quotation_id,
--     DROP COLUMN IF EXISTS costing_id;
--   ALTER TABLE margin_simulation
--     DROP CONSTRAINT IF EXISTS margin_simulation_status_check;
--   ALTER TABLE margin_simulation
--     DROP COLUMN IF EXISTS reject_reason,
--     DROP COLUMN IF EXISTS rejected_at,
--     DROP COLUMN IF EXISTS rejected_by,
--     DROP COLUMN IF EXISTS approved_at,
--     DROP COLUMN IF EXISTS approved_by,
--     DROP COLUMN IF EXISTS submitted_at,
--     DROP COLUMN IF EXISTS submitted_by,
--     DROP COLUMN IF EXISTS status;
