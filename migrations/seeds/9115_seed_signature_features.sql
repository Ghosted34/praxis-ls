-- ============================================================================
-- PLATFORM — 9115 The signature programme's feature catalogue rows.
--
-- ── WHY THIS FILE EXISTS AT ALL ────────────────────────────────────────────
-- `feature_state` (tenant DB, 10780) and `platform.feature_catalogue` (here)
-- are the two halves of one switch, they live in different databases, and
-- nothing connects them. `provisioning.projectFeatures()` and
-- `plans.service.reprojectPlan` both iterate the CATALOGUE, so a tenant flag
-- with no catalogue row is a feature nobody can turn on: the console has
-- nothing to show, the projection never mentions the key, and the tenant keeps
-- whatever the tenant-side seed left it at, forever.
--
-- That is exactly how fifteen `mail.*` flags shipped unswitchable
-- (9114's header, and tests/security/feature-catalogue-coverage.test.js, which
-- fails this PR if these rows are missing).
--
-- `signatures` itself is already here (9110) and keeps its meaning: the module
-- exists at all. These four are the chapters.
--
-- ── AFTER APPLYING ─────────────────────────────────────────────────────────
-- Re-project features for existing tenants (platform console → Tenant →
-- Migrate, or provisioning.projectFeatures(slug)) so their `feature_state`
-- gains these rows. Diagnose with:
--   node scripts/tenant/feature-report.js --slug=<slug>
-- ============================================================================

INSERT INTO platform.feature_catalogue (feature_key, module_key, name, description, default_state, depends_on) VALUES
 -- ON. This is PR-2 itself, and the QR is printed on paper: a document already
 -- in a customer's filing cabinet cannot be re-issued because a flag was off.
 ('signatures.portal',   'MOD-64', 'Verification portal',   'The public /v/:code page a printed QR resolves to, and the QR itself.',        'on',  '{signatures}'),
 -- OFF until their chapters land. Seeded now so the switch exists before the
 -- code does, rather than PR-3 discovering on merge day that nothing can enable
 -- it — which is the failure 9114 documents.
 ('signatures.external', 'MOD-64', 'External signing',      'Signing links sent to a counterparty, the OTP challenge and signing chains.', 'off', '{signatures.portal}'),
 ('signatures.qes',      'MOD-64', 'Certified signatures',  'Tier 3 — identity checked by an external trust provider. Costs per envelope.', 'off', '{signatures.external}'),
 ('signatures.wet',      'MOD-64', 'Print and sign',        'Tier 4 — printed, signed in ink, scanned back and reconciled by barcode.',     'off', '{signatures.external}')
ON CONFLICT (feature_key) DO UPDATE SET
  module_key    = EXCLUDED.module_key,
  name          = EXCLUDED.name,
  description   = EXCLUDED.description,
  default_state = EXCLUDED.default_state,
  depends_on    = EXCLUDED.depends_on;

-- Full and Enterprise include everything, as they do in 9110. That file SELECTs
-- straight from the catalogue, but it ran once — before these rows existed — so
-- they are added explicitly, exactly as 9112 and 9114 had to.
INSERT INTO platform.plan_feature (plan_id, feature_key, included)
SELECT p.plan_id, f.feature_key, true
  FROM platform.plan p
  CROSS JOIN (VALUES
    ('signatures.portal'), ('signatures.external'), ('signatures.qes'), ('signatures.wet')
  ) AS f(feature_key)
 WHERE p.code IN ('full', 'enterprise')
ON CONFLICT (plan_id, feature_key) DO UPDATE SET included = EXCLUDED.included;

-- Starter gets the portal and external signing; not the two that cost money or
-- imply a back office. `signatures` is already in Starter (9110), and a
-- signature nobody outside the company can verify is not much of a signature —
-- so the portal belongs wherever signing does.
INSERT INTO platform.plan_feature (plan_id, feature_key, included)
SELECT p.plan_id, f.feature_key, true
  FROM platform.plan p
  CROSS JOIN (VALUES
    ('signatures.portal'), ('signatures.external')
  ) AS f(feature_key)
 WHERE p.code = 'starter'
ON CONFLICT (plan_id, feature_key) DO UPDATE SET included = EXCLUDED.included;

-- ============================================================================
-- VERIFY
--   SELECT feature_key, default_state, depends_on FROM platform.feature_catalogue
--    WHERE feature_key LIKE 'signatures%' ORDER BY feature_key;   -- expect 5
--   SELECT p.code, f.feature_key FROM platform.plan_feature f
--     JOIN platform.plan p ON p.plan_id = f.plan_id
--    WHERE f.feature_key LIKE 'signatures.%' ORDER BY 1, 2;
--
-- DOWN
--   -- Order matters: plan_feature references feature_catalogue, so a catalogue
--   -- row cannot go while a plan still names it.
--   --
--   -- Deleting these does NOT clear the feature_state rows they projected into
--   -- tenant databases this file cannot reach. Those are inert without a
--   -- catalogue row — which is precisely the unswitchable state this seed
--   -- exists to prevent, so undo it only to re-apply a corrected version.
--   --
--   -- DELETE FROM platform.plan_feature WHERE feature_key IN
--   --   ('signatures.portal','signatures.external','signatures.qes','signatures.wet');
--   -- DELETE FROM platform.feature_catalogue WHERE feature_key IN
--   --   ('signatures.portal','signatures.external','signatures.qes','signatures.wet');
-- ============================================================================
