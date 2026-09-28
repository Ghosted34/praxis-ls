-- ============================================================================
-- TENANT DB — 14160 The invoice's supporting documents, shared with the client
-- (client portal redesign, PR 2).
--
-- A final invoice bills disbursements at cost, and the client is owed the proof
-- behind each of them: the port's receipt, the carrier's demurrage invoice, the
-- customs payment slip. Those documents already exist — the cash request ticks
-- the lines that owe a receipt (`cash_request_line.justification_required`) and
-- the file's reconciliation holds what was uploaded against each line
-- (`dossier_reconciliation_document`, 13801). What did not exist was a way to
-- hand them to the client: somebody downloaded each one and attached it to an
-- email, one at a time.
--
-- `invoice_client_bundle` is that hand-over, made once: finance opens the
-- invoice, sees every supporting document the file holds (the ones owed a
-- receipt already ticked), unticks anything internal, and publishes. The
-- client's portal then shows the invoice with its documents and a single
-- "download all" that returns them as one ZIP.
--
-- ── WHY A BUNDLE AND NOT A FLAG ON THE VAULT ROW ────────────────────────────
--
-- A supporting document is evidence first. Flipping it client-visible in the
-- vault would change what it IS for every other reader, and a receipt can
-- justify lines on more than one invoice. The bundle is a grant for one
-- invoice: the portal reads membership, the vault row is untouched, and
-- withdrawing the bundle takes nothing out of the file.
--
-- `position` is the order the client sees and the ZIP is numbered in; `label`
-- is the line the document justifies, copied at publication so the client's
-- copy reads the same even if the costing line is renamed later.
--
-- Both tables are NEW, so their constraints are free of the 13791 hazard
-- (tests/unit/migration-constraint-ordering.test.js).
-- ============================================================================

CREATE TABLE IF NOT EXISTS invoice_client_bundle (
  bundle_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    uuid NOT NULL REFERENCES invoice(invoice_id) ON DELETE CASCADE,
  client_id     uuid NOT NULL,
  dossier_id    uuid,
  published_at  timestamptz NOT NULL DEFAULT now(),
  published_by  uuid REFERENCES app_user(user_id),
  CONSTRAINT uq_invoice_client_bundle_invoice UNIQUE (invoice_id)
);
CREATE INDEX IF NOT EXISTS ix_invoice_client_bundle_client ON invoice_client_bundle (client_id);

CREATE TABLE IF NOT EXISTS invoice_client_bundle_item (
  bundle_id  uuid NOT NULL REFERENCES invoice_client_bundle(bundle_id) ON DELETE CASCADE,
  doc_id     uuid NOT NULL REFERENCES document_vault(doc_id),
  position   integer NOT NULL,
  label      text,
  CONSTRAINT pk_invoice_client_bundle_item PRIMARY KEY (bundle_id, doc_id)
);
CREATE INDEX IF NOT EXISTS ix_invoice_client_bundle_item_doc ON invoice_client_bundle_item (doc_id);

-- DOWN
-- Additive. Dropping the tables withdraws every published bundle from the
-- portal; the documents themselves stay in the vault and on the file.
--
--   -- DESTRUCTIVE: clients lose the supporting documents shared with them.
--   DROP TABLE IF EXISTS invoice_client_bundle_item;
--   DROP TABLE IF EXISTS invoice_client_bundle;
