-- ============================================================================
-- TENANT DB — 11741 Margin simulation: the low-margin justification (§2.5).
--
-- WHAT WAS WRONG
--
-- `submit` accepted any simulation in DRAFT, whatever it said. A document could
-- therefore go forward for approval carrying a service cost of 95,700,000 XAF
-- and a price of zero — margin 0%, every line PASS-THROUGH — with nothing in
-- the flow that would have asked why. That is not a hypothetical: it is
-- SBX-2026-0001 as it stands in the sandbox today.
--
-- The legacy screen DID ask. `promptRiskJustification()` and
-- `saveJustification()` (view/admin/margin-simulator-billing.php:2268,2273)
-- stop a thin deal and demand a reason before it moves. That check never made
-- it across.
--
-- WHY A COLUMN AND NOT A PROMPT
--
-- The legacy prompt was client-side only: the reason was collected, shown once,
-- and never stored, so the approver saw the 0% margin without ever seeing why
-- it was 0%. Approving is exactly the moment the reason is needed, so it is
-- persisted on the row and returned with the document.
--
-- CLEARED ON RE-PRICE. `update` (§2.4a) nulls this whenever the lines change: a
-- justification written for one set of numbers is not a justification for a
-- different set. The service re-asks on the next submit.
--
-- NOT A CHECK CONSTRAINT. The rule is "a justification is required WHEN margin
-- <= 0 AT SUBMIT", which spans the line table and the moment of transition —
-- not expressible as a row CHECK without duplicating the margin maths in SQL
-- and freezing it there. It lives in margin_simulation.service.submit, which is
-- the only path to SUBMITTED.
--
-- ADDITIVE. One nullable text column; no backfill (existing rows predate the
-- rule and are left as they are).
-- ============================================================================

ALTER TABLE margin_simulation
  ADD COLUMN IF NOT EXISTS low_margin_justification text;

COMMENT ON COLUMN margin_simulation.low_margin_justification IS
  'Why this was submitted at or below cost (§2.5). Required by the service when margin_amount <= 0 at submit; cleared whenever the lines are re-priced. NULL on a healthy simulation.';

-- DOWN
-- Purely additive. Dropping it loses the recorded reason on every thin deal
-- approved since it shipped; the simulations themselves are unaffected.
--
--   ALTER TABLE margin_simulation DROP COLUMN IF EXISTS low_margin_justification;
