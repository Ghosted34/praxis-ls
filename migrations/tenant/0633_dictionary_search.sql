-- ============================================================================
-- TENANT DB — 0633 Financial Dictionary: findability (MOD-05).
--
-- WHAT THIS IS FOR.
--
-- The dictionary is picked from everywhere — costing, quotation, cash request,
-- supplier invoice, the FD itself — by people who do not know the catalogue's
-- own name for the thing they are looking at. They type "surestarie", or
-- "demurage" with one r, or "detention", or "storage", and they mean the line
-- the catalogue calls Demurrage / Surestaries. Today `listItems` answers that
-- with `ILIKE '%q%'` over code + label_fr + label_en: no typo tolerance, no
-- synonyms, no ranking, and a sequential scan.
--
-- Three columns make a real finder possible.
--
-- 1. `keywords text[]` (added in 0632, populated by 9081) — the alternates a
--    line is actually called: the other language, the abbreviation, the common
--    misspelling, the superseded legacy code. A GIN index (0632) answers
--    `keywords && ARRAY['surestarie']` without a scan.
--
-- 2. `description` becomes the human sentence that says what the charge IS,
--    which is both what a picker should show under the name and more matchable
--    text. (9080 used it for legacy provenance; 9081 moves that to legacy_ref
--    and rewrites every description.)
--
-- 3. `legacy_ref` — where the provenance goes. Separating it matters: an audit
--    trail and a search blurb are different jobs, and one column cannot be both
--    without the picker showing "Ancienne ligne #-1094" to a costing clerk.
--    Indexed so an old #-#### reference still resolves instantly.
--
-- WHY TRIGRAM AND NOT full-text search. `to_tsvector` stems words against a
-- language configuration and matches whole lexemes — it is built for prose, and
-- it will not match "demurage" to "demurrage" because a typo is not a
-- morphological variant. pg_trgm compares three-character shingles, so edit
-- distance degrades gracefully, `similarity()` gives a ranking score for free,
-- and one index serves both ILIKE '%…%' and the fuzzy path. For a catalogue of
-- short bilingual labels that is the right tool.
-- ============================================================================

-- SCHEMA public, not a bare CREATE EXTENSION. Every tenant migration runs with
-- `search_path = <schema>`, so a bare one would install pg_trgm into `live` on
-- the first pass and leave `sandbox` unable to resolve `similarity()`. 0504
-- already installs it into public for the party-dedup indexes and explains this
-- at length; this line is a no-op on any database that has run 0504, and the
-- correct statement on one that somehow has not. The runtime search_path is
-- `<schema>, public` (middleware/tenant-context.js), so unqualified calls
-- resolve at query time.
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;

ALTER TABLE dictionary_item
  ADD COLUMN IF NOT EXISTS legacy_ref text;

COMMENT ON COLUMN dictionary_item.legacy_ref IS
  'Originating legacy financial_dictionary code(s), comma-separated. Audit trail only — never shown in a picker.';

-- Trigram indexes over everything the finder ranks on. gin_trgm_ops rather than
-- gist: the catalogue is small and read-mostly, and GIN is the faster of the two
-- for similarity lookups on short text.
CREATE INDEX IF NOT EXISTS ix_dict_trgm_label_fr ON dictionary_item USING GIN (label_fr gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_dict_trgm_label_en ON dictionary_item USING GIN (label_en gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_dict_trgm_code     ON dictionary_item USING GIN ((code::text) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS ix_dict_trgm_descr    ON dictionary_item USING GIN (description gin_trgm_ops);

-- An old "#-1119" written on a filed document has to still find its line.
CREATE INDEX IF NOT EXISTS ix_dict_legacy_ref ON dictionary_item (legacy_ref) WHERE legacy_ref IS NOT NULL;

-- DOWN
-- Purely additive: one extension, one NULLable column, five indexes. No
-- existing row is rewritten and no column is narrowed. Undoing this loses the
-- provenance column (9081 can repopulate it) and the finder's index support —
-- search would fall back to a sequential ILIKE, slower but still correct.
--
--   DROP INDEX IF EXISTS ix_dict_legacy_ref;
--   DROP INDEX IF EXISTS ix_dict_trgm_descr;
--   DROP INDEX IF EXISTS ix_dict_trgm_code;
--   DROP INDEX IF EXISTS ix_dict_trgm_label_en;
--   DROP INDEX IF EXISTS ix_dict_trgm_label_fr;
--   -- DESTRUCTIVE: drops the legacy provenance mapping. Every catalogue line
--   -- survives; only the "which #-#### did this come from" trail is lost, and
--   -- re-running seeds/9081 restores it.
--   ALTER TABLE dictionary_item DROP COLUMN IF EXISTS legacy_ref;
--   -- pg_trgm is left installed: other modules may come to rely on it, and
--   -- dropping an extension is not a safe automatic step.
