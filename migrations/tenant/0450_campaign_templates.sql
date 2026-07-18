-- ============================================================================
-- TENANT DB — 0450 marketing campaign email templates + sending identities
-- (MOD-22). Moves campaign templates off the generic /settings store onto a
-- first-class module so a marketing role (not settings admin) can manage them,
-- and so a template references a configured sender identity rather than
-- embedding a raw from-address. `verified_at` is a manual/admin stamp today
-- (no SPF/DKIM check yet) — see doc/CAMPAIGN_TEMPLATES_BE_HANDOFF.md.
-- ============================================================================
CREATE TABLE IF NOT EXISTS campaign_sender (
  sender_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_name     text NOT NULL,
  from_address  citext NOT NULL,
  domain        text,                                 -- derived from from_address
  verified_at   timestamptz,                          -- null until verified
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_campaign_sender_addr ON campaign_sender(from_address);

CREATE TABLE IF NOT EXISTS campaign_template (
  template_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  subject        text,
  body_html      text,
  from_sender_id uuid REFERENCES campaign_sender(sender_id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_campaign_template_sender ON campaign_template(from_sender_id);
