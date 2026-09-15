-- ============================================================================
-- TENANT DB — 12763 The employee record a work contract can actually be
-- written from, plus the lifecycle state that says whether it is finished.
--
-- ── WHAT WAS MISSING, AND WHY IT MATTERS ──────────────────────────────────
--
-- `employee` has carried a name, a title, a department, a salary and a CNPS
-- number since 0300. That is enough to run payroll and enough to dispatch a
-- driver. It is NOT enough to produce the document the employment relationship
-- actually rests on.
--
-- A Cameroonian CDI opens by identifying the two parties, and the employee half
-- of that paragraph reads, in full:
--
--   « Mme SPECIMEN Epse EXEMPLE Marie Claire, Née le 12 Mars 1985 à
--     BAFIA, Fille de SPECIMEN Jean et de EXEMPLE Rose, Titulaire de la
--     CNI N° 000000000 délivrée le 03 février 2021 à CE00. Demeurant à
--     Bonapriso Douala, et De nationalité Camerounaise »
--
-- Every fact in it — civility, married name, birth date, birth PLACE, both
-- parents' names, the ID document's number AND its issue date AND its issue
-- place, the residence, the nationality — was unrepresentable. So was the
-- matricule the contract assigns ("Le matricule SLAS-137 lui est attribué"),
-- the probation term, the place of work and the working hours.
--
-- A contract generator reading this table could only have produced a document
-- with holes in it, and a contract with holes is not a lesser contract, it is
-- an unusable one. This migration is what makes MOD-02 the single source the
-- generator reads.
--
-- ── WHY THESE COLUMNS AND NOT A SIDE TABLE ────────────────────────────────
--
-- `employees.repo.get` is `SELECT e.*`, and every consumer of an employee
-- already reads it that way. A 1:1 `employee_personal` would mean a join in one
-- read path and silence in the eleven others — the contract drafter included,
-- which is exactly where a missing field turns into a broken document. The
-- sensitive additions are masked at the HTTP boundary like `base_salary`
-- already is (see shared/rbac/field-mask.js, key `employee.personal`), so
-- widening the row does not widen who can read it.
--
-- ── GENDER, AND WHY maiden_name IS NOT JUST ANOTHER NAME ──────────────────
--
-- "Née SPECIMEN Epse EXEMPLE" is a birth name and a married name in one breath,
-- and it appears in that form only for a married woman. `gender` is therefore
-- recorded in its own right — the contract's own prose is gendered throughout
-- ("L'Employée est recrutée", "Fille de") and cannot be generated without it —
-- and `maiden_name` is the field the UI asks for only when gender is FEMALE and
-- the marital status is one where a name change happened. The database does not
-- enforce that pairing: a record imported mid-divorce, or a woman who kept her
-- birth name, must still be storable. The form asks the right question; the
-- column does not refuse the answer.
--
-- ── THE MATRICULE IS ALLOCATED, NOT TYPED ─────────────────────────────────
--
-- `employee_number_sequence` hands out SLAS-001, SLAS-002 … per corporate
-- entity, prefixed from `corporate_entity.code`. Allocation is a single
-- INSERT … ON CONFLICT DO UPDATE … RETURNING, so two clerks hiring at the same
-- moment cannot be handed the same number — the legacy system's
-- "SELECT MAX(...) FOR UPDATE" did the same job by holding a lock on the whole
-- table for the length of a save.
--
-- ADDITIVE ONLY. Every statement is IF NOT EXISTS / guarded.
-- ============================================================================

-- ── 1. Who this person is ──────────────────────────────────────────────────
ALTER TABLE employee
  ADD COLUMN IF NOT EXISTS staff_no            text,
  ADD COLUMN IF NOT EXISTS civility            text,
  ADD COLUMN IF NOT EXISTS gender              text,
  ADD COLUMN IF NOT EXISTS maiden_name         text,
  ADD COLUMN IF NOT EXISTS date_of_birth       date,
  ADD COLUMN IF NOT EXISTS place_of_birth      text,
  ADD COLUMN IF NOT EXISTS father_name         text,
  ADD COLUMN IF NOT EXISTS mother_name         text,
  ADD COLUMN IF NOT EXISTS nationality         text,
  ADD COLUMN IF NOT EXISTS marital_status      text,
  ADD COLUMN IF NOT EXISTS dependent_children  smallint,
  -- The identity document the contract cites. Type is open text rather than an
  -- enum: a CNI, a passport and a "carte de séjour" are the common three in
  -- Cameroon, but a tenant hiring a refugee holds a document none of those name.
  ADD COLUMN IF NOT EXISTS id_document_type    text,
  ADD COLUMN IF NOT EXISTS id_document_number  text,
  ADD COLUMN IF NOT EXISTS id_document_issued_on  date,
  ADD COLUMN IF NOT EXISTS id_document_issued_at  text,
  ADD COLUMN IF NOT EXISTS id_document_expires_on date;

-- ── 2. How to reach them ───────────────────────────────────────────────────
-- `phone_desk` / `phone_mobile` arrived in 12759 for the signature block. These
-- are the rest of the contact card: WhatsApp is a distinct number here (it is
-- how a warehouse hand is actually reached, and `app_user.whatsapp_number` in
-- 0461 only ever covered people who have a LOGIN), a personal email survives
-- the day the work address is disabled, and the emergency contact is the number
-- HR needs at the exact moment nobody can find it.
ALTER TABLE employee
  ADD COLUMN IF NOT EXISTS phone_whatsapp      text,
  ADD COLUMN IF NOT EXISTS personal_email      citext,
  ADD COLUMN IF NOT EXISTS residence_address   text,
  ADD COLUMN IF NOT EXISTS residence_city      text,
  ADD COLUMN IF NOT EXISTS emergency_contact_name text,
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text;

-- ── 3. The terms the contract states ───────────────────────────────────────
-- These duplicate columns `hr_contract` already has (0700 added probation_months,
-- place_of_work, working_hours). That is deliberate and not redundancy: the
-- contract row records what THAT contract said, frozen at signature; the
-- employee row holds what is true of the person NOW, and is what a new or
-- renewed contract is DRAFTED FROM. Without the employee-side copy, generating
-- a second contract means re-typing the terms of the first.
ALTER TABLE employee
  ADD COLUMN IF NOT EXISTS probation_months    smallint,
  ADD COLUMN IF NOT EXISTS place_of_work       text,
  ADD COLUMN IF NOT EXISTS working_hours       text,
  ADD COLUMN IF NOT EXISTS payment_method      text,
  ADD COLUMN IF NOT EXISTS salary_currency     char(3);

-- ── 4. The lifecycle ───────────────────────────────────────────────────────
-- `is_active` is a boolean, and a boolean cannot tell "hired, record complete,
-- no login yet" from "resigned in March". Both are is_active = false, and the
-- first is a queue HR must work through while the second is history.
--
-- `status` is that missing distinction. `is_active` STAYS, and stays the flag
-- every existing consumer reads (payroll roster, fleet dispatch,
-- employees.service.assertActive): the trigger below keeps it derived from
-- status, so nothing that reads the boolean today has to learn about the enum.
ALTER TABLE employee
  ADD COLUMN IF NOT EXISTS status              text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS terminated_on       date,
  ADD COLUMN IF NOT EXISTS termination_reason  text;

-- Existing rows predate the enum: an active row is ACTIVE, a deactivated one is
-- SUSPENDED (never TERMINATED — we do not know that anybody left, and guessing
-- would put a resignation on a record that never had one).
UPDATE employee SET status = CASE WHEN is_active THEN 'ACTIVE' ELSE 'SUSPENDED' END
 WHERE status IS NULL OR status NOT IN ('PENDING','ACTIVE','SUSPENDED','TERMINATED');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_employee_status' AND conrelid = 'employee'::regclass) THEN
    ALTER TABLE employee ADD CONSTRAINT ck_employee_status
      CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','TERMINATED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_employee_gender' AND conrelid = 'employee'::regclass) THEN
    ALTER TABLE employee ADD CONSTRAINT ck_employee_gender
      CHECK (gender IS NULL OR gender IN ('MALE','FEMALE','UNSPECIFIED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_employee_marital_status' AND conrelid = 'employee'::regclass) THEN
    ALTER TABLE employee ADD CONSTRAINT ck_employee_marital_status
      CHECK (marital_status IS NULL OR marital_status IN ('SINGLE','MARRIED','DIVORCED','WIDOWED','SEPARATED','COHABITING'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_employee_civility' AND conrelid = 'employee'::regclass) THEN
    ALTER TABLE employee ADD CONSTRAINT ck_employee_civility
      CHECK (civility IS NULL OR civility IN ('MR','MRS','MS','DR','PROF'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_employee_payment_method' AND conrelid = 'employee'::regclass) THEN
    ALTER TABLE employee ADD CONSTRAINT ck_employee_payment_method
      CHECK (payment_method IS NULL OR payment_method IN ('BANK_TRANSFER','MOBILE_MONEY','CASH','CHEQUE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_employee_children' AND conrelid = 'employee'::regclass) THEN
    ALTER TABLE employee ADD CONSTRAINT ck_employee_children
      CHECK (dependent_children IS NULL OR dependent_children BETWEEN 0 AND 40);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_employee_probation' AND conrelid = 'employee'::regclass) THEN
    ALTER TABLE employee ADD CONSTRAINT ck_employee_probation
      CHECK (probation_months IS NULL OR probation_months BETWEEN 0 AND 24);
  END IF;
  -- An ID document cannot expire before it was issued.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_employee_id_doc_dates' AND conrelid = 'employee'::regclass) THEN
    ALTER TABLE employee ADD CONSTRAINT ck_employee_id_doc_dates
      CHECK (id_document_expires_on IS NULL OR id_document_issued_on IS NULL
             OR id_document_expires_on >= id_document_issued_on);
  END IF;
END $$;

-- `is_active` derived from `status`, so the boolean cannot drift from the enum.
-- Writers may set either — the service sets status, older code sets is_active —
-- and this reconciles them in the same statement rather than leaving two
-- sources of truth for "can payroll pay this person".
CREATE OR REPLACE FUNCTION employee_sync_active() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.is_active := (NEW.status = 'ACTIVE');
  ELSIF TG_OP = 'UPDATE' AND NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    -- Somebody flipped the boolean directly. Honour it, and move the enum to
    -- the state that means it — without inventing a termination.
    NEW.status := CASE WHEN NEW.is_active THEN 'ACTIVE'
                       WHEN NEW.status = 'TERMINATED' THEN 'TERMINATED'
                       ELSE 'SUSPENDED' END;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.is_active := (NEW.status = 'ACTIVE');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_employee_sync_active
  BEFORE INSERT OR UPDATE ON employee
  FOR EACH ROW EXECUTE FUNCTION employee_sync_active();

-- ── 5. The matricule ───────────────────────────────────────────────────────
-- One counter per corporate entity. `sequence_key` is the entity's uuid as
-- text, or '*' for an employee recorded against no entity — a text key rather
-- than a nullable uuid FK because "no entity" must be ONE bucket, and NULL in a
-- primary key is not a value you can conflict on.
CREATE TABLE IF NOT EXISTS employee_number_sequence (
  sequence_key text PRIMARY KEY,
  prefix       text NOT NULL,
  next_no      integer NOT NULL DEFAULT 1 CHECK (next_no > 0),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Unique, but only where present: rows created before this migration have no
-- matricule, and a plain UNIQUE would be satisfied by many NULLs anyway — the
-- partial index says what is meant and stays small.
CREATE UNIQUE INDEX IF NOT EXISTS ux_employee_staff_no
  ON employee (staff_no) WHERE staff_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_employee_status ON employee (status);

COMMENT ON COLUMN employee.staff_no IS
  'Matricule (e.g. SLAS-137). Allocated by employees.repo.allocateStaffNo from employee_number_sequence; never typed by hand.';
COMMENT ON COLUMN employee.status IS
  'Lifecycle: PENDING (record created, not yet in service) / ACTIVE / SUSPENDED / TERMINATED. is_active is derived from it by trg_employee_sync_active.';
COMMENT ON COLUMN employee.maiden_name IS
  'Birth name where it differs from the name in use ("Née SPECIMEN Epse EXEMPLE"). Asked for when gender = FEMALE and the marital status implies a name change; not constrained here, because an imported record must still be storable.';
COMMENT ON COLUMN employee.probation_months IS
  'Standing probation term, the value a NEW contract is drafted with. hr_contract.probation_months records what a SIGNED contract actually said.';

-- DOWN
--   DROP TRIGGER IF EXISTS trg_employee_sync_active ON employee;
--   DROP FUNCTION IF EXISTS employee_sync_active();
--   DROP INDEX IF EXISTS ux_employee_staff_no;
--   DROP INDEX IF EXISTS ix_employee_status;
--   DROP TABLE IF EXISTS employee_number_sequence;
--   ALTER TABLE employee
--     DROP CONSTRAINT IF EXISTS ck_employee_status,
--     DROP CONSTRAINT IF EXISTS ck_employee_gender,
--     DROP CONSTRAINT IF EXISTS ck_employee_marital_status,
--     DROP CONSTRAINT IF EXISTS ck_employee_civility,
--     DROP CONSTRAINT IF EXISTS ck_employee_payment_method,
--     DROP CONSTRAINT IF EXISTS ck_employee_children,
--     DROP CONSTRAINT IF EXISTS ck_employee_probation,
--     DROP CONSTRAINT IF EXISTS ck_employee_id_doc_dates;
--   ALTER TABLE employee
--     DROP COLUMN IF EXISTS staff_no, DROP COLUMN IF EXISTS civility,
--     DROP COLUMN IF EXISTS gender, DROP COLUMN IF EXISTS maiden_name,
--     DROP COLUMN IF EXISTS date_of_birth, DROP COLUMN IF EXISTS place_of_birth,
--     DROP COLUMN IF EXISTS father_name, DROP COLUMN IF EXISTS mother_name,
--     DROP COLUMN IF EXISTS nationality, DROP COLUMN IF EXISTS marital_status,
--     DROP COLUMN IF EXISTS dependent_children, DROP COLUMN IF EXISTS id_document_type,
--     DROP COLUMN IF EXISTS id_document_number, DROP COLUMN IF EXISTS id_document_issued_on,
--     DROP COLUMN IF EXISTS id_document_issued_at, DROP COLUMN IF EXISTS id_document_expires_on,
--     DROP COLUMN IF EXISTS phone_whatsapp, DROP COLUMN IF EXISTS personal_email,
--     DROP COLUMN IF EXISTS residence_address, DROP COLUMN IF EXISTS residence_city,
--     DROP COLUMN IF EXISTS emergency_contact_name,
--     DROP COLUMN IF EXISTS emergency_contact_relationship,
--     DROP COLUMN IF EXISTS emergency_contact_phone,
--     DROP COLUMN IF EXISTS probation_months, DROP COLUMN IF EXISTS place_of_work,
--     DROP COLUMN IF EXISTS working_hours, DROP COLUMN IF EXISTS payment_method,
--     DROP COLUMN IF EXISTS salary_currency, DROP COLUMN IF EXISTS status,
--     DROP COLUMN IF EXISTS terminated_on, DROP COLUMN IF EXISTS termination_reason;
