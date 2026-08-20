-- ============================================================================
-- TENANT DB — 10743 Outbound domain health (PR-2).
--
-- A row per (domain, record, check). The dashboard reads the latest; the
-- history is what lets a PASS → FAIL transition fire `deliverability.regressed`
-- rather than a human noticing invoices have stopped arriving.
-- ============================================================================

CREATE TABLE IF NOT EXISTS domain_health_check (
  domain_health_check_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain        text NOT NULL,
  record        text NOT NULL CHECK (record IN ('MX','SPF','DKIM','DMARC','PTR','RBL')),
  selector      text,
  verdict       text NOT NULL CHECK (verdict IN ('PASS','FAIL','UNKNOWN')),
  value         text,
  suggestion    text,
  checked_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_domain_health_latest
  ON domain_health_check (domain, record, checked_at DESC);

CREATE INDEX IF NOT EXISTS ix_domain_health_checked
  ON domain_health_check (checked_at DESC);

-- DOWN
--   DROP TABLE IF EXISTS domain_health_check;
