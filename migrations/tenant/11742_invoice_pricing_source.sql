-- ============================================================================
-- TENANT DB — 11742 Invoice: the off-quotation override reason (§2.7).
--
-- WHAT WAS WRONG
--
-- `PATCH /final-invoices/:id` accepted any lines at any prices. Nothing in the
-- write path compared them to the offer the client had accepted, so figures
-- lifted off a costing sheet could be billed as though they were prices. That
-- is invoice fb7db2f3: three lines, 95,700,000 XAF, at cost, zero margin, no
-- VAT — none of it traceable to a quotation, because none of it came from one.
--
-- 11741 and its siblings fixed the SHAPE of an invoice line (qty × unit_price,
-- a persisted tax code). This closes the other half: WHERE THE PRICE CAME FROM.
--
-- WHY A COLUMN, WHEN THE RULE IS A SETTING
--
-- The policy itself lives in tenant settings (finance.invoice_pricing.source —
-- QUOTATION_WHEN_PRESENT by default, QUOTATION_REQUIRED, or FREE), because
-- "must every charge be quoted first" is a commercial decision and differs by
-- tenant. What must live on the ROW is the exercise of the exception: which
-- invoice was billed off-quotation, and why.
--
-- The guard is deliberately releasable. A late charge that genuinely was not
-- quoted is an ordinary business event, and a control that cannot be released
-- is one people work around — they bill it to another dossier, and the trail is
-- worse than if the release had existed. So the override is allowed, requires a
-- written reason, is written to the audit trail, and is stored here so the
-- person APPROVING the invoice reads it before they sign. The accountability
-- sits with the approval, which is where maker-checker already put it.
--
-- NULL is the normal case and means the invoice matched its quotation (or the
-- tenant runs FREE, or the dossier had no quotation under the default policy).
--
-- ADDITIVE. One nullable text column, no backfill: invoices raised before this
-- shipped were never checked, and stamping them with a reason would assert
-- something nobody actually decided.
-- ============================================================================

ALTER TABLE invoice
  ADD COLUMN IF NOT EXISTS pricing_override_reason text;

COMMENT ON COLUMN invoice.pricing_override_reason IS
  'Why this invoice bills lines the dossier''s accepted quotation does not cover (§2.7). Set only when a caller supplied pricing_override.reason; shown to the approver. NULL = the lines matched the quotation, or no policy applied.';

-- DOWN
-- Purely additive. Dropping it loses the recorded justification on every
-- off-quotation invoice raised since it shipped; the invoices themselves and
-- the audit-trail entries (final_invoice.pricing_override) are unaffected.
--
--   ALTER TABLE invoice DROP COLUMN IF EXISTS pricing_override_reason;
