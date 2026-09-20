-- ============================================================================
-- TENANT — 14000 Smart Comms 1:1 voice calls: server-authoritative call state
-- and per-user last-seen presence (doc/SMART_COMMS_CALLS_ENGINEERING_GUIDE.md
-- §4.1–4.2, PR-1).
--
-- ── WHAT THIS ADDS ─────────────────────────────────────────────────────────
--
--   comms_call           one 1:1 call between two members of a DIRECT channel.
--                        The server owns the state machine (RINGING → IN_CALL
--                        → terminal) and both timers (60 s ring, 30 min call);
--                        clients are renderers and cannot lie about state.
--
--   comms_user_presence  the persistent half of "last seen": when this user
--                        last opened the app / returned from background /
--                        navigated a page (the socket beat, §4.11). The live
--                        "online now" half is the socket connection itself
--                        (in-memory + Redis), so this table only ever answers
--                        "when were they last here" for someone who is gone.
--
-- ── WHY THE CALL ROW REFERENCES THE DIRECT CHANNEL ─────────────────────────
--
-- A 1:1 call IS a conversation in this product: the phone icon lives on the
-- DIRECT channel's header and member list, and membership in that channel is
-- the authorisation for every call on it — the same boundary as a message.
-- Keying the call on the channel means the row proves nothing a channel row
-- does not already prove, and a v2 group call (guide §8.5) extends the model
-- with a participant set rather than re-keying history.
--
-- ── WHY ONE-ACTIVE-CALL PER USER IS A PARTIAL UNIQUE INDEX ─────────────────
--
-- A CHECK constraint cannot say "no OTHER row has me in it" — that is a
-- relationship, not a property of a row, and the only honest home for it is
-- the index. Partial (WHERE status IN active) so a user with forty finished
-- calls today can still take the fifty-first; the two indexes say caller-side
-- and callee-side, because a row carries both roles.
--
-- ── THE FEATURE FLAG ───────────────────────────────────────────────────────
--
-- `calls` follows the house pattern set by 0450 (`comms`) and 0702 (hr.*):
-- the ai_feature_flag row is the console's display + switch, and the
-- feature_state row is what middleware/feature-gate.js actually reads. A
-- MISSING feature_state row 403s the router, so the seed is what makes
-- "default ON" true on a tenant that has never been re-projected;
-- ON CONFLICT DO NOTHING keeps a deliberate console decision intact, which
-- is the difference between a repair and an override.
-- ============================================================================

CREATE TABLE IF NOT EXISTS comms_call (
  call_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         uuid NOT NULL REFERENCES comms_group(group_id) ON DELETE CASCADE,
  caller_id        uuid NOT NULL REFERENCES app_user(user_id),
  callee_id        uuid NOT NULL REFERENCES app_user(user_id),
  status           text NOT NULL
    CHECK (status IN ('RINGING','IN_CALL','ENDED','NO_ANSWER','CANCELLED','DECLINED','BUSY','FAILED')),
  started_at       timestamptz NOT NULL DEFAULT now(),
  connected_at     timestamptz,
  ended_at         timestamptz,
  duration_seconds int
    CHECK (duration_seconds IS NULL OR (duration_seconds >= 0 AND duration_seconds <= 1800)),
  end_reason       text
    CHECK (end_reason IS NULL OR end_reason IN ('hangup','declined','cancelled','no_answer','busy','max_duration','ice_failed')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- 1:1 by construction: a call with both ends on the same user is a bug in
  -- the writer, not a corner case to tolerate.
  CONSTRAINT uq_comms_call_parties_distinct CHECK (caller_id <> callee_id)
);

-- One active call per user, in either role. Partial so history never blocks
-- the next call; unique so a second dial while ringing/in-call is rejected by
-- the database, not by a check that can race itself (guide D8).
CREATE UNIQUE INDEX IF NOT EXISTS uq_comms_call_one_active_caller
  ON comms_call (caller_id) WHERE status IN ('RINGING','IN_CALL');
CREATE UNIQUE INDEX IF NOT EXISTS uq_comms_call_one_active_callee
  ON comms_call (callee_id) WHERE status IN ('RINGING','IN_CALL');

-- The list + "is this user free" reads.
CREATE INDEX IF NOT EXISTS ix_comms_call_group ON comms_call (group_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_comms_call_status ON comms_call (status) WHERE status IN ('RINGING','IN_CALL');

CREATE TABLE IF NOT EXISTS comms_user_presence (
  user_id      uuid PRIMARY KEY REFERENCES app_user(user_id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER trg_commscall_updated
  BEFORE UPDATE ON comms_call
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE TRIGGER trg_commspresence_updated
  BEFORE UPDATE ON comms_user_presence
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Feature flag: `calls`, default ON (guide decision rows 2/10 — the tenant
-- kill switch is this flag, surfaced where the other feature flags live).
INSERT INTO ai_feature_flag (feature_key, display_name, description, is_enabled)
VALUES ('calls', 'Inhouse calls',
        '1:1 voice calls between employees of the same team, with AI call summaries.',
        true)
ON CONFLICT (feature_key) DO NOTHING;

-- The gate middleware reads feature_state, not ai_feature_flag — a missing
-- row there 403s every call route. Seed the catalogue default; a later real
-- projection overwrites it with whatever the console says.
INSERT INTO feature_state (feature_key, state, source)
VALUES ('calls', 'on', 'default')
ON CONFLICT (feature_key) DO NOTHING;

-- DOWN
-- DROP TRIGGER IF EXISTS trg_commscall_updated ON comms_call;
-- DROP TRIGGER IF EXISTS trg_commspresence_updated ON comms_user_presence;
-- DROP TABLE IF EXISTS comms_user_presence;
-- DROP TABLE IF EXISTS comms_call;
-- DELETE FROM feature_state WHERE feature_key = 'calls';
-- DELETE FROM ai_feature_flag WHERE feature_key = 'calls';
--
-- No DOWN for the flag rows on a tenant that has already taken calls: the
-- rows are history. The table drops cover the tables; the DELETEs cover only
-- the two rows this migration invented.
