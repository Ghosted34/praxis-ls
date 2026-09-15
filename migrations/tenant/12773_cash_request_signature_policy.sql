-- ============================================================================
-- TENANT DB — 12773 The cash request and its receipt join the signature menu.
--
-- 12771 gave the cash request its budget ledger; the two documents themselves
-- are registered in `document_vault.types.js` (DOC_TYPES + SIGNATURE_CEILING)
-- and their canonical payloads in `services/signatures/canonical.js`. This is
-- level 2 of the eligibility funnel (SIGNATURE_ENGINEERING_GUIDE §3.4) — the
-- TENANT menu — which is data and so lives here:
--
--   1. DOC-TYPE CEILING   code — both signable, QES off, WET **on**
--   2. TENANT MENU        THIS FILE
--   3. SENDER, AT DISPATCH n/a — neither document is dispatched for signature
--   4. SIGNER CHOICE      n/a for the digital path — the transition seals it
--
-- THREE SIGNATURES, AND WHERE EACH ONE IS APPLIED (owner decision Q12).
--
--   the requestor           `SUBMITTED`  — raising the claim IS the assertion
--   the approving authority `APPROVED`   — reason APPROVED_PAYMENT
--   the disbursing authority each payment — on the receipt, not the voucher
--
-- Validation is deliberately NOT sealed. The owner's words: *"validating is
-- just a visa. No official signature."* Finance checks the funds and the
-- budget; the three signatories are the requestor, the approver and the
-- disburser, and a fourth seal on the page would misdescribe who decided.
--
-- WHY PRINT_SIGN IS IN THE MENU, WHERE THE COSTING'S IS STAMP-ONLY.
--
-- A costing never leaves the building. These two do: cash changes hands at a
-- window, and the person taking it is not always at a screen. `PRINT_SIGN`
-- is still gated behind the tenant's `signatures.wet` feature flag (presets
-- CARD_FLAG), so a tenant that has not enabled paper signing sees the card
-- blocked with its reason rather than offered — and the DEFAULT stays STAMP,
-- which is what the transitions seal with.
--
-- Idempotent: ON CONFLICT DO NOTHING, so a tenant that has already tuned its
-- policy keeps its choice when this file re-runs.
-- ============================================================================

-- ── 1. The wording each of these seals prints ──────────────────────────────
--
-- `document_signature.sign_reason` is validated against this catalogue by
-- `signInternal`, and the seal prints the tenant's own words for the code
-- (seal-view.js). 10772 seeded five reasons and none of them describes what
-- happens on a cash request: raising a claim is not "acknowledged", releasing
-- cash is not "approved for dispatch", and taking it is not "goods received".
-- A seal that has to borrow another document's vocabulary is a seal whose
-- reader has to translate it.
--
-- ON CONFLICT DO UPDATE, exactly as 10772 does: the wording is the tenant's to
-- change on the Signatures settings screen, and re-running this file must
-- restore the shipped default rather than accumulate near-duplicates. `kind`
-- defaults to 'SIGN' (10784); it is named so the row is unambiguous.
INSERT INTO signature_reason (reason_code, label_en, label_fr, sort_order, kind) VALUES
  ('REQUESTED',     'Requested',   'Demandé',      15, 'SIGN'),
  ('DISBURSED',     'Disbursed',   'Décaissé',     25, 'SIGN'),
  ('CASH_RECEIVED', 'Cash received', 'Fonds reçus', 26, 'SIGN')
ON CONFLICT (reason_code) DO UPDATE SET
  label_en = EXCLUDED.label_en, label_fr = EXCLUDED.label_fr,
  sort_order = EXCLUDED.sort_order;

-- ── 2. The tenant menu ─────────────────────────────────────────────────────
INSERT INTO setting (section, key, value) VALUES
  ('signature_policy', 'CASH_REQUEST',
   jsonb_build_object('allowed', jsonb_build_array('STAMP', 'PRINT_SIGN'), 'default', 'STAMP')),
  ('signature_policy', 'CASH_PAYMENT_RECEIPT',
   jsonb_build_object('allowed', jsonb_build_array('STAMP', 'PRINT_SIGN'), 'default', 'STAMP'))
ON CONFLICT (section, key) DO NOTHING;

-- ============================================================================
-- VERIFY
--   SELECT key, value FROM setting
--    WHERE section = 'signature_policy'
--      AND key IN ('CASH_REQUEST', 'CASH_PAYMENT_RECEIPT');
--     -- expect {"allowed": ["STAMP", "PRINT_SIGN"], "default": "STAMP"} twice
--
--   SELECT reason_code, label_en FROM signature_reason
--    WHERE reason_code IN ('REQUESTED', 'DISBURSED', 'CASH_RECEIVED');
--     -- expect three rows; signInternal refuses an unlisted sign_reason
--
-- DOWN
--   -- DESTRUCTIVE if the tenant has tuned it: the row is indistinguishable
--   -- from a hand-edited one. Removing it leaves the doc type with an empty
--   -- menu, so every seal is skipped (the transition itself still succeeds —
--   -- see cash_request.service.seal, best-effort by design).
--   -- DELETE FROM setting WHERE section = 'signature_policy'
--   --  AND key IN ('CASH_REQUEST', 'CASH_PAYMENT_RECEIPT');
-- ============================================================================
