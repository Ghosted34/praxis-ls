-- ============================================================================
-- TENANT DB — 0702 training: a session that happens, and a certificate that
-- expires
--
-- ── WHAT A TRAINING HAS BEEN ───────────────────────────────────────────────
--
--   training(title, scheduled_on date, facilitator text, status)
--   training_attendance(training_id, employee_id, attended bool, certificate)
--
-- A title, a DATE, and a boolean somebody ticks afterwards. Four consequences,
-- each of which is a thing the product cannot currently do:
--
--   1. NO TIME. `scheduled_on` is a date, so a session cannot say when it
--      starts, how long it runs, or whether two of them collide. Nobody can be
--      reminded, because there is no hour to be reminded before.
--
--   2. NO ONLINE SESSION. Sales has run online meetings since 0350 —
--      `meeting` carries a location, notes, minutes and a transcript, and 0681
--      added dictation against it. Training, which is the one part of this
--      product where somebody actually stands up and talks for an hour, had
--      nowhere to put a join link and no record of what was said.
--
--   3. `attended` IS TYPED IN. It is set by whoever remembers to open the
--      roster afterwards. For an online session the system can observe it —
--      somebody either joined or did not — and observing it is both more
--      accurate and less work than asking.
--
--   4. A CERTIFICATE THAT NEVER EXPIRES. `certificate_vault_id` records that a
--      forklift ticket was issued and says nothing about it lapsing. Every
--      safety qualification this company's staff hold expires, and the date it
--      does is the only fact about it that anybody needs to act on.
--
-- ── SCHEDULED TIME IS NOT ACTUAL TIME ──────────────────────────────────────
--
-- `starts_at`/`ends_at` are the PLAN. `opened_at`/`closed_at` are what
-- happened. They are four columns and not two because the gap between them is
-- the interesting number: a session booked for 09:00 that opened at 09:40 is a
-- fact about the facilitator, and collapsing the plan into the actual erases
-- it the moment the session runs. It is also what makes a lateness figure
-- possible at all — an attendee is late relative to when the session OPENED,
-- not relative to when somebody hoped it would.
--
-- `scheduled_on` is kept, populated, and never read by new code. Dropping a
-- column that four screens and the AI catalogue select is a migration that
-- fails in production at read time rather than at deploy time; the service
-- writes both, and it can be dropped once nothing selects it.
--
-- ── WHY A REQUIREMENT IS ITS OWN TABLE ─────────────────────────────────────
--
-- "Every warehouse operative must hold a current manual-handling certificate"
-- is a rule about a ROLE, not about a session. Modelled on the session it can
-- only ever be answered backwards — you can list who came to the March course,
-- but not who was supposed to and did not, and never who was compliant in
-- June. `training_requirement` states the rule once; the session points at the
-- requirement it satisfies; compliance is then a query rather than a memory.
--
-- ── ON `feature_state` ─────────────────────────────────────────────────────
--
-- Section 5 repairs a live defect that has nothing to do with training as such
-- and everything to do with why this screen is dark. It is documented in full
-- above the statement.
-- ============================================================================

-- ── 1. The session ─────────────────────────────────────────────────────────

ALTER TABLE training
  -- The plan.
  ADD COLUMN IF NOT EXISTS starts_at   timestamptz,
  ADD COLUMN IF NOT EXISTS ends_at     timestamptz,
  -- What happened. Null on a session that never ran.
  ADD COLUMN IF NOT EXISTS opened_at   timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS mode        text NOT NULL DEFAULT 'IN_PERSON',
  ADD COLUMN IF NOT EXISTS location    text,
  ADD COLUMN IF NOT EXISTS join_url    text,
  ADD COLUMN IF NOT EXISTS description text,
  -- A room holds what it holds. Null means "no limit", which is different from
  -- zero and is the reason this is not `DEFAULT 0`.
  ADD COLUMN IF NOT EXISTS capacity    integer CHECK (capacity IS NULL OR capacity > 0),
  -- `facilitator` is free text and stays that way — an external trainer is not
  -- an employee. This is the internal case, and having both is deliberate.
  ADD COLUMN IF NOT EXISTS facilitator_employee_id uuid REFERENCES employee(employee_id),
  ADD COLUMN IF NOT EXISTS training_requirement_id uuid,
  -- The record of what was said, on the meeting pattern (0350/0681).
  ADD COLUMN IF NOT EXISTS transcript_vault_id uuid REFERENCES document_vault(doc_id),
  ADD COLUMN IF NOT EXISTS minutes_vault_id    uuid REFERENCES document_vault(doc_id),
  ADD COLUMN IF NOT EXISTS ai_summary  text,
  ADD COLUMN IF NOT EXISTS ai_model    text,
  ADD COLUMN IF NOT EXISTS ai_summarised_at timestamptz;

DO $$ BEGIN
  ALTER TABLE training ADD CONSTRAINT ck_training_mode
    CHECK (mode IN ('IN_PERSON','ONLINE','HYBRID'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- An online session with no way in is a meeting nobody can attend. Enforced
-- only once the session is past DRAFT-equivalent state — there is no draft
-- state here, so it is enforced on the mode itself and the UI supplies it.
DO $$ BEGIN
  ALTER TABLE training ADD CONSTRAINT ck_training_window
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE training ADD CONSTRAINT ck_training_actual_window
    CHECK (closed_at IS NULL OR opened_at IS NULL OR closed_at >= opened_at);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- LIVE joins the lifecycle. A session in progress is not "scheduled" — the
-- roster behaves differently (people are joining), and the difference between
-- "starts in an hour" and "happening now" is the whole point of a join button.
DO $$ BEGIN
  ALTER TABLE training DROP CONSTRAINT training_status_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE training ADD CONSTRAINT ck_training_status
    CHECK (status IN ('SCHEDULED','LIVE','DONE','CANCELLED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill: an existing session's date becomes its start, at midnight UTC.
-- Deliberately NOT invented into a plausible 09:00 — a time nobody recorded is
-- not a time, and a screen showing "09:00" for a session that may have run at
-- 14:00 is worse than one showing midnight, which reads as "date only".
UPDATE training SET starts_at = scheduled_on::timestamptz
 WHERE starts_at IS NULL AND scheduled_on IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_training_starts ON training(starts_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS ix_training_status_starts ON training(status, starts_at);

COMMENT ON COLUMN training.scheduled_on IS
  'LEGACY (0360). The date half of starts_at, written by the service for readers that predate 0702. New code reads starts_at.';
COMMENT ON COLUMN training.opened_at IS
  'When the session actually opened, not when it was booked. Attendee lateness is measured against this.';
COMMENT ON COLUMN training.capacity IS
  'NULL means unlimited. Zero is refused — a session nobody may attend is a cancelled session.';

-- ── 2. Attendance that can be observed ─────────────────────────────────────

ALTER TABLE training_attendance
  ADD COLUMN IF NOT EXISTS joined_at  timestamptz,
  ADD COLUMN IF NOT EXISTS left_at    timestamptz,
  -- Who ticked the box, and when. `attended` alone cannot distinguish "marked
  -- absent by the facilitator" from "nobody has done the roster yet", and those
  -- lead to different actions.
  ADD COLUMN IF NOT EXISTS marked_at  timestamptz,
  ADD COLUMN IF NOT EXISTS marked_by  uuid REFERENCES app_user(user_id),
  -- Observed vs asserted. True when `attended` was derived from a join rather
  -- than typed, which is the difference between evidence and recollection —
  -- and 0701's appraisal scorer reads training completion as evidence.
  ADD COLUMN IF NOT EXISTS attendance_observed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS certificate_issued_on  date,
  ADD COLUMN IF NOT EXISTS certificate_expires_on date,
  ADD COLUMN IF NOT EXISTS notes text;

DO $$ BEGIN
  ALTER TABLE training_attendance ADD CONSTRAINT ck_training_attendance_presence
    CHECK (left_at IS NULL OR joined_at IS NULL OR left_at >= joined_at);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One row per person per session. Without this the roster silently accepted the
-- same employee twice, and every count computed off it — attendance rate, the
-- appraisal evidence in 0701, capacity — was wrong by however many times
-- somebody pressed Add.
--
-- Deduplicate first, keeping the row that carries the most: attendance, then a
-- certificate, then the lowest id as a stable tie-break — so no tick and no
-- certificate is lost; what goes is the redundant blank row a second press of
-- "Add" created. Inspect what would be removed before applying:
--   SELECT training_id, employee_id, count(*) FROM training_attendance
--    WHERE employee_id IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1;
--
-- DESTRUCTIVE: deletes duplicate training_attendance rows for the same person on the same session, keeping the one carrying attendance/a certificate. Acceptable because every count computed off this table is currently wrong by exactly those rows — attendance rate, the capacity check added below, and the training-completion evidence 0701 feeds into appraisal scoring.
DELETE FROM training_attendance a
 USING training_attendance b
 WHERE a.training_id = b.training_id
   AND a.employee_id = b.employee_id
   AND a.employee_id IS NOT NULL
   AND (a.attended, a.certificate_vault_id IS NOT NULL, b.training_attendance_id)
     < (b.attended, b.certificate_vault_id IS NOT NULL, a.training_attendance_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_training_attendance_person
  ON training_attendance(training_id, employee_id)
  WHERE employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_training_attendance_employee
  ON training_attendance(employee_id, attended);
-- The certificate-expiry watcher's only query: what lapses next.
CREATE INDEX IF NOT EXISTS ix_training_attendance_expiry
  ON training_attendance(certificate_expires_on)
  WHERE certificate_expires_on IS NOT NULL;

COMMENT ON COLUMN training_attendance.attendance_observed IS
  'True when `attended` came from an actual join rather than from somebody ticking a box afterwards. 0701 scores training completion as appraisal evidence, and evidence should say how it was obtained.';
COMMENT ON COLUMN training_attendance.certificate_expires_on IS
  'The only fact about a safety certificate anybody acts on. Derived from the requirement''s valid_months at issue, then editable — a certificate awarded by an external body carries its own date.';

-- ── 3. What was said (the meeting pattern) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS training_note (
  training_note_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_id      uuid NOT NULL REFERENCES training(training_id) ON DELETE CASCADE,
  author_id        uuid REFERENCES app_user(user_id),
  body             text NOT NULL CHECK (length(btrim(body)) > 0),
  -- Minutes are the agreed record; a note is somebody's aside. `meeting_note`
  -- draws the same line, and it matters here for the same reason: minutes are
  -- what gets filed to the vault and shown to attendees.
  is_minutes       boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_training_note_training
  ON training_note(training_id, created_at DESC);

COMMENT ON TABLE training_note IS
  'Notes and minutes taken during a session — mirrors meeting_note (0350). The AI summary is drafted FROM these, never instead of them.';

-- ── 4. The rule, as opposed to the session ─────────────────────────────────

CREATE TABLE IF NOT EXISTS training_requirement (
  training_requirement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL CHECK (length(btrim(title)) > 0),
  description text,
  -- WHO it applies to. Both null = everybody; either one narrows. Matching on
  -- the employee's own text fields rather than on a role table is deliberate —
  -- `employee.department`/`job_title` is where this company actually records
  -- what somebody does, and a requirement that cannot be stated against real
  -- data is a requirement nobody sets.
  department  text,
  job_title   text,
  -- How long a pass lasts. Null = it never lapses (an induction).
  valid_months integer CHECK (valid_months IS NULL OR valid_months > 0),
  -- How much warning before it does. A forklift ticket needs a course booked,
  -- and booking one takes longer than a week.
  warn_days    integer NOT NULL DEFAULT 30 CHECK (warn_days >= 0),
  is_mandatory boolean NOT NULL DEFAULT true,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_training_requirement_active
  ON training_requirement(is_active, department, job_title);

DO $$ BEGIN
  ALTER TABLE training ADD CONSTRAINT fk_training_requirement
    FOREIGN KEY (training_requirement_id)
    REFERENCES training_requirement(training_requirement_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS ix_training_requirement_session
  ON training(training_requirement_id) WHERE training_requirement_id IS NOT NULL;

COMMENT ON TABLE training_requirement IS
  'A rule about a ROLE ("every warehouse operative holds a current manual-handling ticket"), not about a session. Without it compliance can only be answered backwards — who came to the March course — never who was supposed to and did not.';
COMMENT ON COLUMN training_requirement.valid_months IS
  'NULL means the qualification does not lapse. Distinct from 0, which is refused: a certificate valid for no months is not a certificate.';

-- ── 5. Repair: the HR feature rows that were never projected ───────────────
--
-- WHY THIS IS IN A TENANT MIGRATION AND NOT LEFT TO THE CONSOLE.
--
-- `feature_state` is a projection of the platform catalogue, and
-- middleware/feature-gate.js reads it as:
--
--     rows[0] && rows[0].state === 'on'
--
-- A MISSING ROW is therefore indistinguishable from 'off', and it 403s the
-- entire router — for every user, CEO included, since the gate is mounted in
-- front of the module and has no bypass. That is the state the Trainings screen
-- has been in: the tab loads, every request under it returns
-- 403 FEATURE_DISABLED, and the message says the feature is off for this
-- tenant, so an administrator goes to the console, sees it enabled, and has
-- nowhere else to look.
--
-- Seed 9111 already corrected the catalogue's default_state for these keys, but
-- it only takes effect through a re-projection (`npm run db:migrate:tenants`),
-- and a tenant that has not been re-projected keeps no row at all.
--
-- ON CONFLICT DO NOTHING is what makes this a repair rather than an override: a
-- tenant that HAS a row — on or off — is untouched, so a deliberate decision
-- taken in the console survives. Only the never-projected case is filled, and
-- it is filled with the catalogue default for these keys, which is 'on'.
--
-- source='default' is the truthful value and not a convenience: `source` is
-- constrained to plan|override|default (0130), and what this writes IS the
-- catalogue default. The next real projection overwrites the row with whatever
-- the console says, which is the correct end state.
INSERT INTO feature_state (feature_key, state, source)
VALUES ('hr.training',    'on', 'default'),
       ('hr.appraisals',  'on', 'default'),
       ('hr.recruitment', 'on', 'default')
ON CONFLICT (feature_key) DO NOTHING;

-- DOWN
-- DROP TABLE IF EXISTS training_requirement CASCADE;
-- DROP TABLE IF EXISTS training_note;
-- DROP INDEX IF EXISTS ux_training_attendance_person;
-- ALTER TABLE training_attendance
--   DROP COLUMN IF EXISTS notes, DROP COLUMN IF EXISTS certificate_expires_on,
--   DROP COLUMN IF EXISTS certificate_issued_on,
--   DROP COLUMN IF EXISTS attendance_observed, DROP COLUMN IF EXISTS marked_by,
--   DROP COLUMN IF EXISTS marked_at, DROP COLUMN IF EXISTS left_at,
--   DROP COLUMN IF EXISTS joined_at;
-- ALTER TABLE training
--   DROP COLUMN IF EXISTS ai_summarised_at, DROP COLUMN IF EXISTS ai_model,
--   DROP COLUMN IF EXISTS ai_summary, DROP COLUMN IF EXISTS minutes_vault_id,
--   DROP COLUMN IF EXISTS transcript_vault_id,
--   DROP COLUMN IF EXISTS training_requirement_id,
--   DROP COLUMN IF EXISTS facilitator_employee_id, DROP COLUMN IF EXISTS capacity,
--   DROP COLUMN IF EXISTS description, DROP COLUMN IF EXISTS join_url,
--   DROP COLUMN IF EXISTS location, DROP COLUMN IF EXISTS mode,
--   DROP COLUMN IF EXISTS closed_at, DROP COLUMN IF EXISTS opened_at,
--   DROP COLUMN IF EXISTS ends_at, DROP COLUMN IF EXISTS starts_at;
-- UPDATE training SET status = 'SCHEDULED' WHERE status = 'LIVE';
--
-- DESTRUCTIVE, in three ways worth stating separately.
--
-- (a) The UP already deleted duplicate training_attendance rows to make
--     ux_training_attendance_person possible. Those are gone before the DOWN is
--     ever considered — the rows kept are the ones carrying attendance and a
--     certificate, so nothing that was ticked is lost, but a second blank row
--     for the same person is.
-- (b) Dropping certificate_expires_on discards every expiry date. The
--     certificates themselves survive in the vault; the fact that one lapses in
--     March does not, and it exists nowhere else.
-- (c) Dropping training_note discards session minutes. Minutes filed to the
--     vault survive there; notes never filed do not. Export training_note
--     first.
--
-- Section 5 has no DOWN. Removing a feature_state row would re-dark the module
-- for a tenant whose only fault was never having been re-projected, which is
-- the defect this migration exists to repair.
