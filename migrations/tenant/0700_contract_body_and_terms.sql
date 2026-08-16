-- ============================================================================
-- TENANT DB — 0700 a contract that is a document, not a filing reference
--
-- ── THE CONTRACT THAT RENDERED WITH NO CLAUSES IN IT ───────────────────────
--
-- There IS a contract renderer, and it has been there since the document
-- templates shipped: `EMPLOYMENT_CONTRACT` in the template registry draws the
-- letterhead, the two parties, a signature block and a verify footer, and the
-- contracts screen can already send it. What it renders between the parties and
-- the signatures is `d.articles` — and the data builder feeding it said, in
-- full:
--
--     articles: [],
--
-- So every employment contract this system has ever generated is a BLANK FORM:
-- correct-looking letterhead, both names, somewhere to sign, and not one clause.
-- Nobody caught it because a contract PDF looks entirely right until you read
-- it, and the people who would read it are the two parties signing.
--
-- The reason it was empty is that there was nowhere for the text to live.
-- `hr_contract` has been (employee_id, kind, effective_on, end_on, status,
-- pdf_vault_id) since 0360 — a row that POINTS AT a document, with no document
-- in it. So the terms are not data either: "what is this person's notice
-- period?" and "when does their probation end?" are answerable only by opening
-- a scan, which means nothing can warn that a fixed term lapses in a fortnight
-- and nothing can confirm somebody at the end of probation.
--
-- ── WHAT THIS ADDS, AND THE ORDER IT MATTERS IN ────────────────────────────
--
--   1. THE TEXT (`body_md`). The contract as editable markdown, drafted by the
--      model from the employee, the hiring entity and the tenant's own SOPs,
--      then edited by a human. The existing renderer splits it at its headings
--      and fills `articles` with the result — so this migration is what makes
--      that renderer produce a contract instead of a form. Rendering stays a
--      projection of this text, not the other way round, which is what makes a
--      contract amendable without anybody having to find the original .docx.
--   2. THE TERMS (probation, notice, salary snapshot). Columns, because they
--      are the questions the rest of the system needs to answer and because a
--      number inside prose cannot be watched.
--   3. THE DATES THAT LAPSE (`probation_ends_on`, and `end_on` which already
--      existed and which NOTHING HAS EVER LOOKED AT). A fixed-term contract
--      that expires unnoticed is an employee working without one.
--
-- ── WHY THE SALARY IS SNAPSHOTTED ONTO THE CONTRACT ────────────────────────
--
-- `employee.base_salary` is what the person is paid TODAY. A contract states
-- what was agreed WHEN IT WAS SIGNED, and the two must be allowed to differ —
-- that difference is exactly what a raise is, and a contract that silently
-- restated the current figure would be evidence of an agreement nobody made.
-- ============================================================================

-- ── 1. The document itself ─────────────────────────────────────────────────

/* Markdown, not HTML: it is edited by people in a textarea, rendered to PDF
 * through the tenant's own letterhead template, and diffed between versions.
 * HTML would make all three worse and buy nothing here. */
ALTER TABLE hr_contract ADD COLUMN IF NOT EXISTS title    text;
ALTER TABLE hr_contract ADD COLUMN IF NOT EXISTS body_md  text;
ALTER TABLE hr_contract ADD COLUMN IF NOT EXISTS ai_generated boolean NOT NULL DEFAULT false;
-- Which model wrote it. A contract is the document most likely to be
-- questioned later, and "what produced this wording?" should not need an
-- archaeology session through the audit log.
ALTER TABLE hr_contract ADD COLUMN IF NOT EXISTS ai_model text;

COMMENT ON COLUMN hr_contract.body_md IS
  'The contract text as markdown — the source of truth. pdf_vault_id is a rendering OF this, not the other way round, which is what makes a contract amendable.';

-- ── 2. The terms ───────────────────────────────────────────────────────────

ALTER TABLE hr_contract ADD COLUMN IF NOT EXISTS entity_id uuid REFERENCES corporate_entity(entity_id);
-- Snapshots. What the ROLE and the PAY were when this was agreed — see header.
ALTER TABLE hr_contract ADD COLUMN IF NOT EXISTS job_title text;
ALTER TABLE hr_contract ADD COLUMN IF NOT EXISTS gross_salary numeric(18,2) CHECK (gross_salary IS NULL OR gross_salary >= 0);
ALTER TABLE hr_contract ADD COLUMN IF NOT EXISTS salary_currency char(3);
ALTER TABLE hr_contract ADD COLUMN IF NOT EXISTS probation_months smallint CHECK (probation_months IS NULL OR probation_months BETWEEN 0 AND 24);
-- Derived from effective_on + probation_months when the contract is drafted,
-- and STORED so it can be indexed and watched. A date computed on read cannot
-- be the subject of "which probations end this month?".
ALTER TABLE hr_contract ADD COLUMN IF NOT EXISTS probation_ends_on date;
ALTER TABLE hr_contract ADD COLUMN IF NOT EXISTS notice_days smallint CHECK (notice_days IS NULL OR notice_days >= 0);
ALTER TABLE hr_contract ADD COLUMN IF NOT EXISTS working_hours text;
ALTER TABLE hr_contract ADD COLUMN IF NOT EXISTS place_of_work text;

/* Where this hire came from. A contract issued off the back of a vacancy should
 * be able to point at the advert whose terms it is supposed to honour — that is
 * the check nobody can currently perform. ON DELETE SET NULL: archiving an old
 * vacancy must not touch a live employment contract. */
ALTER TABLE hr_contract ADD COLUMN IF NOT EXISTS vacancy_id uuid REFERENCES vacancy(vacancy_id) ON DELETE SET NULL;
/* The contract this one replaces. A renewal is a NEW contract that supersedes
 * the old one, not an edit to it — the superseded terms are what an employee
 * was working under last year, and overwriting them destroys the record of it. */
ALTER TABLE hr_contract ADD COLUMN IF NOT EXISTS renews_contract_id uuid REFERENCES hr_contract(hr_contract_id) ON DELETE SET NULL;

-- ── 3. Signature, and what it means ────────────────────────────────────────

/* Not an e-signature — this records that a signed copy EXISTS and who signed
 * it. The e-sign flow (a token link the candidate opens, a certificate, an
 * audit chain) belongs with the offer stage and is deliberately not invented
 * here: a half-built signature is worse than an honest "we filed the scan".
 */
ALTER TABLE hr_contract ADD COLUMN IF NOT EXISTS signed_on date;
ALTER TABLE hr_contract ADD COLUMN IF NOT EXISTS signed_by_name text;
ALTER TABLE hr_contract ADD COLUMN IF NOT EXISTS countersigned_by_name text;

-- ── 4. The dates nothing was watching ──────────────────────────────────────

/* `end_on` has existed since 0360 and NOTHING HAS EVER READ IT. These two
 * indexes are what the watcher scans: a fixed term that lapses unnoticed is an
 * employee working without a contract, and a probation that passes unnoticed is
 * a confirmation nobody made — in most jurisdictions confirming them by
 * default, which is the opposite of what the employer intended. */
CREATE INDEX IF NOT EXISTS ix_hr_contract_expiring
  ON hr_contract(end_on) WHERE end_on IS NOT NULL AND status IN ('ISSUED','SIGNED');
CREATE INDEX IF NOT EXISTS ix_hr_contract_probation
  ON hr_contract(probation_ends_on) WHERE probation_ends_on IS NOT NULL AND status IN ('ISSUED','SIGNED');
CREATE INDEX IF NOT EXISTS ix_hr_contract_employee ON hr_contract(employee_id, status);

/* A fixed term that ends before it starts is not a typo worth tolerating — it
 * makes the expiry watcher fire immediately and forever. NOT VALID: rows
 * written before this migration were never checked, and failing the whole
 * migration on one historical mistake helps nobody. */
DO $$ BEGIN
  ALTER TABLE hr_contract ADD CONSTRAINT ck_hr_contract_term
    CHECK (effective_on IS NULL OR end_on IS NULL OR end_on >= effective_on) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

/* Existing rows: carry the employee's entity across so the letterhead resolves
 * for a contract issued before this column existed. The salary and job title
 * are deliberately NOT backfilled from `employee` — that would state, on a
 * document, that terms were agreed which nobody agreed. They stay null, and the
 * screen shows them as unrecorded, which is the truth. */
UPDATE hr_contract c
   SET entity_id = e.entity_id
  FROM employee e
 WHERE c.employee_id = e.employee_id
   AND c.entity_id IS NULL
   AND e.entity_id IS NOT NULL;

-- Probation end for contracts that already state a start date, once the months
-- are known. Nothing to compute today (probation_months is new and null
-- everywhere), so this is a no-op on first run — it is here so a replay after
-- somebody backfills the months does the right thing.
UPDATE hr_contract
   SET probation_ends_on = (effective_on + (probation_months || ' months')::interval)::date
 WHERE probation_ends_on IS NULL
   AND effective_on IS NOT NULL
   AND probation_months IS NOT NULL
   AND probation_months > 0;

-- DOWN
-- DROP INDEX IF EXISTS ix_hr_contract_employee;
-- DROP INDEX IF EXISTS ix_hr_contract_probation;
-- DROP INDEX IF EXISTS ix_hr_contract_expiring;
-- ALTER TABLE hr_contract
--   DROP CONSTRAINT IF EXISTS ck_hr_contract_term,
--   DROP COLUMN IF EXISTS countersigned_by_name, DROP COLUMN IF EXISTS signed_by_name,
--   DROP COLUMN IF EXISTS signed_on, DROP COLUMN IF EXISTS renews_contract_id,
--   DROP COLUMN IF EXISTS vacancy_id, DROP COLUMN IF EXISTS place_of_work,
--   DROP COLUMN IF EXISTS working_hours, DROP COLUMN IF EXISTS notice_days,
--   DROP COLUMN IF EXISTS probation_ends_on, DROP COLUMN IF EXISTS probation_months,
--   DROP COLUMN IF EXISTS salary_currency, DROP COLUMN IF EXISTS gross_salary,
--   DROP COLUMN IF EXISTS job_title, DROP COLUMN IF EXISTS entity_id,
--   DROP COLUMN IF EXISTS ai_model, DROP COLUMN IF EXISTS ai_generated,
--   DROP COLUMN IF EXISTS body_md, DROP COLUMN IF EXISTS title;
--
-- DESTRUCTIVE in the way that matters most on this table: `body_md` IS the
-- contract. Dropping it discards the agreed text of every contract drafted
-- since this migration — the rendered PDFs survive in the vault, so the signed
-- copies are not lost, but the amendable source is, and every future amendment
-- goes back to retyping from a scan. Export `hr_contract(hr_contract_id,
-- body_md)` before running this.
