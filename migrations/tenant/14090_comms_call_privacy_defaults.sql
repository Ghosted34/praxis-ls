-- ============================================================================
-- TENANT — 14090 Smart Comms calls: privacy defaults
-- (doc/SMART_COMMS_CALLS_AUDIT.md, PR-6; audit G1, G3, G5).
--
-- 1. comms_call.recording_declined_at / recording_declined_by (G5). The callee
--    may answer "without recording": the server records the choice on the
--    call, and neither side arms the recorder; the pipeline refuses the call's
--    parts. Plain columns, nullable, no constraint
--    (tests/unit/migration-constraint-ordering.test.js).
--
-- 2. comms.call_recording gains `enabled`: the TENANT's own opt-in (G1),
--    switched in Settings → Calls by a MOD-70 admin, read by the call service
--    beside the platform feature `call_recording` (which stays the platform's
--    availability switch; changing its catalogue default would re-project
--    every existing tenant off on the next migrate).
--
--    New tenants start OFF. A tenant is new when it has no users yet:
--    provisioning runs these migrations before the first admin is created
--    (shared/db/sandbox-user-mirror.js), so an existing tenant keeps
--    recording exactly as it is today, and only the owner's separate,
--    signed-off step turns it off for them (the SQL is in §6 of the audit,
--    PR-6's entry).
--
-- 3. `transcript_retention_days` is NOT seeded (absent = keep): G3's text
--    retention is a tenant choice, and a default that deletes records would
--    be a decision this migration has no business making.
-- ============================================================================

ALTER TABLE comms_call ADD COLUMN IF NOT EXISTS recording_declined_at timestamptz;
ALTER TABLE comms_call ADD COLUMN IF NOT EXISTS recording_declined_by uuid;

COMMENT ON COLUMN comms_call.recording_declined_at IS
  'The callee answered without recording (audit G5): nothing of this call is recorded or transcribed.';
COMMENT ON COLUMN comms_call.recording_declined_by IS
  'Who declined the recording (the callee); plain uuid, no FK, like the other actor columns on this table.';

INSERT INTO setting (section, key, value)
VALUES ('comms', 'call_recording', '{"retention_days": 30}'::jsonb)
ON CONFLICT (section, key) DO NOTHING;

UPDATE setting
   SET value = value || jsonb_build_object('enabled', EXISTS (SELECT 1 FROM app_user))
 WHERE section = 'comms'
   AND key = 'call_recording'
   AND NOT (value ? 'enabled');

-- ============================================================================
-- VERIFY
--   SELECT value FROM setting WHERE section = 'comms' AND key = 'call_recording';
--   -- an existing tenant: {"enabled": true, "retention_days": 30}
--   -- a tenant provisioned after this: {"enabled": false, "retention_days": 30}
--
-- DOWN
--   UPDATE setting SET value = value - 'enabled' - 'transcript_retention_days'
--    WHERE section = 'comms' AND key = 'call_recording';
--   ALTER TABLE comms_call DROP COLUMN IF EXISTS recording_declined_by;
--   ALTER TABLE comms_call DROP COLUMN IF EXISTS recording_declined_at;
-- ============================================================================
