-- ============================================================================
-- TENANT — 14060 Smart Comms calls: relay credentials tied to one call, and
-- the relay-only privacy setting (doc/SMART_COMMS_CALLS_AUDIT.md, PR-3).
--
-- 1. comms_call.turn_token (C2). A TURN credential's username is
--    `<expiry>:<turn_token>`: a random token per call, so the relay's logs
--    name the call a credential was minted for, and it carries no user id.
--    Written with the row at dial (insertCall); ensureTurnToken backfills a
--    call dialled before this migration while it is RINGING or IN_CALL. Plain
--    column, no constraint (tests/unit/migration-constraint-ordering.test.js).
-- 2. setting comms.call_privacy {"relay_only": false} (C13). On, every call
--    uses iceTransportPolicy "relay", so neither employee's IP address reaches
--    the other; it needs the TURN relay. Seeded ON CONFLICT DO NOTHING so a
--    tenant's choice is never overwritten by a later deploy.
-- ============================================================================

ALTER TABLE comms_call ADD COLUMN IF NOT EXISTS turn_token text;

INSERT INTO setting (section, key, value) VALUES
  ('comms', 'call_privacy', '{"relay_only": false}'::jsonb)
ON CONFLICT (section, key) DO NOTHING;

-- DOWN
-- DELETE FROM setting WHERE section = 'comms' AND key = 'call_privacy';
-- ALTER TABLE comms_call DROP COLUMN IF EXISTS turn_token;
