-- ============================================================================
-- TENANT DB — 10741 Merge the Pricing Variance Index into the OCR
-- reconciliation (§2.1, owner-approved).
--
-- WHY. pricing_variance and dossier_reconciliation were the same comparison
-- written twice: both read SUM(cost_entry.amount) for the dossier — one kept
-- the per-item detail (GROUP BY dictionary_item_id), the other threw it away
-- and stored a scalar. The scalar could not be drilled into, which is exactly
-- what a red variance needs, and pricing_variance.compute() accepted a
-- caller-supplied actual_cost (BUG-4) — any number, unconnected to cost_entry,
-- stored as fact.
--
-- AFTER THIS MIGRATION:
--   * dossier_reconciliation is the single record: quoted (header) /
--     budget (lines) / actual (lines).
--   * pricing_variance becomes a DERIVED, READ-ONLY projection computed from
--     the reconciliation — variance_percent and the R/Y/G flag are no longer
--     independently stored. The table below is retired, not dropped: applied
--     migrations are hash-pinned and dropping is destructive; the code simply
--     stops writing it.
--   * The Sales/Finance boundary is unchanged: Sales keeps seeing margin % and
--     the flag WITHOUT any cost figure; budget/actual stay finance-only.
--
-- QUOTED AT HEADER LEVEL ONLY. Budget and actual are both keyed by
-- dictionary_item_id and align naturally; quotation_line is priced for the
-- client and does NOT map 1:1 onto cost items (one quoted "Transit
-- Hinterland" can cover eight cost lines). A per-line quoted column would
-- invent a correspondence that does not exist, so the quote lands on the
-- header: which quotation, and its service total HT (débours excluded —
-- OHADA_KB §450; compare HT to HT, quotation.total_ht not total_ttc).
--
-- AI MATCH PROVENANCE. Actuals arrive pre-filled with what can be proven: a
-- cost_entry that names its dictionary_item_id is proven (the ledger's
-- assert_line_valid() enforced the item at posting time). Entries that name no
-- item cannot be proven; the assistant PROPOSES a mapping (suggestion rows
-- below) and a human confirms — same rule as MOD-09 bank reconciliation
-- (reconciliation.ai.js): the assistant may propose, never confirm.
--
-- NO BACKFILL. BUG-1 (the 'APPROVED'/'LOCKED' status mismatch fixed alongside
-- 10740) meant every historical pricing_variance row was computed against a
-- zero budget and whatever actual the caller typed — there is no correct
-- historical data to carry over, so none is.
-- ============================================================================

-- ── 1. Quoted, at header level only ─────────────────────────────────────────
ALTER TABLE dossier_reconciliation
  ADD COLUMN IF NOT EXISTS quotation_id uuid REFERENCES quotation(quotation_id),
  ADD COLUMN IF NOT EXISTS quoted_ht numeric(18,2);

COMMENT ON COLUMN dossier_reconciliation.quotation_id IS
  'The quotation this file was won on (latest ACCEPTED, else CONVERTED). NULL when the file has no accepted quote — the screen then answers budget-vs-actual only.';
COMMENT ON COLUMN dossier_reconciliation.quoted_ht IS
  'Service revenue quoted to the client, HT, débours excluded — snapshot at draft time so the variance is stable even if the quotation is later edited. Header-level only: quotation lines do not map 1:1 onto cost items.';

-- ── 2. Line-level match provenance ──────────────────────────────────────────
-- MATCHED   — actual proven via the entry's own dictionary_item_id.
-- UNMATCHED — actuals exist that name no item (the 'OTHER' bucket); the
--             assistant proposes a mapping, a human confirms.
ALTER TABLE dossier_reconciliation_line
  ADD COLUMN IF NOT EXISTS match_status text NOT NULL DEFAULT 'MATCHED';

-- Inline-named CHECK under a DO guard (style: 0671_dossier_draft.sql:48).
ALTER TABLE dossier_reconciliation_line
  DROP CONSTRAINT IF EXISTS dossier_reconciliation_line_match_status_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'dossier_reconciliation_line_match_status_check') THEN
    ALTER TABLE dossier_reconciliation_line
      ADD CONSTRAINT dossier_reconciliation_line_match_status_check
      CHECK (match_status IN ('MATCHED','UNMATCHED'));
  END IF;
END $$;

COMMENT ON COLUMN dossier_reconciliation_line.match_status IS
  'MATCHED = every actual behind this line named its dictionary item at posting. UNMATCHED = untagged actuals bucketed here awaiting a human-confirmed mapping (see dossier_reconciliation_suggestion).';

-- ── 3. Assistant proposals for untagged actuals ─────────────────────────────
-- One row per (draft reconciliation × untagged cost entry) the matcher could
-- score. status PROPOSED until a person decides; confirming stamps the item
-- onto the cost_entry itself (the analytic tag it was missing) and rebuilds
-- the draft lines. The assistant can only ever create PROPOSED rows.
CREATE TABLE IF NOT EXISTS dossier_reconciliation_suggestion (
  suggestion_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id  uuid NOT NULL REFERENCES dossier_reconciliation(reconciliation_id) ON DELETE CASCADE,
  cost_entry_id      uuid NOT NULL REFERENCES cost_entry(cost_entry_id),
  suggested_dictionary_item_id uuid NOT NULL REFERENCES dictionary_item(dictionary_item_id),
  confidence         numeric(5,4),
  reason             text,
  status             text NOT NULL DEFAULT 'PROPOSED'
                       CHECK (status IN ('PROPOSED','CONFIRMED','REJECTED')),
  decided_by         uuid REFERENCES app_user(user_id),
  decided_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_recon_suggestion
  ON dossier_reconciliation_suggestion(reconciliation_id, status);

COMMENT ON TABLE dossier_reconciliation_suggestion IS
  'AI-proposed dictionary mappings for cost entries that named no item. The assistant proposes (PROPOSED); only a human confirms or rejects — mirror of the MOD-09 bank-reconciliation rule.';

-- ── 4. Retire the stored pricing_variance table ──────────────────────────────
-- Kept (not dropped) because destroying an applied table is destructive and
-- the read path may still be pointed at old rows during rollout; the code no
-- longer writes it as of this migration.
COMMENT ON TABLE pricing_variance IS
  'RETIRED by 10741 — the Pricing Variance Index is now a derived projection over dossier_reconciliation (+ lines). Nothing writes here any more; historical rows predate the BUG-1 fix and are not trustworthy.';

-- DOWN
-- Additive only; reversible with no data loss.
--
--   COMMENT ON TABLE pricing_variance IS NULL;
--   DROP TABLE IF EXISTS dossier_reconciliation_suggestion;
--   ALTER TABLE dossier_reconciliation_line
--     DROP CONSTRAINT IF EXISTS dossier_reconciliation_line_match_status_check;
--   ALTER TABLE dossier_reconciliation_line DROP COLUMN IF EXISTS match_status;
--   ALTER TABLE dossier_reconciliation
--     DROP COLUMN IF EXISTS quoted_ht,
--     DROP COLUMN IF EXISTS quotation_id;
