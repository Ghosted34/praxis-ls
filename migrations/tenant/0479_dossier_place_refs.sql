-- ============================================================================
-- 0479 — dossier.pol / .pod get real references into geo_place (0478).
--
-- WHY. POL and POD are free text on both ends of the stack: the form is a bare
-- <Input> and the validator is `z.string().optional()`. So "Douala", "douala",
-- "DLA", "Douala Port" and "Douala, CM" are five different values for one port.
-- The map matches those strings against geo_place at render time — normalising
-- case, accents and punctuation gets you some of the way, but it cannot know
-- that "DLA" is Douala, so those dossiers silently drop off the map. The typos
-- are already visible in the Operations list too (`routeOf`).
--
-- SHAPE. Exactly the pattern 0477 used for document line items: an FK to the
-- real catalogue row, with the existing text column kept as a DISPLAY SNAPSHOT.
-- Same reasoning — the snapshot preserves what the user actually chose at the
-- time even if the reference row is later renamed, and it keeps every existing
-- read path working untouched.
--
-- ADDITIVE AND NULLABLE ON PURPOSE. Existing dossiers keep resolving through
-- the text path; new ones get exact coordinates. No backfill is attempted here:
-- guessing which geo_place a free-text string meant is precisely the ambiguity
-- this migration exists to stop, so it is left to a human (or to the normal
-- resolve-and-cache path, which is unchanged).
--
-- Idempotent.
-- ============================================================================

ALTER TABLE dossier ADD COLUMN IF NOT EXISTS pol_place_id uuid REFERENCES geo_place(geo_place_id);
ALTER TABLE dossier ADD COLUMN IF NOT EXISTS pod_place_id uuid REFERENCES geo_place(geo_place_id);

CREATE INDEX IF NOT EXISTS ix_dossier_pol_place ON dossier (pol_place_id) WHERE pol_place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_dossier_pod_place ON dossier (pod_place_id) WHERE pod_place_id IS NOT NULL;
