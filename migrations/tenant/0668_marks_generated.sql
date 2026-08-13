-- ============================================================================
-- TENANT DB — 0668 Marks & Numbers goes back to being generated.
--
-- WHY
--
-- Legacy fed "Marks & Numbers" from the container line editor and made the field
-- READ-ONLY (`operations-registry.php:641`): `01*20'RF, 02*40'HC`, regenerated
-- on every change. We seeded it as a plain TEXT field, which quietly turned a
-- derived fact into a hand-typed one. The final invoice, transit order, delivery
-- note and both costing packages all print that string, so the cost of a clerk
-- forgetting to retype it after adding a box is five documents that disagree
-- with the container editor sitting next to them.
--
-- GENERATED, NOT ENFORCED
--
-- `marks_numbers_is_manual` is the escape hatch, and it is a flag rather than a
-- convention because the alternative is guessing. There are real files where the
-- generated string is wrong — a part-load described by the shipper's own marks,
-- a break-bulk consignment with no containers to derive from — and a field that
-- silently overwrote a human's correction on the next container edit would be
-- worse than the free-text box this replaces.
--
--   false → recomputed on every container write (the default, and what legacy did)
--   true  → never touched; the UI shows a Manual badge and offers "revert to generated"
--
-- Existing files default to false and keep whatever string they hold until their
-- containers are next edited. Nothing is rewritten by this migration: a file
-- nobody touches keeps printing exactly what it printed yesterday, which is the
-- only safe behaviour for a field that is already on issued documents.
--
-- WHY is_readonly IS A COLUMN AND NOT A SPECIAL CASE
--
-- The renderer could have special-cased `facet_role = 'CARGO_MARKS'`, which is
-- fewer lines today and a magic string forever — the next generated field would
-- add a second one. A field definition already carries `is_required`,
-- `is_client_visible` and `is_active`; "the system fills this in" is the same
-- kind of fact about the same thing, and it is tenant-editable like the rest.
-- ============================================================================

ALTER TABLE dossier
  ADD COLUMN IF NOT EXISTS marks_numbers_is_manual boolean NOT NULL DEFAULT false;

-- Display-only, and honoured by the server too: a readonly field is refused on
-- write rather than merely greyed out, because a greyed control is a suggestion
-- and the API is the rule.
ALTER TABLE service_type_field
  ADD COLUMN IF NOT EXISTS is_readonly boolean NOT NULL DEFAULT false;

-- The marks field on every profile that captures containers. Left writable on
-- service types that do NOT capture equipment: with no container lines there is
-- nothing to derive from, and a locked empty box would be a dead end.
UPDATE service_type_field f
   SET is_readonly = true
  FROM service_type_field_set fs, service_type st
 WHERE f.service_type_field_set_id = fs.service_type_field_set_id
   AND fs.service_type_id = st.service_type_id
   AND st.captures_containers = true
   AND f.facet_role = 'CARGO_MARKS'
   AND f.is_readonly = false;

-- DOWN
-- Additive. Dropping the flag makes every file's marks writable again and loses
-- the record of which strings a human had deliberately overridden — those files
-- would silently start being regenerated on the next container edit.
--
--   ALTER TABLE service_type_field DROP COLUMN IF EXISTS is_readonly;
--   ALTER TABLE dossier DROP COLUMN IF EXISTS marks_numbers_is_manual;
