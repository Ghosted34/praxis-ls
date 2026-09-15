-- ============================================================================
-- TENANT DB — 12766 Costing foundation: order, totals, attribution, one sheet
-- per file, the approval snapshot, and the disbursement VAT disclosure.
--
-- Six gaps, all found by reading the module end to end against the legacy
-- costing it replaces (doc/COSTING_REVAMP_QUESTIONNAIRE.md §2.3). Each is a
-- column that should have existed and did not, and each has a visible symptom.
--
-- ── 1. costing_line has no order ───────────────────────────────────────────
--
-- `listLines` reads `ORDER BY cl.costing_line_id` — a uuid. So the sheet's line
-- order is random, and re-saving reshuffles it, because `replaceLines` deletes
-- and re-inserts and the new uuids sort differently. Legacy carried `line_no`
-- (api/costing/save.php:96) for exactly this reason. Backfilled from the
-- current uuid order so existing sheets keep whatever order they are being
-- read in today rather than jumping once on deploy.
--
-- ── 2. costing carries no totals ───────────────────────────────────────────
--
-- Totals are computed on read by `computeCosting`, which is correct for the
-- worksheet and useless for everything else: the registry cannot show an
-- amount without fetching every line of every row, the KPI strip cannot
-- aggregate at all, and the approval chain's amount threshold has no column to
-- compare against. Legacy stored them on the master row (save.php:120-135).
--
-- `total_ttc_xaf` is the one that makes aggregation honest. A sheet priced in
-- USD and one priced in XAF cannot be summed in their own currencies, and the
-- 360 does exactly that today (operations_file.repo.js:148-153) while the
-- service-type rollup groups by currency and gets a different answer for the
-- same money. One normalised column, written at the sheet's own stored rate —
-- the rate the approver actually saw — settles it.
--
-- ── 3. No attribution beyond validator_id ──────────────────────────────────
--
-- `setStatus` writes `{ status }` and nothing else, so `approver_id` (present
-- since 0320) is never populated: the 360's People block shows a permanent
-- null approver, and the printed sheet cannot say who validated or approved it
-- or when. Legacy stamped all of it (transition.php:88-140).
--
-- ── 4. Two approved costings per file is legal ─────────────────────────────
--
-- Nothing stops it. The remedy for a wrong figure is the unlock loop (10718),
-- not a second sheet competing with the first — and the 360 sums BOTH today,
-- so a draft beside an approved one double-counts the budget. REJECTED is
-- excluded from the constraint because a rejected sheet is dead: it must not
-- block the corrected one that replaces it.
--
-- ── 5. An amendment cannot show what changed ───────────────────────────────
--
-- Unlock → edit → re-approve is the correct path for a demurrage that grew
-- after the box sat three extra days. But the approver re-reading fourteen
-- lines to find the one that moved will not find it. Diffing needs the prior
-- state, so the line set is snapshotted at each approval and the next
-- submission renders against it.
--
-- ── 6. A disbursement cannot disclose its upstream VAT ─────────────────────
--
-- `dictionary_item.disbursement_vat_transparent` (0630:56) has existed, been
-- defaulted TRUE, and been read by nothing since it was written. Its whole
-- purpose is the sentence a client needs on a débours line: Maersk invoices
-- 100,000 + 19,250 VAT, we pay 119,250, we re-bill 119,250 exactly, and the
-- 19,250 was paid on their behalf and never retained by us. The accounting is
-- already right (Dr 4731 gross, no tax leg, re-billed with no tax code, 4731
-- nets to zero — account 473 is the OHADA mandataire account). What was
-- missing is anywhere to record the split, so the disclosure could not be
-- printed. `upstream_vat_amount` is that place.
--
-- ADDITIVE ONLY. No column is dropped or retyped; no CHECK is narrowed on
-- existing data. The one new constraint is NOT VALID so the rewrite cannot
-- fail on rows written before it existed.
-- ============================================================================

-- ── 1. Line order ───────────────────────────────────────────────────────────
ALTER TABLE costing_line
  ADD COLUMN IF NOT EXISTS line_no integer NOT NULL DEFAULT 0;

-- Backfill in the order the lines are being READ in today (uuid), so no
-- existing sheet visibly reorders on deploy. New sheets get real ordinals.
WITH ordered AS (
  SELECT costing_line_id,
         row_number() OVER (PARTITION BY costing_id ORDER BY costing_line_id) AS n
    FROM costing_line
)
UPDATE costing_line cl
   SET line_no = ordered.n
  FROM ordered
 WHERE ordered.costing_line_id = cl.costing_line_id
   AND cl.line_no = 0;

CREATE INDEX IF NOT EXISTS ix_costing_line_order
  ON costing_line (costing_id, line_no);

COMMENT ON COLUMN costing_line.line_no IS
  'Position on the sheet, 1-based. Legacy api/costing/save.php:96. Without it lines read by uuid and reshuffle on every save.';

-- ── 6. Disbursement upstream VAT ────────────────────────────────────────────
ALTER TABLE costing_line
  ADD COLUMN IF NOT EXISTS upstream_vat_amount numeric(18,2);

-- Only a pass-through line can carry one: an own-service line's VAT is our own
-- output tax and lives in its tax_code, not here. NOT VALID because rows
-- predating this column cannot violate it but need no rewrite to prove it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_costing_line_upstream_vat') THEN
    ALTER TABLE costing_line
      ADD CONSTRAINT chk_costing_line_upstream_vat
      CHECK (upstream_vat_amount IS NULL
             OR (is_disbursement = true AND upstream_vat_amount >= 0)) NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN costing_line.upstream_vat_amount IS
  'Of a disbursement line''s gross amount, how much is the supplier''s own VAT — paid on the client''s behalf, never retained by us. Drives the disclosure dictionary_item.disbursement_vat_transparent (0630) asks for. NULL on service lines.';

-- ── 2. Totals on the master row ─────────────────────────────────────────────
ALTER TABLE costing
  ADD COLUMN IF NOT EXISTS total_ht      numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_vat     numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_ttc     numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_ttc_xaf numeric(18,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN costing.total_ttc_xaf IS
  'total_ttc converted at THIS sheet''s own exchange_rate_to_xaf — the rate the approver saw. The only column any cross-costing sum may use; adding total_ttc across currencies is what operations_file.repo.js did before 12766.';

-- Backfill from the lines so an existing sheet reports its real figure rather
-- than zero. Mirrors computeCosting: a disbursement never carries VAT, and a
-- service line's VAT comes from its own tax code — never a hardcoded rate.
WITH sums AS (
  SELECT cl.costing_id,
         COALESCE(SUM(cl.qty * cl.unit_cost), 0) AS ht,
         COALESCE(SUM(
           CASE WHEN cl.is_disbursement THEN 0
                ELSE cl.qty * cl.unit_cost * (COALESCE(tc.rate_percent, 0) / 100)
           END), 0) AS vat
    FROM costing_line cl
    LEFT JOIN tax_code tc ON tc.tax_code_id = cl.tax_code_id
   GROUP BY cl.costing_id
)
UPDATE costing c
   SET total_ht      = ROUND(sums.ht, 2),
       total_vat     = ROUND(sums.vat, 2),
       total_ttc     = ROUND(sums.ht + sums.vat, 2),
       total_ttc_xaf = ROUND((sums.ht + sums.vat) * COALESCE(c.exchange_rate_to_xaf, 1), 2)
  FROM sums
 WHERE sums.costing_id = c.costing_id;

-- The registry sorts and filters on these; the KPI strip aggregates them.
CREATE INDEX IF NOT EXISTS ix_costing_registry
  ON costing (created_at DESC, status);

-- ── 3. Attribution ──────────────────────────────────────────────────────────
-- `approver_id` already exists (0320:17) and is simply never written; these are
-- the three timestamps and the validator identity that go with it.
ALTER TABLE costing
  ADD COLUMN IF NOT EXISTS validated_by uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS validated_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at  timestamptz,
  ADD COLUMN IF NOT EXISTS locked_at    timestamptz;

COMMENT ON COLUMN costing.validated_by IS
  'Who actually validated, as distinct from validator_id — the person the sheet was ADDRESSED to. They are usually the same and must not be assumed to be.';

-- ── 4. One live costing per operations file ─────────────────────────────────
-- Partial, so a REJECTED sheet never blocks the corrected one that replaces
-- it. Everything else — draft, in review, approved, mid-unlock — is the file's
-- one costing, and a second is a data-entry mistake rather than a workflow.
CREATE UNIQUE INDEX IF NOT EXISTS uq_costing_one_live_per_dossier
  ON costing (dossier_id)
  WHERE status <> 'REJECTED';

-- ── 5. The approval snapshot ────────────────────────────────────────────────
-- One row per approval, holding the line set as approved. The next submission
-- diffs against the newest, so the approver reads "Demurrage 450,000 → 780,000,
-- +1 line added" instead of fourteen unchanged rows.
--
-- jsonb rather than a child table: this is a frozen document, never queried by
-- line and never joined. A shadow copy of costing_line would need every future
-- column added twice and would invite someone to edit history.
CREATE TABLE IF NOT EXISTS costing_approval_snapshot (
  snapshot_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  costing_id    uuid NOT NULL REFERENCES costing(costing_id) ON DELETE CASCADE,
  revision      integer NOT NULL DEFAULT 1,
  lines         jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_ht      numeric(18,2) NOT NULL DEFAULT 0,
  total_vat     numeric(18,2) NOT NULL DEFAULT 0,
  total_ttc     numeric(18,2) NOT NULL DEFAULT 0,
  currency      char(3),
  approved_by   uuid REFERENCES app_user(user_id),
  approved_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- The read is always "the most recent snapshot for this costing".
CREATE INDEX IF NOT EXISTS ix_costing_snapshot_latest
  ON costing_approval_snapshot (costing_id, approved_at DESC);

COMMENT ON TABLE costing_approval_snapshot IS
  'The line set as approved, one row per approval. Read only to diff an amendment after an unlock (10718) so the re-approver sees what moved. Never edited.';

-- DOWN
-- Additive throughout; reversible with no business-data loss. The unique index
-- is the one to drop FIRST if a tenant has somehow been relying on two live
-- costings per file, since nothing else here constrains behaviour.
--
--   DROP INDEX IF EXISTS uq_costing_one_live_per_dossier;
--   DROP TABLE IF EXISTS costing_approval_snapshot;
--   DROP INDEX IF EXISTS ix_costing_registry;
--   ALTER TABLE costing
--     DROP COLUMN IF EXISTS locked_at,
--     DROP COLUMN IF EXISTS approved_at,
--     DROP COLUMN IF EXISTS validated_at,
--     DROP COLUMN IF EXISTS validated_by,
--     DROP COLUMN IF EXISTS total_ttc_xaf,
--     DROP COLUMN IF EXISTS total_ttc,
--     DROP COLUMN IF EXISTS total_vat,
--     DROP COLUMN IF EXISTS total_ht;
--   ALTER TABLE costing_line DROP CONSTRAINT IF EXISTS chk_costing_line_upstream_vat;
--   DROP INDEX IF EXISTS ix_costing_line_order;
--   ALTER TABLE costing_line
--     DROP COLUMN IF EXISTS upstream_vat_amount,
--     DROP COLUMN IF EXISTS line_no;
