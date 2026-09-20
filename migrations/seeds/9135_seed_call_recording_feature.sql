-- ============================================================================
-- PLATFORM — 9135 The `call_recording` feature catalogue row (Smart Comms PR-2).
--
-- ── WHY THIS FILE EXISTS AT ALL ────────────────────────────────────────────
-- Tenant migration 14010 seeds `feature_state('call_recording','on')` and gates
-- the recording/transcript/summary routes on it, but the platform catalogue
-- half is what makes the flag SWITCHABLE — `provisioning.projectFeatures()` and
-- `plans.service.reprojectPlan` iterate the catalogue, and the console has
-- nothing to show without a row. tests/security/feature-catalogue-coverage.test.js
-- fails the PR if the row is missing, which is the 9114 mail incident's lesson
-- written down as a gate.
--
-- ── WHY A SECOND KEY RATHER THAN REUSING `calls` ───────────────────────────
-- Decision row 2 asks for a TENANT-LEVEL kill switch on recording, and it is
-- not the same decision as "may this tenant make calls at all": a tenant can
-- want internal calls without any audio or transcript being retained. Turning
-- `call_recording` off leaves PR-1 calls working exactly as they did, with no
-- recorder and no banner — because there is nothing to consent to.
--
-- `depends_on = {calls}`: recording a call presupposes being able to make one.
-- The projection enforces the same reading a level cheaper than the routes do,
-- so calls off takes recording with it and the pair can never be inconsistent.
--
-- ── PLANS ──────────────────────────────────────────────────────────────────
-- Included in ALL plans, same as `calls` (9134) and `comms` (9110): a
-- projection for a plan that does not include a feature writes state='off' for
-- it regardless of the catalogue default, so omitting Starter would switch
-- recording off for every Starter tenant on the next re-projection.
-- ============================================================================

INSERT INTO platform.feature_catalogue (feature_key, module_key, name, description, default_state, depends_on) VALUES
 ('call_recording', 'MOD-64', 'Call recording & summaries',
  'Always-on call recording with a consent banner on both ends, attributed transcription of each side, and an AI summary draft the caller reviews before sending it to the conversation.',
  'on', '{calls}')
ON CONFLICT (feature_key) DO UPDATE SET
  module_key    = EXCLUDED.module_key,
  name          = EXCLUDED.name,
  description   = EXCLUDED.description,
  default_state = EXCLUDED.default_state,
  depends_on    = EXCLUDED.depends_on;

INSERT INTO platform.plan_feature (plan_id, feature_key, included)
SELECT p.plan_id, 'call_recording', true
  FROM platform.plan p
ON CONFLICT (plan_id, feature_key) DO UPDATE SET included = EXCLUDED.included;

-- ============================================================================
-- VERIFY
--   SELECT feature_key, default_state, depends_on
--     FROM platform.feature_catalogue
--    WHERE feature_key = 'call_recording';   -- expect 1 row, state on, {calls}
--   SELECT p.code, pf.included
--     FROM platform.plan p
--     JOIN platform.plan_feature pf ON pf.plan_id = p.plan_id
--    WHERE pf.feature_key = 'call_recording'; -- expect all plans, included true
--
-- After applying, re-project features for existing tenants (platform console
-- → Tenant → Migrate, or provisioning.projectFeatures(slug)) so their
-- feature_state gains the call_recording row.
--
-- DOWN
--   DELETE FROM platform.plan_feature WHERE feature_key = 'call_recording';
--   DELETE FROM platform.feature_catalogue WHERE feature_key = 'call_recording';
--   -- Does NOT clear the feature_state row projected into tenant databases;
--   -- that row becomes inert without a catalogue row. Undo only to re-apply
--   -- a corrected version.
-- ============================================================================
