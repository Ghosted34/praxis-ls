-- ============================================================================
-- TENANT DB — 14140 The letterhead chooses its address, and prints RCCM and NIU
-- on one line. Tenant review "meeting 5", 21 Sep 2026.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- The PO box on the letterhead did not follow an address change (BP 5120 →
-- 5121). There was no cache: with more than one active address row, three
-- readers — the dossier, the studio preview and the document renderer — each
-- took "the first REGISTERED row" of an unordered or differently-ordered list,
-- so which row printed depended on the query plan. The resolver is now one
-- function with a deterministic rule (entity-letterhead.service
-- registeredAddressRow / postalAddressRow); these columns let the entity SAY
-- which rows it means instead of leaving it to the rule:
--
--   address_id         the row the address block prints (registered seat)
--   postal_address_id  the row the PO box / postal block prints
--   identifiers_inline "RCCM: … · NIU: …" on one line (the default), or one
--                      identifier per line
--
-- ── SHAPE ──────────────────────────────────────────────────────────────────
--
-- Plain columns only (13791 rule — no FK or CHECK on an existing table after
-- 13791). A dangling id is harmless: the resolver ignores a chosen row that is
-- missing or inactive and falls back to its precedence. Additive and
-- idempotent.
-- ============================================================================

ALTER TABLE entity_letterhead
  ADD COLUMN IF NOT EXISTS address_id uuid,
  ADD COLUMN IF NOT EXISTS postal_address_id uuid,
  ADD COLUMN IF NOT EXISTS identifiers_inline boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN entity_letterhead.address_id IS
  'entity_address row the letterhead address block prints. NULL = the registered primary, then the newest registered row (entity-letterhead.service registeredAddressRow). No FK (13791 rule); a missing or inactive id falls back.';
COMMENT ON COLUMN entity_letterhead.postal_address_id IS
  'entity_address row the PO box / postal block prints. NULL = the newest MAILING row with a PO box, else the address block''s row.';
COMMENT ON COLUMN entity_letterhead.identifiers_inline IS
  'true: "RCCM: … · NIU: …" on one line (default since 14140); false: one identifier per line.';

-- DOWN
-- ALTER TABLE entity_letterhead DROP COLUMN IF EXISTS identifiers_inline;
-- ALTER TABLE entity_letterhead DROP COLUMN IF EXISTS postal_address_id;
-- ALTER TABLE entity_letterhead DROP COLUMN IF EXISTS address_id;
