-- ============================================================================
-- TENANT — 14070 Smart Comms calls: rings on every device, and the noise
-- filter off by default (doc/SMART_COMMS_CALLS_AUDIT.md, PR-4).
--
-- 1. comms_call.ring_alerts (A12, A14). The ring push now goes to every device
--    of the callee at dial and re-alerts every 15 s while the row still rings
--    (at most 4). This counts the pushes sent; each one is claimed with
--    `COALESCE(ring_alerts, 0) = <n>` before it is sent, so a queue retry
--    cannot send it twice. Plain column, nullable, no constraint
--    (tests/unit/migration-constraint-ordering.test.js).
-- 2. The ack no longer stops anything: the column comments from 14020 said it
--    did, so they are rewritten (audit H3).
-- 3. comms.call_noise_suppression {"enabled": false} (E5): off until it is
--    verified on devices. Only a value still at the 14020 seed is flipped; a
--    tenant's own "off" is left alone. A tenant that deliberately chose "on"
--    cannot be told apart from the seed, so it is flipped too — the switch is
--    in Settings → Calls.
-- ============================================================================

ALTER TABLE comms_call ADD COLUMN IF NOT EXISTS ring_alerts integer;

COMMENT ON COLUMN comms_call.ring_alerts IS
  'Ring pushes sent for this call: 1 for the push at dial, plus one per 15 s re-alert while it rang (at most 5). Each is claimed on this column before it is sent (smartcomm.call.repo.js claimRingAlert). NULL means no ring push went out.';

COMMENT ON COLUMN comms_call.ring_ack_at IS
  'When the first ring acknowledgement landed (the ring-channel metric). Since PR-4 it stops nothing: every device keeps ringing until the call is answered, declined or ends.';

COMMENT ON COLUMN comms_call.ring_push_sent_at IS
  'When the first ring push went out (to every device of the callee, at dial). The cancel push that replaces the ring is sent only when this is set.';

UPDATE setting
   SET value = '{"enabled": false}'::jsonb
 WHERE section = 'comms'
   AND key = 'call_noise_suppression'
   AND value = '{"enabled": true}'::jsonb;

-- ============================================================================
-- VERIFY
--   SELECT value FROM setting
--    WHERE section = 'comms' AND key = 'call_noise_suppression';  -- enabled false
--   SELECT count(*) FROM comms_call WHERE ring_alerts IS NOT NULL; -- 0 at first
--
-- DOWN
--   ALTER TABLE comms_call DROP COLUMN IF EXISTS ring_alerts;
--   -- The noise default is not put back: a tenant that turned the filter off
--   -- after this ran cannot be told apart from the flip. Turn it on in
--   -- Settings → Calls where wanted.
-- ============================================================================
