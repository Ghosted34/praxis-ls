-- ============================================================================
-- TENANT — 12752 Service pillars for the public website.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
-- `publicList` returns a FLAT array of published services. Every real logistics
-- services page is not flat: it is a small number of named pillars, each with
-- its own anchor, and the services sit underneath them. SmartLS's is three —
-- Freight Solutions / Logistics Solutions / Value-Added Services — with jump
-- links to #section-a/b/c from the page hero.
--
-- Nothing in the schema could express that. `service_type` carries `key`,
-- `name_fr`, `name_en`, `territory`, `is_system`, `is_active` and no grouping
-- of any kind, and `territory` (DOMESTIC_INLAND | INTERNATIONAL_IMPORT …) is an
-- OPERATIONAL axis, not a marketing one: "Freight / Logistics / Value-Added" is
-- how a tenant sells, not how a dossier routes. Overloading it would have made
-- the sales taxonomy a hostage of the operations one, and the first tenant who
-- wanted four pillars, or different names, would have broken both.
--
-- So: a separate, tenant-owned table. A tenant names its own pillars, orders
-- them, and assigns services to them. `group_id` is NULLABLE on purpose — the
-- column ships before any tenant has grouped anything, and an ungrouped service
-- must still appear on the page (see the read path, which collects them into a
-- trailing unnamed group rather than dropping them).
--
-- ── ALSO HERE, because they are the same read and the same PR ──────────────
-- `claim_fr` / `claim_en` — the single emphasised line each service card ends
-- with ("Competitive pricing and average 48-hour clearance time."). It is not a
-- `highlights` entry: highlights are a LIST rendered as bullets, this is ONE
-- sentence rendered as the card's closing proof. Modelling it as highlights[0]
-- would have meant the renderer silently treating the first bullet as special,
-- which is the kind of positional convention that survives exactly until
-- somebody reorders the list.
--
-- `accent` — which brand token tints the card's icon. A TOKEN NAME, never a
-- hex: doc/PUBLIC_WEB_PLAN.md §3.4 is explicit that colour is tenant config and
-- the components are shared, so a stored `#EE7D04` would hardcode one tenant's
-- palette into another tenant's data. The renderer maps PRIMARY → --brand-primary,
-- ACCENT → --brand-accent, SUCCESS → --brand-success.
-- ============================================================================

CREATE TABLE IF NOT EXISTS service_type_web_group (
  group_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable handle for the anchor in the URL (`/services#freight`), so a link
  -- shared today still lands in the right place after the label is reworded.
  key          citext UNIQUE NOT NULL,
  name_fr      text NOT NULL,
  name_en      text,
  -- Icon name, resolved by the renderer against its own set. Not a URL and not
  -- markup: a tenant-editable field that reached the DOM as HTML would be
  -- stored XSS on a public page.
  icon         text,
  sort_order   integer NOT NULL DEFAULT 100,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE service_type_web_group IS
  'Marketing pillars for the public services page. Tenant-owned and tenant-named; unrelated to service_type.territory, which is operational.';

-- ON DELETE SET NULL, not CASCADE: deleting a pillar must never delete the
-- services under it. They fall back to ungrouped and still render.
ALTER TABLE service_type_web_profile
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES service_type_web_group(group_id) ON DELETE SET NULL;

ALTER TABLE service_type_web_profile
  ADD COLUMN IF NOT EXISTS claim_fr text;
ALTER TABLE service_type_web_profile
  ADD COLUMN IF NOT EXISTS claim_en text;
ALTER TABLE service_type_web_profile
  ADD COLUMN IF NOT EXISTS accent text NOT NULL DEFAULT 'PRIMARY';

-- Guarded so a re-run against a database that already has the constraint is a
-- no-op rather than an error (same shape as 0103/0104 on the platform side).
ALTER TABLE service_type_web_profile
  DROP CONSTRAINT IF EXISTS service_type_web_profile_accent_chk;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'service_type_web_profile_accent_chk'
  ) THEN
    ALTER TABLE service_type_web_profile
      ADD CONSTRAINT service_type_web_profile_accent_chk
      CHECK (accent IN ('PRIMARY', 'ACCENT', 'SUCCESS'));
  END IF;
END $$;

COMMENT ON COLUMN service_type_web_profile.group_id IS
  'Optional pillar. NULL renders in the trailing unnamed group, never dropped.';
COMMENT ON COLUMN service_type_web_profile.claim_fr IS
  'One emphasised proof line closing the card. Not a highlights entry.';
COMMENT ON COLUMN service_type_web_profile.accent IS
  'Brand TOKEN name (PRIMARY|ACCENT|SUCCESS), never a hex — palette is tenant config.';

-- The read path filters published profiles and orders by pillar then card.
CREATE INDEX IF NOT EXISTS ix_service_type_web_profile_group
  ON service_type_web_profile (group_id, sort_order);

CREATE INDEX IF NOT EXISTS ix_service_type_web_group_order
  ON service_type_web_group (sort_order) WHERE is_active;

-- ============================================================================
-- VERIFY
--   \d service_type_web_group
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'service_type_web_profile'
--      AND column_name IN ('group_id','claim_fr','claim_en','accent');
--     -- expect 4 rows
--   INSERT INTO service_type_web_profile (service_type_id, accent)
--        VALUES (gen_random_uuid(), 'PUCE');   -- expect: violates accent_chk
--
-- DOWN
--   DROP INDEX IF EXISTS ix_service_type_web_group_order;
--   DROP INDEX IF EXISTS ix_service_type_web_profile_group;
--   ALTER TABLE service_type_web_profile
--     DROP CONSTRAINT IF EXISTS service_type_web_profile_accent_chk,
--     DROP COLUMN IF EXISTS accent,
--     DROP COLUMN IF EXISTS claim_en,
--     DROP COLUMN IF EXISTS claim_fr,
--     DROP COLUMN IF EXISTS group_id;
--   DROP TABLE IF EXISTS service_type_web_group;
--   -- Dropping group_id discards the assignments; the pillars themselves go
--   -- with the table. Re-applying starts from ungrouped, which renders.
-- ============================================================================
