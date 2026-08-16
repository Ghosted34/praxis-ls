-- 0692 Sales CRM F5 — expiring, revocable proposal sharing and engagement.
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS share_token_hash text;
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS share_expires_at timestamptz;
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS share_revoked_at timestamptz;
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS viewed_at timestamptz;
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS downloaded_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS ux_proposal_share_token_hash ON proposal(share_token_hash) WHERE share_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_proposal_share_expiry ON proposal(share_expires_at) WHERE share_revoked_at IS NULL;
-- DOWN (token/audit timestamps may be discarded; PDF remains in the vault)
-- DROP INDEX IF EXISTS ix_proposal_share_expiry;
-- DROP INDEX IF EXISTS ux_proposal_share_token_hash;
-- ALTER TABLE proposal DROP COLUMN IF EXISTS downloaded_at, DROP COLUMN IF EXISTS viewed_at, DROP COLUMN IF EXISTS share_revoked_at, DROP COLUMN IF EXISTS share_expires_at, DROP COLUMN IF EXISTS share_token_hash;
