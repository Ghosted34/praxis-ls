-- ============================================================================
-- TENANT DB — 0661 Shipment details, frozen onto the documents that lock.
--
-- THE PROBLEM. The SSDC projection (0660) is computed live from the dossier.
-- That is right for every screen where the question is "what do we know about
-- this file NOW" — the 360, the operations list, the portal. It is wrong for a
-- document that has been approved, issued or posted.
--
-- A costing is approved on the 3rd citing vessel MSC ARUSHI. The carrier rolls
-- the booking on the 5th and ops updates the file. Reprint the costing on the
-- 10th and, with a live projection, it now cites a vessel that was not known
-- when it was approved — and nothing anywhere says the document changed. For a
-- ledger under OHADA that is not a cosmetic problem: the approved document is a
-- record, and a record that silently rewrites itself is not one.
--
-- SO: SNAPSHOT AT LOCK. When a document reaches a locked state its shipment
-- details are frozen into it, and every later render of THAT document reads the
-- frozen copy. The live projection carries on being live everywhere else, and
-- the 360 flags the difference rather than hiding it.
--
-- WHY A JSONB COPY RATHER THAN A VERSION POINTER. The field-set version pins the
-- DEFINITIONS, not the VALUES — republishing the form is not what changes a
-- vessel name. Only a copy of the rendered projection answers "what did this
-- invoice say when it was issued", which is the question an auditor asks.
--
-- This is the same pattern already used twice in this schema: the actor
-- snapshot on ledger rows (0510) and the display snapshot on document line
-- items (0477). Consistency here is deliberate — one rule, "a locked record
-- keeps what it said", applied everywhere it matters.
--
-- NULLABLE AND ADDITIVE. Every existing locked document keeps a NULL snapshot
-- and falls back to the live projection exactly as it does today; nothing
-- is backfilled, because inventing a snapshot from today's data would be
-- asserting something we do not know.
-- ============================================================================

ALTER TABLE costing        ADD COLUMN IF NOT EXISTS shipment_details_snapshot jsonb;
ALTER TABLE invoice        ADD COLUMN IF NOT EXISTS shipment_details_snapshot jsonb;
ALTER TABLE quotation      ADD COLUMN IF NOT EXISTS shipment_details_snapshot jsonb;
ALTER TABLE transit_order  ADD COLUMN IF NOT EXISTS shipment_details_snapshot jsonb;
ALTER TABLE delivery_note  ADD COLUMN IF NOT EXISTS shipment_details_snapshot jsonb;

COMMENT ON COLUMN costing.shipment_details_snapshot IS
  'The SSDC projection as it stood when this costing was APPROVED_LOCKED. NULL = render live (pre-0661 documents).';
COMMENT ON COLUMN invoice.shipment_details_snapshot IS
  'The SSDC projection as it stood when this invoice was locked. NULL = render live.';
COMMENT ON COLUMN quotation.shipment_details_snapshot IS
  'The SSDC projection as it stood when this quotation was issued. NULL = render live.';

-- DOWN
-- ALTER TABLE costing       DROP COLUMN IF EXISTS shipment_details_snapshot;
-- ALTER TABLE invoice       DROP COLUMN IF EXISTS shipment_details_snapshot;
-- ALTER TABLE quotation     DROP COLUMN IF EXISTS shipment_details_snapshot;
-- ALTER TABLE transit_order DROP COLUMN IF EXISTS shipment_details_snapshot;
-- ALTER TABLE delivery_note DROP COLUMN IF EXISTS shipment_details_snapshot;
--
-- NOTE: dropping these DESTROYS the record of what each locked document said at
-- the moment it locked. That cannot be reconstructed from the dossier, which is
-- the entire reason the columns exist. Restore from the pre-deploy dump instead
-- unless the snapshots are known to be empty.
