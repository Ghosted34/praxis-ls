-- ============================================================================
-- 10695 — the delivery note becomes proof of delivery, not a printout.
--
-- (Five digits for the same reason as 10692: `migrator.js` sorts filenames as
-- strings, so this must sort after every `0`-prefixed file. See that header.)
--
-- ── WHAT THE LEGACY BORDEREAU ACTUALLY IS ───────────────────────────────────
--
-- `administration/view/operations/delivery-note.php` prints a document with a
-- "Received By (Client) — Name, Signature & Stamp" box on it. The client signs
-- that box when the goods arrive. Nothing in the legacy system ever captured
-- what was written there: `delivery_notes` has no received-by column, no state,
-- no reservations field. The signature exists on paper and nowhere else.
--
-- That is the whole defect. A delivery note is not a printout, it is the
-- EVIDENCE that a delivery happened and was accepted. When a client says three
-- months later that two of the six containers never arrived, the answer has to
-- be a record, and today the answer is "we printed something".
--
--   `status`            DRAFT → ISSUED → DELIVERED, plus CANCELLED. A note being
--                       prepared is not a note that has been handed over, and
--                       the list screen already renders a Status column that is
--                       hard-"—" today because the column does not exist.
--   `received_by_name`  who actually signed for the goods at the gate. The one
--                       fact that makes the document evidence.
--   `received_at`       when they signed — distinct from `delivery_date` (the
--                       planned/actual arrival) and from `created_at` (when the
--                       note was raised). Three different dates, all real.
--   `reservations`      the "Comments / Reservations (Client)" box the print
--                       layout has always had (delivery-note.php:620) and which
--                       has never been storable. This is where "carton 3 crushed"
--                       goes, and it is the single most valuable field on the
--                       document in a dispute — it is the client's own words,
--                       recorded at the moment of handover.
--   `signature_vault_id` the scanned signed copy. Mirrors the transit order:
--                       a status is something WE set, a scan is evidence
--                       somebody else produced.
--
-- ── WHY THERE IS NO `container_manifest text` COLUMN ────────────────────────
--
-- Legacy stored the container list as a free-text blob (`tc_list`), pasted by
-- hand and split on commas at print time into 18 fixed slots. This rebuild
-- already holds the same boxes STRUCTURED, on the file, in
-- `dossier_container_unit` (container_no, seal_no, tare, gross weight) — filled
-- in when the BL lands.
--
-- Re-typing them into a textarea would create a second, unreconciled copy of a
-- fact the system already knows, and the two would drift the first time a box
-- was swapped. So the note SELECTS from the file's containers instead, and
-- `delivery_note_container` below records which of them this delivery covers.
-- A note can also carry a container that is not on the file (`container_no`
-- free-text, no unit link) — that happens, and refusing it would just push
-- people back to the paste box.
-- ============================================================================

ALTER TABLE delivery_note
  -- Which of our legal entities issued it. Numbering is per-entity (the
  -- sequence lives in `doc_sequence` keyed on it) and the letterhead is the
  -- entity's, so a note without one cannot be numbered or printed correctly.
  -- Legacy had a single hard-coded company; this system does not.
  ADD COLUMN IF NOT EXISTS entity_id          uuid REFERENCES corporate_entity(entity_id),
  ADD COLUMN IF NOT EXISTS status             text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS received_by_name   text,
  ADD COLUMN IF NOT EXISTS received_at        timestamptz,
  ADD COLUMN IF NOT EXISTS reservations       text,
  ADD COLUMN IF NOT EXISTS signature_vault_id uuid REFERENCES document_vault(doc_id),
  ADD COLUMN IF NOT EXISTS issued_at          timestamptz,
  ADD COLUMN IF NOT EXISTS issued_by          uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS cancelled_at       timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason      text,
  ADD COLUMN IF NOT EXISTS created_by         uuid REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS updated_at         timestamptz NOT NULL DEFAULT now();

-- Every existing row was created by a code path that allocated a number and
-- printed immediately — there was no draft state to be in. Calling them ISSUED
-- is the honest reading: numbered and handed out, but never confirmed received,
-- because nothing could confirm it. Deliberately NOT marked DELIVERED: we have
-- no evidence they were, and inventing that evidence is the one thing this
-- migration exists to stop.
UPDATE delivery_note SET status = 'ISSUED'
 WHERE doc_number IS NOT NULL AND status = 'DRAFT';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_delivery_note_status') THEN
    ALTER TABLE delivery_note ADD CONSTRAINT chk_delivery_note_status
      CHECK (status IN ('DRAFT','ISSUED','DELIVERED','CANCELLED'));
  END IF;

  -- DELIVERED means somebody signed for it. Enforced here rather than only in
  -- the service because this is the claim the whole document makes, and a row
  -- that asserts it without a name is not a defensible record.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_delivery_note_received') THEN
    ALTER TABLE delivery_note ADD CONSTRAINT chk_delivery_note_received
      CHECK (status <> 'DELIVERED'
             OR (received_by_name IS NOT NULL AND btrim(received_by_name) <> ''
                 AND received_at IS NOT NULL)) NOT VALID;
  END IF;
END $$;

-- Backfill the entity from the file, so existing notes can still be reprinted
-- on the right letterhead. Notes with no dossier stay NULL — inventing an
-- issuer for them would be a guess printed on a legal document.
UPDATE delivery_note dn
   SET entity_id = d.entity_id
  FROM dossier d
 WHERE d.dossier_id = dn.dossier_id
   AND dn.entity_id IS NULL
   AND d.entity_id IS NOT NULL;

-- A delivery note number is unique per issuing entity, like every other
-- document. Legacy took MAX(dn_sequence)+1 under a lock that does not lock
-- (`SELECT MAX(...) FOR UPDATE` on an aggregate), so two operators clicking
-- together could take the same number; `numbering.allocate()` plus this index
-- makes that impossible rather than unlikely.
CREATE UNIQUE INDEX IF NOT EXISTS ux_delivery_note_number
  ON delivery_note (entity_id, doc_number) WHERE doc_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_delivery_note_status
  ON delivery_note (status);
CREATE INDEX IF NOT EXISTS ix_delivery_note_entity
  ON delivery_note (entity_id);

CREATE OR REPLACE TRIGGER trg_delivery_note_updated
  BEFORE UPDATE ON delivery_note
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Which containers this delivery covers ───────────────────────────────────
--
-- Normally a pointer at the file's own box (`dossier_container_unit_id`), so
-- the note cannot invent a container the file has never heard of.
--
-- `container_no` / `seal_no` are ALSO stored, denormalised, and that is not
-- redundancy — it is a SNAPSHOT. The delivery note is a legal record of what
-- was handed over on a date; if the file is later corrected (a mistyped box
-- number fixed, a unit deleted), the note must still print what was actually
-- signed for. Same reasoning as `shipment_details_snapshot` on issue.
CREATE TABLE IF NOT EXISTS delivery_note_container (
  delivery_note_container_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_note_id uuid NOT NULL
    REFERENCES delivery_note(delivery_note_id) ON DELETE CASCADE,
  -- ON DELETE SET NULL, not CASCADE: correcting the file must never silently
  -- shorten a signed delivery note. The snapshot below survives the link.
  dossier_container_unit_id uuid
    REFERENCES dossier_container_unit(dossier_container_unit_id) ON DELETE SET NULL,
  seq             integer NOT NULL DEFAULT 0,
  container_no    text,
  seal_no         text,
  gross_weight_kg numeric(18,3),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  -- A row has to identify a box somehow: either it points at one on the file,
  -- or it names one. A row that does neither is the paste-box bug returning.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_dn_container_identified') THEN
    ALTER TABLE delivery_note_container ADD CONSTRAINT chk_dn_container_identified
      CHECK (dossier_container_unit_id IS NOT NULL
             OR (container_no IS NOT NULL AND btrim(container_no) <> ''));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_dn_container_note
  ON delivery_note_container (delivery_note_id, seq);
-- The same box cannot be listed twice on one note.
CREATE UNIQUE INDEX IF NOT EXISTS ux_dn_container_unit
  ON delivery_note_container (delivery_note_id, dossier_container_unit_id)
  WHERE dossier_container_unit_id IS NOT NULL;

-- DOWN
-- DROP TABLE IF EXISTS delivery_note_container;
-- DROP INDEX IF EXISTS ix_delivery_note_status;
-- DROP INDEX IF EXISTS ux_delivery_note_number;
-- ALTER TABLE delivery_note DROP CONSTRAINT IF EXISTS chk_delivery_note_received;
-- ALTER TABLE delivery_note DROP CONSTRAINT IF EXISTS chk_delivery_note_status;
-- ALTER TABLE delivery_note
--   DROP COLUMN IF EXISTS updated_at, DROP COLUMN IF EXISTS created_by,
--   DROP COLUMN IF EXISTS cancel_reason, DROP COLUMN IF EXISTS cancelled_at,
--   DROP COLUMN IF EXISTS issued_by, DROP COLUMN IF EXISTS issued_at,
--   DROP COLUMN IF EXISTS signature_vault_id, DROP COLUMN IF EXISTS reservations,
--   DROP COLUMN IF EXISTS received_at, DROP COLUMN IF EXISTS received_by_name,
--   DROP COLUMN IF EXISTS status;
