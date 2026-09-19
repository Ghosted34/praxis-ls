-- ============================================================================
-- TENANT DB — 13963 The public-address marker on entity_address (PR-06).
--
-- ── WHY THIS MIGRATION EXISTS ─────────────────────────────────────────────
--
-- Decision Q2 (audit 2026-09-19): the public entity card publishes the
-- CANONICAL REGISTERED ADDRESS — the same active structured `REGISTERED` row
-- the letterhead resolves, with the same precedence — so the shop window and
-- the invoice footer can no longer disagree about where a company is.
--
-- The response that selected that direction also said "both addresses are
-- important". Read as "a second operational/trading address", that is a
-- DIFFERENT disclosure from the statutory one and must be opt-in per row:
-- publishing every active address automatically would put warehouses,
-- remittance desks and PO boxes on a marketing page because somebody kept
-- the books tidy. So this migration adds an explicit marker and an explicit
-- public label, and NOTHING is public until a person sets both — the same
-- posture `public_enabled` took on `corporate_entity` (13787).
--
-- ── WHY THERE IS NO CHECK — THE 13791 RULE ────────────────────────────────
--
-- The first draft of this migration carried
-- `ck_entity_address_public_needs_label`, a CHECK making `is_public = true`
-- impossible without a non-blank label. `migration-constraint-ordering.test.js`
-- refused it, and it is right to: `entity_address` is a PRE-EXISTING table,
-- and a constraint added to one above 13791 breaks provisioning a fresh
-- tenant (the repair migration aborts in the sandbox pass on a column the
-- target does not have yet — see that test's header for the post-mortem).
--
-- So the rule lives in CODE, in two layers, both deliberately redundant:
--   1. the shared schema (`@praxis/shared`, entity-common.js): a CREATE with
--      the marker must carry its label in the same body, and so must the
--      UPDATE that sets the marker — `addressUpdate` refines
--      `is_public: true` to a label in the same patch;
--   2. the public read (site_settings.service.publicEntities →
--      `otherPublicAddresses`) skips a marked row with no label, so even a
--      row written before that rule, or straight through a psql session,
--      cannot be PUBLISHED unlabelled.
-- The cost of the check is nil; the cost of an unlabelled address is a line
-- on a stranger's page that says nothing about what it is.
--
-- ── SCHEMA-DUAL ───────────────────────────────────────────────────────────
--
-- Like every tenant migration this runs UNQUALIFIED, once per schema (live,
-- then sandbox). Plain `ADD COLUMN IF NOT EXISTS` only — nothing here for
-- 13791 to mirror.
--
-- Idempotent (safe to re-run), additive (nothing dropped).
-- ============================================================================

ALTER TABLE entity_address
  ADD COLUMN IF NOT EXISTS is_public       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_label_fr text,
  ADD COLUMN IF NOT EXISTS public_label_en text;

-- The label rule itself is NOT a CHECK here — see "WHY THERE IS NO CHECK"
-- above: it is enforced by @praxis/shared on every write and re-asserted by
-- the public read, because a constraint on this pre-existing table would
-- abort provisioning a new tenant at 13791.

COMMENT ON COLUMN entity_address.is_public IS
  'Off by default and for every existing row. Publishes this address on the public entity card BESIDE the canonical registered address — only with a public label, never automatically. The registered office itself needs no marker: the public read resolves it the way the letterhead does (active REGISTERED, then primary, then the legacy corporate_entity.address column). The label rule is enforced in @praxis/shared (entity-common.js), not by a CHECK: a constraint here would break tenant provisioning (13791).';
COMMENT ON COLUMN entity_address.public_label_fr IS
  'What a visitor read this address AS, in French — e.g. ''Bureau opérationnel de Douala''. Required (with public_label_en, in at least one language) whenever is_public is true: an address on a public page with no label is a line a visitor cannot interpret. Enforced on write by @praxis/shared and re-asserted by the public read.';
COMMENT ON COLUMN entity_address.public_label_en IS
  'What a visitor reads this address AS, in English. See public_label_fr.';

-- ============================================================================
-- VERIFY
--   SELECT count(*) FROM entity_address WHERE is_public;              -- expect 0
--   (A row marked public without a label is refused by @praxis/shared on
--    both create and update — and skipped by the public read regardless.)
-- ============================================================================

-- DOWN
-- ALTER TABLE entity_address
--   DROP COLUMN IF EXISTS public_label_en,
--   DROP COLUMN IF EXISTS public_label_fr,
--   DROP COLUMN IF EXISTS is_public;
