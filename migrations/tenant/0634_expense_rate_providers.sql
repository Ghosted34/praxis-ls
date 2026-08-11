-- ============================================================================
-- TENANT DB — 0634 Expense Rates: carriers & authorities as first-class rate
-- providers (MOD-10), strict container-type rates, formula-priced items.
--
-- WHAT THIS DOES.
--
-- 1. `rate_provider` — the registry the Expense Rates 360 rates against: named
--    shipping lines and airlines ("Maersk", "DHL"), plus rate-setting
--    AUTHORITIES that are not carriers at all (PAD, PAK — a port authority's
--    fee applies no matter which shipping line carried the box). One table,
--    a `kind` discriminator, same seeded-but-editable shape as dictionary_ref:
--    a manager extends it from an admin panel or inline from the rate grid,
--    nobody waits on a release to add COSCO or Turkish Cargo.
--
-- 2. `expense_rate` moves off two loose free-text columns (`shipping_line`,
--    `variant`) onto two real foreign keys: `rate_provider_id` (NULL = the
--    global default rate) and `container_type_ref_id` (NULL = no equipment
--    dimension — an authority fee charged per BL, an air rate priced by
--    weight, not by box). The old columns invited exactly the drift the
--    dictionary already fixed once for container types (0632/9080): "20ft"
--    vs "20'" vs "20FT" is three rows that should be one. A rate is now
--    scoped by picking real rows, not by typing a string that happens to
--    match another string.
--
-- 3. `dictionary_item.pricing_mode` — FLAT (a rate card resolves the price,
--    the default) or FORMULA (Demurrage, Storage: the price depends on a
--    tariff and elapsed time, and the real calculation lives in the Extra
--    Charges Simulation module, MOD-28). The Expense Rates 360 still shows
--    a REFERENCE rate for a FORMULA item — the flat-rate machinery does not
--    disappear, it becomes a "typical/starting" figure with a deep link to
--    the simulator for the real number.
--
-- 4. A standing data-quality fix: PAD_FEES was seeded with proof_source
--    'CARRIER_AIRLINE' (→ provider_kind SHIPPING_LINE), which is wrong — a
--    port authority is not a shipping line. PAK_FEES was seeded correctly
--    (PORT_TERMINAL) in the same batch, so this was a one-row slip, not a
--    modelling decision. Fixed at the root in seeds/9080 too, so a freshly
--    provisioned tenant never reproduces it.
--
-- WHY THE OLD COLUMNS ARE DROPPED, NOT DEPRECATED-IN-PLACE. `expense_rate` has
-- no seeded rows (seeds/9080's own comment: "rates themselves are NOT seeded
-- here — that is the Expense-Rate build") and nothing in the client ever wrote
-- to it (MOD-10's UI shipped as a bare CRUD table with free-text inputs; nobody
-- built on top of it yet). Keeping two parallel representations of the same
-- fact (a string AND a foreign key) is the accuracy problem this migration
-- exists to close, not a compromise worth preserving for a table with no
-- production data. The backfill below still runs, defensively, for any tenant
-- that DID enter rows by hand before this shipped.
-- ============================================================================

-- ── 1. rate_provider — carriers (sea/air) and rate-setting authorities ──────
CREATE TABLE IF NOT EXISTS rate_provider (
  rate_provider_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL,
  code          citext NOT NULL,
  name          text NOT NULL,
  -- SCAC (sea) or IATA prefix (air) — optional, shown alongside the name; not
  -- validated against a format because tenants outside Cameroon/CEMAC may use
  -- neither convention.
  carrier_code  text,
  sort_order    integer NOT NULL DEFAULT 100,
  is_system     boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, code)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rate_provider_kind') THEN
    ALTER TABLE rate_provider ADD CONSTRAINT chk_rate_provider_kind
      CHECK (kind IN ('SHIPPING_LINE','AIRLINE','PORT_AUTHORITY','CUSTOMS_AUTHORITY','OTHER'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_rate_provider_kind ON rate_provider(kind) WHERE is_active;
CREATE OR REPLACE TRIGGER trg_rate_provider_updated BEFORE UPDATE ON rate_provider FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed the carriers named in the build brief, plus the two authorities that
-- already have dictionary lines (PAD_FEES, PAK_FEES). is_system so a "restore
-- defaults" story is possible later; still fully editable/deactivatable.
INSERT INTO rate_provider (kind, code, name, sort_order, is_system) VALUES
  ('SHIPPING_LINE','MAERSK','Maersk',10,true),
  ('SHIPPING_LINE','MSC','MSC — Mediterranean Shipping Company',20,true),
  ('SHIPPING_LINE','CMA_CGM','CMA CGM',30,true),
  ('SHIPPING_LINE','HAPAG_LLOYD','Hapag-Lloyd',40,true),
  ('SHIPPING_LINE','GRIMALDI_ACL','Grimaldi Lines / ACL',50,true),
  ('SHIPPING_LINE','COSCO','COSCO Shipping',60,true),
  ('AIRLINE','DHL','DHL',10,true),
  ('AIRLINE','ETHIOPIAN_CARGO','Ethiopian Airlines Cargo',20,true),
  ('AIRLINE','AIR_FRANCE_CARGO','Air France Cargo',30,true),
  ('AIRLINE','BRUSSELS_CARGO','Brussels Airlines Cargo',40,true),
  ('AIRLINE','EMIRATES_SKYCARGO','Emirates SkyCargo',50,true),
  ('AIRLINE','TURKISH_CARGO','Turkish Cargo',60,true),
  ('AIRLINE','RAM_CARGO','Royal Air Maroc Cargo',70,true),
  ('PORT_AUTHORITY','PAD','Port Autonome de Douala',10,true),
  ('PORT_AUTHORITY','PAK','Port Autonome de Kribi',20,true)
ON CONFLICT (kind, code) DO NOTHING;

-- ── 2. expense_rate: real scope (provider) + real equipment (container type) ─
ALTER TABLE expense_rate
  ADD COLUMN IF NOT EXISTS rate_provider_id      uuid REFERENCES rate_provider(rate_provider_id),
  ADD COLUMN IF NOT EXISTS container_type_ref_id uuid REFERENCES dictionary_ref(ref_id);

-- Best-effort backfill for any tenant that entered rows by hand before this
-- migration. Fabricates a rate_provider per distinct free-text shipping_line
-- (kind SHIPPING_LINE — the only kind the old free-text column could have
-- meant) and maps common container-variant spellings onto the seeded
-- CONTAINER_TYPE registry (0632/9080). Anything that does not match a known
-- pattern is left NULL rather than guessed — a rate with no provider/type is
-- still valid (it just means "default"/"no equipment dimension"), which is
-- safer than mapping it to the wrong box size.
INSERT INTO rate_provider (kind, code, name, is_system)
SELECT DISTINCT 'SHIPPING_LINE',
       upper(regexp_replace(btrim(shipping_line), '[^A-Za-z0-9]+', '_', 'g')),
       btrim(shipping_line), false
  FROM expense_rate
 WHERE shipping_line IS NOT NULL AND btrim(shipping_line) <> ''
ON CONFLICT (kind, code) DO NOTHING;

UPDATE expense_rate er SET rate_provider_id = rp.rate_provider_id
  FROM rate_provider rp
 WHERE er.rate_provider_id IS NULL
   AND er.shipping_line IS NOT NULL AND btrim(er.shipping_line) <> ''
   AND rp.kind = 'SHIPPING_LINE'
   AND rp.code = upper(regexp_replace(btrim(er.shipping_line), '[^A-Za-z0-9]+', '_', 'g'));

UPDATE expense_rate er SET container_type_ref_id = dr.ref_id
  FROM dictionary_ref dr
 WHERE er.container_type_ref_id IS NULL
   AND dr.kind = 'CONTAINER_TYPE'
   AND dr.code = CASE lower(regexp_replace(COALESCE(er.variant, ''), '[^a-z0-9]', '', 'gi'))
                   WHEN '20' THEN 'FT20' WHEN '20ft' THEN 'FT20'
                   WHEN '40' THEN 'FT40' WHEN '40ft' THEN 'FT40'
                   WHEN '40hc' THEN 'FT40HC' WHEN '40hq' THEN 'FT40HC'
                   WHEN '45hc' THEN 'FT45HC' WHEN '45hq' THEN 'FT45HC' WHEN '45' THEN 'FT45HC'
                   WHEN 'reefer' THEN 'REEFER' WHEN 'rf' THEN 'REEFER' WHEN 'frigo' THEN 'REEFER'
                   WHEN 'flatrack' THEN 'FLATRACK' WHEN 'ot' THEN 'OPENTOP' WHEN 'opentop' THEN 'OPENTOP'
                   WHEN 'tank' THEN 'ISOTANK' WHEN 'isotank' THEN 'ISOTANK'
                   ELSE NULL
                 END;

-- Both columns below are fully superseded by rate_provider_id/
-- container_type_ref_id (backfilled immediately above). expense_rate has no
-- seeded rows (9080's own comment: rates are not seeded there) and nothing in
-- the client ever wrote to this table before this feature, so no production
-- data is lost.
-- DESTRUCTIVE: drops the shipping_line free-text column, superseded above.
ALTER TABLE expense_rate DROP COLUMN IF EXISTS shipping_line;
-- DESTRUCTIVE: drops the variant free-text column, superseded above.
ALTER TABLE expense_rate DROP COLUMN IF EXISTS variant;

CREATE INDEX IF NOT EXISTS ix_exprate_provider       ON expense_rate(rate_provider_id);
CREATE INDEX IF NOT EXISTS ix_exprate_container_type ON expense_rate(container_type_ref_id);

-- ── 3. dictionary_item.pricing_mode — FLAT (rate card) vs FORMULA (simulator) ─
ALTER TABLE dictionary_item ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'FLAT';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_dict_pricing_mode') THEN
    ALTER TABLE dictionary_item ADD CONSTRAINT chk_dict_pricing_mode CHECK (pricing_mode IN ('FLAT','FORMULA'));
  END IF;
END $$;
-- Demurrage & storage lines are formula-priced by nature (tiered tariff over
-- elapsed days, MOD-28) — flip the ones the catalogue already carries under
-- those sub-categories. A tenant can flip any other line to FORMULA by hand.
UPDATE dictionary_item SET pricing_mode = 'FORMULA'
 WHERE subcategory IN ('DEMURRAGE','STORAGE') AND pricing_mode = 'FLAT';

-- ── 4. Data-quality fix: PAD is a port authority, not a shipping line ────────
UPDATE dictionary_item SET provider_kind = 'PORT_TERMINAL'
 WHERE code = 'PAD_FEES' AND provider_kind = 'SHIPPING_LINE';

-- DOWN
-- rate_provider and its seed rows, the two new expense_rate FK columns, and
-- dictionary_item.pricing_mode are all this migration adds; the PAD_FEES fix
-- and the dropped shipping_line/variant columns are the only lossy steps.
--
--   ALTER TABLE dictionary_item DROP CONSTRAINT IF EXISTS chk_dict_pricing_mode;
--   ALTER TABLE dictionary_item DROP COLUMN IF EXISTS pricing_mode;
--   -- DESTRUCTIVE: the PAD_FEES correction is not reverted (it was a bug fix,
--   -- not a feature) — leave it PORT_TERMINAL.
--   DROP INDEX IF EXISTS ix_exprate_container_type;
--   DROP INDEX IF EXISTS ix_exprate_provider;
--   -- DESTRUCTIVE: re-adding shipping_line/variant restores empty columns, not
--   -- the original free text — that text is gone. Any rate written after this
--   -- migration only exists as (rate_provider_id, container_type_ref_id).
--   ALTER TABLE expense_rate ADD COLUMN shipping_line text, ADD COLUMN variant text;
--   ALTER TABLE expense_rate DROP COLUMN IF EXISTS container_type_ref_id;
--   ALTER TABLE expense_rate DROP COLUMN IF EXISTS rate_provider_id;
--   DROP TRIGGER IF EXISTS trg_rate_provider_updated ON rate_provider;
--   DROP INDEX IF EXISTS ix_rate_provider_kind;
--   DROP TABLE IF EXISTS rate_provider;
