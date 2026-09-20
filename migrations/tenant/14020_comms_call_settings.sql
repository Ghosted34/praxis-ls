-- ============================================================================
-- TENANT — 14020 Smart Comms calls, hardening: the tenant call settings and the
-- ring-channel evidence the observability chapter reads
-- (doc/SMART_COMMS_CALLS_ENGINEERING_GUIDE.md §7.1, PR-3).
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--
--   1. Two rows in the EXISTING `setting` store (§3.5 says "existing settings
--      table", and it means it — a table just for two keys would be a second
--      configuration mechanism for the same product area, and the Settings hub
--      would then have to know which of the two a given key lives in):
--
--        comms.call_recording        {"retention_days": 30}   — D7's window
--        comms.call_noise_suppression {"enabled": true}        — the yard default
--
--      Both are DEFAULTS, not switches: a tenant that never opens the screen
--      has rows here, and a tenant that edits them keeps the edit (the seed is
--      ON CONFLICT DO NOTHING precisely so a deliberate decision is not
--      re-imposed by a later deploy — the same reasoning as 14000's feature
--      seed).
--
--   2. Three PLAIN columns on the pre-existing `comms_call`, recording which
--      ring channel actually reached the callee — the raw material for §7.4's
--      ring-channel distribution.
--
--      ring_ack_channel  'socket' | 'notification' | 'push' — the channel the
--                        callee's device was RINGING ON when it acknowledged.
--                        Written once, by the first ack; never rewritten, so
--                        "which channel landed" stays a fact about the ring
--                        rather than about the last device to speak.
--      ring_ack_at       when that ack landed. Also the stop signal: the push
--                        escalation reads it and stands down (§4.6).
--      ring_push_sent_at when the escalation pushed, whether or not anything
--                        was delivered. This is the honest half of the pair:
--                        the ack says a channel LANDED, this says one was
--                        ATTEMPTED, and the gap between them is the interesting
--                        number (devices with no subscription, expired VAPID,
--                        iOS refusing to wake a closed PWA).
--
-- ── WHY THESE ARE COLUMNS AND NOT A RING-EVENT TABLE ────────────────────────
--
-- A call rings once. There is one ring per row, one channel that landed and at
-- most one push attempt, so an event table would carry a 1:1 relationship
-- through a join — and the metric that reads it would join every call to find
-- what the call row could have told it directly. A v2 group call (guide §8.5)
-- rings N people at once and will want a row per participant; that is the point
-- at which an event table earns its keep, and it is deliberately not this PR.
--
-- ── THE CONSTRAINT RULE (why there is no CHECK here) ────────────────────────
--
-- `tests/unit/migration-constraint-ordering.test.js` forbids a migration above
-- 13791 from adding a CHECK or a foreign key to a table it did not create, and
-- the reason is provisioning rather than taste: 13791 mirrors live's
-- constraints into sandbox and does not catch `undefined_column`, so a new
-- tenant would abort mid-provision. `comms_call` predates this file, so the
-- vocabulary is enforced where it is written (smartcomm.call.repo.js
-- setRingAck is the only writer) exactly as 14010 did for
-- `transcription_state`.
--
-- ── AND WHY THERE IS NO NEW INDEX ───────────────────────────────────────────
--
-- The escalation is a delayed job carrying its call id, not a scan for
-- un-pushed rings, and the metrics read is a day-range aggregate over
-- `started_at` — which `ix_comms_call_group (group_id, started_at DESC)` and
-- the 15 s sweep's partial status index already serve. An index added "just in
-- case" is a write cost on the hottest table in the module for a read that does
-- not exist yet.
-- ============================================================================

INSERT INTO setting (section, key, value) VALUES
  ('comms', 'call_recording', '{"retention_days": 30}'::jsonb),
  ('comms', 'call_noise_suppression', '{"enabled": true}'::jsonb)
ON CONFLICT (section, key) DO NOTHING;

ALTER TABLE comms_call ADD COLUMN IF NOT EXISTS ring_ack_channel text;
ALTER TABLE comms_call ADD COLUMN IF NOT EXISTS ring_ack_at timestamptz;
ALTER TABLE comms_call ADD COLUMN IF NOT EXISTS ring_push_sent_at timestamptz;

COMMENT ON COLUMN comms_call.ring_ack_channel IS
  'The ring channel the callee''s device was ringing on when it acknowledged: socket | notification | push. Written once by the first ack (smartcomm.call.repo.js setRingAck), never rewritten — the raw material for the ops metrics screen''s ring-channel distribution. NULL means no channel landed: nobody acknowledged inside the 60-second window.';

COMMENT ON COLUMN comms_call.ring_ack_at IS
  'When the first ring acknowledgement landed. Doubles as the stop signal for the push escalation, which re-reads the row before pushing and stands down when this is set (guide §4.6 — a ring_ack stops all channels).';

COMMENT ON COLUMN comms_call.ring_push_sent_at IS
  'When the web-push escalation was attempted, delivered or not. Pair it with ring_ack_channel: ack = a channel landed, this = one was attempted, and the calls where this is set and the ack is NULL are the ring-through failures worth looking at.';

-- ============================================================================
-- VERIFY
--   SELECT section, key, value FROM setting WHERE section = 'comms'
--     ORDER BY key;                                    -- two rows, always
--   SELECT count(*) FROM comms_call WHERE ring_ack_at IS NOT NULL;  -- 0 on a
--     fresh install; the columns are additive and nothing backfills them.
--
-- DOWN
--   DELETE FROM setting
--    WHERE section = 'comms'
--      AND key IN ('call_recording', 'call_noise_suppression');
--   -- Only safe while no tenant has edited them: the delete removes the row
--   -- whatever it holds. A tenant that changed its retention window back to
--   -- the default first is indistinguishable afterwards, which is why this is
--   -- a manual step and not an automated down.
--   ALTER TABLE comms_call DROP COLUMN IF EXISTS ring_push_sent_at;
--   ALTER TABLE comms_call DROP COLUMN IF EXISTS ring_ack_at;
--   ALTER TABLE comms_call DROP COLUMN IF EXISTS ring_ack_channel;
--   -- Losing the ack columns loses ring-channel history for calls that have
--   -- already happened. The calls themselves and every transcript survive.
-- ============================================================================
