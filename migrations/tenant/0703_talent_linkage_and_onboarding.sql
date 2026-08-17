-- ============================================================================
-- TENANT DB — 0703 talent that reaches a vacancy, and onboarding that has dates
--
-- Two problems, both of them the same shape: the product RECORDS something and
-- then gives nobody a way to act on it.
--
-- ── 1. THE POOL IS A DEAD END ──────────────────────────────────────────────
--
-- 0525 made past candidates findable — it added skills, a score, a CV and a
-- summary to `job_applicant`, and its header says exactly why:
--
--     "A candidate who was right but late is the cheapest hire available next
--      quarter, and until now nothing recorded enough about them to find them."
--
-- It delivered the finding. It did not deliver the going back. A recruiter can
-- search the pool, read that Marie scored 84 on last year's Customs Officer
-- role, and then has NO ACTION — no button, no endpoint, nothing. To put her in
-- front of the open role they must retype her name, re-upload her CV, and lose
-- the score, the assessment and the fact that she was ever seen before.
--
-- So the verb is missing, and this migration is what a verb needs: somewhere to
-- record that THIS applicant row came from THAT one. Without the provenance
-- column the action is indistinguishable from a duplicate application, and the
-- pool fills with people who look like they applied twice.
--
-- There are two benches and they stay two, deliberately. `talent_pool` (0360) is
-- hand-entered contacts — somebody met at a conference, no CV, no history.
-- `job_applicant.status IN ('TALENT_POOL','REJECTED')` is everyone who actually
-- applied. 0525 chose not to flatten the second into the first, because doing so
-- discards the CV, the score and the vacancy they came through — which is the
-- entire reason to go back to them. Both can now reach a vacancy; each records
-- which bench it came from.
--
-- ── 2. AN ONBOARDING CHECKLIST HAS NO DATES AND NO OWNER ───────────────────
--
--   onboarding_checklist(employee_id, status)
--   onboarding_item(checklist_id, label, is_done, done_at)
--
-- A list of strings and a tick. Four things missing, and each one is why a task
-- gets forgotten rather than done:
--
--   NO DUE DATE. "Register with CNPS" and "order a laptop" are not the same
--     urgency, and neither is anything at all until it has a date. Nothing here
--     can be late, so nothing here is ever chased.
--   NO OWNER. Every item reads as the HR administrator's job. In practice IT
--     issues the laptop, Finance opens the payroll record and the line manager
--     does the induction — and an unassigned task belongs to whoever notices.
--   NO TEMPLATE. Every checklist is retyped for every hire, so the twelfth new
--     starter gets a different list from the first, and the item somebody
--     forgot to type is the one that gets missed.
--   NOTHING RAISES IT. Hiring an applicant provisions an employee row
--     (vacancy.service, on the transition into HIRED) and stops. The checklist
--     is created only if a human remembers to, which is exactly the moment
--     everybody is busy.
--
-- The template is what makes the other three worth having: due dates stated in
-- DAYS FROM THE START DATE rather than as calendar dates, so one template
-- serves every hire.
-- ============================================================================

-- ── 1. Where a candidate came from ─────────────────────────────────────────

ALTER TABLE job_applicant
  -- The row this one was created from, on the same table. A self-reference and
  -- not a boolean: "was sourced from the pool" cannot answer "from whom", and
  -- the whole point is being able to open the earlier assessment.
  ADD COLUMN IF NOT EXISTS sourced_from_applicant_id uuid REFERENCES job_applicant(applicant_id) ON DELETE SET NULL,
  -- Or from the hand-entered bench, which is a different table and a much
  -- thinner record. Two columns rather than one polymorphic pair because a FK
  -- that the database can enforce is worth more than a tidy schema.
  ADD COLUMN IF NOT EXISTS sourced_from_talent_pool_id uuid REFERENCES talent_pool(talent_pool_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sourced_at timestamptz,
  ADD COLUMN IF NOT EXISTS sourced_by uuid REFERENCES app_user(user_id);

CREATE INDEX IF NOT EXISTS ix_job_applicant_sourced_from
  ON job_applicant(sourced_from_applicant_id) WHERE sourced_from_applicant_id IS NOT NULL;

COMMENT ON COLUMN job_applicant.sourced_from_applicant_id IS
  'The earlier application this one was raised from. Without it, putting a past candidate forward is indistinguishable from them applying twice, and the pool fills with apparent duplicates.';

-- The hand-entered bench needs enough to be worth putting forward. A name and a
-- comma-separated skills string cannot be sent to a hiring manager.
ALTER TABLE talent_pool
  ADD COLUMN IF NOT EXISTS email       citext,
  ADD COLUMN IF NOT EXISTS phone       text,
  ADD COLUMN IF NOT EXISTS cv_vault_id uuid REFERENCES document_vault(doc_id),
  ADD COLUMN IF NOT EXISTS job_title   text,
  -- When somebody last put them forward. Stops two recruiters approaching the
  -- same person about two roles in the same week, which is the failure that
  -- makes a company look disorganised to the exact people it wants to hire.
  ADD COLUMN IF NOT EXISTS last_considered_at timestamptz;

CREATE INDEX IF NOT EXISTS ix_talent_pool_email ON talent_pool(email) WHERE email IS NOT NULL;

-- ── 2. The onboarding template ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS onboarding_template (
  onboarding_template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  -- Who it is for. Both null = every hire; either one narrows. Matched on the
  -- employee's own text fields, the same convention 0702's training
  -- requirements use — and for the same reason: department/job_title is where
  -- this company actually records what somebody does.
  department  text,
  job_title   text,
  -- When two templates match one hire, the more specific wins; this settles a
  -- tie between two equally specific ones. Without it the winner is whatever
  -- the planner happened to return first, which changes between runs.
  priority    integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_onboarding_template_active
  ON onboarding_template(is_active, department, job_title);
-- Two templates called "Standard new starter" is a tenant with no way to tell
-- which one a hire was raised from. It also gives the seed below a conflict
-- target, so re-running this file cannot duplicate it.
CREATE UNIQUE INDEX IF NOT EXISTS ux_onboarding_template_name ON onboarding_template(name);

CREATE TABLE IF NOT EXISTS onboarding_template_item (
  onboarding_template_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_template_id uuid NOT NULL REFERENCES onboarding_template(onboarding_template_id) ON DELETE CASCADE,
  label       text NOT NULL CHECK (length(btrim(label)) > 0),
  description text,
  -- DAYS FROM THE START DATE, not a calendar date. This is what makes one
  -- template serve every hire: "day 1" is day 1 for everybody. Negative is
  -- allowed and meant — a contract signed and a desk ordered BEFORE somebody
  -- walks in is most of what good onboarding is.
  due_days    integer NOT NULL DEFAULT 0,
  -- Who does it, as a ROLE. A named person on a template goes stale the day
  -- they leave, and then every checklist raised afterwards is assigned to
  -- somebody who no longer works here.
  owner_role  text,
  -- The procedure that says how. An item pointing at the SOP it comes from is
  -- the difference between "complete induction" and a task somebody can do.
  sop_document_id uuid REFERENCES sop_document(sop_document_id) ON DELETE SET NULL,
  -- A checklist cannot be completed while a mandatory item is outstanding.
  -- Statutory registrations are the reason: they are the ones with a legal
  -- deadline and the ones a busy week loses.
  is_mandatory boolean NOT NULL DEFAULT false,
  sort_order   integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_onboarding_template_item_parent
  ON onboarding_template_item(onboarding_template_id, sort_order);
-- One task, once, per template. A template listing "Register with CNPS" twice
-- raises every checklist with a duplicate somebody has to decide about — and it
-- is the conflict target the seed needs.
CREATE UNIQUE INDEX IF NOT EXISTS ux_onboarding_template_item_label
  ON onboarding_template_item(onboarding_template_id, label);

COMMENT ON COLUMN onboarding_template_item.due_days IS
  'Offset in days from the hire''s start date. Negative means before they start — a signed contract and an ordered laptop are pre-arrival tasks, and a template that cannot express that pushes them to day 1, which is too late.';
COMMENT ON COLUMN onboarding_template_item.owner_role IS
  'A ROLE, never a person. A named individual on a template is assigned to somebody who has left as soon as they leave, on every checklist raised afterwards.';

-- ── 3. The checklist, with dates and owners ────────────────────────────────

ALTER TABLE onboarding_checklist
  ADD COLUMN IF NOT EXISTS onboarding_template_id uuid REFERENCES onboarding_template(onboarding_template_id) ON DELETE SET NULL,
  -- The date every due date is computed from. Held on the checklist rather than
  -- read from employee.hired_on each time, because a start date that moves must
  -- not silently re-date a checklist somebody is already working through —
  -- rescheduling is an act, not a side effect.
  ADD COLUMN IF NOT EXISTS starts_on   date,
  ADD COLUMN IF NOT EXISTS applicant_id uuid REFERENCES job_applicant(applicant_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE onboarding_item
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS due_on      date,
  ADD COLUMN IF NOT EXISTS owner_role  text,
  -- The person, resolved when the checklist is raised or assigned by hand.
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS sop_document_id uuid REFERENCES sop_document(sop_document_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_mandatory boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sort_order  integer NOT NULL DEFAULT 0,
  -- Who ticked it. `done_at` records that it happened and not who did it, and
  -- for a statutory registration that is the question asked afterwards.
  ADD COLUMN IF NOT EXISTS done_by     uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS notes       text;

CREATE INDEX IF NOT EXISTS ix_onboarding_item_due
  ON onboarding_item(due_on) WHERE due_on IS NOT NULL AND is_done = false;
CREATE INDEX IF NOT EXISTS ix_onboarding_item_assignee
  ON onboarding_item(assigned_to) WHERE assigned_to IS NOT NULL;

COMMENT ON COLUMN onboarding_checklist.starts_on IS
  'The date item due dates are computed from — a snapshot of the hire''s start date, not a live read of it. Moving somebody''s start date must not silently re-date a checklist already in progress; rescheduling is a deliberate act.';

-- ── 4. A default template, INACTIVE ────────────────────────────────────────
--
-- Seeded so a tenant has something to look at and edit rather than an empty
-- screen with a "New template" button and no idea what belongs on one. INACTIVE
-- for the same reason 0697 seeded its house rules inactive: a template that
-- starts raising real checklists against real people the moment a migration
-- runs is a migration that changes somebody's week. Somebody reads it, edits
-- the roles to match their org, and turns it on.
--
-- The dates are Cameroon's: CNPS registration carries a statutory deadline,
-- which is why it is the mandatory one.
INSERT INTO onboarding_template (name, description, is_active, priority)
VALUES ('Standard new starter',
        'Default onboarding for a new hire. Review the owner roles against your own org chart, then activate.',
        false, 0)
-- DO NOTHING, never DO UPDATE: a tenant who has edited this template into their
-- real one must not have it reset by a replay.
ON CONFLICT (name) DO NOTHING;

INSERT INTO onboarding_template_item (onboarding_template_id, label, due_days, owner_role, is_mandatory, sort_order)
SELECT t.onboarding_template_id, i.label, i.due_days, i.owner_role, i.is_mandatory, i.sort_order
  FROM onboarding_template t
  CROSS JOIN (VALUES
    ('Signed employment contract on file',        -7, 'HR',            true,  10),
    ('Collect identity documents and photograph', -5, 'HR',            true,  20),
    ('Register with CNPS',                        -3, 'HR',            true,  30),
    ('Open the payroll record',                   -2, 'Finance',       true,  40),
    ('Create the system account and email',       -1, 'IT',            false, 50),
    ('Issue laptop, phone and access badge',      -1, 'IT',            false, 60),
    ('Welcome and office tour',                    0, 'Line manager',  false, 70),
    ('Health and safety briefing',                 0, 'HSE',           true,  80),
    ('Issue the staff handbook and house rules',   1, 'HR',            false, 90),
    ('Set the first-quarter objectives',           5, 'Line manager',  false, 100),
    ('Thirty-day check-in',                       30, 'Line manager',  false, 110),
    ('Probation review',                          80, 'Line manager',  false, 120)
  ) AS i(label, due_days, owner_role, is_mandatory, sort_order)
 WHERE t.name = 'Standard new starter'
ON CONFLICT (onboarding_template_id, label) DO NOTHING;

-- DOWN
-- DROP TABLE IF EXISTS onboarding_template_item;
-- ALTER TABLE onboarding_checklist DROP COLUMN IF EXISTS onboarding_template_id;
-- DROP TABLE IF EXISTS onboarding_template;
-- ALTER TABLE onboarding_item
--   DROP COLUMN IF EXISTS notes, DROP COLUMN IF EXISTS done_by,
--   DROP COLUMN IF EXISTS sort_order, DROP COLUMN IF EXISTS is_mandatory,
--   DROP COLUMN IF EXISTS sop_document_id, DROP COLUMN IF EXISTS assigned_to,
--   DROP COLUMN IF EXISTS owner_role, DROP COLUMN IF EXISTS due_on,
--   DROP COLUMN IF EXISTS description;
-- ALTER TABLE onboarding_checklist
--   DROP COLUMN IF EXISTS notes, DROP COLUMN IF EXISTS completed_at,
--   DROP COLUMN IF EXISTS applicant_id, DROP COLUMN IF EXISTS starts_on;
-- ALTER TABLE talent_pool
--   DROP COLUMN IF EXISTS last_considered_at, DROP COLUMN IF EXISTS job_title,
--   DROP COLUMN IF EXISTS cv_vault_id, DROP COLUMN IF EXISTS phone,
--   DROP COLUMN IF EXISTS email;
-- ALTER TABLE job_applicant
--   DROP COLUMN IF EXISTS sourced_by, DROP COLUMN IF EXISTS sourced_at,
--   DROP COLUMN IF EXISTS sourced_from_talent_pool_id,
--   DROP COLUMN IF EXISTS sourced_from_applicant_id;
--
-- DESTRUCTIVE in two ways worth stating separately.
--
-- (a) Dropping onboarding_item.done_by and due_on discards WHO completed a
--     statutory registration and WHEN it was due. `done_at` survives, so the
--     fact that it happened is kept; the accountability is not, and for a CNPS
--     registration that is the question asked afterwards.
-- (b) Dropping job_applicant.sourced_from_* makes every candidate raised from
--     the pool look like a duplicate application, permanently and with no way
--     to tell them apart. Export the column before running this.
--
-- The seeded template is left in place by this DOWN on purpose: it is INACTIVE
-- and harmless, and a tenant may well have edited it into their real one.
