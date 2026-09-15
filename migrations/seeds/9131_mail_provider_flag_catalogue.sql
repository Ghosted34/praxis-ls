-- ============================================================================
-- 9131 — catalogue rows for the split provider flags (tenant migration 12775)
--
-- 12775 seeds `mail.provider.microsoft` and `mail.provider.google` into every
-- tenant's feature_state. A tenant flag with no catalogue row is a flag nobody
-- can switch: the Platform Console renders the console from this table, so the
-- row is what turns a seeded key into an operator-visible toggle. The pairing is
-- enforced by tests/security/feature-catalogue-coverage.js.
--
-- They replace the single `mail.provider.oauth` switch, which stays (and still
-- works as an umbrella) so nothing already enabled changes behaviour. Microsoft
-- is the one that matters now: Exchange Online removed Basic auth for IMAP and
-- POP in 2022 and retired it for SMTP AUTH on 30 April 2026, so OAuth is the
-- only way a Microsoft 365 tenant can connect a mailbox at all. Google waits on
-- restricted-scope verification, which is why they are no longer one switch.
-- ============================================================================

INSERT INTO platform.feature_catalogue (feature_key, module_key, name, description, default_state, depends_on) VALUES
 ('mail.provider.microsoft', 'MOD-64', 'Microsoft 365 mailboxes', 'Connect a Microsoft 365 mailbox over OAuth (Graph). The only route Microsoft still supports.', 'off', '{mail.core}'),
 ('mail.provider.google',    'MOD-64', 'Google Workspace mailboxes', 'Connect a Gmail or Workspace mailbox over OAuth. Awaiting restricted-scope verification.',    'off', '{mail.core}')
ON CONFLICT (feature_key) DO UPDATE SET
  module_key    = EXCLUDED.module_key,
  name          = EXCLUDED.name,
  description   = EXCLUDED.description,
  default_state = EXCLUDED.default_state,
  depends_on    = EXCLUDED.depends_on;

INSERT INTO platform.plan_feature (plan_id, feature_key, included)
SELECT p.plan_id, f.feature_key, true
  FROM platform.plan p
  CROSS JOIN (VALUES ('mail.provider.microsoft'), ('mail.provider.google')) AS f(feature_key)
 WHERE p.code IN ('FULL', 'ENTERPRISE')
ON CONFLICT (plan_id, feature_key) DO NOTHING;

-- DOWN
--
-- Purely additive: two catalogue rows and their plan entitlements. Delete the
-- plan rows FIRST — plan_feature references the catalogue, so the reverse order
-- fails on the foreign key.
--
-- DELETE FROM platform.plan_feature
--  WHERE feature_key IN ('mail.provider.microsoft', 'mail.provider.google');
-- DELETE FROM platform.feature_catalogue
--  WHERE feature_key IN ('mail.provider.microsoft', 'mail.provider.google');
