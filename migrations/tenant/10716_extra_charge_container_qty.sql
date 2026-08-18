-- ============================================================================
-- TENANT DB — 10716 Extra-charge simulator: the container list, the dates, and
-- the tariff that produced the number (G16).
--
-- WHAT WAS WRONG
--
-- `extra_charge_simulation` (0345:64) was shaped for one question — "how much
-- demurrage on one box past its free days" — and the legacy asked a bigger one.
-- `view/*/extra-charges-simulator.php` computes FIVE charge families over a
-- LIST of containers parsed from free text ("2x40HC, 1x20RF"), across three
-- dates (ATA, gate-out, empty-return), and shows HT / VAT / TTC.
--
-- The stored row could hold none of that. `container_variant text` carries one
-- variant and NO COUNT, so a ten-container file persisted one container's worth
-- of charge — the figure on screen and the figure in the table disagreed, and
-- the table was the wrong one. There was nowhere to put the dates the charge
-- was derived from, so a saved simulation could not be re-derived or defended.
--
-- WHY jsonb FOR THE CONTAINERS
--
-- A container list is quantity × size × type, repeated: `[{q:2,s:40,t:"HC"},
-- {q:1,s:20,t:"RF"}]`. One integer cannot hold it. A child table could, but a
-- simulation is a what-if that carries no GL and is frequently discarded, and a
-- second table would need its own lifecycle, FK and cascade for data that is
-- only ever read back as a whole. The parser already produces exactly this
-- array (`extra_charge_simulation.rules.js`), so it is stored as it is computed.
--
-- WHY rates_snapshot
--
-- The tariff moves to tenant settings in the same change (seed 9093). That is
-- the right home — the legacy hard-coded it in a JS literal and its "save"
-- button was `alert("Saved locally!")`, so a tariff edit never survived a
-- refresh. But a settings-driven tariff means yesterday's simulation would
-- silently re-explain itself with today's rates. Freezing the resolved table
-- onto the row is the same rule 0661 applies to locked documents: a record
-- keeps what it said. Nullable — rows written before this migration have no
-- snapshot and are rendered from their stored totals, not re-derived.
--
-- WHY total_ht / vat_total ALONGSIDE total_amount
--
-- `total_amount` already exists and already means TTC; it is not redefined
-- here, because rows carrying it were written under that meaning. The legacy
-- displayed all three, and a quote that cannot show its VAT line is not usable
-- against a carrier invoice. Added as siblings, defaulted to 0.
--
-- ADDITIVE ONLY. `container_variant` and `free_days` stay: rows written by the
-- generic-tier path populate them, and dropping a populated column to tidy the
-- shape would be destructive for no gain (see check-destructive-migrations.js).
-- ============================================================================

ALTER TABLE extra_charge_simulation
  ADD COLUMN IF NOT EXISTS containers     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ata            date,
  ADD COLUMN IF NOT EXISTS gate_out       date,
  ADD COLUMN IF NOT EXISTS empty_return   date,
  ADD COLUMN IF NOT EXISTS yard_trigger   integer,
  ADD COLUMN IF NOT EXISTS rates_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS total_ht       numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_total      numeric(18,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN extra_charge_simulation.containers IS
  'Parsed container list [{q,s,t}] — quantity, size (20/40/45), type (DC/RF/HC/FR). The legacy''s free-text list, structured.';
COMMENT ON COLUMN extra_charge_simulation.rates_snapshot IS
  'The tariff actually used, frozen at compute. NULL = pre-10716 row; render its stored totals rather than re-deriving.';
COMMENT ON COLUMN extra_charge_simulation.total_amount IS
  'Total TTC. Unchanged meaning; total_ht and vat_total were added beside it in 10716.';

-- Money added here follows the same non-negative rule as 0497.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_extra_charge_simulation_total_ht_nonneg') THEN
    ALTER TABLE extra_charge_simulation
      ADD CONSTRAINT chk_extra_charge_simulation_total_ht_nonneg CHECK (total_ht >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_extra_charge_simulation_vat_total_nonneg') THEN
    ALTER TABLE extra_charge_simulation
      ADD CONSTRAINT chk_extra_charge_simulation_vat_total_nonneg CHECK (vat_total >= 0) NOT VALID;
  END IF;
END $$;

-- DOWN
-- Purely additive: eight nullable/defaulted columns and two CHECKs. Undoing it
-- loses the container list, the dates and the frozen tariff on every simulation
-- recorded since it shipped — the totals survive, but the row stops being able
-- to explain them.
--
--   ALTER TABLE extra_charge_simulation
--     DROP CONSTRAINT IF EXISTS chk_extra_charge_simulation_vat_total_nonneg,
--     DROP CONSTRAINT IF EXISTS chk_extra_charge_simulation_total_ht_nonneg;
--   -- DESTRUCTIVE: drops the container list, dates and frozen tariff.
--   ALTER TABLE extra_charge_simulation
--     DROP COLUMN IF EXISTS vat_total,
--     DROP COLUMN IF EXISTS total_ht,
--     DROP COLUMN IF EXISTS rates_snapshot,
--     DROP COLUMN IF EXISTS yard_trigger,
--     DROP COLUMN IF EXISTS empty_return,
--     DROP COLUMN IF EXISTS gate_out,
--     DROP COLUMN IF EXISTS ata,
--     DROP COLUMN IF EXISTS containers;
