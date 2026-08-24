-- ============================================================================
-- TENANT DB — 10786 The signature usage ledger: one row per issued certified
-- envelope, the metering half of QES billing.
--
-- doc/SIGNATURE_ENGINEERING_GUIDE.md §7.3, §7.5.
--
-- ── CHARGE ON ISSUE, AND ONLY ON ISSUE ─────────────────────────────────────
-- The row is written in the SAME transaction that writes the envelope's
-- provider_ref. `provider_ref NOT NULL` below is what makes "charged without
-- an envelope" unrepresentable: a ledger row cannot exist pointing at a
-- provider document that was never issued, so a provider 5xx (no ref, no row)
-- costs the tenant nothing. This is Q15's rule enforced STRUCTURALLY rather
-- than by remembering to delete a row on failure (§7.4 step 4).
--
-- ── WHAT THE ROW IS FOR ────────────────────────────────────────────────────
-- One billing relationship is in scope: Praxis → tenant. The tenant absorbs
-- the provider cost in its own service pricing (§1.5(e), Round 2), so the row
-- meters what Praxis bills the TENANT at a platform rate — there is no line
-- for the tenant's client, and no refund path to maintain, because cancelling
-- after dispatch leaves the row in place: the provider consumed the quota
-- whatever we do (§7.4 step 7).
--
-- Modeled on ai_usage_ledger (0400) on purpose: `billed_at`/`invoice_ref`
-- stay NULL until the row lands on an invoice, and the partial index is the
-- sweep's working set.
--
-- Idempotent. Re-runnable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS signature_usage_ledger (
  usage_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_id   uuid NOT NULL REFERENCES qes_envelope(envelope_id) ON DELETE CASCADE,
  request_id    uuid NOT NULL REFERENCES signature_request(request_id),
  entity_ref    text NOT NULL,
  provider_key  text NOT NULL,
  -- NOT NULL: see the header. A row without an issued envelope id is a charge
  -- for nothing, and the schema should not let that be written.
  provider_ref  text NOT NULL,
  unit_fee      numeric(12,2) NOT NULL,
  currency      text NOT NULL DEFAULT 'XAF',
  -- Set when the row lands on an invoice. NULL until then — the partial
  -- index below is the "unbilled" sweep set.
  billed_at     timestamptz,
  invoice_ref   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_sigusage_unbilled ON signature_usage_ledger(created_at)
  WHERE billed_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_sigusage_request ON signature_usage_ledger(request_id);
CREATE INDEX IF NOT EXISTS ix_sigusage_month ON signature_usage_ledger(created_at);

COMMENT ON TABLE signature_usage_ledger IS
  'One row per issued certified envelope (doc/SIGNATURE_ENGINEERING_GUIDE.md §7.5). Meters Praxis→tenant billing at a platform rate; no tenant→client line exists (Round 2).';
COMMENT ON COLUMN signature_usage_ledger.provider_ref IS
  'NOT NULL on purpose: a ledger row without an issued envelope id would be a charge for nothing, and the schema refuses to represent it.';

-- ============================================================================
-- VERIFY
--   SELECT count(*) FROM signature_usage_ledger;      -- expect 0
--   SELECT column_name, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'signature_usage_ledger' AND column_name = 'provider_ref';
--     -- expect: provider_ref | NO
--
-- DOWN
--   -- DESTRUCTIVE: drops the metering record for every certified envelope.
--   -- The envelopes themselves survive and still show their status; what is
--   -- gone is the proof of what was consumed and therefore what is owed.
--   DROP TABLE IF EXISTS signature_usage_ledger;
-- ============================================================================
