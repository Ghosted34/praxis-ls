-- ============================================================================
-- TENANT DB — 14240 The onboarding checklist every client starts from, edited
-- from the Clients screen's ⚙ Settings (client management consolidated into
-- the Client 360).
--
-- Until now the baseline steps were a constant in portal.service.js
-- (ONBOARDING_DEFAULTS) and copied into client_onboarding_step on a client's
-- first read. 10706 promised "a tenant can extend later without a migration"
-- and nothing let one: the four steps were the same for every tenant, and a
-- tenant that onboards clients differently had no way to say so.
--
-- This table is that list. It is keyed by `step_key` — the same key
-- client_onboarding_step already carries — so the seed below is the old
-- constant, row for row, and every client's existing checklist lines up with
-- it without a data migration.
--
-- How a client's checklist follows the template (portal.repo.syncOnboarding):
--   - an ACTIVE step the client does not have yet is added (a step added here
--     reaches every client the next time their checklist is opened);
--   - a step's wording and order follow the template, done or not;
--   - a step switched OFF here is dropped from a client's list only while it
--     is still unticked. A ticked step is a record of something that happened
--     for that client, and switching the step off for the future does not
--     unhappen it.
-- Steps are never deleted, only switched off, for the same reason: the key is
-- what a client's history refers to.
-- ============================================================================

CREATE TABLE IF NOT EXISTS client_onboarding_template (
  step_key    text PRIMARY KEY CHECK (step_key ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  label_en    text NOT NULL CHECK (length(btrim(label_en)) BETWEEN 1 AND 160),
  label_fr    text NOT NULL CHECK (length(btrim(label_fr)) BETWEEN 1 AND 160),
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  updated_by  uuid REFERENCES app_user(user_id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE client_onboarding_template IS
  'The onboarding checklist every client starts from (14240). Copied into client_onboarding_step by key when a client''s checklist is read; switched off, never deleted.';

INSERT INTO client_onboarding_template (step_key, label_en, label_fr, sort_order) VALUES
  ('COMPANY_PROFILE',   'Company profile completed', 'Profil d''entreprise complété',    10),
  ('KYC_DOCUMENTS',     'KYC documents received',    'Documents KYC reçus',              20),
  ('SERVICE_AGREEMENT', 'Service agreement signed',  'Convention de service signée',     30),
  ('FIRST_BOOKING',     'First shipment booked',     'Première expédition réservée',     40)
ON CONFLICT (step_key) DO NOTHING;

-- DOWN
-- Additive: one new table. Clients' own checklists (client_onboarding_step)
-- are untouched either way. Rolling back also means reverting
-- portal.repo.syncOnboarding, which reads the template.
--
--   DROP TABLE IF EXISTS client_onboarding_template;
