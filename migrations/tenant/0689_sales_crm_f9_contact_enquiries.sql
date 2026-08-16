-- ============================================================================
-- TENANT DB — 0689 Sales & CRM F9: the contact enquiry desk.
--
-- The vertical slice for SALES_CRM_FEATURES.md#F9. Messages from the website's
-- contact form arrive, get classified, get answered, and either close or become
-- a lead (or, when they are a partnership offer, a partnership request).
--
-- It owns:
--   1. contact_enquiry hardening — enquiry_type, company_name, internal_notes,
--      the RESPONDED state, response bookkeeping and updated_at.
--   2. contact_enquiry_response — one row per reply attempt, with its delivery
--      outcome.
--
-- ── THE ARCHITECTURAL CORRECTION THAT DEFINES THIS FEATURE ──────────────────
--
-- `contact_enquiry.status` currently reads NEW / TRIAGED / CLOSED. TRIAGED is
-- not a state of the correspondence — it is the fact that a lead was raised
-- from the message. Two different concerns in one column, which is the mistake
-- Block A rule 2 names and F6 already corrected once for quote_request. The
-- damage here is concrete and is the reason F9 exists: with TRIAGED occupying
-- the column there is nowhere to record that somebody REPLIED, so the KPI row
-- the desk is supposed to show cannot be computed at all.
--
-- So, after this migration:
--
--   status              the correspondence lifecycle, and nothing else:
--                       NEW -> READ -> RESPONDED -> CLOSED.
--   lead_id             the single source of truth for "became a lead".
--   partnership_request_id   the single source of truth for "became a
--                       partnership request".
--
-- "Was this triaged" is one query — `lead_id IS NOT NULL OR
-- partnership_request_id IS NOT NULL` — never a status value, and never
-- computed a second way somewhere else. Triage no longer moves the status at
-- all: an enquiry that produced a lead still has to be answered and closed like
-- any other, and under the old shape it silently left the unread pile without
-- anyone replying to the person who wrote in.
--
-- ── AND THE TILES PARTITION THE SET ─────────────────────────────────────────
--
-- The legacy renders four tiles — Total, New (unread), Responded, Closed — over
-- four statuses NEW / READ / RESPONDED / CLOSED. READ belongs to no tile, so an
-- enquiry that has been opened and not yet answered is counted into Total and
-- displayed nowhere; the three sub-tiles do not add up to the first one. That
-- is the same class of defect as F6's "converted: 0 against 26 rows".
--
-- F9's definition of done is "every enquiry falls into exactly one KPI tile", so
-- the row here is the legacy's four tiles PLUS a Read tile: TOTAL, NEW, READ,
-- RESPONDED, CLOSED. Four counters that partition, and TOTAL as their sum. The
-- tiles are derived from the status list in inbound_intake.rules.js rather than
-- hand-listed, and assertPartitions() proves the sum before any response leaves
-- the API — a fifth status added later either lands in a tile or fails the test.
--
-- ── REPLIES ARE ROWS, NOT A COLUMN ──────────────────────────────────────────
--
-- A reply is sent through the mail engine (src/services/email.service.js), and
-- a send can fail. A single `response_text` column could not express "we tried
-- to answer this and the SMTP host refused", which would leave the desk showing
-- an enquiry as merely READ with no trace of the attempt — the operator retries
-- blind. contact_enquiry_response carries one row per attempt with its own
-- send_status, so a failure is visible and a second reply does not erase the
-- first. `responded_at` / `responded_by_user_id` are denormalised onto the
-- enquiry for the register, and are only ever written alongside a SENT row.
--
-- Idempotent: every CREATE guarded with IF NOT EXISTS, every ALTER guarded with
-- ADD COLUMN IF NOT EXISTS, every constraint wrapped in a catalog check
-- (per doc/DB_ARCHITECTURE.md §8.2).
-- ============================================================================

-- ─── 1. contact_enquiry hardening ───────────────────────────────────────────

-- The register filters on this. Defaulted rather than nullable: a message with
-- no type is invisible to every filter chip, which is how the legacy's own
-- register loses rows.
ALTER TABLE contact_enquiry ADD COLUMN IF NOT EXISTS enquiry_type   text NOT NULL DEFAULT 'GENERAL_ENQUIRY';
ALTER TABLE contact_enquiry ADD COLUMN IF NOT EXISTS company_name   text;
ALTER TABLE contact_enquiry ADD COLUMN IF NOT EXISTS internal_notes text;

-- Response bookkeeping, denormalised for the list. Written only by the respond
-- path, and only when a send actually succeeded.
ALTER TABLE contact_enquiry ADD COLUMN IF NOT EXISTS responded_at         timestamptz;
ALTER TABLE contact_enquiry ADD COLUMN IF NOT EXISTS responded_by_user_id uuid REFERENCES app_user(user_id);

-- The partnership register an enquiry was routed into. See the header: this is
-- the source of truth for "became a partnership request", exactly as `lead_id`
-- is for "became a lead". F10 owns partnership_request; F9 owns the link,
-- because the link lives on F9's table.
ALTER TABLE contact_enquiry ADD COLUMN IF NOT EXISTS partnership_request_id uuid
  REFERENCES partnership_request(partnership_request_id);

-- The table shipped with created_at only, so "when did this last change" was
-- unanswerable and the set_updated_at() trigger every other table carries had
-- nothing to write to.
ALTER TABLE contact_enquiry ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ─── 2. The status column becomes the correspondence lifecycle ──────────────
--
-- Order matters: the rows must be moved off TRIAGED BEFORE the new CHECK is
-- added, or the constraint is rejected on any database that has taken traffic.
--
-- TRIAGED -> READ, not CLOSED. A triaged enquiry has been opened and acted on
-- internally; nobody has necessarily written back to the person. READ is the
-- honest state, and it puts the row in front of an operator instead of filing
-- it away answered.
UPDATE contact_enquiry SET status = 'READ' WHERE status = 'TRIAGED';

DO $$ BEGIN
  -- The 0350 constraint was declared inline, so it carries Postgres's generated
  -- name. Drop both that and our own name, so this file is rerunnable and also
  -- correct on a database provisioned before the rename.
  ALTER TABLE contact_enquiry DROP CONSTRAINT IF EXISTS contact_enquiry_status_check;
  ALTER TABLE contact_enquiry DROP CONSTRAINT IF EXISTS ck_contact_enquiry_status;
  ALTER TABLE contact_enquiry
    ADD CONSTRAINT ck_contact_enquiry_status
    CHECK (status IN ('NEW','READ','RESPONDED','CLOSED'));

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_contact_enquiry_type') THEN
    ALTER TABLE contact_enquiry
      ADD CONSTRAINT ck_contact_enquiry_type
      CHECK (enquiry_type IN ('GENERAL_ENQUIRY','PARTNERSHIP','CAREERS','MEDIA'));
  END IF;

  -- The legacy capped internal_notes at 5000 characters in PHP only, so the
  -- cap held for its own form and for nothing else that wrote to the table.
  -- The validator enforces it too; this is the copy that cannot be bypassed.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_contact_enquiry_notes_len') THEN
    ALTER TABLE contact_enquiry
      ADD CONSTRAINT ck_contact_enquiry_notes_len
      CHECK (internal_notes IS NULL OR char_length(internal_notes) <= 5000);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_contact_enquiry_status     ON contact_enquiry(status);
CREATE INDEX IF NOT EXISTS ix_contact_enquiry_type       ON contact_enquiry(enquiry_type);
CREATE INDEX IF NOT EXISTS ix_contact_enquiry_created_at ON contact_enquiry(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_contact_enquiry_lead       ON contact_enquiry(lead_id)
  WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_contact_enquiry_partnership ON contact_enquiry(partnership_request_id)
  WHERE partnership_request_id IS NOT NULL;

CREATE OR REPLACE TRIGGER trg_contact_enquiry_updated
  BEFORE UPDATE ON contact_enquiry
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 3. contact_enquiry_response — one row per reply attempt ────────────────
--
-- `send_status` is the attempt's own outcome and is NOT the enquiry's status.
-- PENDING is written and COMMITTED before the mail engine is called, so a reply
-- that dies mid-send (process restart, SMTP timeout with no answer) leaves a
-- visible "we tried" row rather than nothing at all. The service then settles it
-- to SENT or FAILED. Only a SENT row moves the enquiry to RESPONDED.
CREATE TABLE IF NOT EXISTS contact_enquiry_response (
  contact_enquiry_response_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_enquiry_id  uuid NOT NULL REFERENCES contact_enquiry(contact_enquiry_id) ON DELETE CASCADE,
  to_address          citext NOT NULL,
  subject             text,
  body                text NOT NULL,
  send_status         text NOT NULL DEFAULT 'PENDING'
                        CHECK (send_status IN ('PENDING','SENT','FAILED')),
  provider_message_id text,
  error               text,
  sent_at             timestamptz,
  created_by_user_id  uuid REFERENCES app_user(user_id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_contact_enquiry_response_enquiry
  ON contact_enquiry_response(contact_enquiry_id, created_at DESC);
-- Partial: the only rows anyone ever sweeps for are the ones that did not land.
CREATE INDEX IF NOT EXISTS ix_contact_enquiry_response_unsettled
  ON contact_enquiry_response(send_status)
  WHERE send_status <> 'SENT';

-- ─── 4. Event types for the enquiry lifecycle ───────────────────────────────
--
-- `event_log.event_type_key` carries no FK, so an unregistered key logs happily
-- and is then invisible to the workflow designer and the notification rules.
-- Declared here so a tenant can bind an alert to "a partnership enquiry arrived
-- and nobody has read it", which is the whole point of the desk.
--
-- `contact_enquiry.responded` is approvable: some tenants want a manager to see
-- what was written back to a client before it counts as answered.
INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
 ('contact_enquiry.created',        'MOD-25','Contact enquiry received',              false,false),
 ('contact_enquiry.read',           'MOD-25','Contact enquiry opened',                false,false),
 ('contact_enquiry.responded',      'MOD-25','Contact enquiry answered',              false,true),
 ('contact_enquiry.response_failed','MOD-25','Contact enquiry reply failed to send',  false,false),
 ('contact_enquiry.closed',         'MOD-25','Contact enquiry closed',                false,false),
 ('contact_enquiry.reopened',       'MOD-25','Contact enquiry reopened',              false,false),
 ('contact_enquiry.updated',        'MOD-25','Contact enquiry updated',               false,false),
 ('contact_enquiry.routed_to_lead', 'MOD-25','Contact enquiry raised a lead',         false,false),
 ('contact_enquiry.routed_to_partnership','MOD-25','Contact enquiry raised a partnership request', false,false)
ON CONFLICT (key) DO NOTHING;

-- DOWN
-- READ BEFORE RUNNING — contact_enquiry holds messages sent by the public that
-- exist nowhere else, and contact_enquiry_response holds what was written back
-- to them:
--   SELECT COUNT(*) FROM contact_enquiry;
--   SELECT COUNT(*) FROM contact_enquiry_response;
--
-- Reversing the status change is NOT a column drop: rows written as READ or
-- RESPONDED have no TRIAGED equivalent, and mapping them back would assert
-- something untrue about whether the person was answered. Restore the old
-- CHECK only after deciding, deliberately, what those rows should say.
--
-- DROP INDEX IF EXISTS ix_contact_enquiry_response_unsettled;
-- DROP INDEX IF EXISTS ix_contact_enquiry_response_enquiry;
-- DROP TABLE IF EXISTS contact_enquiry_response;
-- DROP TRIGGER IF EXISTS trg_contact_enquiry_updated ON contact_enquiry;
-- DROP INDEX IF EXISTS ix_contact_enquiry_partnership;
-- DROP INDEX IF EXISTS ix_contact_enquiry_lead;
-- DROP INDEX IF EXISTS ix_contact_enquiry_created_at;
-- DROP INDEX IF EXISTS ix_contact_enquiry_type;
-- DROP INDEX IF EXISTS ix_contact_enquiry_status;
-- ALTER TABLE contact_enquiry DROP CONSTRAINT IF EXISTS ck_contact_enquiry_notes_len;
-- ALTER TABLE contact_enquiry DROP CONSTRAINT IF EXISTS ck_contact_enquiry_type;
-- ALTER TABLE contact_enquiry DROP CONSTRAINT IF EXISTS ck_contact_enquiry_status;
-- ALTER TABLE contact_enquiry DROP COLUMN IF EXISTS updated_at;
-- ALTER TABLE contact_enquiry DROP COLUMN IF EXISTS partnership_request_id;
-- ALTER TABLE contact_enquiry DROP COLUMN IF EXISTS responded_by_user_id;
-- ALTER TABLE contact_enquiry DROP COLUMN IF EXISTS responded_at;
-- ALTER TABLE contact_enquiry DROP COLUMN IF EXISTS internal_notes;
-- ALTER TABLE contact_enquiry DROP COLUMN IF EXISTS company_name;
-- ALTER TABLE contact_enquiry DROP COLUMN IF EXISTS enquiry_type;
