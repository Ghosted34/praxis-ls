-- ============================================================================
-- TENANT DB — 13800 the Control Tower band, configured per role
--
-- Companion to doc/KPI_BAND_ENGINEERING_GUIDE.md (PR-1). Three arrays per role:
--
--   scope_ids    which catalog ids this role's PEOPLE may pick from at all.
--                NULL (the default, and the seed) means "everything the role
--                can read", recomputed at every read — so a tile that ships
--                in a later PR becomes pickable for the role the day it goes
--                live, with nobody editing rows. A non-null array narrows it,
--                which is how "warehouse operators never see margin" is said.
--   default_ids  the band a member sees before they touch a picker. ≤ 4 — the
--                fixed-four promise (D2), enforced in the DB, not just the app,
--                so a hand-edited row cannot put a tenant's home screen into a
--                fifth column.
--   locked_ids   slots every member must carry (an exec band that reads the
--                same everywhere). ⊆ default_ids: you may require what you
--                also offer, not more.
--
-- WHY A TABLE HERE AND THE USER'S OWN PICK IN user_preference (0507): the
-- role row is OTHER people's display, so it lives beside the role in the
-- identity tables (this schema, pinned live by iam_role's controller) and is
-- written behind MOD-67 edit; the personal row is one key in `shell`.
--
-- WHY ids ARE BARE TEXT AND NOT AN FK. The catalog is code (guide §4: a
-- tenant-editable catalog is a fake number waiting to be configured). The
-- CHECK constraints below can enforce arity and containment — shape, which
-- SQL is good at — and `role_kpi.service.js` validates membership against
-- the code catalog on every write. Ids that stop existing fail CLOSED: the
-- resolver filters before it paints, so an orphan id never renders and never
-- grants anything.
--
-- WHERE THE SEED IS, AND WHY IT IS NOT HERE. This file creates the table and
-- nothing else. The curated per-role defaults live in
-- `migrations/seeds/9023_seed_role_kpi_defaults.sql`, because the seed has to
-- read `role` and `permission` to intersect a curated band with what the role
-- can actually READ — and on a freshly provisioned tenant those tables are
-- still EMPTY at this point: `provisioning.service.js → migrateTenantDb` runs
-- every tenant migration first and only then the 90xx seeds, and the roles
-- themselves are seeded by 9020/9021/9022. A seed block in this file inserts
-- zero rows on every new tenant and rows on every existing one — the same
-- migration set producing two different tenants, which is the one thing the
-- ledger exists to prevent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS role_kpi_config (
  role_id     uuid PRIMARY KEY REFERENCES role(role_id) ON DELETE CASCADE,
  scope_ids   text[],                       -- NULL = everything the role can read
  default_ids text[] NOT NULL DEFAULT '{}',
  locked_ids  text[] NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (scope_ids IS NULL OR default_ids <@ scope_ids),
  CHECK (locked_ids <@ default_ids),
  CHECK (array_length(default_ids, 1) IS NULL OR array_length(default_ids, 1) <= 4)
);

-- DOWN
-- DROP TABLE IF EXISTS role_kpi_config;
