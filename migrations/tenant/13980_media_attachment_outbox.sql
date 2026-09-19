-- ============================================================================
-- TENANT — 13970 The media-attachment outbox (PR-07, CE-11 + CE-25).
--
-- ── WHY THIS TABLE EXISTS ──────────────────────────────────────────────────
--
-- Two workflows in this tenant write BYTES first and the POINTER TO THEM
-- second, with nothing durable in between:
--
--   · a website slot upload (site_settings.media.upload) stores the vault
--     object and its derivatives, and only THEN opens the transaction that
--     scopes it public, points the owner column at it and archives the
--     document it replaced. A failure after the bytes — the transaction
--     dies, the process is restarted, the pool drops the connection — leaves
--     an unowned vault object that nothing will ever reference again, while
--     the previous cover keeps serving as if nothing happened. Nobody is
--     told, and the storage bill grows (CE-25).
--   · a document scan is three requests: create the entity_document row,
--     upload the file to the vault, PATCH vault_id. If the upload lands and
--     the PATCH does not, the bytes exist, the record exists, and the LINK
--     does not — a state the register renders as "no scan yet" (PENDING),
--     which is indistinguishable from "nobody ever picked a file" (CE-11).
--
-- This table is the DURABLE NAMING of those in-between states. One row per
-- attachment attempt, and the state says exactly what exists:
--
--   INTENT         the owner row exists; bytes not yet stored; no link.
--   BYTES_STORED   the vault object exists (vault_doc_id names it); no link.
--   LINKED         record, bytes and link all exist. Terminal success.
--   FAILED         an error was caught; vault_doc_id still says whether the
--                  bytes exist. Surfaced in the Story tab until resolved.
--   RECONCILED     the reconciliation completed the link, or swept the
--                  orphaned bytes and archived the vault row. Terminal.
--
-- The state column is BOOKKEEPING, not truth. Truth stays where it already
-- was — the owner columns, document_vault.entity_ref and storage itself —
-- and the reconciliation job (jobs/handlers/media-reconcile.js) repairs from
-- that ground truth, then updates these rows to match. A crash between the
-- bytes and the bookkeeping therefore cannot lie for longer than one sweep.
--
-- ── WHY AN OUTBOX RATHER THAN "JUST WRAP IT IN ONE TRANSACTION" ────────────
--
-- The bytes live in object storage, which has no seat at the transaction.
-- Making the row-before-bytes / bytes-before-pointer windows honest is
-- exactly what an outbox is for: the intent is committed FIRST, so every
-- later failure leaves a row that names what exists instead of a silence.
--
-- ── WHY owner_table IS A CHECK AND NOT A JOIN ──────────────────────────────
--
-- The owners live in five different tables (four website slots plus the three
-- document registers). A polymorphic FK is impossible and a cross-table view
-- would be read-coupled to all seven. The CHECK below is the closed set this
-- module's code writes; reconciliation re-derives the real owner join from
-- the same list, so a value that is not in code cannot be in the table.
--
-- ── WHY THERE IS NO CHECK ON state TRANSITIONS ─────────────────────────────
--
-- Transitions are enforced by attachment_outbox.service.js, which is the only
-- writer. A CHECK cannot express "FAILED may carry vault_doc_id or not" — the
-- one fact this table exists to record — without encoding the whole machine
-- twice.
--
-- Idempotent (safe to re-run), additive (nothing dropped).
-- ============================================================================

CREATE TABLE IF NOT EXISTS media_attachment (
  attachment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SITE_MEDIA: a website slot upload (cover, portrait, mark).
  -- DOCUMENT_SCAN: a vault upload that names a document row in entity_ref.
  kind       text NOT NULL CHECK (kind IN ('SITE_MEDIA', 'DOCUMENT_SCAN')),
  owner_table text NOT NULL CHECK (owner_table IN (
    'corporate_entity', 'site_leader', 'site_partner', 'site_credential',
    'entity_document', 'client_document', 'supplier_document')),
  owner_id   uuid NOT NULL,
  -- SITE_MEDIA only: which slot the operator was uploading into.
  slot       text,
  -- The vault object once its bytes exist. NULL means "no bytes (yet)".
  vault_doc_id uuid REFERENCES document_vault(doc_id) ON DELETE SET NULL,
  state      text NOT NULL DEFAULT 'INTENT'
    CHECK (state IN ('INTENT', 'BYTES_STORED', 'LINKED', 'FAILED', 'RECONCILED')),
  attempts   integer NOT NULL DEFAULT 0,
  last_error text,
  -- The derivative storage keys actually written beside the master, so the
  -- sweep can delete exactly what the upload wrote even though the vault
  -- row's own public_media_variants never landed (that UPDATE is inside the
  -- transaction that failed — which is the whole point of this table).
  variant_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_media_attachment_state
  ON media_attachment(state, created_at);
CREATE INDEX IF NOT EXISTS ix_media_attachment_owner
  ON media_attachment(owner_table, owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_media_attachment_vault
  ON media_attachment(vault_doc_id);

COMMENT ON TABLE media_attachment IS
  'Durable outbox for media/document attachment attempts (PR-07, CE-11/CE-25). One row per attempt at putting bytes behind a record. The state names whether the record, the bytes and the link each exist, so no failure can read as success. Ground truth stays in the owner columns and document_vault; the reconciliation job (media-reconcile) repairs from ground truth and then updates these rows to match.';
COMMENT ON COLUMN media_attachment.vault_doc_id IS
  'The document_vault row holding the bytes, once they exist. NULL in INTENT (nothing stored yet) and in a FAILED attempt that died before storage — the distinction is the point of the column.';
COMMENT ON COLUMN media_attachment.variant_keys IS
  'Storage keys of the derivatives actually written beside the master key during a SITE_MEDIA attempt. Recorded before the owner-pointer transaction, because that transaction is the one whose failure orphans them (CE-25).';
COMMENT ON COLUMN media_attachment.last_error IS
  'The message of the error that parked this attempt. Shown verbatim in the Story tab so the operator can tell a wrong file from a dead network.';

-- ============================================================================
-- VERIFY
--   SELECT count(*) FROM media_attachment;                     -- expect 0
--   (Backfill: none. Every row this table will ever hold is written by the
--    code that ships with it; historical orphans are found by the
--    reconciliation from ground truth, not reconstructed here.)
-- ============================================================================

-- DOWN
-- DROP INDEX IF EXISTS ix_media_attachment_vault;
-- DROP INDEX IF EXISTS ix_media_attachment_owner;
-- DROP INDEX IF EXISTS ix_media_attachment_state;
-- DROP TABLE IF EXISTS media_attachment;
