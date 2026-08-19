-- ============================================================================
-- TENANT DB — 10742 Deprecate costing.margin_percent (§2.2, owner-approved).
--
-- Legacy costing has NO margin concept at all: api/costing/save.php contains
-- zero margin references, and all 54 'margin' hits in
-- view/*/costing-module.php are CSS (margin-left, margin-bottom). The legacy
-- costing footer is Subtotal (HT) / VAT / Total Estimate — nothing else. That
-- is correct and deliberate: costing answers "what will this cost us?";
-- margin is a PRICING question owned by the margin simulator and the
-- quotation (which is why the legacy margin simulator has a LINK COSTING
-- dropdown).
--
-- We added costing.margin_percent in 0320 and computed a sell price from it
-- in costing.rules.js — margin then lived in two places with nothing keeping
-- them honest. As of this migration the code neither writes nor reads the
-- column; costing totals stop at HT / VAT / TTC (VAT per line from
-- costing_line.tax_code_id, never a hardcoded rate).
--
-- THE COLUMN IS KEPT, NULLABLE, UNWRITTEN — not dropped. Dropping is
-- destructive, historical sheets carry the value a past approval was based
-- on, and readers in the wild (exports, BI) get a deprecation window. A later
-- migration may drop it once nothing external reads it.
-- ============================================================================

COMMENT ON COLUMN costing.margin_percent IS
  'DEPRECATED (10742, §2.2): costing has no margin — totals are HT/VAT/TTC and stop. Margin belongs to margin_simulation + quotation. Never written since 10742; kept for historical sheets and external readers pending a final drop.';

-- DOWN
-- Comment-only; reversible with no data loss.
--
--   COMMENT ON COLUMN costing.margin_percent IS NULL;
