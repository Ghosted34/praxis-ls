-- ============================================================================
-- PLATFORM DB — 0092 In-house notifications (PROMPT_ErrorMonitor_Module §3.3, §5.3)
-- ============================================================================
--
-- Closes the last delivery gap in the Error Command Center. Two features were
-- shipped against a channel that did not exist:
--
--   §3.3  the Share modal's "In-house notification — send to a team member".
--         With no endpoint it fell back to COPYING the payload to the clipboard
--         and telling the operator to paste it somewhere. That is not a channel,
--         it is an apology.
--   §5.3  escalation's `action_inhouse`. It emitted a socket event and wrote a
--         row to error_escalation_log. A socket event reaches whoever happens to
--         have the console OPEN AT THAT INSTANT — which, for a rule that exists
--         to catch a 3am outage, is nobody. The escalation log is a record of
--         what fired, not a thing anyone is shown.
--
-- So the one class of notification that most needs to survive the recipient not
-- looking at the screen was the one with nowhere to persist. This table is that
-- somewhere.
--
-- WHY PLATFORM-SCOPED AND NOT PER TENANT
--
-- The recipients are platform_user rows: Praxis staff, not tenant users. There
-- is no tenant database that a notification to a Praxis admin belongs in, and
-- the console — which is the only thing that renders these — holds no tenant
-- connection (PRD §5.3 [RULE]). Same argument as 0090's error_event.
--
-- GRAIN: one row per (recipient, event). A fan-out to five on-call admins is
-- five rows, deliberately. Read state is per person, and a shared row with a
-- read-by array turns "mark as read" into a write conflict between two admins
-- looking at the same incident.
--
-- NO ROW IS EVER UPDATED EXCEPT read_at. Notifications are an audit trail of
-- what someone was told and when — editing the text after the fact would make
-- "I was never told" unanswerable.
--
-- DOWN
-- Fully additive: one table, no changes to any existing object. Nothing
-- references it, so dropping it loses notification history and nothing else.
--
-- DROP TABLE IF EXISTS platform.notification;

CREATE TABLE platform.notification (
  notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CASCADE: a deleted staff member's unread notifications are noise, and there
  -- is no one left for them to be addressed to.
  to_user_id      uuid NOT NULL REFERENCES platform.platform_user(platform_user_id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE. "Who told me about this outage" is worth keeping even
  -- after that person leaves; deleting the notification with them would erase
  -- the record from the recipient's side too. NULL means the system sent it.
  from_user_id    uuid REFERENCES platform.platform_user(platform_user_id) ON DELETE SET NULL,

  type            text NOT NULL DEFAULT 'error_escalation'
                    CHECK (type IN ('error_escalation', 'error_share', 'system')),
  title           text NOT NULL,
  body            text NOT NULL,
  -- §3.3's metadata block: error_id, error_signature, module, route. Kept as
  -- jsonb rather than columns because the shape is per-type and this table will
  -- outlive the error monitor being its only producer.
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,

  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- The only query the bell makes: "my notifications, newest first".
CREATE INDEX ix_notification_user ON platform.notification (to_user_id, created_at DESC);
-- Partial, because the unread COUNT is polled on every console page load and
-- read rows accumulate forever while unread ones are almost always a handful.
CREATE INDEX ix_notification_unread ON platform.notification (to_user_id, created_at DESC)
  WHERE read_at IS NULL;
-- Escalation dedupe reads this: "have I already told this person about this
-- signature recently". Without it that check is a sequential scan on the table
-- whose write rate spikes during exactly the incident it is meant to survive.
CREATE INDEX ix_notification_signature ON platform.notification ((metadata->>'error_signature'), created_at DESC)
  WHERE type = 'error_escalation';

-- ── Capability ──────────────────────────────────────────────────────────────
-- READING your own notifications needs no capability and deliberately has none:
-- a notification addressed to you is yours, and gating it would mean a
-- PLATFORM_SUPPORT user could be sent something they then cannot open.
--
-- SENDING is gated on errors.read at the route, not here — you may only share an
-- error you are allowed to see, which is a property of the error, not of the
-- notification. That is why 0092 grants nothing new.

-- DOWN
-- DROP TABLE IF EXISTS platform.notification;
