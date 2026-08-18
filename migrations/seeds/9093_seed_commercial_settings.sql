-- ============================================================================
-- SEED (per tenant schema) — commercial business rules (G16).
--
-- NUMBERED 90xx DELIBERATELY. `migrator.files` partitions this directory by
-- prefix: `tenantSeeds` takes /^90/ and runs against each tenant's live and
-- sandbox schemas, `platformSeeds` takes /^91/ and runs against the platform
-- database. This file writes to `setting`, which is a TENANT table (created in
-- tenant/0130_platform_projection.sql) and does not exist in the platform DB —
-- as 91xx it would have failed provisioning outright.
--
-- WHY THIS FILE EXISTS
--
-- Three settings keys are read at runtime and none of them were ever seeded:
--
--   commercial.extra_charge_rates  → extra_charge_simulation.service.js
--   commercial.demurrage_tariff    → same, generic-tier path (THROWS when absent)
--   commercial.pricing_variance    → pricing_variance.service.js thresholds
--
-- `grep -rn "'commercial'" migrations/seeds/*.sql` returned nothing before this
-- file: 9050 seeds only `numbering` and `finance`. So a freshly provisioned
-- tenant hit "No demurrage tariff configured" on the tiered path, and the R/Y/G
-- thresholds silently fell back to constants in `flagFor()` — a business rule
-- living in source, which is the thing PHASE2_COMMERCIAL_AUDIT.md §"Tenant
-- business rules" says must not happen.
--
-- WHERE THE NUMBERS COME FROM
--
-- Verbatim from `let STATE = {…}` in the legacy
-- `administration/view/*/extra-charges-simulator.php`. All FIVE role copies of
-- that page (admin, management, finance, operations, sales) were diffed and are
-- byte-identical in this block, so there is no question of which one is
-- authoritative.
--
-- THIS CORRECTS A PORTING ERROR, AND THE CORRECTION IS LARGE. `DEFAULT_RATES`
-- in extra_charge_simulation.rules.js claimed to mirror the legacy "exactly"
-- and did not: the STORAGE band values had been copied into the DEMURRAGE slot.
--
--     demurrage[20]  legacy [7092, 12962.4]   was [300, 1200]     23.6x low
--     demurrage[40]  legacy [13465.2, 25444.8] was [600, 2400]    22.4x low
--     demurrage[20RF] legacy [7092, 12962.4]  was [0, 0]          reefers free
--
-- A 30-day 40' HC quoted ~41,400 XAF against a true ~331,000 XAF. The unit
-- tests pinned the wrong figures, so the suite was green and the defect
-- invisible. Rates now live here, where a tenant can see and change them.
--
-- ON CONFLICT DO NOTHING — a tenant that has already tuned its tariff keeps its
-- values on re-run, matching 9050's behaviour. This seeds a starting point; it
-- does not reassert itself over a decision someone made later.
-- ============================================================================

-- Extra-charge simulator tariff (MOD-28). Shapes match the rules engine:
--   demurrage.<sizeOrSizeType> = [tier1_rate, tier2_rate]   (per day)
--   storage.<size>             = [12-20d, 21-40d, 41-70d, 71+d]  (per day)
--   yard.<size>                = one-off, charged once port stay >= yardTrigger
--   detention.<dry|rf>.<size>  = per day after 2 free transit days
--   plug.<size>                = per day, reefers only
INSERT INTO setting (section, key, value) VALUES
 ('commercial', 'extra_charge_rates', '{
    "yardTrigger": 14,
    "fx":        { "XAF": 1, "USD": 615, "EUR": 655.957 },
    "demurrage": {
      "20":   [7092, 12962.4],
      "40":   [13465.2, 25444.8],
      "20RF": [7092, 12962.4],
      "40RF": [13465.2, 25444.8],
      "20HC": [7092, 12962.4],
      "40HC": [13465.2, 25444.8],
      "20FR": [7092, 12962.4],
      "40FR": [13465.2, 25444.8]
    },
    "storage":   { "20": [300, 1200, 3600, 6000], "40": [600, 2400, 7200, 12000] },
    "yard":      { "20": 100000, "40": 200000 },
    "detention": { "dry": { "20": 7400, "40": 15000 }, "rf": { "20": 37500, "40": 75000 } },
    "plug":      { "20": 13000, "40": 13000 }
  }'::jsonb)
ON CONFLICT (section, key) DO NOTHING;

-- Pricing Variance Index thresholds (MOD-27). Margin % on the quoted price:
-- >= green_min is GREEN, >= yellow_min is YELLOW, below that RED. These are the
-- values flagFor() falls back to; seeding them makes the rule visible and
-- editable instead of implicit in code.
INSERT INTO setting (section, key, value) VALUES
 ('commercial', 'pricing_variance', '{"green_min": 20, "yellow_min": 10}'::jsonb)
ON CONFLICT (section, key) DO NOTHING;

-- Margin simulator floor (MOD-27). A simulation whose overall margin falls
-- below this is flagged as at-risk and cannot be submitted without a written
-- justification. 0 means "only genuinely loss-making lines are flagged", which
-- is the legacy's behaviour (it flagged on margin < 0 per line).
INSERT INTO setting (section, key, value) VALUES
 ('commercial', 'margin_floor', '{"min_margin_percent": 0}'::jsonb)
ON CONFLICT (section, key) DO NOTHING;

-- DOWN
--   DELETE FROM setting WHERE section = 'commercial'
--     AND key IN ('extra_charge_rates', 'pricing_variance', 'margin_floor');
