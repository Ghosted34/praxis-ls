-- ============================================================================
-- TENANT DB — 13970 tax obligation generation (MOD-01, PR-05 / audit CE-16).
--
-- 0342 created `tax_calendar` — "compliance calendar of statutory obligations
-- (drives reminders/alerts)". 0516 bound it to the registration that explains
-- WHY an obligation exists (`tax_registration_id`, `period_code`, `generated`)
-- and gave it two resting states (`WAIVED`, `SUPERSEDED`). What was still
-- missing was the generator, and with it four things a calendar row cannot
-- answer about itself:
--
--   1. WHICH PERIOD it covers. `due_on` says when to file, not for when. Two
--      monthly VAT rows 30 days apart look identical without `period_code`,
--      and `period_code` alone is a label — `period_start`/`period_end` are
--      what let a re-run ask "have I already generated this period?" in dates
--      rather than in a string it would have to parse back.
--
--   2. WHO FILES IT. `entity_tax_registration.responsible_user_id` says who
--      owns the REGISTRATION. The obligation is a task, and a task needs its
--      own assignee so a filing can be delegated without re-assigning the whole
--      registration — and so the reminder can be addressed to a person.
--
--   3. WHY IT CHANGED STATE. `WAIVED` and `SUPERSEDED` are decisions a human
--      made or a re-run made on a human's behalf. `status_changed_by`/`_at`/
--      `status_reason` record which, because "this quarter's VAT was waived"
--      without a reason and an actor is a gap in the audit trail, not a state.
--
--   4. WHETHER IT HAS ALREADY BEEN REMINDED ABOUT. A daily sweep over
--      approaching deadlines would otherwise tell the same person the same
--      thing every morning until they acted — and a warning that arrives
--      thirty times is a warning nobody reads (the reason `contract-lapse`
--      dedupes on its own window). `last_reminder_step` is the watermark.
--
-- ── WHY `generation_key` IS A COLUMN AND NOT A COMPUTED EXPRESSION ──────────
--
-- The whole acceptance condition is "re-run produces no duplicates", and the
-- only enforcement worth having for that is the database's. `ux_tax_calendar_
-- generation_key` is a UNIQUE index over the key, so a second generator run
-- that would produce the same obligation for the same period collides and
-- inserts nothing — even if two runs overlap, even if the application-side
-- "have I generated this yet?" check has a bug in it. The key deliberately
-- carries the registration's CADENCE (`filing_frequency`, `filing_due_day`),
-- not just the period: when a registration's cadence changes, the key changes,
-- so the generator writes a new row and supersedes the old one instead of
-- silently leaving an obligation dated the way the law no longer says.
--
-- It is a plain text column rather than an expression index because the key is
-- assembled in the generator from values that are validated there, and because
-- an expression index would pin the assembly rule into the schema where a
-- change to it needs a migration rather than a code review.
--
-- ── WHY THERE IS NO FOREIGN KEY AND NO CHECK, THOUGH BOTH WOULD FIT ─────────
--
-- `tax_calendar` is a PRE-EXISTING table, and per the 13791 rule
-- (tests/unit/migration-constraint-ordering.test.js) a table this file did not
-- create may only gain PLAIN columns. The reason is provisioning, not taste:
-- `provisioning.service.js` migrates `for (const schema of ["live","sandbox"])`
-- — every file against live, THEN every file against sandbox — and 13791
-- repairs sandbox by mirroring live's constraints. When it runs in the SANDBOX
-- pass, live is at the head of the list while sandbox is only at 13791. It
-- guards that the TABLE exists in the target; it does not guard that the
-- COLUMN does, and its handler catches check_violation and
-- foreign_key_violation but not undefined_column. A `REFERENCES` on a column
-- this file adds therefore aborts provisioning a new tenant with:
--
--     column "responsible_user_id" does not exist
--
-- — a red `migrations` job that no gate here can see, because it needs a live
-- Postgres. 13791 cannot be edited (content drift over the whole fleet) and no
-- later migration can help (13791 aborts before one runs). So: plain columns,
-- and the rule that would have been a constraint is enforced where the write
-- happens. Same shape as 13900, 13920 and 13961.
--
-- What enforces each rule instead, and where:
--
--   responsible_user_id, status_changed_by, created_by  → every write resolves
--     the id through `(SELECT user_id FROM app_user WHERE user_id = $n)`, which
--     is both the DATA 2.4 guard (identity lives in LIVE, the write may land in
--     SANDBOX) and the existence check the FK would have made: an id that does
--     not resolve stores NULL rather than raising 23503. `assign()` turns that
--     NULL back into a 404, so a mistyped assignee is reported rather than
--     silently dropped.
--
--   status → the CHECK 0516 already widened to include WAIVED and SUPERSEDED
--     stays exactly as it is. `MANUAL_STATUSES` in the generator is the
--     narrower list a person may write, and SUPERSEDED is reachable only from
--     the reconciliation pass — a rule with no SQL expression, so it was never
--     going to be a CHECK.
--
-- ADDITIVE ONLY. Idempotent — safe to re-run. SCHEMA-DUAL: runs UNQUALIFIED,
-- once per schema (live, then sandbox).
-- ============================================================================

-- ── 1. The period an obligation covers ─────────────────────────────────────
ALTER TABLE tax_calendar
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end   date;

-- ── 2. The person who files it ─────────────────────────────────────────────
-- Inherited from the registration when the obligation is generated; settable on
-- the obligation afterwards, which is the "assign OR inherit" in CE-16. Null
-- when neither exists — reported as a finding by the generator rather than
-- guessed, because inventing a responsible person is worse than naming none.
ALTER TABLE tax_calendar
  ADD COLUMN IF NOT EXISTS responsible_user_id uuid;

-- ── 3. The idempotency key ─────────────────────────────────────────────────
ALTER TABLE tax_calendar
  ADD COLUMN IF NOT EXISTS generation_key text;

-- Partial: rows a human typed in (or that 0342-era code created) have no key and
-- must not be forced to have one, nor collide with each other on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tax_calendar_generation_key
  ON tax_calendar (generation_key)
  WHERE generation_key IS NOT NULL;

-- ── 4. State-change provenance ─────────────────────────────────────────────
ALTER TABLE tax_calendar
  ADD COLUMN IF NOT EXISTS status_changed_by uuid,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_reason     text;

-- ── 5. Who ran the generation ──────────────────────────────────────────────
-- Null for a scheduled run: the actor is the worker, and inventing a user_id
-- for it would put a machine's decisions under a person's name in the audit
-- trail. The immutable-ledger row the generator writes carries the run itself.
ALTER TABLE tax_calendar
  ADD COLUMN IF NOT EXISTS created_by uuid;

-- ── 6. Reminder watermark ──────────────────────────────────────────────────
-- The reminder ladder step already emitted for this obligation ('D30', 'D14',
-- 'D7', 'D1'). Compared, not counted: the ladder only ever descends, so "the
-- step I am in is not the step I last sent" is a sufficient and cheaper
-- watermark than a per-step table.
ALTER TABLE tax_calendar
  ADD COLUMN IF NOT EXISTS last_reminder_step text,
  ADD COLUMN IF NOT EXISTS last_reminder_at   timestamptz;

-- ── 7. Indexes the sweep actually needs ────────────────────────────────────
-- The daily reminder pass asks "which obligations are open and coming up?",
-- across every entity, ordered by due date. Without this it is a sequential
-- scan over every obligation the tenant has ever generated, most of which are
-- DONE. The partial predicate is the same set the sweep filters on.
CREATE INDEX IF NOT EXISTS ix_tax_calendar_open_due
  ON tax_calendar (due_on, entity_id)
  WHERE status IN ('PENDING', 'LATE');

-- "Everything this person has to file" — the dossier and the reminder both
-- group by assignee, and the assignee is nullable so a plain index would index
-- the NULLs that mean "nobody has been told yet".
CREATE INDEX IF NOT EXISTS ix_tax_calendar_responsible
  ON tax_calendar (responsible_user_id, due_on)
  WHERE responsible_user_id IS NOT NULL;

COMMENT ON COLUMN tax_calendar.generation_key IS
  'Idempotency key for a GENERATED obligation (13970): entity | registration |
   obligation | period_code | cadence. Unique while non-null, so a generator
   re-run cannot duplicate an obligation. Hand-entered rows leave it NULL.';

COMMENT ON COLUMN tax_calendar.generated IS
  'True when the row came from a tax registration rather than being typed in
   (0516). Since 13970 the generator is what sets it, together with
   generation_key, period_start/period_end and the inherited responsible_user_id.';

COMMENT ON COLUMN tax_calendar.responsible_user_id IS
  'The person who files this obligation (13970). Inherited from the
   registration that generated it, and reassignable on the obligation alone so
   one quarter can be delegated without re-assigning the registration.
   No FOREIGN KEY: per the 13791 rule a table this file did not create gains
   PLAIN columns only. Enforced instead by resolving every write through
   (SELECT user_id FROM app_user WHERE user_id = $n) — an id that does not
   resolve stores NULL, and assign() reports that as 404 rather than dropping
   it silently.';

COMMENT ON COLUMN tax_calendar.status_changed_by IS
  'Who moved this obligation to its current status (13970). Null for a
   scheduled run, which is the honest answer: the worker is not a person and
   must not be filed under one''s name. Plain uuid per the 13791 rule; resolved
   through app_user on write, as responsible_user_id is.';

COMMENT ON COLUMN tax_calendar.status_reason IS
  'Why the status changed (13970). Written by both halves: a human waiver
   carries the reason the service required, a generator transition carries
   registration_inactive / registration_deregistered / cadence_changed /
   past_due_on. Required for WAIVED, because after a waiver nothing will ever
   chase this filing again and the next person needs to know why.';

COMMENT ON COLUMN tax_calendar.period_start IS
  'First day of the period this obligation is FOR (13970), as distinct from
   due_on, which is when it must be filed. Stored as a date rather than parsed
   back out of period_code so a re-run can ask the question in dates.';

-- ── DOWN ────────────────────────────────────────────────────────────────────
-- DOWN
-- Additive migration; reverse by dropping what it added. Commented so nothing
-- runs by accident, present so there is a starting point at 3am.
--
-- READ THIS FIRST. Dropping the columns does NOT delete the generated
-- obligations — they are `tax_calendar` rows and they survive as ordinary
-- calendar entries, which is the right outcome: a filing that happened is a
-- fact about the company whether or not the generator that predicted it still
-- exists. What is lost is the period and the provenance, and with
-- `generation_key` the ability to re-run without duplicating. If the generator
-- is being retired rather than rolled back, DELETE the generated rows you no
-- longer want first — `WHERE generated AND status = 'PENDING'` is the safe set,
-- because it leaves every obligation a person already acted on.
--
-- No foreign key was added, so nothing references these columns from elsewhere
-- and the drops below need no ordering.
--
-- DROP INDEX IF EXISTS ix_tax_calendar_responsible;
-- DROP INDEX IF EXISTS ix_tax_calendar_open_due;
-- DROP INDEX IF EXISTS ux_tax_calendar_generation_key;
-- ALTER TABLE tax_calendar
--   DROP COLUMN IF EXISTS last_reminder_at,
--   DROP COLUMN IF EXISTS last_reminder_step,
--   DROP COLUMN IF EXISTS created_by,
--   DROP COLUMN IF EXISTS status_reason,
--   DROP COLUMN IF EXISTS status_changed_at,
--   DROP COLUMN IF EXISTS status_changed_by,
--   DROP COLUMN IF EXISTS generation_key,
--   DROP COLUMN IF EXISTS responsible_user_id,
--   DROP COLUMN IF EXISTS period_end,
--   DROP COLUMN IF EXISTS period_start;
