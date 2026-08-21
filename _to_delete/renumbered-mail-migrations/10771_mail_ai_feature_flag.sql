-- PR-4 §8.2 — the metering + access identity for mail AI.
--
-- `ai_usage_ledger` rows written by the mail assistant carry
-- `feature_key = 'mail_ai'`, and `ai_access_grant.feature_key` is a FOREIGN KEY
-- to `ai_feature_flag`. Without this row a tenant could not grant or revoke one
-- user's access to mail AI — the insert would fail on the FK — and the AI
-- Control screen would show mail spend against a feature it had never heard of.
--
-- `is_enabled = true` matches the two-level model in
-- `ai/governance/governance.service.js`: the platform console's `feature_state`
-- entitlement is the CEILING and this row is the tenant's own PREFERENCE, which
-- only matters once entitled. Defaulting it ON means entitling a tenant shows
-- the feature immediately rather than requiring a second, tenant-side flip that
-- nobody knows to look for. Mail's own `mail.ai` switch is the floor and is
-- independent of this.
INSERT INTO ai_feature_flag (feature_key, display_name, description, is_enabled)
VALUES
  ('mail_ai', 'Smart Mail AI',
   'Drafting, rewriting, translation, thread summaries and attachment extraction inside the mailbox.',
   true)
ON CONFLICT (feature_key) DO NOTHING;
-- DOWN
--   DELETE FROM ai_access_grant WHERE feature_key = 'mail_ai';
--   DELETE FROM ai_feature_flag WHERE feature_key = 'mail_ai';
