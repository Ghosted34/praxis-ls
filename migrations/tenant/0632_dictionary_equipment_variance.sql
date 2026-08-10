-- ============================================================================
-- TENANT DB — 0632 Financial Dictionary: equipment variance & search keywords
-- (MOD-05, supports the curated seed in seeds/9080_seed_dictionary.sql).
--
-- WHY THIS COLUMN EXISTS.
--
-- The legacy catalogue carried the equipment in the LINE NAME: "Port Charges
-- 20'", "Port Charges 40'", "THC 20'", "THC 40'", "Open Top Stevedoring",
-- "Flat Rack Stevedoring"… ~30 of its ~195 rows were the same charge written
-- twice or four times, once per box size. That is a data model that cannot
-- answer "what do port charges cost us?" without a LIKE, and that grows by two
-- rows every time the terminal adds an equipment class.
--
-- The 9080 seed collapses each of those families into ONE dictionary line and
-- moves the equipment onto the RATE, where it belongs: expense_rate already has
-- a `variant` column, and dictionary_ref now carries the CONTAINER_TYPE /
-- LOAD_MODE registries the variant is drawn from (also seeded in 9080).
--
-- `varies_by_equipment` is what makes that collapse legible to the software.
-- It says: this line has no single price — ask for a variant before you quote
-- it. The Expense-Rate tab uses it to decide whether to show the equipment
-- picker; a costing sheet uses it to refuse a line with no variant chosen. It
-- is a flag on the ITEM because the fact is about the charge, not about any one
-- tenant's rate card.
--
-- `keywords` is the seam for the fuzzy finder. Operations staff type "surestarie",
-- "demurrage", "detention" and "storage" for charges the catalogue calls three
-- different things in two languages; a GIN index over an array of alternates is
-- how that search stops being a full scan over label_fr || label_en. Left empty
-- by this migration and by the seed — populating it is the finder's own build.
--
-- Both are additive and defaulted, so every existing row keeps its meaning:
-- "no, this line does not vary by equipment" and "no alternate spellings yet"
-- are the correct answers for a catalogue that never modelled either.
-- ============================================================================

ALTER TABLE dictionary_item
  ADD COLUMN IF NOT EXISTS varies_by_equipment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS keywords            text[]  NOT NULL DEFAULT '{}'::text[];

-- Partial: the variant-bearing lines are a small minority of the catalogue and
-- the only rows the Expense-Rate picker filters on.
CREATE INDEX IF NOT EXISTS ix_dict_varies_equipment
  ON dictionary_item(dictionary_item_id) WHERE varies_by_equipment;

-- GIN over the alternates array — the shape `keywords && ARRAY['surestarie']`
-- needs, and the reason the column is an array rather than a text blob.
CREATE INDEX IF NOT EXISTS ix_dict_keywords ON dictionary_item USING GIN (keywords);

-- DOWN
-- Purely additive: two defaulted columns and two indexes on dictionary_item. No
-- existing row is rewritten and no column is narrowed. Undoing this loses the
-- equipment-variance flag set by 9080 (16 lines) and any keywords a tenant has
-- since typed; the catalogue rows themselves are untouched.
--
--   DROP INDEX IF EXISTS ix_dict_keywords;
--   DROP INDEX IF EXISTS ix_dict_varies_equipment;
--   -- DESTRUCTIVE: drops the equipment-variance flag and the search alternates.
--   -- Every line survives; the Expense-Rate tab loses the "ask for a variant"
--   -- signal and falls back to a single rate per line.
--   ALTER TABLE dictionary_item
--     DROP COLUMN IF EXISTS keywords,
--     DROP COLUMN IF EXISTS varies_by_equipment;
