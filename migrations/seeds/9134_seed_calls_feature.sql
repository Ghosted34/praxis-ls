-- ============================================================================
-- PLATFORM — 9134 The `calls` feature catalogue row (Smart Comms PR-1).
--
-- ── WHY THIS FILE EXISTS AT ALL ────────────────────────────────────────────
-- The same two-halves defect the 9114 mail incident caught: tenant migration
-- 14000 seeds `feature_state('calls','on')` and gates the call routes on it,
-- but the platform catalogue half is what makes the flag SWITCHABLE —
-- `provisioning.projectFeatures()` and `plans.service.reprojectPlan` iterate
-- the catalogue, and the console has nothing to show without a row.
-- tests/security/feature-catalogue-coverage.test.js fails the PR if the row
-- is missing, so the two halves cannot drift again.
--
-- `default_state` is 'on' — the guide's locked decision: inhouse calls are ON
-- by default, and this flag is the tenant's kill switch, not a selling point.
-- The kill switch is the console toggle (source=override), which the
-- projection honours over the plan.
--
-- `depends_on = {comms}`: calls live on DIRECT conversations in the Smart
-- Comms module — the routes carry both gates, and the projection enforces the
-- same reading a level cheaper: comms off takes calls with it.
--
-- ── PLANS ──────────────────────────────────────────────────────────────────
-- Included in ALL three plans, same as `comms` itself (9110): a projection
-- for a plan that does not include a feature writes state='off' for it
-- regardless of the catalogue default, so omitting Starter would silently
-- switch calls off for every Starter tenant on the next re-projection.
-- ============================================================================

INSERT INTO platform.feature_catalogue (feature_key, module_key, name, description, default_state, depends_on) VALUES
 ('calls', 'MOD-64', 'Inhouse calls',
  '1:1 voice calls between members of the same team on their direct conversations. WebRTC peer-to-peer media, with the server relaying signaling and enforcing the 30-minute cap.',
  'on', '{comms}')
ON CONFLICT (feature_key) DO UPDATE SET
  module_key    = EXCLUDED.module_key,
  name          = EXCLUDED.name,
  description   = EXCLUDED.description,
  default_state = EXCLUDED.default_state,
  depends_on    = EXCLUDED.depends_on;

INSERT INTO platform.plan_feature (plan_id, feature_key, included)
SELECT p.plan_id, 'calls', true
  FROM platform.plan p
ON CONFLICT (plan_id, feature_key) DO UPDATE SET included = EXCLUDED.included;

-- ============================================================================
-- VERIFY
--   SELECT feature_key, default_state, depends_on
--     FROM platform.feature_catalogue
--    WHERE feature_key = 'calls';            -- expect 1 row, default_state = 'on'
--   SELECT p.code, pf.included
--     FROM platform.plan p
--     JOIN platform.plan_feature pf ON pf.plan_id = p.plan_id
--    WHERE pf.feature_key = 'calls';          -- expect all three plans, included = true
--
-- After applying, re-project features for existing tenants (platform console
-- → Tenant → Migrate, or provisioning.projectFeatures(slug)) so their
-- feature_state gains the calls row.
--
-- DOWN
--   DELETE FROM platform.plan_feature WHERE feature_key = 'calls';
--   DELETE FROM platform.feature_catalogue WHERE feature_key = 'calls';
--   -- Does NOT clear the feature_state row projected into tenant databases;
--   -- that row becomes inert without a catalogue row. Undo only to re-apply
--   -- a corrected version.
-- ============================================================================
