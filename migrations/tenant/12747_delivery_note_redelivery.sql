-- ============================================================================
-- TENANT DB — 12747  Partial deliveries: re-delivering a box already signed for
--
-- WHAT THIS IS FOR. A sea file carries twelve containers and they do not all
-- clear at once. The delivery note already models that correctly — one note per
-- delivery run, each snapshotting the boxes that actually went — and
-- `delivery_note_container` has always allowed the same box to appear on two
-- notes, because a split load is real.
--
-- What it could not tell apart was the two reasons that happens:
--
--   · the box is on another note that is still ISSUED — a split load, or two
--     notes raised for one run. Normal. Nothing to say.
--   · the box is on a note that is DELIVERED — somebody has already signed for
--     it. Almost always a mistake, and occasionally a genuine return and
--     re-delivery. Never something to do silently.
--
-- The picker showed `already_on` for both cases in the same neutral tone, so
-- the second was as easy to do as the first.
--
-- ONE COLUMN, and it is the reason rather than a flag. A boolean would record
-- that somebody clicked past a warning; the sentence records WHY, prints on the
-- note, and is what a dispute six months later actually needs. `NOT NULL` is
-- wrong here — the column applies to a minority of rows — so the rule is
-- enforced in the service, where it can name the container.
--
-- NO delivered_on column on dossier_container_unit, deliberately. Delivery
-- progress is DERIVED from the notes (see delivery_note.repo.progressForDossier):
-- the notes are already the truth, and a stamped date beside them is a second
-- source that drifts the first time a note is cancelled.
-- ============================================================================

ALTER TABLE delivery_note_container
  ADD COLUMN IF NOT EXISTS redelivery_reason text;

COMMENT ON COLUMN delivery_note_container.redelivery_reason IS
  'Why this box is being handed over again when another DELIVERED note already '
  'covers it (a return, a re-delivery, a correction). Required by the service '
  'in that case, null otherwise. Printed on the note.';

-- The same box, twice on one note, is a UI slip rather than an intent — already
-- guarded by ux_dn_container_unit. This is the ACROSS-notes case, which is
-- legitimate and therefore indexed rather than constrained: the progress
-- rollup and the picker both ask "which notes is this box on?" on every open of
-- a containerised file, and without this they seq-scan the table.
CREATE INDEX IF NOT EXISTS ix_dn_container_unit_lookup
  ON delivery_note_container (dossier_container_unit_id)
  WHERE dossier_container_unit_id IS NOT NULL;

-- Same, for the grouped shape (10708): a file that never itemised its boxes
-- still reports progress, per container LINE.
CREATE INDEX IF NOT EXISTS ix_dn_container_line_lookup
  ON delivery_note_container (dossier_container_line_id)
  WHERE dossier_container_line_id IS NOT NULL;

-- DOWN
--   DROP INDEX IF EXISTS ix_dn_container_line_lookup;
--   DROP INDEX IF EXISTS ix_dn_container_unit_lookup;
--   ALTER TABLE delivery_note_container DROP COLUMN IF EXISTS redelivery_reason;
