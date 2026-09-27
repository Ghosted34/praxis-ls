-- ============================================================================
-- TENANT DB — 14130 Client headings: the families a client document prints.
--
-- ── THE PROBLEM (tenant review "meeting 5", 21 Sep 2026, 01:28:21) ──────────
--
-- The operations team costs a file line by line — customs duties, the
-- clearance fee, the officers' transport to the customs office, a gate pass —
-- and the client wants to read ONE line: "Customs Formalities 500 000". Every
-- client document copied the costing's lines one for one (costing → margin
-- simulation → quotation → final invoice), so a quotation was as long as the
-- costing behind it.
--
-- ── THE MODEL (the owner's answers to the PR 2 questions) ──────────────────
--
--   * A CLIENT HEADING is a family a client reads ("Customs Formalities",
--     "Port & Terminal Charges"). The list is a `dictionary_ref` kind,
--     CLIENT_HEADING — bilingual, seeded (90996), editable, like every other
--     dropdown the dictionary owns. It is NOT the subcategory: subcategories
--     are an internal classification and most of them mix pass-through money
--     with our own fees.
--   * Each dictionary line carries a DEFAULT heading
--     (`dictionary_item.client_heading_ref_id`).
--   * Each document line may OVERRIDE it (`client_heading`, free text) — the
--     pricer moves a line to another family, renames one, or makes one up for
--     this file ("DAP Douala–Bangui"). NULL means "the catalogue's heading".
--     The override rides costing → margin simulation → quotation → invoice.
--   * Grouping is PRINT ONLY. Every document keeps storing its detailed lines,
--     so postings, margins, cash requests, reconciliation and the quotation →
--     invoice price guard all keep working per line; the printed quotation and
--     invoice show one line per heading × nature (disbursements and our fees
--     never share a line — VAT and OHADA posting differ).
--
-- ── PLAIN COLUMNS ONLY (13791 rule) ────────────────────────────────────────
--
-- Every table touched here already exists, so no FK or CHECK is added
-- (tests/unit/migration-constraint-ordering.test.js). `client_heading_ref_id`
-- is validated by the financial-dictionary service instead: it must name an
-- active CLIENT_HEADING row of dictionary_ref.
-- ============================================================================

ALTER TABLE dictionary_item
  ADD COLUMN IF NOT EXISTS client_heading_ref_id uuid;

COMMENT ON COLUMN dictionary_item.client_heading_ref_id IS
  'The client-facing family this line prints under on quotations and invoices (dictionary_ref kind CLIENT_HEADING). Plain uuid (13791 rule) — validated in financial_dictionary.service. NULL prints under "Other Charges".';

ALTER TABLE costing_line           ADD COLUMN IF NOT EXISTS client_heading text;
ALTER TABLE margin_simulation_line ADD COLUMN IF NOT EXISTS client_heading text;
ALTER TABLE quotation_line         ADD COLUMN IF NOT EXISTS client_heading text;
ALTER TABLE invoice_line           ADD COLUMN IF NOT EXISTS client_heading text;

COMMENT ON COLUMN costing_line.client_heading IS
  'Per-document override of the dictionary line''s client heading (free text). NULL = the catalogue''s heading. Carried to the margin simulation, quotation and invoice.';
COMMENT ON COLUMN margin_simulation_line.client_heading IS
  'Client heading override carried from the costing (see costing_line.client_heading).';
COMMENT ON COLUMN quotation_line.client_heading IS
  'Client heading override; the printed quotation groups lines by heading × nature. NULL = the catalogue''s heading.';
COMMENT ON COLUMN invoice_line.client_heading IS
  'Client heading override; the printed invoice groups lines by heading × nature. NULL = the catalogue''s heading.';

CREATE INDEX IF NOT EXISTS ix_dictionary_item_client_heading
  ON dictionary_item (client_heading_ref_id) WHERE client_heading_ref_id IS NOT NULL;

-- DOWN
-- DROP INDEX IF EXISTS ix_dictionary_item_client_heading;
-- ALTER TABLE invoice_line           DROP COLUMN IF EXISTS client_heading;
-- ALTER TABLE quotation_line         DROP COLUMN IF EXISTS client_heading;
-- ALTER TABLE margin_simulation_line DROP COLUMN IF EXISTS client_heading;
-- ALTER TABLE costing_line           DROP COLUMN IF EXISTS client_heading;
-- ALTER TABLE dictionary_item        DROP COLUMN IF EXISTS client_heading_ref_id;
