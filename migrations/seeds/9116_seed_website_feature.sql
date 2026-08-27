-- ============================================================================
-- PLATFORM — 9116 The tenant website package's feature catalogue row.
--
-- ── WHY THIS FILE EXISTS AT ALL ────────────────────────────────────────────
-- `feature_state` (tenant DB) and `platform.feature_catalogue` (here) are the
-- two halves of one switch, they live in different databases, and nothing
-- connects them. The new `service_type_web` admin endpoints and the
-- `service_type_web_public` public router are both gated on this key, so a
-- catalogue row that doesn't exist is a website package nobody can turn on.
-- tests/security/feature-catalogue-coverage.test.js fails the PR if this row
-- is missing — the same gate that caught the 9114 mail incident.
--
-- The module rides MOD-29 (operations — service type editing) per the guide's
-- RBAC note (decision 5): "Uses the same rights as service-type editing".
-- `requireFeature` only needs tenant context, so the anonymous public router
-- can carry `feature: "website"` and answer FEATURE_DISABLED (403) when the
-- package is off — a public endpoint that gates a feature does not need auth.
--
-- Default is 'off' on purpose. The website package is a commercial decision
-- still open in WORK_TO_BE_DONE.md ("which tenants get a website package");
-- defaulting to on would expose the new admin surface to every tenant on
-- provisioning day, which is the failure mode the gate exists to prevent.
--
-- ── AFTER APPLYING ─────────────────────────────────────────────────────────
-- Re-project features for existing tenants (platform console → Tenant →
-- Migrate, or provisioning.projectFeatures(slug)) so their `feature_state`
-- gains the `website` row. Diagnose with:
--   node scripts/tenant/feature-report.js --slug=<slug>
-- ============================================================================

INSERT INTO platform.feature_catalogue (feature_key, module_key, name, description, default_state, depends_on) VALUES
 ('website', 'MOD-29', 'Tenant website content',
  'Per-tenant public service-type pages fed by /public/services: bilingual slugs, cover image, FAQ, related services.',
  'off', '{}')
ON CONFLICT (feature_key) DO UPDATE SET
  module_key    = EXCLUDED.module_key,
  name          = EXCLUDED.name,
  description   = EXCLUDED.description,
  default_state = EXCLUDED.default_state,
  depends_on    = EXCLUDED.depends_on;

-- ============================================================================
-- VERIFY
--   SELECT feature_key, default_state, depends_on
--     FROM platform.feature_catalogue
--    WHERE feature_key = 'website';   -- expect 1 row, default_state = 'off'
--
-- DOWN
--   DELETE FROM platform.feature_catalogue WHERE feature_key = 'website';
--   -- Does NOT clear the feature_state row projected into tenant databases;
--   -- that row becomes inert without a catalogue row, which is exactly the
--   -- unswitchable state this seed exists to prevent. Undo only to re-apply
--   -- a corrected version.
-- ============================================================================
