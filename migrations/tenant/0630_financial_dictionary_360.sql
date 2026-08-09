-- ============================================================================
-- TENANT DB — 0630 Financial Dictionary 360 (MOD-05 redesign).
--
-- The financial dictionary is the heart of operations: every quote, invoice,
-- costing sheet, cash request and journal line speaks in dictionary items, and
-- each item carries its OHADA fate (which accounts it posts to, whether it is a
-- débours, what tax applies). This migration turns the lean catalogue into the
-- spine for a full 360 view.
--
-- WHAT THIS DOES
--
-- 1. dictionary_item gains the descriptive + control columns the 360 needs:
--      - direction         REVENUE | EXPENSE | DEBOURS | ASSET  (drives the code
--                          letter and the SYSCOHADA picker prefilter)
--      - applicability_mode SERVICE_SCOPED | ANY_OPERATIONS | NON_OPERATIONAL
--      - subcategory / unit_of_measure / proof_source / provider_kind
--                          (all seeded-editable via dictionary_ref, never hardcoded)
--      - requires_justification / receipt_requirement  (compliance controls, §Q4)
--      - debours_vat_transparent  (§Q16: a débours re-bills the VAT-inclusive
--                          amount and SHOWS the upstream supplier VAT to the
--                          client — "paid on your behalf, not retained by us")
--
-- 2. dictionary_ref — ONE generic seeded-but-editable registry behind every
--    dropdown on the dictionary (subcategory, unit, proof source, provider…),
--    so a manager adds a value in a gear modal instead of waiting for a release.
--
-- 3. service_type_dictionary_item — the many-to-many that makes "pick a service
--    type + Basic/Advanced/Full and get its financial lines at once" real. tier
--    is the MINIMUM level at which a line surfaces, so the sets nest:
--    BASIC ⊆ ADVANCED ⊆ FULL (§Q3). Backfilled from the old service_type_key.
--
-- 4. expense_rate gains provider_kind + provider_supplier_id so customs and port
--    authorities are first-class rate sources, not just shipping lines (§Q8).
--    (The amend/supersede UI and cost-evolution read are PR2; this is the spine.)
--
-- 5. The SYSCOHADA working-plan expansion is in 9001_seed_coa_expansion.sql,
--    NOT here: chart_of_accounts is populated by the 9000-series seeds, which run
--    AFTER tenant migrations, so CoA rows must live in a seed or their
--    parent_code FK points at nothing. Exhaustive AUDCIF annex = phase-2 data.
--
-- Codes: NEW items are minted "#<L><NNN>" (L = R/E/D/A from direction) in the
-- service layer. Existing free-form codes (FREIGHT…) are left untouched — code
-- is a referenced human key and is never rewritten by a migration.
-- ============================================================================

-- ── 1. dictionary_item control + descriptive columns ────────────────────────
ALTER TABLE dictionary_item
  ADD COLUMN IF NOT EXISTS direction              text,
  ADD COLUMN IF NOT EXISTS applicability_mode     text NOT NULL DEFAULT 'ANY_OPERATIONS',
  ADD COLUMN IF NOT EXISTS subcategory            text,
  ADD COLUMN IF NOT EXISTS unit_of_measure        text,
  ADD COLUMN IF NOT EXISTS proof_source           text,
  ADD COLUMN IF NOT EXISTS provider_kind          text,
  ADD COLUMN IF NOT EXISTS requires_justification boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS receipt_requirement    text NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN IF NOT EXISTS debours_vat_transparent boolean NOT NULL DEFAULT true;

-- Backfill direction from the existing accounting nature, then make it NOT NULL.
UPDATE dictionary_item SET direction = CASE
    WHEN direction IS NOT NULL THEN direction
    WHEN category = 'debours'  THEN 'DEBOURS'
    WHEN category = 'service'  THEN 'REVENUE'
    WHEN category = 'asset'    THEN 'ASSET'
    ELSE 'EXPENSE'
  END
  WHERE direction IS NULL;

-- Backfill applicability: an item tied to a service is service-scoped; a pure
-- overhead line is non-operational; everything else surfaces on any operation.
UPDATE dictionary_item SET applicability_mode = CASE
    WHEN service_type_key IS NOT NULL AND service_type_key <> '' THEN 'SERVICE_SCOPED'
    WHEN category = 'overhead' THEN 'NON_OPERATIONAL'
    ELSE 'ANY_OPERATIONS'
  END;

-- DESTRUCTIVE: SET NOT NULL on direction is safe — the UPDATE above backfilled every existing row (category → direction), so none is null now; the column is required henceforth.
ALTER TABLE dictionary_item ALTER COLUMN direction SET NOT NULL;

-- ADD CONSTRAINT has no native IF NOT EXISTS; the DO block is the idempotency
-- guard the migrator requires (it checks pg_constraint before adding).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_dict_direction') THEN
    ALTER TABLE dictionary_item ADD CONSTRAINT chk_dict_direction CHECK (direction IN ('REVENUE','EXPENSE','DEBOURS','ASSET'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_dict_applicability') THEN
    ALTER TABLE dictionary_item ADD CONSTRAINT chk_dict_applicability CHECK (applicability_mode IN ('SERVICE_SCOPED','ANY_OPERATIONS','NON_OPERATIONAL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_dict_receipt') THEN
    ALTER TABLE dictionary_item ADD CONSTRAINT chk_dict_receipt CHECK (receipt_requirement IN ('ALWAYS_REQUIRED','CONDITIONALLY_REQUIRED','NOT_REQUIRED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_dict_provider') THEN
    ALTER TABLE dictionary_item ADD CONSTRAINT chk_dict_provider CHECK (provider_kind IS NULL OR provider_kind IN ('SHIPPING_LINE','CUSTOMS_AUTHORITY','PORT_TERMINAL','OTHER'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_dict_direction   ON dictionary_item(direction);
CREATE INDEX IF NOT EXISTS ix_dict_applic_mode ON dictionary_item(applicability_mode);

-- ── 2. dictionary_ref — the one seeded-but-editable registry behind dropdowns ─
-- kind groups the values (SUBCATEGORY, UNIT, PROOF_SOURCE, PROVIDER_KIND, …).
-- is_system marks a Praxis-seeded row (editable, but flagged for "restore
-- defaults"); is_active lets a tenant retire a value without deleting history.
CREATE TABLE IF NOT EXISTS dictionary_ref (
  ref_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL,
  code        citext NOT NULL,
  name_fr     text NOT NULL,
  name_en     text,
  extra       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- e.g. {"category":"debours"} to scope a subcategory
  sort_order  integer NOT NULL DEFAULT 100,
  is_system   boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, code)
);
CREATE INDEX IF NOT EXISTS ix_dictref_kind ON dictionary_ref(kind) WHERE is_active;
CREATE OR REPLACE TRIGGER trg_dictref_updated BEFORE UPDATE ON dictionary_ref FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed the starting values (all editable). Business groupings a Cameroon freight
-- forwarder meets daily; tenants extend these in the gear modal.
INSERT INTO dictionary_ref (kind, code, name_fr, name_en, sort_order, is_system) VALUES
  ('SUBCATEGORY','OCEAN_FREIGHT','Fret maritime','Ocean freight',10,true),
  ('SUBCATEGORY','AIR_FREIGHT','Fret aérien','Air freight',20,true),
  ('SUBCATEGORY','SURCHARGES','Surcharges (BAF/CAF)','Surcharges (BAF/CAF)',30,true),
  ('SUBCATEGORY','DEMURRAGE','Surestaries','Demurrage & detention',40,true),
  ('SUBCATEGORY','THC','Manutention terminal (THC)','Terminal handling (THC)',50,true),
  ('SUBCATEGORY','STORAGE','Magasinage','Storage',60,true),
  ('SUBCATEGORY','SCANNING','Scanner','Scanning',70,true),
  ('SUBCATEGORY','CUSTOMS_DUTIES','Droits de douane','Customs duties',80,true),
  ('SUBCATEGORY','CUSTOMS_INSPECTION','Inspection douanière','Customs inspection',90,true),
  ('SUBCATEGORY','DECLARATION','Déclaration en douane','Customs declaration',100,true),
  ('SUBCATEGORY','TRUCKING','Camionnage','Trucking',110,true),
  ('SUBCATEGORY','RAIL','Transport ferroviaire','Rail',120,true),
  ('SUBCATEGORY','ESCORT','Escorte / convoi','Escort / convoy',130,true),
  ('SUBCATEGORY','AGENCY_FEE','Honoraires d''agence','Agency fee',140,true),
  ('SUBCATEGORY','HANDLING','Manutention','Handling',150,true),
  ('SUBCATEGORY','SURVEY','Expertise / survey','Survey',160,true),
  ('SUBCATEGORY','RENT','Loyer','Rent',170,true),
  ('SUBCATEGORY','UTILITIES','Charges (eau/électricité)','Utilities',180,true),
  ('SUBCATEGORY','SALARIES','Salaires','Salaries',190,true),
  ('SUBCATEGORY','OTHER','Autre','Other',999,true),
  ('UNIT','CONTAINER_20','Conteneur 20''','Container 20''',10,true),
  ('UNIT','CONTAINER_40','Conteneur 40''','Container 40''',20,true),
  ('UNIT','BL','Connaissement (BL)','Bill of lading',30,true),
  ('UNIT','DOSSIER','Dossier','Dossier / file',40,true),
  ('UNIT','TON','Tonne','Tonne',50,true),
  ('UNIT','KG','Kilogramme','Kilogram',60,true),
  ('UNIT','CBM','Mètre cube','Cubic metre',70,true),
  ('UNIT','DAY','Jour','Day',80,true),
  ('UNIT','UNIT','Unité','Unit',90,true),
  ('PROOF_SOURCE','GOVERNMENT_AUTHORITY','Administration / Douane','Government / Customs',10,true),
  ('PROOF_SOURCE','CARRIER_AIRLINE','Transporteur / Compagnie','Carrier / Airline',20,true),
  ('PROOF_SOURCE','PORT_TERMINAL','Port / Terminal','Port / Terminal',30,true),
  ('PROOF_SOURCE','THIRD_PARTY_VENDOR','Prestataire tiers','Third-party vendor',40,true),
  ('PROOF_SOURCE','INTERNAL_SERVICE','Service interne','Internal service',50,true),
  ('PROVIDER_KIND','SHIPPING_LINE','Compagnie maritime','Shipping line',10,true),
  ('PROVIDER_KIND','CUSTOMS_AUTHORITY','Autorité douanière','Customs authority',20,true),
  ('PROVIDER_KIND','PORT_TERMINAL','Autorité portuaire / Terminal','Port authority / Terminal',30,true),
  ('PROVIDER_KIND','OTHER','Autre','Other',40,true)
ON CONFLICT (kind, code) DO NOTHING;

-- ── 3. service_type_dictionary_item — the Basic/Advanced/Full mapping ────────
CREATE TABLE IF NOT EXISTS service_type_dictionary_item (
  service_type_id    uuid NOT NULL REFERENCES service_type(service_type_id) ON DELETE CASCADE,
  dictionary_item_id uuid NOT NULL REFERENCES dictionary_item(dictionary_item_id) ON DELETE CASCADE,
  -- The lowest bundle the line belongs to. Pull "ADVANCED" and you get BASIC +
  -- ADVANCED lines; "FULL" gets everything. Nested, per §Q3.
  tier               text NOT NULL DEFAULT 'BASIC' CHECK (tier IN ('BASIC','ADVANCED','FULL')),
  sort_order         integer NOT NULL DEFAULT 100,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service_type_id, dictionary_item_id)
);
CREATE INDEX IF NOT EXISTS ix_stdi_item    ON service_type_dictionary_item(dictionary_item_id);
CREATE INDEX IF NOT EXISTS ix_stdi_service ON service_type_dictionary_item(service_type_id);

-- Backfill from the legacy single-value link: every item that named a service
-- (by key) becomes a BASIC line of that service. service_type_key stays as a
-- denormalised hint until PR2 finishes cutting the ST-360 over to this join.
INSERT INTO service_type_dictionary_item (service_type_id, dictionary_item_id, tier)
SELECT st.service_type_id, di.dictionary_item_id, 'BASIC'
  FROM dictionary_item di
  JOIN service_type st ON st.key = di.service_type_key
 WHERE di.service_type_key IS NOT NULL AND di.service_type_key <> ''
ON CONFLICT (service_type_id, dictionary_item_id) DO NOTHING;

-- ── 4. expense_rate: provider dimension (shipping line / customs / port) ─────
ALTER TABLE expense_rate
  ADD COLUMN IF NOT EXISTS provider_kind        text,
  ADD COLUMN IF NOT EXISTS provider_supplier_id uuid REFERENCES supplier_master(supplier_id),
  ADD COLUMN IF NOT EXISTS note                 text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_exprate_provider') THEN
    ALTER TABLE expense_rate ADD CONSTRAINT chk_exprate_provider CHECK (provider_kind IS NULL OR provider_kind IN ('SHIPPING_LINE','CUSTOMS_AUTHORITY','PORT_TERMINAL','OTHER'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_exprate_provider_supplier ON expense_rate(provider_supplier_id);

-- DOWN
-- Additive DDL + idempotent seed rows. No existing business data is destroyed
-- (the backfilled direction/applicability_mode overwrite NULL/default only, and
-- the seeded dictionary_ref rows use ON CONFLICT DO NOTHING so they never clobber
-- a tenant edit). To undo, drop in reverse dependency order; seeded reference
-- rows would be exported first if anything hangs off them (a
-- dictionary_item.subcategory referencing dictionary_ref.code, etc.).
--
--   DROP TABLE IF EXISTS service_type_dictionary_item;
--   ALTER TABLE expense_rate DROP CONSTRAINT IF EXISTS chk_exprate_provider;
--   DROP INDEX IF EXISTS ix_exprate_provider_supplier;
--   ALTER TABLE expense_rate
--     DROP COLUMN IF EXISTS note,
--     DROP COLUMN IF EXISTS provider_supplier_id,
--     DROP COLUMN IF EXISTS provider_kind;
--   DROP TRIGGER IF EXISTS trg_dictref_updated ON dictionary_ref;
--   DROP INDEX IF EXISTS ix_dictref_kind;
--   DROP TABLE IF EXISTS dictionary_ref;
--   DROP INDEX IF EXISTS ix_dict_direction;
--   DROP INDEX IF EXISTS ix_dict_applic_mode;
--   ALTER TABLE dictionary_item
--     DROP CONSTRAINT IF EXISTS chk_dict_direction,
--     DROP CONSTRAINT IF EXISTS chk_dict_applicability,
--     DROP CONSTRAINT IF EXISTS chk_dict_receipt,
--     DROP CONSTRAINT IF EXISTS chk_dict_provider;
--   ALTER TABLE dictionary_item
--     DROP COLUMN IF EXISTS direction,
--     DROP COLUMN IF EXISTS applicability_mode,
--     DROP COLUMN IF EXISTS subcategory,
--     DROP COLUMN IF EXISTS unit_of_measure,
--     DROP COLUMN IF EXISTS proof_source,
--     DROP COLUMN IF EXISTS provider_kind,
--     DROP COLUMN IF EXISTS requires_justification,
--     DROP COLUMN IF EXISTS receipt_requirement,
--     DROP COLUMN IF EXISTS debours_vat_transparent;
--   -- The dictionary_ref seed rows this migration inserted are left in place
--   -- (harmless reference data); restore from a pre-migration dump if an exact
--   -- revert is required.
