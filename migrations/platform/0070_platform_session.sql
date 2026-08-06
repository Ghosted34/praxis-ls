-- 0070 — Give the platform tier a session, so revocation means something.
--
-- SEC-M6. Platform tokens were STATELESS: no session table, therefore no remote
-- kill, no rotation-reuse detection, and a 30-day refresh TTL inherited from the
-- shared default. The only revocation lever was deactivating the user, which
-- takes effect at the NEXT refresh — so a stolen platform refresh token stayed
-- usable for up to 30 days after anyone noticed.
--
-- This tier administers EVERY TENANT. It provisions and wipes tenant databases,
-- holds the credential store, and the audit lists it alongside C3 (no
-- brute-force protection) and H6 (8-character passwords) as the softest target
-- with the widest reach. The tenant tier has had all of this since SEC-C2; the
-- asymmetry was backwards — the more privileged tier was the less protected one.
--
-- MIRRORS `user_session` ON THE TENANT SIDE deliberately, rather than inventing
-- a second design: same kill semantics (`killed_at`/`killed_by`), same rotation
-- chain (`replaced_by`), so the reuse-detection logic reads the same way in both
-- places and a reviewer only has to learn it once.
--
-- WHAT `replaced_by` IS FOR, because it is the non-obvious column: on refresh
-- the old row is marked as replaced by the new one. If a refresh token arrives
-- for a session that is ALREADY replaced, that token was captured — the
-- legitimate holder has moved on. The correct response is to kill the whole
-- chain, not just refuse this one request, because the attacker and the user
-- are now both holding tokens for it.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS platform.platform_session;

CREATE TABLE IF NOT EXISTS platform.platform_session (
  session_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_user_id  uuid NOT NULL REFERENCES platform.platform_user(platform_user_id) ON DELETE CASCADE,
  -- The refresh token's jti. Indexed, because every refresh looks up by it.
  refresh_jti       uuid NOT NULL,
  issued_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  killed_at         timestamptz,
  killed_by         uuid REFERENCES platform.platform_user(platform_user_id),
  -- Set when this session is rotated; points at its successor. A refresh
  -- arriving on a replaced session is REUSE — see the header.
  replaced_by       uuid REFERENCES platform.platform_session(session_id),
  ip                text,
  user_agent        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- The refresh path resolves a session by jti on every call; without this it is
-- a sequential scan on a table that only grows.
CREATE UNIQUE INDEX IF NOT EXISTS ux_platform_session_refresh_jti
  ON platform.platform_session (refresh_jti);

-- "List my sessions" and "kill everything for this user" both filter on the
-- user and care only about live rows.
CREATE INDEX IF NOT EXISTS ix_platform_session_user_live
  ON platform.platform_session (platform_user_id)
  WHERE killed_at IS NULL;

COMMENT ON TABLE platform.platform_session IS
  'SEC-M6. Live platform-console sessions. Mirrors the tenant user_session so revocation, '
  'idle expiry and refresh-reuse detection behave identically at both tiers.';

-- DOWN
-- DROP TABLE IF EXISTS platform.platform_session;
-- Dropping this returns the platform tier to stateless tokens: no remote kill,
-- no reuse detection, and a stolen refresh token valid for its full TTL.
