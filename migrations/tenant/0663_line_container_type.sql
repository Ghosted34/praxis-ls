-- ============================================================================
-- TENANT DB — 0663 Equipment on the line: which box was this charge for?
--
-- WHY THIS COLUMN EXISTS
--
-- 0632 moved equipment OFF the dictionary item and ONTO the rate: one "Port
-- Charges" line, priced per container type, instead of four near-identical
-- catalogue rows. That was right, and it left one thing unfinished — the
-- DOCUMENT never recorded which box it had been priced for.
--
-- The costing form has shown a container picker since it was written
-- (costing/pages.tsx), but only to resolve a rate; the choice was discarded on
-- save. So a sheet with 3 x 20' RF and 2 x 40' HC of port charges persists as
-- two rows both labelled "Port Charges" with different unit costs and nothing
-- saying why they differ. Reconciling that against a carrier invoice is manual,
-- and "cost per 40' HC" is unanswerable without re-deriving it from the price.
--
-- Nullable, and NULL means what it has always meant: this charge has no
-- equipment dimension. Office supplies and bank fees keep NULL forever. No
-- existing row is rewritten and no historic document changes meaning.
--
-- Four tables and not a shared side-table: a polymorphic (source, line_id)
-- table cannot carry a foreign key back to the line it describes, so nothing
-- would stop an orphan surviving its parent, and every read would join on a
-- text discriminator. The column is identical in all four places, which is what
-- makes the reporting union trivial.
--
-- NO ON DELETE ACTION, deliberately. A container type is retired by clearing
-- is_active, never by deletion — the plain reference is what keeps a five-year-
-- old costing sheet readable after the type stops being offered.
-- ============================================================================

ALTER TABLE costing_line
  ADD COLUMN IF NOT EXISTS container_type_ref_id uuid REFERENCES dictionary_ref(ref_id);
ALTER TABLE quotation_line
  ADD COLUMN IF NOT EXISTS container_type_ref_id uuid REFERENCES dictionary_ref(ref_id);
ALTER TABLE invoice_line
  ADD COLUMN IF NOT EXISTS container_type_ref_id uuid REFERENCES dictionary_ref(ref_id);
ALTER TABLE supplier_invoice_line
  ADD COLUMN IF NOT EXISTS container_type_ref_id uuid REFERENCES dictionary_ref(ref_id);

-- Partial: equipment-bearing lines are a minority, and these indexes exist for
-- "all port-charge lines for a 40' HC", which always filters on NOT NULL.
CREATE INDEX IF NOT EXISTS ix_costing_line_ctype
  ON costing_line(container_type_ref_id) WHERE container_type_ref_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_quotation_line_ctype
  ON quotation_line(container_type_ref_id) WHERE container_type_ref_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_invoice_line_ctype
  ON invoice_line(container_type_ref_id) WHERE container_type_ref_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_supplier_invoice_line_ctype
  ON supplier_invoice_line(container_type_ref_id) WHERE container_type_ref_id IS NOT NULL;

-- DOWN
-- Purely additive: four nullable FK columns and four partial indexes. Undoing
-- this loses the equipment tag on every line recorded since it shipped; the
-- lines themselves and all money on them survive untouched.
--
--   DROP INDEX IF EXISTS ix_supplier_invoice_line_ctype;
--   DROP INDEX IF EXISTS ix_invoice_line_ctype;
--   DROP INDEX IF EXISTS ix_quotation_line_ctype;
--   DROP INDEX IF EXISTS ix_costing_line_ctype;
--   -- DESTRUCTIVE: drops the equipment dimension from all four line types.
--   ALTER TABLE supplier_invoice_line DROP COLUMN IF EXISTS container_type_ref_id;
--   ALTER TABLE invoice_line          DROP COLUMN IF EXISTS container_type_ref_id;
--   ALTER TABLE quotation_line        DROP COLUMN IF EXISTS container_type_ref_id;
--   ALTER TABLE costing_line          DROP COLUMN IF EXISTS container_type_ref_id;
