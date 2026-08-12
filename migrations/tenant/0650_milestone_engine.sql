-- ============================================================================
-- TENANT DB — 0650 Milestone engine: weights, working time, re-baselining.
--
-- WHAT THIS REPLACES
--
-- 0310 gave every stage ONE number — `default_offset_days` — and every instance
-- ONE date. A due date was `base + N days`, computed once at instantiation and
-- never touched again. That model cannot express any of the things a forwarder
-- actually needs: it does not know that customs is shut on Sunday, it cannot
-- tell you the file is going to be late before it is late, and when a vessel
-- berths four days behind schedule it leaves every downstream date quietly
-- wrong until somebody edits them by hand.
--
-- THE THREE DATES, WHICH ARE THE HEART OF THIS FILE
--
--   baseline_due  frozen at instantiation. Never moves, ever. This is the
--                 yardstick — "were we ever on plan?" is not answerable without
--                 a number that predates the excuses.
--   planned_due   the commitment. What the client is told. Moves only when work
--                 runs LATE, or when a human re-plans and signs for it.
--   forecast_due  what we actually believe. Moves in both directions, freely.
--
-- One date cannot do this job. The rule the business asked for — "a delay pushes
-- everything out, but finishing early must NOT pull the promise forward" — is
-- unimplementable with a single column: an early finish would either have to lie
-- (leave stale dates downstream) or break the rule. Splitting commitment from
-- prediction is what makes both halves honest at once. It is also the shape the
-- predictive layer will need later: baseline → forecast → actual, per stage, per
-- lane, is exactly the training signal for "this carrier is habitually 2 days
-- late into Douala in Q4".
--
-- THE COMPRESSION FLOOR (`min_duration_hours`) IS NOT A NICETY
--
-- `is_target_lock` protects a delivery commitment: upstream slip compresses the
-- remaining stages instead of moving the final date. Left there, that is a
-- schedule generator that will happily allocate forty minutes to a customs
-- inspection and report OK. The floor is what stops it. When the remaining
-- floors no longer fit inside the remaining time, the engine stops compressing
-- and says the commitment is unreachable (BREACH_FORECAST) — early, loudly, and
-- while somebody can still do something about it. A schedule that always looks
-- feasible is worth nothing.
--
-- WHY ATTRIBUTION LIVES ON THE INSTANCE
--
-- `owner_tier` + `attributed_to` + `cause_reason_code`. When a stage slips, the
-- variance is charged to the tier that owns THAT stage — not the tier that owns
-- the stage whose forecast moved as a result. Get this backwards and every
-- carrier delay lands on internal ops' scorecard, because ops owns the delivery
-- stage that got pushed. `cause_reason_code` is the exception valve: a port
-- strike is not the carrier's fault, and the codes come from the same vocabulary
-- as the published assumptions register (service_type_assumption) so what we
-- promised and what we excused are written in one language.
--
-- STAGE COUNT IS CAPPED AT 15, ENFORCED IN A TRIGGER
--
-- The floor of 3 is validator-only, deliberately: stages arrive one INSERT at a
-- time, so a DB-level minimum would reject the first row of every new template.
-- The ceiling is enforceable row-by-row and is enforced here, because a runaway
-- template is the one that silently breaks weight arithmetic (a 40-stage chain
-- gives each stage 2.5% and the maths stops meaning anything).
--
-- ADDITIVE ONLY. Every existing column keeps working; `default_offset_days`
-- remains the fallback when a dossier has no target date at all, which is why
-- it is not dropped. Existing instances keep their `due_date` and are backfilled
-- into the three-date model below.
-- ============================================================================

-- ── Template stages: weight, floor, ownership, behaviour ────────────────────
ALTER TABLE milestone_template_stage
  ADD COLUMN IF NOT EXISTS weight                     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_duration_hours         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS owner_tier                 text,
  ADD COLUMN IF NOT EXISTS responsible_role_id        uuid,
  ADD COLUMN IF NOT EXISTS is_anchor                  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_target_lock             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_client_visible          boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_optional                boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_blocking                boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS chain_segment              text,
  ADD COLUMN IF NOT EXISTS cadence                    text,
  ADD COLUMN IF NOT EXISTS required_evidence_doc_type text,
  ADD COLUMN IF NOT EXISTS auto_advance_on_event      text,
  ADD COLUMN IF NOT EXISTS is_system                  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS system_code                text,
  ADD COLUMN IF NOT EXISTS source_version             integer;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'milestone_stage_owner_tier_chk' AND conrelid = 'milestone_template_stage'::regclass) THEN
    ALTER TABLE milestone_template_stage
      ADD CONSTRAINT milestone_stage_owner_tier_chk
      CHECK (owner_tier IS NULL OR owner_tier IN ('INTERNAL','CARRIER','TERMINAL','AUTHORITY','CLIENT'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'milestone_stage_cadence_chk' AND conrelid = 'milestone_template_stage'::regclass) THEN
    ALTER TABLE milestone_template_stage
      ADD CONSTRAINT milestone_stage_cadence_chk
      CHECK (cadence IS NULL OR cadence IN ('DAILY','WEEKLY','MONTHLY','QUARTERLY','ANNUAL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'milestone_stage_weight_chk' AND conrelid = 'milestone_template_stage'::regclass) THEN
    ALTER TABLE milestone_template_stage
      ADD CONSTRAINT milestone_stage_weight_chk
      CHECK (weight >= 0 AND weight <= 100 AND min_duration_hours >= 0);
  END IF;
  -- Idempotent seeding and "restore this stage to the system default" both need
  -- a stable key. `code` is unique within a template by operational logic
  -- already; nothing enforced it, so a double-run of a seed produced a template
  -- with two BOOKING stages and a chain that could never be advanced cleanly.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'milestone_stage_code_uq' AND conrelid = 'milestone_template_stage'::regclass) THEN
    ALTER TABLE milestone_template_stage
      ADD CONSTRAINT milestone_stage_code_uq UNIQUE (milestone_template_id, code);
  END IF;
END $$;

-- ── Templates: name + provenance so a tenant edit is visible as drift ───────
ALTER TABLE milestone_template
  ADD COLUMN IF NOT EXISTS name           text,
  ADD COLUMN IF NOT EXISTS is_system      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS system_code    text,
  ADD COLUMN IF NOT EXISTS source_version integer,
  ADD COLUMN IF NOT EXISTS published_by   uuid,
  ADD COLUMN IF NOT EXISTS published_at   timestamptz;

-- ── Instances: three dates, health, attribution, deviation ──────────────────
ALTER TABLE milestone_instance
  ADD COLUMN IF NOT EXISTS label_en                   text,
  ADD COLUMN IF NOT EXISTS baseline_due               date,
  ADD COLUMN IF NOT EXISTS planned_due                date,
  ADD COLUMN IF NOT EXISTS forecast_due               date,
  ADD COLUMN IF NOT EXISTS actual_start               timestamptz,
  ADD COLUMN IF NOT EXISTS weight                     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_duration_hours         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS owner_tier                 text,
  ADD COLUMN IF NOT EXISTS responsible_role_id        uuid,
  ADD COLUMN IF NOT EXISTS is_anchor                  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_target_lock             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_client_visible          boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_optional                boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_blocking                boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS chain_segment              text,
  ADD COLUMN IF NOT EXISTS cadence                    text,
  ADD COLUMN IF NOT EXISTS required_evidence_doc_type text,
  ADD COLUMN IF NOT EXISTS auto_advance_on_event      text,
  ADD COLUMN IF NOT EXISTS is_ad_hoc                  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_due_override        date,
  ADD COLUMN IF NOT EXISTS health                     text NOT NULL DEFAULT 'OK',
  ADD COLUMN IF NOT EXISTS variance_hours             integer,
  ADD COLUMN IF NOT EXISTS attributed_to              text,
  ADD COLUMN IF NOT EXISTS cause_reason_code          text,
  ADD COLUMN IF NOT EXISTS cause_note                 text,
  ADD COLUMN IF NOT EXISTS reopened_at                timestamptz,
  ADD COLUMN IF NOT EXISTS reopened_by                uuid,
  ADD COLUMN IF NOT EXISTS reopen_reason              text,
  ADD COLUMN IF NOT EXISTS last_rebaselined_at        timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'milestone_instance_health_chk' AND conrelid = 'milestone_instance'::regclass) THEN
    ALTER TABLE milestone_instance
      ADD CONSTRAINT milestone_instance_health_chk
      CHECK (health IN ('OK','DUE','AT_RISK','DELAYED','BREACH_FORECAST','DONE','BLOCKED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'milestone_instance_owner_tier_chk' AND conrelid = 'milestone_instance'::regclass) THEN
    ALTER TABLE milestone_instance
      ADD CONSTRAINT milestone_instance_owner_tier_chk
      CHECK (owner_tier IS NULL OR owner_tier IN ('INTERNAL','CARRIER','TERMINAL','AUTHORITY','CLIENT'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'milestone_instance_attributed_chk' AND conrelid = 'milestone_instance'::regclass) THEN
    ALTER TABLE milestone_instance
      ADD CONSTRAINT milestone_instance_attributed_chk
      CHECK (attributed_to IS NULL OR attributed_to IN ('INTERNAL','CARRIER','TERMINAL','AUTHORITY','CLIENT'));
  END IF;
END $$;

-- Existing chains predate the three-date model. Seed all three from the date
-- they already have, so a live dossier reads as exactly on plan rather than as
-- missing data — its baseline is the only honest one available.
UPDATE milestone_instance
   SET baseline_due = COALESCE(baseline_due, due_date),
       planned_due  = COALESCE(planned_due,  due_date),
       forecast_due = COALESCE(forecast_due, due_date)
 WHERE due_date IS NOT NULL
   AND (baseline_due IS NULL OR planned_due IS NULL OR forecast_due IS NULL);

-- 0310 named this column `label`, the client type calls it `label_fr`, and the
-- chain therefore rendered stage CODES to every user since the engine shipped.
UPDATE milestone_instance mi
   SET label_en = s.label_en
  FROM milestone_template_stage s
 WHERE s.code = mi.code
   AND mi.label_en IS NULL;

CREATE INDEX IF NOT EXISTS ix_milestone_instance_health
  ON milestone_instance (health) WHERE status <> 'DONE';
CREATE INDEX IF NOT EXISTS ix_milestone_instance_planned_due
  ON milestone_instance (planned_due) WHERE status <> 'DONE';
CREATE INDEX IF NOT EXISTS ix_milestone_instance_auto_event
  ON milestone_instance (auto_advance_on_event) WHERE auto_advance_on_event IS NOT NULL;

-- ── Cap a template at 15 stages ─────────────────────────────────────────────
-- See the header for why the ceiling is here and the floor is in the validator.
CREATE OR REPLACE FUNCTION milestone_stage_cap()
RETURNS trigger AS $$
DECLARE
  n integer;
BEGIN
  SELECT COUNT(*) INTO n
    FROM milestone_template_stage
   WHERE milestone_template_id = NEW.milestone_template_id;
  IF n > 15 THEN
    RAISE EXCEPTION 'milestone template % exceeds the 15-stage cap', NEW.milestone_template_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_milestone_stage_cap
  AFTER INSERT ON milestone_template_stage
  FOR EACH ROW EXECUTE FUNCTION milestone_stage_cap();

-- ── Service taxonomy: how long, measured how, and does it even end ──────────
ALTER TABLE service_type
  ADD COLUMN IF NOT EXISTS default_duration_days integer,
  ADD COLUMN IF NOT EXISTS duration_basis        text NOT NULL DEFAULT 'WORKING_DAYS',
  ADD COLUMN IF NOT EXISTS is_open_ended         boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_type_duration_basis_chk' AND conrelid = 'service_type'::regclass) THEN
    ALTER TABLE service_type
      ADD CONSTRAINT service_type_duration_basis_chk
      CHECK (duration_basis IN ('WORKING_DAYS','CALENDAR_DAYS','MONTHS'));
  END IF;
END $$;

-- The client's promise, which is NOT the carrier's estimate. `eta` is what the
-- line says the vessel will do; this is what we are judged on. Conflating them
-- is how an SLA quietly becomes whatever the carrier managed.
ALTER TABLE dossier
  ADD COLUMN IF NOT EXISTS promised_delivery_date date;

-- ── Working calendar ────────────────────────────────────────────────────────
-- Scoped to a corporate entity, with ONE tenant-wide default (entity_id IS
-- NULL) so a fresh tenant computes working time correctly before anybody has
-- opened the settings screen. Hours are local wall-clock in `timezone`.
CREATE TABLE IF NOT EXISTS working_calendar (
  working_calendar_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid REFERENCES corporate_entity(entity_id) ON DELETE CASCADE,
  name          text NOT NULL,
  timezone      text NOT NULL DEFAULT 'Africa/Douala',
  -- One row per weekday keeps the shape obvious in SQL and in the UI: 0=Sunday.
  -- Closed days are simply absent from working_calendar_day.
  is_default    boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_working_calendar_default
  ON working_calendar ((entity_id IS NULL)) WHERE entity_id IS NULL AND is_default;

CREATE TABLE IF NOT EXISTS working_calendar_day (
  working_calendar_day_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  working_calendar_id uuid NOT NULL REFERENCES working_calendar(working_calendar_id) ON DELETE CASCADE,
  weekday    smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0 = Sunday
  opens_at   time NOT NULL,
  closes_at  time NOT NULL,
  CHECK (closes_at > opens_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_working_calendar_day
  ON working_calendar_day (working_calendar_id, weekday);

CREATE TABLE IF NOT EXISTS working_calendar_holiday (
  working_calendar_holiday_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  working_calendar_id uuid NOT NULL REFERENCES working_calendar(working_calendar_id) ON DELETE CASCADE,
  -- `holiday_date` carries a real year for movable feasts (Eid, Easter Monday);
  -- `is_recurring` marks the fixed ones, where only month/day matter and the
  -- year is a sample. Both are needed: Cameroon's calendar has both kinds.
  holiday_date date NOT NULL,
  is_recurring boolean NOT NULL DEFAULT false,
  name_fr      text NOT NULL,
  name_en      text,
  is_system    boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_working_calendar_holiday
  ON working_calendar_holiday (working_calendar_id, holiday_date);

-- ── Published assumptions register ──────────────────────────────────────────
-- The engine's honesty layer. Every counterparty we depend on keeps its own
-- hours, and a schedule that pretends otherwise is a schedule nobody trusts.
-- These are seeded per service type, editable, and the client-visible ones are
-- rendered on the portal beside the milestone chain — so the promise and its
-- conditions are read together.
CREATE TABLE IF NOT EXISTS service_type_assumption (
  service_type_assumption_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type_id   uuid NOT NULL REFERENCES service_type(service_type_id) ON DELETE CASCADE,
  seq               integer NOT NULL DEFAULT 0,
  code              text NOT NULL,
  text_fr           text NOT NULL,
  text_en           text,
  is_client_visible boolean NOT NULL DEFAULT true,
  is_system         boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_service_type_assumption
  ON service_type_assumption (service_type_id, code);

-- ── Re-baseline history ─────────────────────────────────────────────────────
-- One row per stage per recalculation. This is the audit trail behind every
-- moved date and every point on a scorecard: who slipped, by how much, against
-- which commitment, and what the schedule did about it. Without it "the carrier
-- costs us four days a file" is an assertion; with it, it is a query.
CREATE TABLE IF NOT EXISTS milestone_rebaseline_log (
  milestone_rebaseline_log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id            uuid NOT NULL REFERENCES dossier(dossier_id) ON DELETE CASCADE,
  milestone_instance_id uuid REFERENCES milestone_instance(milestone_instance_id) ON DELETE CASCADE,
  occurred_at           timestamptz NOT NULL DEFAULT now(),
  trigger_event         text NOT NULL,        -- ADVANCE | REOPEN | TARGET_CHANGED | INSERT | SCAN
  old_planned_due       date,
  new_planned_due       date,
  old_forecast_due      date,
  new_forecast_due      date,
  variance_hours        integer,
  attributed_to         text,
  cause_reason_code     text,
  outcome               text,                 -- SHIFTED | COMPRESSED | BREACH_FORECAST | LOCK_RELEASED | NO_CHANGE
  actor_user_id         uuid
);
CREATE INDEX IF NOT EXISTS ix_milestone_rebaseline_dossier
  ON milestone_rebaseline_log (dossier_id, occurred_at DESC);

-- DOWN
-- DROP TABLE IF EXISTS milestone_rebaseline_log;
-- DROP TABLE IF EXISTS service_type_assumption;
-- DROP TABLE IF EXISTS working_calendar_holiday;
-- DROP TABLE IF EXISTS working_calendar_day;
-- DROP TABLE IF EXISTS working_calendar;
-- DROP TRIGGER IF EXISTS trg_milestone_stage_cap ON milestone_template_stage;
-- DROP FUNCTION IF EXISTS milestone_stage_cap();
-- ALTER TABLE dossier DROP COLUMN IF EXISTS promised_delivery_date;
-- ALTER TABLE service_type DROP COLUMN IF EXISTS default_duration_days,
--   DROP COLUMN IF EXISTS duration_basis, DROP COLUMN IF EXISTS is_open_ended;
-- (milestone_instance / milestone_template_stage columns are additive; drop
--  them individually only after confirming no chain is mid-flight.)
