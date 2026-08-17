-- ============================================================================
-- TENANT DB — 10706 client onboarding command centre (PRD §11.1).
--
-- Per-client onboarding checklist: the client portal shows the steps and
-- their progress; staff (MOD-67) tick steps off as they complete (KYC
-- documents received, agreement signed, first booking). Default steps are
-- seeded on first read by the service, so every client gets the same baseline
-- and a tenant can extend later without a migration.
-- ============================================================================

CREATE TABLE IF NOT EXISTS client_onboarding_step (
  client_onboarding_step_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 uuid NOT NULL REFERENCES client_master(client_id) ON DELETE CASCADE,
  step_key                  text NOT NULL,
  label_en                  text NOT NULL,
  label_fr                  text NOT NULL,
  done                      boolean NOT NULL DEFAULT false,
  done_at                   timestamptz,
  done_by                   uuid REFERENCES app_user(user_id),
  sort_order                integer NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, step_key)
);

-- DOWN
--   DROP TABLE IF EXISTS client_onboarding_step;
