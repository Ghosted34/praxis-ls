-- ============================================================================
-- TENANT DB — 0688 Sales & CRM F10: partnership / vendor intake, and the
-- approved vendor's draft supplier.
--
-- Vertical slice for doc/SALES_CRM_FEATURES.md#F10. `partnership_request` was
-- five columns — company_name, contact_name, email, proposal_text, status —
-- against a legacy form that vets forwarding agents. Everything a vetting
-- decision actually rests on was missing.
--
-- This migration owns:
--   1. The applicant's identity: country of origin, contact title and phone,
--      and NETWORK MEMBERSHIPS, which is the load-bearing field on the form —
--      a forwarding agent is vetted by whether it is in WCA / JCTrans / a
--      comparable network, and that is a LIST, so it is a jsonb array with a
--      shape constraint rather than a comma-separated string somebody has to
--      re-parse in three places (the legacy parses it twice, differently,
--      with a fallback to explode(',') when the JSON does not decode).
--   2. proposal_type — AGENCY_PARTNERSHIP or VENDOR_REGISTRATION. Two very
--      different applications sharing one register, and the only field that
--      decides whether approval creates a supplier.
--   3. The corporate profile document, into the vault, by FK — not
--      `corporate_profile_ref`, a bare filename the legacy admin page
--      concatenated onto a hard-coded directory in the browser (and the
--      basename() and the two rival PR_DOC_BASE constants in that file are why
--      the "View" button opens the wrong path half the time).
--   4. internal_notes, capped at the legacy's 5000 characters — in a CHECK, not
--      in a maxlength attribute.
--   5. The status vocabulary the legacy's OWN API validates against —
--      NEW / IN_REVIEW / APPROVED / REJECTED — replacing this table's
--      NEW / REVIEWING / ACCEPTED / DECLINED. Same four states, and the
--      legacy's spelling is the one the intake form and the public site will
--      post in F13, so it is the one that survives. Existing rows are
--      translated, not left behind: a second name for a state is the mistake
--      F6 spent a whole slice correcting one column over.
--   6. The decision: who reviewed it, when, and why — with a rejection reason
--      enforced in the database, the same way 0685 enforces it for campaigns.
--   7. supplier_id — the back-link to the DRAFT supplier an approved vendor
--      registration creates. This is the correction at the heart of F10: the
--      legacy screen prints "This module captures intake only. It does not
--      auto-create suppliers. Approved vendors must be manually onboarded in
--      the Supplier Master Registry." That is a limitation wearing the costume
--      of a control. The control this system already has is better: a supplier
--      is born DRAFT, has no auxiliary accounting account until activation,
--      and only somebody holding the approve permission can verify it. Re-
--      typing the company's name into a second screen adds nothing to that
--      except an opportunity to mistype it.
--
-- ON THE KPI TILES. The legacy's four are total / agency / vendor / pending,
-- and they do NOT partition anything: agency + vendor already equals total,
-- and pending is a slice of a different dimension. This slice keeps those four
-- as the display, but computes them from TWO complete partitions — one by
-- proposal_type, one by status — so the service can prove they add up
-- (partnership_request.rules.assertPartitions). Every index below exists to
-- make one of those GROUP BYs cheap.
--
-- Idempotent: every ALTER is ADD COLUMN IF NOT EXISTS, every constraint is
-- added inside a DO block that checks pg_constraint, the status CHECK is
-- dropped by name before being re-added (doc/DB_ARCHITECTURE.md §8.2), and the
-- status translation is written so re-running it is a no-op. Applies twice
-- cleanly.
-- ============================================================================

-- ─── 1. Who is applying ─────────────────────────────────────────────────────
ALTER TABLE partnership_request ADD COLUMN IF NOT EXISTS country_of_origin  text;
ALTER TABLE partnership_request ADD COLUMN IF NOT EXISTS contact_title      text;
ALTER TABLE partnership_request ADD COLUMN IF NOT EXISTS contact_phone      text;
ALTER TABLE partnership_request ADD COLUMN IF NOT EXISTS website            text;

-- The memberships. jsonb ARRAY, constrained to an array, because every consumer
-- (the register's pills, the CSV export, the vetting read) wants a list and the
-- legacy's TEXT column gave each of them a different one. GIN-indexed below so
-- "which applicants claim WCA" is answerable without a scan — that question is
-- the reason the field exists.
ALTER TABLE partnership_request ADD COLUMN IF NOT EXISTS network_memberships jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_partnership_request_memberships_array') THEN
    ALTER TABLE partnership_request
      ADD CONSTRAINT ck_partnership_request_memberships_array
      CHECK (jsonb_typeof(network_memberships) = 'array');
  END IF;
END $$;

-- ─── 2. Which kind of application ───────────────────────────────────────────
-- Defaulted to AGENCY_PARTNERSHIP for the rows that predate the column: they
-- were captured by a form that had no vendor path, so that is what they are.
-- The default stays on the column because F13's public endpoint will post
-- without it for an agency application.
ALTER TABLE partnership_request ADD COLUMN IF NOT EXISTS proposal_type text NOT NULL DEFAULT 'AGENCY_PARTNERSHIP';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_partnership_request_proposal_type') THEN
    ALTER TABLE partnership_request
      ADD CONSTRAINT ck_partnership_request_proposal_type
      CHECK (proposal_type IN ('AGENCY_PARTNERSHIP','VENDOR_REGISTRATION'));
  END IF;
END $$;

-- Where it came from. Same vocabulary as lead.intake_channel (0683), so a
-- website-sourced application is countable the same way across the funnel and
-- F13 has a column to stamp rather than needing one of its own.
ALTER TABLE partnership_request ADD COLUMN IF NOT EXISTS intake_channel text NOT NULL DEFAULT 'MANUAL';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_partnership_request_intake_channel') THEN
    ALTER TABLE partnership_request
      ADD CONSTRAINT ck_partnership_request_intake_channel
      CHECK (intake_channel IN ('WEBSITE','MANUAL','REFERRAL','CAMPAIGN'));
  END IF;
END $$;

-- ─── 3. The corporate profile document ──────────────────────────────────────
-- An FK into the vault, not a filename. The vault owns the bytes, the SHA-256
-- content hash, the doc-type registry entry (PARTNERSHIP_PROFILE, MOD-25) that
-- decides who may READ it, and the auth-gated download route. A bare filename
-- owns none of those, which is why the legacy's View button is a raw
-- window.open onto a public directory.
ALTER TABLE partnership_request ADD COLUMN IF NOT EXISTS corporate_profile_vault_id uuid REFERENCES document_vault(doc_id);

-- ─── 4. Vetting notes ───────────────────────────────────────────────────────
ALTER TABLE partnership_request ADD COLUMN IF NOT EXISTS internal_notes text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_partnership_request_internal_notes_len') THEN
    ALTER TABLE partnership_request
      ADD CONSTRAINT ck_partnership_request_internal_notes_len
      CHECK (internal_notes IS NULL OR length(internal_notes) <= 5000);
  END IF;
END $$;

-- ─── 5. The status vocabulary ───────────────────────────────────────────────
-- Translate first, then re-constrain. Both orders "work" on an empty table and
-- only this one works on a populated one.
ALTER TABLE partnership_request DROP CONSTRAINT IF EXISTS partnership_request_status_check;
ALTER TABLE partnership_request DROP CONSTRAINT IF EXISTS ck_partnership_request_status;

UPDATE partnership_request SET status = 'IN_REVIEW' WHERE status = 'REVIEWING';
UPDATE partnership_request SET status = 'APPROVED'  WHERE status = 'ACCEPTED';
UPDATE partnership_request SET status = 'REJECTED'  WHERE status = 'DECLINED';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_partnership_request_status') THEN
    ALTER TABLE partnership_request
      ADD CONSTRAINT ck_partnership_request_status
      CHECK (status IN ('NEW','IN_REVIEW','APPROVED','REJECTED'));
  END IF;
END $$;

-- ─── 6. The decision ────────────────────────────────────────────────────────
ALTER TABLE partnership_request ADD COLUMN IF NOT EXISTS reviewed_at          timestamptz;
ALTER TABLE partnership_request ADD COLUMN IF NOT EXISTS reviewed_by_user_id  uuid REFERENCES app_user(user_id);
ALTER TABLE partnership_request ADD COLUMN IF NOT EXISTS decision_reason      text;

-- A rejection with no reason tells the next person nothing, and "we told them
-- no" with no recorded why is the state a re-application arrives into. 0685
-- enforces the same rule for a rejected campaign and for the same reason: the
-- legacy asks for a reason in the BROWSER, which means its API accepts one
-- without.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_partnership_request_rejection_reason') THEN
    ALTER TABLE partnership_request
      ADD CONSTRAINT ck_partnership_request_rejection_reason
      CHECK (status <> 'REJECTED'
             OR (decision_reason IS NOT NULL AND length(btrim(decision_reason)) > 0));
  END IF;
END $$;

-- ─── 7. The supplier back-link ──────────────────────────────────────────────
-- Nullable, and it stays null for an agency partnership: only a VENDOR_
-- REGISTRATION becomes a supplier. UNIQUE so one application cannot be
-- approved into two suppliers by two concurrent clicks — the service also
-- checks, but the index is what makes the check true under concurrency.
ALTER TABLE partnership_request ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES supplier_master(supplier_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_partnership_request_supplier
  ON partnership_request(supplier_id) WHERE supplier_id IS NOT NULL;

-- ─── 8. updated_at ──────────────────────────────────────────────────────────
-- The table only ever had created_at (the legacy calls it submission_datetime),
-- so "when was this last touched" was unanswerable and a review that changed
-- only the notes left no trace on the row at all.
ALTER TABLE partnership_request ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
UPDATE partnership_request SET updated_at = created_at WHERE updated_at < created_at;

CREATE OR REPLACE TRIGGER trg_partnership_request_updated
  BEFORE UPDATE ON partnership_request
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 9. Indexes ─────────────────────────────────────────────────────────────
-- The register filters on status and type, searches company / country /
-- contact / email, orders by submission date, and asks the memberships
-- question above.
CREATE INDEX IF NOT EXISTS ix_partnership_request_status     ON partnership_request(status);
CREATE INDEX IF NOT EXISTS ix_partnership_request_type       ON partnership_request(proposal_type);
CREATE INDEX IF NOT EXISTS ix_partnership_request_created_at ON partnership_request(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_partnership_request_channel    ON partnership_request(intake_channel);
CREATE INDEX IF NOT EXISTS ix_partnership_request_country
  ON partnership_request(country_of_origin) WHERE country_of_origin IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_partnership_request_networks
  ON partnership_request USING gin (network_memberships);

-- ─── 10. Event types ────────────────────────────────────────────────────────
-- `event_log.event_type_key` carries no FK, so an unregistered key logs happily
-- and is then invisible to the workflow designer and the notification rules.
-- The module has emitted partnership_request.created and .reviewed since it was
-- written and neither was ever declared, so a tenant could not bind an alert to
-- "a new agent applied" at all.
--
-- `partnership_request.approved` is marked approvable: approving a vendor is
-- the point at which a stranger becomes a party this company can transact with,
-- and a tenant that wants a second signature on that should be able to bind one
-- without a migration.
INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
 ('partnership_request.created',           'MOD-25','Partnership application received',    false,false),
 ('partnership_request.updated',           'MOD-25','Partnership application updated',     false,false),
 ('partnership_request.in_review',         'MOD-25','Partnership application under review',false,false),
 ('partnership_request.approved',          'MOD-25','Partnership application approved',    false,true),
 ('partnership_request.rejected',          'MOD-25','Partnership application rejected',    false,false),
 ('partnership_request.document_attached', 'MOD-25','Corporate profile attached',          false,false),
 ('partnership_request.supplier_drafted',  'MOD-25','Draft supplier created from approved vendor', false,false)
ON CONFLICT (key) DO NOTHING;

-- DOWN
-- READ BEFORE RUNNING — partnership_request holds applications that exist
-- nowhere else (the website posts into it; there is no second copy), and
-- supplier_id is the only record of which supplier came from which application:
--   SELECT COUNT(*) FROM partnership_request;
--   SELECT COUNT(*) FROM partnership_request WHERE supplier_id IS NOT NULL;
-- Dropping the status constraint is safe; reverting the VALUES is not — the
-- rows translated in section 5 cannot be told apart from rows that were always
-- spelled the new way.
--
-- DROP INDEX IF EXISTS ix_partnership_request_networks;
-- DROP INDEX IF EXISTS ix_partnership_request_country;
-- DROP INDEX IF EXISTS ix_partnership_request_channel;
-- DROP INDEX IF EXISTS ix_partnership_request_created_at;
-- DROP INDEX IF EXISTS ix_partnership_request_type;
-- DROP INDEX IF EXISTS ix_partnership_request_status;
-- DROP TRIGGER IF EXISTS trg_partnership_request_updated ON partnership_request;
-- ALTER TABLE partnership_request DROP CONSTRAINT IF EXISTS ck_partnership_request_rejection_reason;
-- ALTER TABLE partnership_request DROP CONSTRAINT IF EXISTS ck_partnership_request_status;
-- ALTER TABLE partnership_request DROP CONSTRAINT IF EXISTS ck_partnership_request_internal_notes_len;
-- ALTER TABLE partnership_request DROP CONSTRAINT IF EXISTS ck_partnership_request_intake_channel;
-- ALTER TABLE partnership_request DROP CONSTRAINT IF EXISTS ck_partnership_request_proposal_type;
-- ALTER TABLE partnership_request DROP CONSTRAINT IF EXISTS ck_partnership_request_memberships_array;
-- DROP INDEX IF EXISTS ux_partnership_request_supplier;
-- ALTER TABLE partnership_request DROP COLUMN IF EXISTS updated_at;
-- ALTER TABLE partnership_request DROP COLUMN IF EXISTS supplier_id;
-- ALTER TABLE partnership_request DROP COLUMN IF EXISTS decision_reason;
-- ALTER TABLE partnership_request DROP COLUMN IF EXISTS reviewed_by_user_id;
-- ALTER TABLE partnership_request DROP COLUMN IF EXISTS reviewed_at;
-- ALTER TABLE partnership_request DROP COLUMN IF EXISTS internal_notes;
-- ALTER TABLE partnership_request DROP COLUMN IF EXISTS corporate_profile_vault_id;
-- ALTER TABLE partnership_request DROP COLUMN IF EXISTS intake_channel;
-- ALTER TABLE partnership_request DROP COLUMN IF EXISTS proposal_type;
-- ALTER TABLE partnership_request DROP COLUMN IF EXISTS network_memberships;
-- ALTER TABLE partnership_request DROP COLUMN IF EXISTS website;
-- ALTER TABLE partnership_request DROP COLUMN IF EXISTS contact_phone;
-- ALTER TABLE partnership_request DROP COLUMN IF EXISTS contact_title;
-- ALTER TABLE partnership_request DROP COLUMN IF EXISTS country_of_origin;
