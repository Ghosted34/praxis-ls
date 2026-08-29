-- ============================================================================
-- TENANT DB — 12752 Push-subscription rotation tokens, and the "this device
-- went quiet" stamp.
--
-- ── THE PROBLEM ─────────────────────────────────────────────────────────────
--
-- A PushSubscription is not permanent. Browsers rotate and expire them on their
-- own schedule — a push service rotating keys, an endpoint ageing out, a long
-- idle period. When that happens the old endpoint stops working immediately and
-- NOTHING reports it: the server keeps pushing to a dead endpoint, the phone
-- keeps not receiving, and neither side sees an error.
--
-- The service worker DOES hear `pushsubscriptionchange` and can re-subscribe
-- the browser. What it cannot do is tell us: /notifications/push/subscribe sits
-- behind authMiddleware, and this product authenticates with a Bearer token
-- held in the page (lib/token-store), not a cookie. A service worker has no
-- access to it and no session of its own. So the repair waited for the user to
-- next open the app — and a user who relies on push to know WHEN to open the
-- app does not open it. The fix was gated behind the thing it broke.
--
-- ── WHY A TOKEN AND NOT THE OLD ENDPOINT ────────────────────────────────────
--
-- The obvious unauthenticated design is "present the old endpoint as proof" —
-- endpoints are long and unguessable, so knowing one looks like possession. It
-- was rejected: endpoints are stored HERE, in plaintext, because we need them
-- to send. Anyone who could read this table could then redirect a user's push
-- notifications — including mail previews — to a device of their own.
--
-- `rotation_token_hash` is a SHA-256 of a random token the server issues once
-- and the client keeps in IndexedDB (which a service worker CAN read without a
-- session). Possession of the token proves same-device; the column holds only
-- the hash, so this table leaking yields nothing usable. The token is
-- single-use — rotating issues a fresh one — so a captured value is spent the
-- moment it is used, by whoever gets there first.
-- ============================================================================

ALTER TABLE push_subscription
  ADD COLUMN IF NOT EXISTS rotation_token_hash text;

-- The rotation lookup is by hash alone (the caller has no session and no user
-- id to narrow by), so it must not be a sequential scan, and two live
-- subscriptions must never share a token.
CREATE UNIQUE INDEX IF NOT EXISTS ux_push_sub_rotation_token
  ON push_subscription (rotation_token_hash)
  WHERE rotation_token_hash IS NOT NULL;

-- When we last told this user that their last device stopped receiving.
-- Per USER, not per subscription: the subscription row is deleted at the moment
-- we would want to record it, and the question the notice answers ("are you
-- still reachable?") is about the person, not the device that just died.
CREATE TABLE IF NOT EXISTS push_device_lapse (
  user_id      uuid PRIMARY KEY REFERENCES app_user(user_id) ON DELETE CASCADE,
  notified_at  timestamptz NOT NULL DEFAULT now(),
  last_endpoint text
);

-- DOWN
--   DROP TABLE IF EXISTS push_device_lapse;
--   DROP INDEX IF EXISTS ux_push_sub_rotation_token;
--   ALTER TABLE push_subscription DROP COLUMN IF EXISTS rotation_token_hash;
