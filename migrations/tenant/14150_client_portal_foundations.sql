-- ============================================================================
-- TENANT DB — 14150 Client portal foundations (portal redesign, PR 1).
--
-- The client portal was one long page of panels, and the pieces a client
-- actually needs to DO something were missing: a way to stay signed in on
-- their own phone, a way to send us the document we are waiting for, and a way
-- to tell us they have paid. This migration is the data those three need, plus
-- the team scope that lets a client's admin invite their own colleagues.
--
-- ── 1. SIGN-IN THAT FEELS LIKE AN APP ───────────────────────────────────────
--
-- `portal_session` is the trusted-device session. A client who ticks "keep me
-- signed in" gets a refresh token (only its SHA-256 is stored) that lives 30
-- days and ROTATES on every use; `prev_refresh_hash` + `rotated_at` are the
-- grace window for two tabs refreshing at once — the race doc/AUTH_SESSIONS.md
-- calls Trap 2 — so a legitimate race is not mistaken for token theft. A
-- session without the tick has no row at all: the 2-hour access token in
-- sessionStorage is the whole session, exactly as before.
--
-- `portal_login_code` is the emailed six-digit code, so a client never has to
-- remember a password. Hashed, ten minutes, five attempts, single use.
--
-- `portal_passkey` is Face ID / fingerprint for portal users. It is a SEPARATE
-- table from staff `webauthn_credential` (13797) on purpose: that table's
-- `user_id` means an app_user, and a portal user must never be resolvable as
-- one — the whole portal auth tier exists to keep the two apart.
--
-- All three hang off `portal_user` (0460), which lives in the identity (live)
-- schema like app_user. They are created in every schema because tenant
-- migrations apply to both; only the identity copy is ever read.
--
-- ── 2. A CLIENT'S OWN TEAM ─────────────────────────────────────────────────
--
-- `portal_access.access_scope` — ALL, OPERATIONS (shipments + documents) or
-- BILLING (invoices + payments). `is_client_admin` marks who may invite
-- colleagues. Every existing grant keeps ALL and gains no admin rights: nothing
-- a client can see today changes until someone decides it should.
--
-- ── 3. WHAT WE ARE WAITING FOR FROM THE CLIENT ─────────────────────────────
--
-- `client_request` is one row per thing we need: a document or a piece of
-- information, for the account or for one shipment. Three sources:
--
--   RULE    materialised from `document_requirement` (10747) — the KYC papers
--           every client owes and the documents each service type needs. One
--           row per (client, file, doc type), enforced by the partial unique
--           index, so re-reading the list never duplicates it.
--   STAFF   somebody asked, with a note and a due date.
--   CLIENT  the client sent something nobody asked for ("share a document").
--
-- A row moves OPEN → SUBMITTED (the client answered) → ACCEPTED or REJECTED
-- (with a reason the client reads). A rejected row goes back to SUBMITTED when
-- they send a better scan. The uploaded file itself is an ordinary vault row
-- (status PENDING until accepted), so every existing vault reader keeps working.
--
-- ── 4. "I HAVE PAID" ───────────────────────────────────────────────────────
--
-- `payment_proof` is a CLAIM, not a payment: the client's receipt photo, the
-- amount, the method and the invoices it covers. Nothing here touches the
-- ledger. Finance confirms it (which drafts a `payment_receipt` through the
-- existing receivables service, so the posting keeps its own approval) or
-- rejects it with a reason. Same rule as mail's OCR staging table: a machine or
-- a client may PROPOSE a money record; only the module that owns money writes one.
--
-- ── 5. THE DOCUMENT TYPES THE REQUIREMENTS NAME ────────────────────────────
--
-- 10747 seeded requirements for RCCM, NIU, ID_SIGNATORY, BANK_DETAILS and the
-- per-shipment papers, but only PACKING_LIST existed in the registry (0669), so
-- the rest could never be satisfied by any upload and never had a name to show.
-- They are added here. `BL_AWB` is not: the registry already splits it into BL
-- and MAWB, and the portal treats either as satisfying it.
-- ============================================================================

-- ── 1. Trusted-device sessions, email codes, passkeys ───────────────────────

CREATE TABLE IF NOT EXISTS portal_session (
  portal_session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id    uuid NOT NULL REFERENCES portal_user(portal_user_id) ON DELETE CASCADE,
  refresh_hash      text NOT NULL,
  prev_refresh_hash text,
  rotated_at        timestamptz,
  method            text NOT NULL DEFAULT 'password'
                      CHECK (method IN ('password','code','passkey','invite')),
  device_label      text,
  user_agent        text,
  ip                text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_portal_session_refresh ON portal_session (refresh_hash);
CREATE INDEX IF NOT EXISTS ix_portal_session_prev ON portal_session (prev_refresh_hash)
  WHERE prev_refresh_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_portal_session_user ON portal_session (portal_user_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS portal_login_code (
  portal_login_code_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_user_id  uuid NOT NULL REFERENCES portal_user(portal_user_id) ON DELETE CASCADE,
  code_hash       text NOT NULL,
  attempts        integer NOT NULL DEFAULT 0,
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  requested_ip    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_portal_login_code_user
  ON portal_login_code (portal_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS portal_passkey (
  credential_id   text PRIMARY KEY,
  portal_user_id  uuid NOT NULL REFERENCES portal_user(portal_user_id) ON DELETE CASCADE,
  public_key      text NOT NULL,
  counter         bigint NOT NULL DEFAULT 0,
  transports      text[],
  device_type     text,
  backed_up       boolean NOT NULL DEFAULT false,
  aaguid          text,
  label           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz
);
CREATE INDEX IF NOT EXISTS ix_portal_passkey_user ON portal_passkey (portal_user_id);

-- ── 2. A client's own team ──────────────────────────────────────────────────

-- access_scope is one of ALL / OPERATIONS / BILLING. That rule is enforced by
-- the validators (portal.validator `grant`/`team`, portal_auth.validator
-- `teamInvite`/`teamUpdate`) and by portal_client.service's SCOPES — NOT by a
-- CHECK here: portal_access predates 13791, and a constraint added to an
-- existing table above it breaks provisioning a fresh tenant's sandbox
-- (tests/unit/migration-constraint-ordering.test.js has the whole story).
ALTER TABLE portal_access
  ADD COLUMN IF NOT EXISTS access_scope     text NOT NULL DEFAULT 'ALL',
  ADD COLUMN IF NOT EXISTS is_client_admin  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS invited_by_email citext;

-- ── 3. What we are waiting for from the client ──────────────────────────────

CREATE TABLE IF NOT EXISTS client_request (
  client_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES client_master(client_id) ON DELETE CASCADE,
  dossier_id        uuid REFERENCES dossier(dossier_id) ON DELETE CASCADE,
  source            text NOT NULL DEFAULT 'STAFF' CHECK (source IN ('RULE','STAFF','CLIENT')),
  kind              text NOT NULL DEFAULT 'DOCUMENT' CHECK (kind IN ('DOCUMENT','INFO')),
  doc_type_code     text,
  title             text,
  note              text,
  due_on            date,
  status            text NOT NULL DEFAULT 'OPEN'
                      CHECK (status IN ('OPEN','SUBMITTED','ACCEPTED','REJECTED','CANCELLED')),
  answer_text       text,
  answer_doc_id     uuid REFERENCES document_vault(doc_id),
  answered_by_email citext,
  answered_at       timestamptz,
  review_note       text,
  reviewed_by       uuid REFERENCES app_user(user_id),
  reviewed_at       timestamptz,
  created_by        uuid REFERENCES app_user(user_id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_client_request_client ON client_request (client_id, status);
CREATE INDEX IF NOT EXISTS ix_client_request_dossier ON client_request (dossier_id)
  WHERE dossier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_client_request_review ON client_request (created_at)
  WHERE status = 'SUBMITTED';
-- One materialised requirement per client, file and document type.
CREATE UNIQUE INDEX IF NOT EXISTS ux_client_request_rule
  ON client_request (client_id, COALESCE(dossier_id, '00000000-0000-0000-0000-000000000000'::uuid), doc_type_code)
  WHERE source = 'RULE';
CREATE OR REPLACE TRIGGER trg_client_request_updated
  BEFORE UPDATE ON client_request FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 4. "I have paid" ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payment_proof (
  payment_proof_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES client_master(client_id) ON DELETE CASCADE,
  amount             numeric(18,2) NOT NULL CHECK (amount > 0),
  currency           char(3) NOT NULL DEFAULT 'XAF',
  method             text NOT NULL CHECK (method IN ('BANK','MOBILE_MONEY','CASH','CHEQUE')),
  -- Which mobile wallet or bank, when the method alone does not say:
  -- 'MTN_MOMO' | 'ORANGE_MONEY' | a bank's name. Display only.
  provider           text,
  paid_on            date NOT NULL,
  reference          text,
  note               text,
  -- An advance for a shipment that has no invoice yet (customs duties paid
  -- ahead, typically): no allocation, but the file it was for.
  dossier_id         uuid REFERENCES dossier(dossier_id),
  doc_id             uuid REFERENCES document_vault(doc_id),
  status             text NOT NULL DEFAULT 'SUBMITTED'
                       CHECK (status IN ('SUBMITTED','CONFIRMED','REJECTED')),
  submitted_by_email citext,
  review_note        text,
  reviewed_by        uuid REFERENCES app_user(user_id),
  reviewed_at        timestamptz,
  receipt_id         uuid REFERENCES payment_receipt(receipt_id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_payment_proof_client ON payment_proof (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_payment_proof_open ON payment_proof (created_at)
  WHERE status = 'SUBMITTED';
CREATE OR REPLACE TRIGGER trg_payment_proof_updated
  BEFORE UPDATE ON payment_proof FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS payment_proof_allocation (
  payment_proof_id uuid NOT NULL REFERENCES payment_proof(payment_proof_id) ON DELETE CASCADE,
  invoice_id       uuid NOT NULL REFERENCES invoice(invoice_id),
  amount           numeric(18,2) NOT NULL CHECK (amount > 0),
  PRIMARY KEY (payment_proof_id, invoice_id)
);
CREATE INDEX IF NOT EXISTS ix_payment_proof_alloc_invoice ON payment_proof_allocation (invoice_id);

-- ── 5. The document types the requirements name ─────────────────────────────

INSERT INTO dictionary_ref (kind, code, name_fr, name_en, extra, sort_order, is_system) VALUES
  ('DOCUMENT_TYPE','RCCM','Registre du commerce (RCCM)','Trade register (RCCM)',
     '{"client_scoped":true,"reusable":true}'::jsonb,100,true),
  ('DOCUMENT_TYPE','NIU','Numéro d''identifiant unique (NIU)','Taxpayer number (NIU)',
     '{"client_scoped":true,"reusable":true}'::jsonb,110,true),
  ('DOCUMENT_TYPE','ID_SIGNATORY','Pièce d''identité du signataire','Signatory''s ID',
     '{"client_scoped":true,"reusable":true}'::jsonb,120,true),
  ('DOCUMENT_TYPE','BANK_DETAILS','Relevé d''identité bancaire','Bank details',
     '{"client_scoped":true,"reusable":true}'::jsonb,130,true),
  ('DOCUMENT_TYPE','COMMERCIAL_INVOICE','Facture commerciale','Commercial invoice','{}'::jsonb,140,true),
  ('DOCUMENT_TYPE','CUSTOMS_DECLARATION','Déclaration en douane','Customs declaration','{}'::jsonb,150,true),
  ('DOCUMENT_TYPE','CERTIFICATE_OF_ORIGIN','Certificat d''origine','Certificate of origin','{}'::jsonb,160,true),
  ('DOCUMENT_TYPE','EXPORT_DECLARATION','Déclaration d''exportation','Export declaration','{}'::jsonb,170,true),
  ('DOCUMENT_TYPE','PAYMENT_PROOF','Preuve de paiement','Proof of payment','{}'::jsonb,180,true)
ON CONFLICT (kind, code) DO NOTHING;

-- DOWN
-- Additive, apart from the rows below, which are only deleted while nothing
-- references them. The tables carry client-submitted files and payment claims.
--
--   DROP TABLE IF EXISTS payment_proof_allocation;
--   -- DESTRUCTIVE: loses every proof of payment a client has submitted.
--   DROP TABLE IF EXISTS payment_proof;
--   -- DESTRUCTIVE: loses every document request and the client's answers.
--   DROP TABLE IF EXISTS client_request;
--   ALTER TABLE portal_access
--     DROP COLUMN IF EXISTS invited_by_email,
--     DROP COLUMN IF EXISTS is_client_admin,
--     DROP COLUMN IF EXISTS access_scope;
--   DROP TABLE IF EXISTS portal_passkey;
--   DROP TABLE IF EXISTS portal_login_code;
--   DROP TABLE IF EXISTS portal_session;
--   DELETE FROM dictionary_ref r
--    WHERE r.kind = 'DOCUMENT_TYPE' AND r.is_system
--      AND r.code IN ('RCCM','NIU','ID_SIGNATORY','BANK_DETAILS','COMMERCIAL_INVOICE',
--                     'CUSTOMS_DECLARATION','CERTIFICATE_OF_ORIGIN','EXPORT_DECLARATION',
--                     'PAYMENT_PROOF')
--      AND NOT EXISTS (SELECT 1 FROM document_vault v WHERE v.doc_type_ref_id = r.ref_id);
