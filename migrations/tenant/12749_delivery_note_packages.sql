-- ============================================================================
-- TENANT DB — 12749  A delivery note's cargo lines carry weight and marks.
--
-- WHAT THIS IS FOR. A sea file hands over CONTAINERS and the note's manifest
-- says which boxes. An air file hands over PACKAGES, and until now the note
-- could say only "Palettes ciment × 24" — a description and a count, with the
-- weight nowhere on the document that proves the goods changed hands.
--
-- The weight is not decoration on an air waybill. It is what the consignee
-- checks at the counter, what a claim is argued over, and what the file already
-- holds (`dossier.gross_weight` / `weight_unit`, promoted by 0660). The note
-- was the one place it went missing.
--
-- MARKS for the same reason: an air shipment is identified by the marks on the
-- cartons, exactly as a sea shipment is by the number on the box. The transit
-- order has printed a marks column since it was rebuilt; the delivery note
-- could not, because the line had nowhere to put it.
--
-- BOTH NULLABLE. A line is still `{label, qty}` at minimum — that is what
-- `delivery_note.rules.normaliseLines` guarantees and what a hand-typed line
-- gives. These add to it; they do not become a second required shape.
--
-- gross_weight_kg, not `gross_weight` + a unit column. The file stores a unit
-- because a client quotes in tonnes or in pounds; the note stores kilogrammes
-- because it is a receipt and a receipt should not need a conversion to read.
-- The service converts on prefill.
-- ============================================================================

ALTER TABLE delivery_note_line
  ADD COLUMN IF NOT EXISTS gross_weight_kg numeric(18,3),
  ADD COLUMN IF NOT EXISTS marks           text;

COMMENT ON COLUMN delivery_note_line.gross_weight_kg IS
  'Gross weight of this line in kilogrammes. Prefilled from the file''s '
  'gross_weight (converted from its weight_unit), editable, and printed on the '
  'note for a shipment handed over as packages rather than as containers.';

COMMENT ON COLUMN delivery_note_line.marks IS
  'Marks and numbers on the packages — how an air or LCL shipment is identified '
  'at the counter, the way a container is identified by its number.';

-- DOWN
--   ALTER TABLE delivery_note_line DROP COLUMN IF EXISTS marks;
--   ALTER TABLE delivery_note_line DROP COLUMN IF EXISTS gross_weight_kg;
