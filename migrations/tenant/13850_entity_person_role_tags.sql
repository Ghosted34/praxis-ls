-- ============================================================================
-- TENANT DB — 13850 Entity people hold several roles at once.
--
-- ── THE CASE THAT PROMPTED THIS ─────────────────────────────────────────────
--
-- An owner holds 100% of the shares AND acts as the managing director. The
-- entity's People & shareholding tab could record them as a shareholder or as a
-- director, never as both: `entity_person.role` is a single CHECK-constrained
-- value, so "shareholder and director" meant two rows for one human — two rows
-- that have to be kept in step by hand and that any reader has to know to
-- re-join.
--
-- 0515 already anticipated this and said so at line 249:
--
--   "ONE table with a role, not three. In a real company the same person is
--    usually several of these at once — the majority shareholder is also the
--    managing director and the primary bank signatory — and separate tables
--    mean maintaining them in three places until they drift."
--
-- The table was one; the ROW was still one role. This closes that gap.
--
-- ── WHY role_tags AND NOT A SECOND ROLE COLUMN ──────────────────────────────
--
-- `entity_contact.role_tags text[]` (0515 §8) is the same idea one table over —
-- the contact's departments — so this is the pattern already in the schema, not
-- a new one. `role` stays the PRIMARY role: it is NOT NULL, every existing row
-- and query keeps working untouched, and it is what orders the collection and
-- what the two tables on the tab are built from. The array carries the OTHER
-- roles, and the person's effective role set is the union.
--
-- Keeping `role` required is deliberate. A row whose only role lives in the
-- array would leave `role` meaningless, and the cap-table rules, the readiness
-- checklist and the ORDER BY all read it. Making the array additive means this
-- migration changes no existing row's meaning: every row's union today is
-- exactly the single value it already had.
--
-- ── WHY NOT A JOIN TABLE ────────────────────────────────────────────────────
--
-- person_role(person_id, role) is the textbook answer and it buys nothing here:
-- roles are a closed list of eight carried on a row that is always read whole,
-- the array keeps the read to the same single query `collections()` already
-- runs, and a join table would need its own nested CRUD from the UI (add role /
-- remove role as separate operations) for a checkbox group to express.
--
-- ── SCOPE ───────────────────────────────────────────────────────────────────
--
-- 0515 is baselined and frozen; this is an ALTER against it. The CHECK is added
-- in a DO block because Postgres has no ADD CONSTRAINT IF NOT EXISTS, and the
-- column with IF NOT EXISTS so a partial run re-runs clean. No backfill: '{}'
-- is the truthful value for every existing row, whose union is its `role`.
-- ============================================================================

ALTER TABLE entity_person
  ADD COLUMN IF NOT EXISTS role_tags text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN entity_person.role_tags IS
  'Additional roles held by the same person, beside the primary `role`. The effective set is role + role_tags (see entityCommon.personRoles). Empty on every row written before 13850.';

-- The values are the same eight 0515 allows for `role`, enforced the same way.
-- `<@` is "is contained by": every element of role_tags must be in the list.
-- An empty array is trivially contained, which is what makes the default valid.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'entity_person_role_tags_valid'
  ) THEN
    ALTER TABLE entity_person ADD CONSTRAINT entity_person_role_tags_valid
      CHECK (role_tags <@ ARRAY[
        'SHAREHOLDER', 'DIRECTOR', 'OFFICER', 'LEGAL_REPRESENTATIVE',
        'AUTHORISED_SIGNATORY', 'BENEFICIAL_OWNER', 'STATUTORY_AUDITOR',
        'SECRETARY'
      ]::text[]);
  END IF;
END $$;

-- DOWN
-- The column is additive and nothing reads it before this migration's code
-- ships, so undoing is a drop. It takes the extra roles with it — rows keep
-- their primary `role`, which is the whole state a pre-13850 database had.
-- ALTER TABLE entity_person DROP CONSTRAINT IF EXISTS entity_person_role_tags_valid;
-- ALTER TABLE entity_person DROP COLUMN IF EXISTS role_tags;
