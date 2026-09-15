-- ============================================================================
-- TENANT DB — 12767 The costing worksheet joins the signature menu.
--
-- 12766 gave the costing its foundation; the document itself is registered in
-- `document_vault.types.js` (DOC_TYPES + SIGNATURE_CEILING) and its canonical
-- payload in `services/signatures/canonical.js`. This is level 2 of the
-- eligibility funnel (SIGNATURE_ENGINEERING_GUIDE §3.4) — the TENANT menu —
-- which is data and so lives here:
--
--   1. DOC-TYPE CEILING   code — COSTING is signable, QES off, WET off
--   2. TENANT MENU        THIS FILE
--   3. SENDER, AT DISPATCH n/a — a costing is never dispatched for signature
--   4. SIGNER CHOICE      n/a — the transition seals it, nobody picks a card
--
-- WHY ONLY STAMP, WHERE 10773 SEEDED STAMP + DRAWN FOR EVERY OTHER TYPE.
--
-- These three seals are applied BY THE TRANSITION, inside the same transaction
-- that moves the sheet's status — there is no signing page, so there is no
-- moment at which a person could draw a mark. Offering DRAWN would put a card
-- in the menu that nothing can ever choose, and a menu entry that cannot be
-- reached is how the predecessor system accumulated settings nobody could
-- explain. A tenant that later builds a manual signing step for costings can
-- add it; the ceiling in code permits it.
--
-- Idempotent: ON CONFLICT DO NOTHING, so a tenant that has already tuned its
-- policy keeps its choice when this file re-runs.
-- ============================================================================

INSERT INTO setting (section, key, value) VALUES
  ('signature_policy', 'COSTING',
   jsonb_build_object('allowed', jsonb_build_array('STAMP'), 'default', 'STAMP'))
ON CONFLICT (section, key) DO NOTHING;

-- ============================================================================
-- VERIFY
--   SELECT value FROM setting
--    WHERE section = 'signature_policy' AND key = 'COSTING';
--     -- expect {"allowed": ["STAMP"], "default": "STAMP"}
--
-- DOWN
--   -- DESTRUCTIVE if the tenant has tuned it: the row is indistinguishable
--   -- from a hand-edited one. Removing it leaves COSTING with an empty menu,
--   -- so every costing transition would raise EMPTY_SIGNATURE_MENU and the
--   -- seal would be skipped (the transition itself still succeeds — see
--   -- costing.service.sealTransition).
--   -- DELETE FROM setting WHERE section = 'signature_policy' AND key = 'COSTING';
-- ============================================================================
