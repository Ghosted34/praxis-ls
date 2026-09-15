-- ============================================================================
-- TENANT — 13795 Notifications: which ones are allowed to interrupt.
--
-- ── THE PROBLEM ────────────────────────────────────────────────────────────
--
-- Every notification in this product arrives with the same weight: a number on
-- a bell, refreshed by a 60-second poll that pauses when the tab is hidden. A
-- cash request awaiting approval and an invoice posted look identical and sound
-- identical, because neither makes a sound. The operational cost is not
-- hypothetical — an approval nobody knew about is a truck that did not load.
--
-- A notification now carries whether it may INTERRUPT: play a tone, hold the
-- banner on screen until it is dealt with, vibrate a phone. The default set
-- lives in packages/shared/rules/notification-interrupt.js — anything HIGH,
-- plus `approvals` and `comms` — and this table is where a user overrides it.
--
-- ── WHY A NEW TABLE AND NOT A CHANNEL ON notification_preference ───────────
--
-- The obvious home was `notification_preference`, which is already
-- (user_id, channel, category) → enabled with a missing row meaning "default".
-- Interrupt is the same shape of question about the same pair, so the first
-- version of this migration added 'INTERRUPT' to that table's channel CHECK.
--
-- It cannot. `tests/unit/migration-constraint-ordering.test.js` forbids adding
-- a CHECK or a foreign key to a PRE-EXISTING table above 13791, and the reason
-- is provisioning rather than style: `provisioning.service.js` migrates every
-- file against live and THEN every file against sandbox, so when 13791 runs in
-- the sandbox pass it mirrors the constraints it finds in live — where every
-- later migration has already run — into a sandbox that has only reached
-- 13791. It guards that the table exists but not that the column does, and it
-- does not catch undefined_column, so a new tenant aborts mid-provision.
--
-- A NEW table is explicitly outside that hazard: 13791 skips a table absent
-- from the target, and this one does not exist in sandbox when 13791 looks.
--
-- The API shape is unchanged regardless — GET/PUT /notifications/preferences
-- still speaks (channel, category, enabled) with channel 'INTERRUPT', and the
-- repo routes those rows here. So the endpoint, the validator and the
-- Preferences grid neither know nor care which table backs them.
--
-- `enabled` is the override in both directions: a row with false silences a
-- category that interrupts by default, a row with true raises one that does
-- not. A MISSING row means the computed default, which is why there is no
-- backfill — writing today's defaults as rows would freeze them, and the next
-- change to that rule would reach nobody who had ever opened the screen.
--
-- Security notifications ignore this table, as they ignore every other
-- preference. That is enforced in notification.service, not here.
-- ============================================================================

CREATE TABLE IF NOT EXISTS notification_interrupt_preference (
  user_id     uuid NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  category    text NOT NULL,
  enabled     boolean NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category)
);

CREATE INDEX IF NOT EXISTS ix_notif_interrupt_user
  ON notification_interrupt_preference (user_id);

COMMENT ON TABLE notification_interrupt_preference IS
  'Per-user, per-category override of whether a notification may interrupt — play a tone, hold its banner until dismissed, vibrate a phone. A missing row means the computed default in packages/shared/rules/notification-interrupt.js. Reached through the ordinary preferences endpoint as the pseudo-channel INTERRUPT; it is not a delivery channel and nothing dispatches to it.';

-- ============================================================================
-- VERIFY
--   INSERT INTO notification_interrupt_preference (user_id, category, enabled)
--     SELECT user_id, 'approvals', false FROM app_user LIMIT 1;   -- accepted
--   INSERT INTO notification_interrupt_preference (user_id, category, enabled)
--     SELECT user_id, 'approvals', true  FROM app_user LIMIT 1;   -- expect 23505
--
-- DOWN
--   DROP TABLE IF EXISTS notification_interrupt_preference;
--   -- Every notification reverts to the computed default. Nothing else reads
--   -- this table.
-- ============================================================================
