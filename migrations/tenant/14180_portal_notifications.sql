-- ============================================================================
-- TENANT DB — 14180 Telling a client something is waiting in their portal:
-- by email, and on the phone or computer they installed the portal on (client
-- portal redesign, PR 2).
--
-- Until now the portal was a place a client had to remember to visit. A reply
-- from the team, a document we asked for, a new invoice or proposal, a shipment
-- reaching port: each sat there until somebody happened to look, and the team
-- chased by telephone what the portal had already said.
--
-- ── WHAT A CLIENT CAN TURN OFF, AND WHAT THE DEFAULTS ARE ───────────────────
--
-- Five topics — MESSAGES, REQUESTS, BILLING, PROPOSALS, SHIPMENTS — each on two
-- channels. Everything is ON except shipment updates by email: a stage reached
-- is worth a tap on a phone and not worth an inbox, and a busy importer with
-- forty files on the water would otherwise receive forty emails a day. The
-- defaults live in the code (portal_notify.service DEFAULTS), so a person who
-- has never opened the settings has no row here at all; the row appears the
-- first time they change something, and from then on it says exactly what they
-- chose. The OFF lists are stored rather than the ON lists so that a topic
-- added later reaches everybody by default instead of nobody.
--
-- A person's settings belong to them AT THIS CLIENT (client_id, email): the
-- grant is per company, and so is what they want to hear about it.
--
-- ── DEVICES ARE IDENTITY, NOT BUSINESS DATA ─────────────────────────────────
--
-- A browser that agreed to receive notifications is a device of a portal
-- login, exactly as `push_subscription` is a device of a staff login, and it is
-- written the same way: always in the LIVE schema, keyed by the endpoint the
-- push service handed out, carrying the fingerprint of the key it was minted
-- under so a rotated key prunes it instead of failing silently (12770), and the
-- same last-used / last-failed columns the staff table has, so one sender can
-- serve both.
--
-- ── THE OUTBOX ──────────────────────────────────────────────────────────────
--
-- `portal_notify_outbox` is written by emitEvent's hook IN THE TRANSACTION of
-- the change it is about — the reply saved, the invoice posted, the stage
-- completed — and read by a delayed job. Two things follow, and they are why
-- this is a table and not just a queued job:
--
--   · a change that rolls back takes its row with it, so a client is never
--     told about a reply that was never saved;
--   · a burst becomes one message: four documents requested in a minute are
--     four rows and one email listing four things, not four emails.
--
-- Each row is sent on two channels, which can finish at different times (a
-- chat reply is pushed within seconds and emailed only if still unread ten
-- minutes later), hence a done-stamp per channel. `thread_key` is the
-- conversation for MESSAGES ('general' or a shipment id) and NULL otherwise.
--
-- ── WHAT WAS SENT ───────────────────────────────────────────────────────────
--
-- `portal_notify_sent` is how a delivery is never repeated: a job that is
-- retried after sending two of three emails must not send the first two again,
-- and a conversation that keeps moving must not email the same person every
-- ten minutes. One row per person, channel and thing told; the unique key is
-- the claim, taken before the send. Rows older than thirty days are removed by
-- the sender itself, and so are outbox rows done on both channels — nothing
-- reads further back than an hour.
--
-- ── THE SEND POINT ──────────────────────────────────────────────────────────
--
-- `portal.notify` joins the registry (10726) so an administrator can send these
-- from, say, support@ rather than the default notifications address — and it
-- is wired: portal_notify.service passes it on every email.
-- ============================================================================

CREATE TABLE IF NOT EXISTS portal_notify_setting (
  client_id      uuid NOT NULL REFERENCES client_master(client_id) ON DELETE CASCADE,
  subject_email  citext NOT NULL,
  language       text,
  email_off      text[] NOT NULL DEFAULT '{}',
  push_off       text[] NOT NULL DEFAULT '{}',
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_portal_notify_setting PRIMARY KEY (client_id, subject_email),
  CONSTRAINT ck_portal_notify_setting_language CHECK (language IS NULL OR language IN ('en','fr')),
  CONSTRAINT ck_portal_notify_setting_email_off
    CHECK (email_off <@ ARRAY['MESSAGES','REQUESTS','BILLING','PROPOSALS','SHIPMENTS']::text[]),
  CONSTRAINT ck_portal_notify_setting_push_off
    CHECK (push_off <@ ARRAY['MESSAGES','REQUESTS','BILLING','PROPOSALS','SHIPMENTS']::text[])
);

CREATE TABLE IF NOT EXISTS portal_push_subscription (
  endpoint        text PRIMARY KEY,
  portal_user_id  uuid NOT NULL REFERENCES portal_user(portal_user_id) ON DELETE CASCADE,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  vapid_key_hash  text,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  last_failed_at  timestamptz,
  last_error      text
);
CREATE INDEX IF NOT EXISTS ix_portal_push_subscription_user ON portal_push_subscription (portal_user_id);

CREATE TABLE IF NOT EXISTS portal_notify_outbox (
  outbox_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id      uuid NOT NULL REFERENCES client_master(client_id) ON DELETE CASCADE,
  topic          text NOT NULL,
  thread_key     text,
  event_key      text NOT NULL,
  item_ref       text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  push_done_at   timestamptz,
  email_done_at  timestamptz,
  CONSTRAINT ck_portal_notify_outbox_topic
    CHECK (topic IN ('MESSAGES','REQUESTS','BILLING','PROPOSALS','SHIPMENTS')),
  CONSTRAINT ck_portal_notify_outbox_thread
    CHECK (thread_key IS NULL OR thread_key = 'general' OR thread_key ~ '^[0-9a-f-]{36}$')
);
-- What a job reads: this client's waiting rows for one topic (and thread).
CREATE INDEX IF NOT EXISTS ix_portal_notify_outbox_waiting
  ON portal_notify_outbox (client_id, topic, thread_key, outbox_id)
  WHERE push_done_at IS NULL OR email_done_at IS NULL;

CREATE TABLE IF NOT EXISTS portal_notify_sent (
  sent_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id      uuid NOT NULL REFERENCES client_master(client_id) ON DELETE CASCADE,
  subject_email  citext NOT NULL,
  channel        text NOT NULL,
  topic          text NOT NULL,
  dedupe_key     text NOT NULL,
  sent_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_portal_notify_sent_channel CHECK (channel IN ('EMAIL','PUSH')),
  CONSTRAINT ck_portal_notify_sent_topic
    CHECK (topic IN ('MESSAGES','REQUESTS','BILLING','PROPOSALS','SHIPMENTS','TEST')),
  CONSTRAINT ux_portal_notify_sent UNIQUE (subject_email, channel, dedupe_key)
);
-- "Did this person get an email about this thread in the last hour?"
CREATE INDEX IF NOT EXISTS ix_portal_notify_sent_recent
  ON portal_notify_sent (subject_email, channel, topic, sent_at DESC);
-- The thirty-day sweep.
CREATE INDEX IF NOT EXISTS ix_portal_notify_sent_age ON portal_notify_sent (sent_at);

INSERT INTO mail_send_point
  (send_point_key, module_key, group_key, label_en, label_fr, description_en, description_fr, legacy_purpose, default_catalogue_key, is_wired, sort_order)
VALUES
  ('portal.notify', 'MOD-67', 'OPERATIONS', 'Client portal alert', 'Alerte du portail client',
   'Tells a client contact that something is waiting in their portal: a reply, a request, an invoice, a proposal or a shipment update.',
   'Prévient un contact client qu''un élément l''attend dans son portail : une réponse, une demande, une facture, une proposition ou une étape d''expédition.',
   'NOTIFICATIONS', 'SUPPORT', true, 35)
ON CONFLICT (send_point_key) DO NOTHING;

-- DOWN
-- Additive. Dropping the tables forgets every client's notification choices and
-- every device they registered; the devices re-register the next time the
-- portal is opened with notifications allowed, the choices do not come back.
--
--   DELETE FROM mail_send_point_binding WHERE send_point_key = 'portal.notify';
--   DELETE FROM mail_send_point WHERE send_point_key = 'portal.notify';
--   DROP TABLE IF EXISTS portal_notify_sent;
--   DROP TABLE IF EXISTS portal_notify_outbox;
--   DROP TABLE IF EXISTS portal_push_subscription;
--   DROP TABLE IF EXISTS portal_notify_setting;
