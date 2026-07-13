-- ============================================================================
-- TENANT DB — 0441 business-setup + IAM gap-fixes (Pixie parity, single-business).
--   - payment_gateway        : per-tenant gateway config, write-only creds (§2.3)
--   - email_signature         : per-user signature render (§2.1; brand template
--                               lives in setting section='email_signature')
--   - access_review / _entry  : periodic access recertification (§4.1)
-- Login editor (§3.2) and security-events read (§4.2) need no new tables (setting
-- section='login' / existing event_log). See doc/GAP_FIXES_PLAN.md.
-- ============================================================================

-- Payment gateways. Credentials are AES-256-GCM encrypted and never read back;
-- the API exposes has_credentials (derived) only.
CREATE TABLE IF NOT EXISTS payment_gateway (
  provider        text PRIMARY KEY,
  active          boolean NOT NULL DEFAULT false,
  role            text,                     -- free-text, e.g. 'PRIMARY' | 'BACKUP'
  credentials_enc text,                     -- ciphertext; NULL until set
  updated_by      uuid REFERENCES app_user(user_id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Per-user email signature render. The tenant-wide brand template is stored in
-- setting(section='email_signature', key='template') — no table needed for it.
CREATE TABLE IF NOT EXISTS email_signature (
  user_id     uuid PRIMARY KEY REFERENCES app_user(user_id) ON DELETE CASCADE,
  html        text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Access reviews — snapshot every active user's roles at creation; reviewers
-- decide each entry; completing the review stamps completed_at/by.
CREATE TABLE IF NOT EXISTS access_review (
  review_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  created_by    uuid REFERENCES app_user(user_id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  completed_by  uuid REFERENCES app_user(user_id)
);

CREATE TABLE IF NOT EXISTS access_review_entry (
  entry_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id       uuid NOT NULL REFERENCES access_review(review_id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES app_user(user_id),
  roles_snapshot  jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision        text CHECK (decision IN ('approved','revoked','flagged')),
  note            text,
  decided_by      uuid REFERENCES app_user(user_id),
  decided_at      timestamptz
);
CREATE INDEX IF NOT EXISTS access_review_entry_review_idx ON access_review_entry (review_id);
