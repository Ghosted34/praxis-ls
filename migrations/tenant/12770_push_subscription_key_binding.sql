-- ============================================================================
-- TENANT DB — 12770 Bind a push subscription to the VAPID key it was minted
-- with, and keep the verdict of the last send.
--
-- ── THE FAILURE THIS EXISTS TO CLOSE ────────────────────────────────────────
--
-- A PushSubscription is minted against ONE application server key. Rotate the
-- deploy's VAPID keypair — one button in the Platform Console — and every
-- subscription in every tenant becomes undeliverable in the same instant. The
-- push services answer 403 (bad signature), not 404/410 (endpoint gone), and
-- that distinction is what made the outage permanent and invisible:
--
--   * 403 is not "gone", so nothing was pruned. The rows stayed.
--   * /notifications/push/devices counts rows, so it kept answering "1 device"
--     and the Settings toggle kept saying "You'll get alerts here".
--   * The "this device went quiet" email fires on `pruned > 0 && sent === 0`,
--     so it never fired.
--   * The boot-time sync re-POSTs whatever subscription the browser is holding
--     without ever asking which key it was minted under — so the one mechanism
--     that repairs a rotation re-registered the dead endpoint, every boot,
--     for ever.
--
-- Every safety net in the push path was keyed on "the endpoint is gone". None
-- of them could see "the endpoint is fine and our signature is no longer
-- welcome on it".
--
-- `vapid_key_hash` is a SHA-256 of the PUBLIC key in force when the browser
-- subscribed. Public keys are not secrets — this is a fingerprint for
-- comparison, not a credential. With it, a superseded subscription is
-- recognisable BEFORE a send is attempted, which turns a silent permanent
-- outage into the ordinary lapse path that already exists: prune, tell the
-- user, and let the next app boot re-subscribe under the current key.
--
-- `last_error` / `last_failed_at` record why a device that IS current still is
-- not receiving, so "registered but never reached" stops being invisible.
-- `last_used_at` (0473) has always meant "last registered" because nothing
-- ever wrote it on a successful send; it now means what its name says.
-- ============================================================================

ALTER TABLE push_subscription
  ADD COLUMN IF NOT EXISTS vapid_key_hash text,
  ADD COLUMN IF NOT EXISTS last_error     text,
  ADD COLUMN IF NOT EXISTS last_failed_at timestamptz;

COMMENT ON COLUMN push_subscription.vapid_key_hash IS
  'SHA-256 of the VAPID public key this subscription was minted with. NULL for rows created before 12770 — those are attempted, and a 403 then marks them superseded.';
COMMENT ON COLUMN push_subscription.last_error IS
  'Classified verdict of the last failed send (superseded_key | rejected_<status> | unreachable), with the push service''s own message.';

-- Superseded rows are pruned as they are found, so this index serves the
-- lookup that finds them, not a long-lived population.
CREATE INDEX IF NOT EXISTS ix_push_sub_key_hash
  ON push_subscription (vapid_key_hash);

-- DOWN
--   DROP INDEX IF EXISTS ix_push_sub_key_hash;
--   ALTER TABLE push_subscription
--     DROP COLUMN IF EXISTS last_failed_at,
--     DROP COLUMN IF EXISTS last_error,
--     DROP COLUMN IF EXISTS vapid_key_hash;
