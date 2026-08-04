-- 0032 — Capabilities for the deploy-wide credential store.
--
-- Audit SEC-H2 / API F-20 (2026-08-04). Eight routes under /api/platform
-- (`/settings/*`, `/ai-vendors/*`) carried platformAuth but no requireCap, so
-- every authenticated platform user of every role could read and rotate the
-- deployment's S3, Geoapify, VAPID and AI-vendor credentials. The routes are
-- now gated on `settings.read` / `settings.write`; this migration introduces
-- those capabilities into the permission matrix.
--
-- GRANTED TO ROOT ADMIN ONLY, deliberately.
--   * PLATFORM_ROOT_ADMIN bypasses requireCap in code (middleware/platform-auth.js,
--     ROOT_ROLE), so the row below changes nothing about what Root can do — it
--     exists so the console's matrix renders the capability as held rather than
--     as an unchecked box on the account that does hold it.
--   * PLATFORM_SUPPORT and PLATFORM_BILLING are NOT granted. If either was
--     relying on the ungated routes, it loses access here. That is the finding
--     being fixed, not a regression: neither role's purpose involves rotating
--     infrastructure credentials.
--   * Custom roles created since 0031 are likewise not granted. Grant
--     deliberately, per role, via the console — do not backfill.
--
-- Reversal: this migration is additive and safe to reverse by deleting the two
-- rows. Doing so re-opens nothing, because the route gate is in code; it only
-- removes Root's display row.
--
--   DELETE FROM platform.platform_role_permission
--    WHERE capability IN ('settings.read','settings.write');

INSERT INTO platform.platform_role_permission (role_id, capability)
SELECT r.role_id, c.capability
FROM platform.platform_role r
CROSS JOIN (VALUES
  ('settings.read'),('settings.write')
) AS c(capability)
WHERE r.code = 'PLATFORM_ROOT_ADMIN'
ON CONFLICT DO NOTHING;
