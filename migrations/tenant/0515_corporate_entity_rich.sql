-- ============================================================================
-- TENANT DB — 0515 corporate entity master revamp (MOD-01), part 1 of 2.
--
-- `corporate_entity` has not changed since 0100: fifteen columns, no children,
-- no documents, no people, no tax binding. Meanwhile 0511 gave client_master and
-- supplier_master registrations, documents, contacts, addresses, banks and
-- beneficial owners. The counterparties were better documented than the legal
-- entities that issue every invoice and own every ledger — this closes that.
--
-- This migration lays the IDENTITY foundation: who the entity legally is, how it
-- relates to the group, who owns and runs it, and where to reach it. 0513 adds
-- the documents, tax registrations, letterhead and renewal engine on top.
--
-- WHY THE PARTY PATTERN IS COPIED RATHER THAN SHARED. 0511 deliberately kept
-- client_master and supplier_master separate ("no unified `party` table by
-- design"). Corporate entities are a third master with the same *shape* but a
-- different *meaning* — a client's address is where we invoice them, an entity's
-- registered office is a statutory fact printed on our own letterhead. Copying
-- the shape keeps `buildResource` (src/modules/master/_shared/nested.js) reusable
-- verbatim while leaving the semantics free to diverge.
--
-- MULTI-FRAMEWORK FROM THE START. `accounting_framework` is per ENTITY, not per
-- tenant. The engine only implements OHADA today, but a Cameroon parent on OHADA
-- with a France subsidiary on IFRS is the actual target, and consolidation has to
-- know which is which. Adding the column now costs nothing; retrofitting it after
-- entities carry ledger history costs a data migration per tenant.
--
-- ADDITIVE ONLY. Every change is `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF
-- NOT EXISTS`, a seed with `ON CONFLICT DO NOTHING`, or a widening of a CHECK.
-- Nothing is dropped; existing rows are untouched. Idempotent — safe to re-run.
--
-- SCHEMA-DUAL. Like every tenant migration this runs UNQUALIFIED, once per
-- schema (live, then sandbox), so all references resolve within the current
-- schema. See migrations/tenant/0001_extensions.sql and doc/DB_ARCHITECTURE.md.
-- ============================================================================

-- ── 1. Statutory identity ──────────────────────────────────────────────────
-- What the entity legally IS. Every one of these appears on a letterhead, an
-- invoice footer, a tender file or a bank KYC pack somewhere in the world; 0513
-- assembles them into the rendered header/footer rather than asking a human to
-- retype them per document template.
ALTER TABLE corporate_entity
  ADD COLUMN IF NOT EXISTS trading_name text,
  -- SARL / SA / SAS / SASU / GIE / Ltd / PLC / GmbH / BV / Inc / LLC …
  -- Free text, not an enum: legal forms are jurisdiction-specific and a tenant
  -- expanding into a new country must not need a migration to name its own form.
  ADD COLUMN IF NOT EXISTS legal_form text,
  ADD COLUMN IF NOT EXISTS incorporation_date date,
  ADD COLUMN IF NOT EXISTS incorporation_country char(2),
  ADD COLUMN IF NOT EXISTS incorporation_place text,          -- 'Douala', 'Nanterre'
  ADD COLUMN IF NOT EXISTS share_capital numeric(20,2),
  ADD COLUMN IF NOT EXISTS share_capital_currency char(3),
  ADD COLUMN IF NOT EXISTS share_capital_paid_up numeric(20,2),
  ADD COLUMN IF NOT EXISTS description text,                  -- "about this entity"
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS email citext,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS headcount integer,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS dissolution_date date;

-- ── 2. Accounting framework (multi-GAAP readiness) ─────────────────────────
-- OHADA (SYSCOHADA révisé) is what the engine implements today. IFRS, US GAAP
-- and others are on the roadmap; the column exists now so entity rows created in
-- the meantime carry the right answer instead of an implied one.
ALTER TABLE corporate_entity
  ADD COLUMN IF NOT EXISTS accounting_framework text DEFAULT 'OHADA'
    CHECK (accounting_framework IS NULL OR accounting_framework IN
      ('OHADA','IFRS','IFRS_SME','US_GAAP','FR_PCG','UK_GAAP','LOCAL_OTHER'));

-- The DEFAULT covers rows created from here on; this covers the rows that already
-- exist. Both are needed — a backfill alone leaves every FUTURE insert null.
ALTER TABLE corporate_entity ALTER COLUMN accounting_framework SET DEFAULT 'OHADA';
UPDATE corporate_entity SET accounting_framework = 'OHADA' WHERE accounting_framework IS NULL;

-- ── 3. Lifecycle ladder ────────────────────────────────────────────────────
-- Mirrors the party ladder from 0511 so both masters read the same. `is_active`
-- stays as the compatibility surface every other module already reads — it is
-- kept in step with the ladder by the trigger below rather than by every caller
-- remembering to set both.
--
-- DRAFT matters specifically: registering an entity means gathering statutes,
-- tax certificates and a cap table over days. Without DRAFT the choice is a
-- half-formed row that looks live, or nothing saved at all.
ALTER TABLE corporate_entity
  ADD COLUMN IF NOT EXISTS registration_status text
    CHECK (registration_status IS NULL OR registration_status IN
      ('DRAFT','PENDING_REVIEW','ACTIVE','SUSPENDED','DEACTIVATED','ARCHIVED')),
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_by uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS deactivation_reason text;

-- Backfill from the boolean that has been carrying this meaning alone.
UPDATE corporate_entity
   SET registration_status = CASE WHEN is_active THEN 'ACTIVE' ELSE 'DEACTIVATED' END
 WHERE registration_status IS NULL;

-- Keep `is_active` derived from the ladder. Only ACTIVE counts as active; a
-- SUSPENDED entity must stop appearing in pickers, and a DRAFT one must never
-- have appeared. Writing either column alone now yields a consistent row.
-- TG_OP is tested FIRST and OLD is never touched on INSERT: in PL/pgSQL `OLD` is
-- unassigned for an INSERT trigger and reading a field off it raises at runtime,
-- so an `IS DISTINCT FROM OLD.x` guard cannot come first however harmless it
-- looks.
CREATE OR REPLACE FUNCTION entity_sync_active() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.registration_status := COALESCE(NEW.registration_status, 'ACTIVE');
    NEW.is_active := (NEW.registration_status = 'ACTIVE');
    NEW.status_changed_at := COALESCE(NEW.status_changed_at, now());
  ELSIF NEW.registration_status IS DISTINCT FROM OLD.registration_status THEN
    NEW.is_active := (NEW.registration_status = 'ACTIVE');
    NEW.status_changed_at := now();
  ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    -- Legacy callers that still flip the boolean (POST /entities/:id/active)
    -- keep working, and the ladder follows them.
    NEW.registration_status := CASE WHEN NEW.is_active THEN 'ACTIVE' ELSE 'DEACTIVATED' END;
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_entity_sync_active ON corporate_entity;
CREATE TRIGGER trg_entity_sync_active BEFORE INSERT OR UPDATE ON corporate_entity
  FOR EACH ROW EXECUTE FUNCTION entity_sync_active();

-- ── 4. Group structure ─────────────────────────────────────────────────────
-- "Smart Logistics Cameroon (main) + Smart Logistics France (subsidiary handling
-- European clients)" is TWO entity rows, not one row with two faces. France keeps
-- its own books, its own invoice numbering, its own VAT filings and its own
-- payroll — and journal_entry, invoice, employee and payroll_run all key off
-- entity_id, so collapsing them would break every one of those.
--
-- `consolidates` is what later lets group reporting roll France into the parent
-- without guessing; it is recorded now because the answer is known at
-- registration time and reconstructing it afterwards is guesswork.
ALTER TABLE corporate_entity
  ADD COLUMN IF NOT EXISTS parent_entity_id uuid REFERENCES corporate_entity(entity_id),
  ADD COLUMN IF NOT EXISTS relationship_type text
    CHECK (relationship_type IS NULL OR relationship_type IN
      ('HEADQUARTERS','SUBSIDIARY','BRANCH','REPRESENTATIVE_OFFICE','JOINT_VENTURE','ASSOCIATE','SPV')),
  ADD COLUMN IF NOT EXISTS ownership_percent numeric(7,4)
    CHECK (ownership_percent IS NULL OR (ownership_percent >= 0 AND ownership_percent <= 100)),
  ADD COLUMN IF NOT EXISTS consolidates boolean NOT NULL DEFAULT true,
  -- Which entity in the group is the reporting parent. Distinct from the legal
  -- parent: a JV may be legally owned 50/50 yet consolidate into one side.
  ADD COLUMN IF NOT EXISTS is_group_parent boolean NOT NULL DEFAULT false;

-- An entity cannot be its own parent. Cycles deeper than one hop are rejected in
-- the service (a recursive walk), which is where a readable error can be raised;
-- this catches the trivial case at the storage layer regardless of caller.
ALTER TABLE corporate_entity DROP CONSTRAINT IF EXISTS corporate_entity_no_self_parent;
ALTER TABLE corporate_entity ADD CONSTRAINT corporate_entity_no_self_parent
  CHECK (parent_entity_id IS NULL OR parent_entity_id <> entity_id);

CREATE INDEX IF NOT EXISTS ix_entity_parent ON corporate_entity(parent_entity_id);

-- ── 5. Downstream defaults ─────────────────────────────────────────────────
-- Picking an entity on a payroll run or an invoice is only half the value; the
-- other half is the entity CARRYING its own defaults, so the France run does not
-- silently inherit Cameroon's currency and social-security rates. payroll_run
-- already snapshots config at run time (`config_snapshot`) — this is where that
-- snapshot should come from.
ALTER TABLE corporate_entity
  ADD COLUMN IF NOT EXISTS default_currency char(3),
  ADD COLUMN IF NOT EXISTS default_tax_jurisdiction_id uuid REFERENCES tax_jurisdiction(jurisdiction_id),
  ADD COLUMN IF NOT EXISTS payroll_country char(2),
  ADD COLUMN IF NOT EXISTS numbering_reset text DEFAULT 'ANNUAL'
    CHECK (numbering_reset IS NULL OR numbering_reset IN ('NEVER','ANNUAL','MONTHLY')),
  ADD COLUMN IF NOT EXISTS vat_registered boolean;

ALTER TABLE corporate_entity ALTER COLUMN numbering_reset SET DEFAULT 'ANNUAL';

-- Backfill for rows that already exist. The three country-derived defaults
-- (`default_currency`, `payroll_country`, `incorporation_country`) cannot be
-- static column DEFAULTs because they depend on this row's own `country_code`,
-- so §5b installs a BEFORE INSERT trigger to derive them for future rows.
UPDATE corporate_entity e
   SET default_currency = COALESCE(
     (SELECT cp.currency FROM country_profile cp WHERE cp.code = e.country_code), 'XAF')
 WHERE e.default_currency IS NULL;

UPDATE corporate_entity SET payroll_country       = country_code   WHERE payroll_country IS NULL;
UPDATE corporate_entity SET incorporation_country = country_code   WHERE incorporation_country IS NULL;
UPDATE corporate_entity SET numbering_reset       = 'ANNUAL'       WHERE numbering_reset IS NULL;
UPDATE corporate_entity SET share_capital_currency = default_currency WHERE share_capital_currency IS NULL;

-- ── 5b. Derived defaults on write ──────────────────────────────────────────
-- A backfill fixes the rows that exist; it does nothing for the next entity
-- someone creates. These three defaults depend on the row's own `country_code`,
-- so they cannot be static column DEFAULTs and are derived here instead.
--
-- In the trigger rather than the service on purpose: entities are created by the
-- REST controller, the AI write-tool (`create_entity`) and the tenant seed, and a
-- rule that lives in one of those three is a rule the other two forget. Volume is
-- negligible — entities are created a handful of times in a tenant's life.
CREATE OR REPLACE FUNCTION entity_fill_defaults() RETURNS trigger AS $$
BEGIN
  IF NEW.default_currency IS NULL THEN
    NEW.default_currency := COALESCE(
      (SELECT cp.currency FROM country_profile cp WHERE cp.code = NEW.country_code), 'XAF');
  END IF;
  NEW.payroll_country        := COALESCE(NEW.payroll_country, NEW.country_code);
  NEW.incorporation_country  := COALESCE(NEW.incorporation_country, NEW.country_code);
  NEW.share_capital_currency := COALESCE(NEW.share_capital_currency, NEW.default_currency);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_entity_fill_defaults ON corporate_entity;
CREATE TRIGGER trg_entity_fill_defaults BEFORE INSERT ON corporate_entity
  FOR EACH ROW EXECUTE FUNCTION entity_fill_defaults();

-- ── 6. Establishments (sites that are not separate legal persons) ──────────
-- A warehouse in Kribi or a branch office in Lyon has an address, often its own
-- tax-office reference and its own social-security registration, but no separate
-- books. `corporate_entity` would be wrong (it would fork the ledger);
-- `entity_address` would be too thin (no registrations, no manager). Hence a
-- table of its own.
CREATE TABLE IF NOT EXISTS entity_establishment (
  establishment_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id         uuid NOT NULL REFERENCES corporate_entity(entity_id) ON DELETE CASCADE,
  code              text,
  name              text NOT NULL,
  kind              text NOT NULL DEFAULT 'OFFICE'
      CHECK (kind IN ('HEAD_OFFICE','OFFICE','WAREHOUSE','TERMINAL','WORKSHOP','SITE','AGENCY','OTHER')),
  country_code      char(2),
  city              text,
  address_line      text,
  -- Establishment-level statutory references: France's SIRET, Cameroon's centre
  -- des impôts, a customs office code. Free-form because every country names it
  -- differently, and this is a reference, not a computed field.
  tax_office_ref    text,
  registration_ref  text,
  customs_office    text,
  manager_employee_id uuid REFERENCES employee(employee_id),
  opened_on         date,
  closed_on         date,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (closed_on IS NULL OR opened_on IS NULL OR closed_on >= opened_on)
);
CREATE INDEX IF NOT EXISTS ix_establishment_entity ON entity_establishment(entity_id);

-- ── 7. People: shareholders, directors, officers, signatories, UBOs ────────
-- ONE table with a role, not three. In a real company the same person is usually
-- several of these at once — the majority shareholder is also the managing
-- director and the primary bank signatory — and separate tables mean maintaining
-- them in three places until they drift.
--
-- `holder_type` is what makes a holding structure expressible: a shareholder can
-- be a company, and when that company is itself one of our entities the
-- `holder_entity_id` link makes the group graph traversable rather than
-- name-matched.
--
-- Optional links to employee / client / supplier mean a director who is also on
-- payroll is one person in the system, not two records that disagree.
CREATE TABLE IF NOT EXISTS entity_person (
  person_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id         uuid NOT NULL REFERENCES corporate_entity(entity_id) ON DELETE CASCADE,
  role              text NOT NULL CHECK (role IN
      ('SHAREHOLDER','DIRECTOR','OFFICER','LEGAL_REPRESENTATIVE',
       'AUTHORISED_SIGNATORY','BENEFICIAL_OWNER','STATUTORY_AUDITOR','SECRETARY')),
  holder_type       text NOT NULL DEFAULT 'PERSON' CHECK (holder_type IN ('PERSON','COMPANY')),
  full_name         text NOT NULL,
  title             text,                                  -- 'Directeur Général', 'CFO'
  -- Natural-person identity (AML). Null for a corporate holder.
  date_of_birth     date,
  nationality       char(2),
  country_of_residence char(2),
  id_type           text,                                  -- 'PASSPORT' | 'CNI' | 'RESIDENCE_PERMIT'
  id_number         text,
  -- Corporate holder identity. Null for a natural person.
  company_registration_number text,
  company_country   char(2),
  holder_entity_id  uuid REFERENCES corporate_entity(entity_id),   -- when the holder is one of ours

  email             citext,
  phone             text,

  -- ── Shareholding (only meaningful for role = 'SHAREHOLDER') ──
  -- Share COUNT and CLASS, not a bare percentage: percentages alone cannot
  -- express preference shares or partly-paid capital, and cannot be reconciled
  -- against corporate_entity.share_capital.
  share_class       text,                                  -- 'ORDINARY' | 'PREFERENCE' | 'A' | 'B'
  share_count       numeric(20,4),
  share_nominal_value numeric(20,4),
  ownership_percent numeric(9,4)
      CHECK (ownership_percent IS NULL OR (ownership_percent >= 0 AND ownership_percent <= 100)),
  voting_percent    numeric(9,4)
      CHECK (voting_percent IS NULL OR (voting_percent >= 0 AND voting_percent <= 100)),

  -- ── Governance flags ──
  is_pep            boolean NOT NULL DEFAULT false,        -- politically exposed person
  is_primary_contact boolean NOT NULL DEFAULT false,
  signature_limit_amount numeric(20,2),                    -- bank mandate ceiling
  signature_limit_currency char(3),

  -- ── Effective dating: appointed/resigned, acquired/disposed ──
  -- This is what gives question 12's "most of a full cap-table history for a
  -- fraction of the cost": the current cap table is the rows where effective_to
  -- is null, and a past one is a date predicate away.
  effective_from    date,
  effective_to      date,

  -- Cross-links so one human is one record system-wide.
  employee_id       uuid REFERENCES employee(employee_id),
  client_id         uuid REFERENCES client_master(client_id),
  supplier_id       uuid REFERENCES supplier_master(supplier_id),

  notes             text,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES app_user(user_id),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from),
  -- A corporate holder has no date of birth; a natural person has no company
  -- registration number. Guarding the pairing stops the two identity blocks
  -- being filled in at once, which is how a UBO screen ends up ambiguous.
  CONSTRAINT entity_person_holder_shape CHECK (
    (holder_type = 'PERSON'  AND company_registration_number IS NULL) OR
    (holder_type = 'COMPANY' AND date_of_birth IS NULL AND id_number IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS ix_entity_person_entity ON entity_person(entity_id, role);
CREATE INDEX IF NOT EXISTS ix_entity_person_current ON entity_person(entity_id) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS ix_entity_person_holder ON entity_person(holder_entity_id) WHERE holder_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_entity_person_employee ON entity_person(employee_id) WHERE employee_id IS NOT NULL;

-- ── 8. Contacts ────────────────────────────────────────────────────────────
-- Departmental contact points for the entity itself — the AP inbox that supplier
-- invoices go to, the legal contact on a tender, the emergency line. Shaped like
-- client_contact so `buildResource` mounts it with no special casing.
CREATE TABLE IF NOT EXISTS entity_contact (
  contact_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL REFERENCES corporate_entity(entity_id) ON DELETE CASCADE,
  name          text NOT NULL,
  title         text,
  email         citext,
  phone         text,
  role_tags     text[],
  is_primary    boolean NOT NULL DEFAULT false,
  language      char(2),
  timezone      text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_entity_contact_entity ON entity_contact(entity_id);

-- ── 9. Addresses ───────────────────────────────────────────────────────────
-- `corporate_entity.address` is one free-text line printed on the letterhead.
-- That conflates the REGISTERED office (a statutory fact, often a lawyer's or
-- accountant's address) with the trading address people actually visit and the
-- remittance address on a payment advice. They are genuinely different and in
-- France they are frequently not the same place.
--
-- The legacy `address` column stays and stays readable; §5 of 0513 makes the
-- letterhead prefer the REGISTERED row when one exists.
CREATE TABLE IF NOT EXISTS entity_address (
  address_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL REFERENCES corporate_entity(entity_id) ON DELETE CASCADE,
  type          text NOT NULL DEFAULT 'REGISTERED'
      CHECK (type IN ('REGISTERED','TRADING','BILLING','REMITTANCE','MAILING','WAREHOUSE','OTHER')),
  line1         text,
  line2         text,
  city          text,
  region        text,
  postal_code   text,
  country_code  char(2),
  po_box        text,
  is_primary    boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_entity_address_entity ON entity_address(entity_id, type);

-- ── 10. Registrations (per country) ────────────────────────────────────────
-- The entity's own NIU/RCCM in Cameroon, VAT/EORI/SIREN in France, EIN in the US
-- — one row per identifier per country. This is the direct answer to "how does a
-- company with more than one entity stay compliant in both systems": the
-- identifiers are per (entity, country), and country_profile already declares
-- which ones each country expects, so the form is generated rather than coded.
--
-- Kept SEPARATE from party_registration rather than adding an entity_id column to
-- it: that table's CHECK asserts exactly one of client_id/supplier_id is set, and
-- widening it to three-way-exclusive would weaken a constraint that currently
-- protects two live masters.
CREATE TABLE IF NOT EXISTS entity_registration (
  registration_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id         uuid NOT NULL REFERENCES corporate_entity(entity_id) ON DELETE CASCADE,
  country_code      char(2),
  kind              text NOT NULL,   -- NIU, RCCM, VAT, EORI, SIREN, SIRET, EIN, LEI, DUNS, IATA, FIATA, AEO, …
  number            text,
  issuing_authority text,
  issued_on         date,
  expires_on        date,
  is_primary        boolean NOT NULL DEFAULT false,
  verified          boolean NOT NULL DEFAULT false,
  verified_by       uuid REFERENCES app_user(user_id),
  verified_at       timestamptz,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_entity_reg_entity  ON entity_registration(entity_id, country_code);
CREATE INDEX IF NOT EXISTS ix_entity_reg_expires ON entity_registration(expires_on)
  WHERE expires_on IS NOT NULL;

-- Backfill the two identifiers that already live as columns on the entity, so the
-- Registrations tab is populated on day one rather than looking empty next to a
-- header that still shows them. The columns stay — every existing invoice
-- template reads `niu`/`rccm` directly — and 0513's letterhead builder prefers
-- the registration rows when present.
INSERT INTO entity_registration (entity_id, country_code, kind, number, is_primary, created_at)
SELECT e.entity_id, e.country_code, 'NIU', e.niu, true, e.created_at
  FROM corporate_entity e
 WHERE e.niu IS NOT NULL AND btrim(e.niu) <> ''
   AND NOT EXISTS (SELECT 1 FROM entity_registration r
                    WHERE r.entity_id = e.entity_id AND r.kind = 'NIU');

INSERT INTO entity_registration (entity_id, country_code, kind, number, is_primary, created_at)
SELECT e.entity_id, e.country_code, 'RCCM', e.rccm, true, e.created_at
  FROM corporate_entity e
 WHERE e.rccm IS NOT NULL AND btrim(e.rccm) <> ''
   AND NOT EXISTS (SELECT 1 FROM entity_registration r
                    WHERE r.entity_id = e.entity_id AND r.kind = 'RCCM');

-- Likewise seed a REGISTERED address row from the free-text column so the
-- Addresses tab is not empty for entities that already have one.
INSERT INTO entity_address (entity_id, type, line1, country_code, is_primary, created_at)
SELECT e.entity_id, 'REGISTERED', e.address, e.country_code, true, e.created_at
  FROM corporate_entity e
 WHERE e.address IS NOT NULL AND btrim(e.address) <> ''
   AND NOT EXISTS (SELECT 1 FROM entity_address a WHERE a.entity_id = e.entity_id);

-- ── 11. updated_at triggers ────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_entity_establishment_updated ON entity_establishment;
CREATE TRIGGER trg_entity_establishment_updated BEFORE UPDATE ON entity_establishment
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_entity_person_updated ON entity_person;
CREATE TRIGGER trg_entity_person_updated BEFORE UPDATE ON entity_person
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_entity_contact_updated ON entity_contact;
CREATE TRIGGER trg_entity_contact_updated BEFORE UPDATE ON entity_contact
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_entity_address_updated ON entity_address;
CREATE TRIGGER trg_entity_address_updated BEFORE UPDATE ON entity_address
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_entity_registration_updated ON entity_registration;
CREATE TRIGGER trg_entity_registration_updated BEFORE UPDATE ON entity_registration
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── DOWN ────────────────────────────────────────────────────────────────────
-- DOWN
-- Additive migration; reverse by dropping what it added. Commented so nothing
-- runs by accident, present so there is a starting point at 3am.
--
-- ORDER MATTERS: the triggers first (they reference the columns), then the child
-- tables (they reference corporate_entity), then the columns themselves.
--
-- NOT fully reversible in one respect, and the distinction is worth knowing on
-- the pager: §10's backfill COPIED niu/rccm/address into entity_registration and
-- entity_address rows. Dropping those tables discards any edit made to a
-- registration since — the original columns are untouched and still hold their
-- pre-migration values, so the letterhead falls back to them cleanly, but a
-- corrected RCCM entered through the new UI is lost. Restore the pre-deploy dump
-- (scripts/deploy.sh takes one) if those edits matter.
--
-- DROP TRIGGER IF EXISTS trg_entity_sync_active ON corporate_entity;
-- DROP TRIGGER IF EXISTS trg_entity_fill_defaults ON corporate_entity;
-- DROP FUNCTION IF EXISTS entity_sync_active();
-- DROP FUNCTION IF EXISTS entity_fill_defaults();
-- DROP TABLE IF EXISTS entity_registration, entity_address, entity_contact,
--   entity_person, entity_establishment;
-- ALTER TABLE corporate_entity DROP CONSTRAINT IF EXISTS corporate_entity_no_self_parent;
-- ALTER TABLE corporate_entity
--   DROP COLUMN IF EXISTS trading_name,           DROP COLUMN IF EXISTS legal_form,
--   DROP COLUMN IF EXISTS incorporation_date,     DROP COLUMN IF EXISTS incorporation_country,
--   DROP COLUMN IF EXISTS incorporation_place,    DROP COLUMN IF EXISTS share_capital,
--   DROP COLUMN IF EXISTS share_capital_currency, DROP COLUMN IF EXISTS share_capital_paid_up,
--   DROP COLUMN IF EXISTS description,            DROP COLUMN IF EXISTS industry,
--   DROP COLUMN IF EXISTS website,                DROP COLUMN IF EXISTS email,
--   DROP COLUMN IF EXISTS phone,                  DROP COLUMN IF EXISTS headcount,
--   DROP COLUMN IF EXISTS timezone,               DROP COLUMN IF EXISTS dissolution_date,
--   DROP COLUMN IF EXISTS accounting_framework,   DROP COLUMN IF EXISTS registration_status,
--   DROP COLUMN IF EXISTS status_changed_at,      DROP COLUMN IF EXISTS status_changed_by,
--   DROP COLUMN IF EXISTS deactivation_reason,    DROP COLUMN IF EXISTS parent_entity_id,
--   DROP COLUMN IF EXISTS relationship_type,      DROP COLUMN IF EXISTS ownership_percent,
--   DROP COLUMN IF EXISTS consolidates,           DROP COLUMN IF EXISTS is_group_parent,
--   DROP COLUMN IF EXISTS default_currency,       DROP COLUMN IF EXISTS default_tax_jurisdiction_id,
--   DROP COLUMN IF EXISTS payroll_country,        DROP COLUMN IF EXISTS numbering_reset,
--   DROP COLUMN IF EXISTS vat_registered;
--
-- `is_active` is left as the migration found it: the sync trigger kept it in
-- step with the ladder, and every value it holds is one the pre-0515 code wrote
-- too, so nothing needs undoing there.
