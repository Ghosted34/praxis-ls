-- ============================================================================
-- TENANT DB — 10705 quote_request portal intake (PRD §11.1 "self-service
-- quoting/booking"). A signed-in client quotes from the portal, so the request
-- is filed directly against their client record — no lead needed (they are
-- already a customer) — and the intake channel says where it came from.
-- ============================================================================

ALTER TABLE quote_request
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES client_master(client_id);

CREATE INDEX IF NOT EXISTS ix_quote_request_client
  ON quote_request(client_id) WHERE client_id IS NOT NULL;

-- Extend the intake-channel allow-list with PORTAL. The original constraint
-- (0683) was inline, so it has the default name; find and replace it rather
-- than guessing. Idempotent: drop the old one only if present, add the new one
-- only if absent — a re-run (ledger lost, CI apply-twice) is a no-op.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_request_intake_channel_check') THEN
    ALTER TABLE quote_request DROP CONSTRAINT quote_request_intake_channel_check;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'quote_request_intake_channel_check') THEN
    ALTER TABLE quote_request
      ADD CONSTRAINT quote_request_intake_channel_check
      CHECK (intake_channel IN ('WEBSITE','MANUAL','REFERRAL','CAMPAIGN','PORTAL'));
  END IF;
END $$;

-- DOWN
--   ALTER TABLE quote_request DROP CONSTRAINT quote_request_intake_channel_check;
--   ALTER TABLE quote_request ADD CONSTRAINT quote_request_intake_channel_check
--     CHECK (intake_channel IN ('WEBSITE','MANUAL','REFERRAL','CAMPAIGN'));
--   -- DESTRUCTIVE: loses which client each portal quote belonged to.
--   DROP INDEX IF EXISTS ix_quote_request_client;
--   ALTER TABLE quote_request DROP COLUMN IF EXISTS client_id;
