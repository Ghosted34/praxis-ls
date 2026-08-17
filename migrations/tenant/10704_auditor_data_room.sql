-- ============================================================================
-- TENANT DB — 10704 Auditor data room (PRD §5.2 "data room for document
-- requests/answers").
--
-- The Audit Terminal already exposes time-boxed read-only statements and the
-- immutable ledger. What it cannot do is ASK for a document and receive it:
-- the auditor's open questions ("please provide the signed transit order for
-- dossier X") had no in-system channel, so they went to email and the
-- evidence trail lived nowhere.
--
-- A room is a request thread keyed to the auditor's portal identity
-- (subject_email — the same address the AUDITOR grant in portal_access is
-- keyed on, so an expired/revoked grant also cuts off every room). Staff
-- (MOD-67) attach vault documents; the auditor sees them and can download
-- them. Attachments are document_vault rows: the vault's existing content
-- hash + QR verification and audit trail apply to shared evidence as-is.
-- ============================================================================

CREATE TABLE auditor_data_room (
  room_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_email citext NOT NULL,                 -- auditor's portal identity
  request_note  text NOT NULL CHECK (length(btrim(request_note)) BETWEEN 1 AND 2000),
  status        text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ANSWERED')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  answered_at   timestamptz,
  answered_by   uuid REFERENCES app_user(user_id)
);

CREATE INDEX ix_auditor_room_email ON auditor_data_room(subject_email, created_at DESC);

CREATE TABLE auditor_data_room_doc (
  room_id   uuid NOT NULL REFERENCES auditor_data_room(room_id) ON DELETE CASCADE,
  doc_id    uuid NOT NULL REFERENCES document_vault(doc_id),
  added_by  uuid REFERENCES app_user(user_id),
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, doc_id)
);

-- DOWN
--   -- DESTRUCTIVE: drops the shared documents join first (FK order), then the rooms.
--   DROP TABLE IF EXISTS auditor_data_room_doc;
--   DROP TABLE IF EXISTS auditor_data_room;
