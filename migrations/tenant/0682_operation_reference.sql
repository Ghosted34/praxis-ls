-- ============================================================================
-- 0682 — operation-file references stop being guessable.
--
-- ── THE DEFECT ──────────────────────────────────────────────────────────────
--
-- `numbering.service.allocate()` produces a human-readable SEQUENTIAL number,
-- and the operations file uses it: `SLAS-OPS-2026-0142`. That is exactly right
-- for an invoice — accounting continuity, statutory reconciliation, gap-free
-- per entity and year — and exactly wrong for a dossier reference, because a
-- dossier reference is the one number in this system a CLIENT sees.
--
-- A client holding `SLAS-OPS-2026-0142` can read off, without trying anything:
-- roughly how many files we opened this year, when theirs sits in that order,
-- and how fast the business is growing. And they can TRY `…-0141` and `…-0143`.
-- A predictable reference is never authorization — every read is still gated by
-- tenant/RBAC and, on the portal, by ownership — but enumerability is a leak on
-- its own, and it is one we hand out on every document we print.
--
-- The legacy PHP system had this right by accident: `SL6721864SM` — entity
-- prefix, random core, service code. Nothing in that shape is countable. This
-- migration is the schema half of modernising that convention rather than
-- discarding it.
--
-- ── WHAT THIS DELIBERATELY DOES NOT TOUCH ───────────────────────────────────
--
-- `doc_sequence`, and therefore every financial and statutory number: invoices,
-- proformas, receipts, journal entries, purchase orders, supplier invoices, tax
-- documents. Those NEED to be sequential — an accountant reconciling a year
-- reads them in order and a gap is a question somebody has to answer. Random
-- numbering there would be a regression dressed as a security fix. The
-- operation file gets a separate allocator; nothing else changes.
--
-- No `dossier.ref` value is rewritten, now or ever. Existing files — legacy
-- `SL6721864SM` and modern `SLAS-OPS-2026-0142` alike — keep the reference
-- printed on documents that have already left the building. New files get the
-- new shape. Search handles all three (src/services/documents/
-- operation-reference.js `classifyReference`).
--
-- ── THE TWO COLUMNS ─────────────────────────────────────────────────────────
--
--   corporate_entity.ops_reference_prefix   'SL'  — which of our entities
--   service_type.ops_reference_code         'SM'  — what kind of job
--
-- Both are recognition only. Neither carries any of the security weight: that
-- is entirely the random core between them, which the application generates
-- with `crypto.randomBytes` and never derives from anything countable.
--
-- WHY NOT REUSE `corporate_entity.doc_prefix`. It is the FINANCIAL prefix
-- ('SLAS'), it is free-text and up to a tenant, it is not unique, and it feeds
-- invoice numbering. Overloading it would mean an entity could not change its
-- invoice prefix without changing the shape of dossier references that are
-- already in clients' hands — two unrelated decisions welded together.
--
-- ── ASSIGNED ONCE ───────────────────────────────────────────────────────────
--
-- Both are two characters, unique within the tenant, and seeded here for every
-- row that exists. They are meant to be permanent: a reference that has been
-- quoted to a client is a fact about the past, so an entity that later changes
-- its prefix must not retroactively change what its old files are called. The
-- application enforces "immutable once used" (a prefix or code cannot be
-- changed once a dossier carries a reference built from it); the database keeps
-- the shape and the uniqueness.
--
-- The seeding order is `created_at, entity_id` — deterministic, so re-running
-- against a partially-seeded database assigns the same prefixes it would have
-- assigned the first time.
--
-- ── UNIQUENESS IS PER SCHEMA, WHICH IS PER TENANT PER ENVIRONMENT ───────────
--
-- These indexes are unqualified, so they are created inside `live` and inside
-- `sandbox` separately, and each tenant has its own database. Two tenants may
-- both use 'SL' and never collide — which is the correct scope: a prefix means
-- "our Smart Logistics entity", not anything global.
--
-- Idempotent: every statement is guarded, and the seeding loops only ever touch
-- rows whose value is still NULL.
-- ============================================================================

/* ── 1. Entity operation-reference prefix ─────────────────────────────────── */

ALTER TABLE corporate_entity
  ADD COLUMN IF NOT EXISTS ops_reference_prefix text;

COMMENT ON COLUMN corporate_entity.ops_reference_prefix IS
  'Two-character entity marker that leads this entity''s operation-file '
  'references (SL in SL7Z3K9QW2M4XBSM). Recognition only — the security '
  'property is the random core, not this. Assigned once, immutable once a '
  'dossier has used it; distinct from doc_prefix, which leads INVOICE numbers.';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_entity_ops_reference_prefix') THEN
    ALTER TABLE corporate_entity ADD CONSTRAINT chk_entity_ops_reference_prefix CHECK (
      ops_reference_prefix IS NULL OR ops_reference_prefix ~ '^[A-Z0-9]{2}$'
    );
  END IF;
END $$;

-- Partial, so the many rows that have not been assigned one yet (there are none
-- after the seed below, but a row inserted by a path that predates this file
-- would be) do not all collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS ux_corporate_entity_ops_reference_prefix
  ON corporate_entity(ops_reference_prefix) WHERE ops_reference_prefix IS NOT NULL;

/* ── 2. Service-type operation-reference code ─────────────────────────────── */

ALTER TABLE service_type
  ADD COLUMN IF NOT EXISTS ops_reference_code text;

COMMENT ON COLUMN service_type.ops_reference_code IS
  'Two-character service marker that closes an operation-file reference (SM in '
  'SL7Z3K9QW2M4XBSM). Recognition only. Immutable once a dossier has used it — '
  'renaming the service type never changes references already issued.';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_service_type_ops_reference_code') THEN
    ALTER TABLE service_type ADD CONSTRAINT chk_service_type_ops_reference_code CHECK (
      ops_reference_code IS NULL OR ops_reference_code ~ '^[A-Z0-9]{2}$'
    );
  END IF;
END $$;

-- Unique across ALL service types, active or not: an archived service type's
-- code must not be handed to a new one, or two files with different references
-- would read as the same kind of job.
CREATE UNIQUE INDEX IF NOT EXISTS ux_service_type_ops_reference_code
  ON service_type(ops_reference_code) WHERE ops_reference_code IS NOT NULL;

/* ── 3. Seed the codes every tenant already has ───────────────────────────── */

-- The shipped taxonomy's codes, which are the ones the business already uses on
-- legacy references (SM on a sea import, HT on a hinterland transit). Kept in
-- step with DEFAULT_SERVICE_CODES in src/services/documents/operation-reference.js
-- by tests/unit/operation-reference-service-code.test.js, which reads both files.
--
-- A code already taken by another row is skipped here and picked up by the
-- fallback walk below, so a tenant that renamed its service types still ends up
-- with a complete, unique set.
DO $$
DECLARE
  r        record;
  wanted   text;
  cand     text;
  chars    text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  i        int;
  j        int;
  assigned boolean;
  defaults jsonb := jsonb_build_object(
    'SEA_FREIGHT_IMPORT',      'SM',
    'SEA_FREIGHT_EXPORT',      'SX',
    'AIR_FREIGHT_IMPORT',      'AM',
    'AIR_FREIGHT_EXPORT',      'AX',
    'HINTERLAND_TRANSIT',      'HT',
    'INLAND_TRANSPORTATION',   'IT',
    'WAREHOUSING',             'WH',
    'END_TO_END_AIR_FREIGHT',  'AF',
    'END_TO_END_SEA_FREIGHT',  'EF',
    'BUSINESS_REPRESENTATION', 'BR',
    'CUSTOMS_BROKERAGE',       'CB',
    'PROJECT_CARGO',           'PC',
    'RAIL_TRANSPORTATION',     'RT',
    'RAIL_HINTERLAND_TRANSIT', 'RH',
    'END_TO_END_RAIL_FREIGHT', 'ER'
  );
BEGIN
  FOR r IN
    SELECT service_type_id, upper(key::text) AS k
      FROM service_type
     WHERE ops_reference_code IS NULL
     ORDER BY created_at, service_type_id
  LOOP
    -- Preferred: the shipped code. Otherwise the initials of the first two
    -- words of the key — PROJECT_CARGO -> PC, WAREHOUSING -> WA — which is the
    -- same rule `deriveServiceCode` applies in the application.
    wanted := defaults ->> r.k;
    IF wanted IS NULL THEN
      wanted := upper(
        substr(split_part(r.k, '_', 1), 1, 1) ||
        COALESCE(
          NULLIF(substr(split_part(r.k, '_', 2), 1, 1), ''),
          NULLIF(substr(split_part(r.k, '_', 1), 2, 1), ''),
          'X'
        )
      );
    END IF;
    IF wanted !~ '^[A-Z0-9]{2}$' THEN wanted := 'OX'; END IF;

    assigned := false;
    -- First choice, then the second character walked through a readable
    -- alphabet, then the whole two-character space. Deterministic at every step
    -- so a re-run reproduces the same assignment.
    FOR i IN 0 .. length(chars) LOOP
      IF i = 0 THEN
        cand := wanted;
      ELSE
        cand := substr(wanted, 1, 1) || substr(chars, i, 1);
        CONTINUE WHEN cand = wanted;
      END IF;
      -- 'OP' is what a file with no service type uses; never hand it to a real one.
      CONTINUE WHEN cand = 'OP';
      IF NOT EXISTS (SELECT 1 FROM service_type WHERE ops_reference_code = cand) THEN
        UPDATE service_type SET ops_reference_code = cand
         WHERE service_type_id = r.service_type_id AND ops_reference_code IS NULL;
        assigned := true;
        EXIT;
      END IF;
    END LOOP;

    IF NOT assigned THEN
      FOR i IN 1 .. length(chars) LOOP
        FOR j IN 1 .. length(chars) LOOP
          cand := substr(chars, i, 1) || substr(chars, j, 1);
          CONTINUE WHEN cand = 'OP';
          IF NOT EXISTS (SELECT 1 FROM service_type WHERE ops_reference_code = cand) THEN
            UPDATE service_type SET ops_reference_code = cand
             WHERE service_type_id = r.service_type_id AND ops_reference_code IS NULL;
            assigned := true;
            EXIT;
          END IF;
        END LOOP;
        EXIT WHEN assigned;
      END LOOP;
    END IF;

    -- 900 taken codes on one tenant is not a state worth inventing a recovery
    -- for; leaving it NULL lets the application assign one later and keeps the
    -- migration from failing the whole deploy over it.
    IF NOT assigned THEN
      RAISE WARNING 'service_type % : no free operation-reference code', r.k;
    END IF;
  END LOOP;
END $$;

/* ── 4. Seed the prefix for every entity that exists ──────────────────────── */

-- Two initials from the entity's trading or legal name — "Smart Logistics" ->
-- SL, "Base Cameroon Limited" -> BC — then the same deterministic fallback walk.
--
-- ACCENTS, IN TWO PASSES, AND THE ORDER MATTERS. Punctuation becomes a space
-- FIRST, while "É" is still one alphanumeric character ("Étoile-Logistique" ->
-- "Étoile Logistique"); only then is the string NFD-normalised and everything
-- outside plain ASCII dropped, which turns "É" into "E" rather than into a
-- word break. Done the other way round the combining accent becomes a
-- separator and the name splits mid-word.
--
-- The application applies exactly this rule (`derivePrefix`: punctuation to
-- space, normalize("NFD"), strip non-ASCII), so both sides answer EL. Two
-- implementations of one normaliser is how a normaliser drifts, so
-- tests/unit/operation-reference-prefix.test.js pins the JS half and this
-- comment is the pointer between them.
DO $$
DECLARE
  r        record;
  words    text[];
  wanted   text;
  cand     text;
  chars    text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  i        int;
  j        int;
  assigned boolean;
BEGIN
  FOR r IN
    SELECT entity_id,
           COALESCE(NULLIF(btrim(trading_name), ''), NULLIF(btrim(legal_name), ''), 'Entity') AS nm
      FROM corporate_entity
     WHERE ops_reference_prefix IS NULL
     ORDER BY created_at, entity_id
  LOOP
    words := regexp_split_to_array(
      btrim(regexp_replace(
        normalize(regexp_replace(r.nm, '[^[:alnum:]]+', ' ', 'g'), NFD),
        '[^A-Za-z0-9 ]', '', 'g'
      )),
      '\s+'
    );
    wanted := upper(
      COALESCE(NULLIF(substr(COALESCE(words[1], ''), 1, 1), ''), 'X') ||
      COALESCE(
        NULLIF(substr(COALESCE(words[2], ''), 1, 1), ''),
        NULLIF(substr(COALESCE(words[1], ''), 2, 1), ''),
        'X'
      )
    );
    IF wanted !~ '^[A-Z0-9]{2}$' THEN wanted := 'XX'; END IF;

    assigned := false;
    FOR i IN 0 .. length(chars) LOOP
      IF i = 0 THEN
        cand := wanted;
      ELSE
        cand := substr(wanted, 1, 1) || substr(chars, i, 1);
        CONTINUE WHEN cand = wanted;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM corporate_entity WHERE ops_reference_prefix = cand) THEN
        UPDATE corporate_entity SET ops_reference_prefix = cand
         WHERE entity_id = r.entity_id AND ops_reference_prefix IS NULL;
        assigned := true;
        EXIT;
      END IF;
    END LOOP;

    IF NOT assigned THEN
      FOR i IN 1 .. length(chars) LOOP
        FOR j IN 1 .. length(chars) LOOP
          cand := substr(chars, i, 1) || substr(chars, j, 1);
          IF NOT EXISTS (SELECT 1 FROM corporate_entity WHERE ops_reference_prefix = cand) THEN
            UPDATE corporate_entity SET ops_reference_prefix = cand
             WHERE entity_id = r.entity_id AND ops_reference_prefix IS NULL;
            assigned := true;
            EXIT;
          END IF;
        END LOOP;
        EXIT WHEN assigned;
      END LOOP;
    END IF;

    IF NOT assigned THEN
      RAISE WARNING 'corporate_entity % : no free operation-reference prefix', r.entity_id;
    END IF;
  END LOOP;
END $$;

/* ── 5. The uniqueness the allocator relies on ────────────────────────────── */

-- `dossier.ref` has been UNIQUE since 0310 and the retry loop in
-- `allocateOperationReference` treats that constraint as the final authority on
-- a collision — it generates a new core and tries again on 23505. Asserted here
-- rather than assumed: if a future migration ever drops it, the allocator's
-- collision defence silently becomes a pre-check, which is the one thing the
-- design says it must never be.
-- Read from the catalog rather than by pattern-matching `pg_indexes.indexdef`:
-- the text form varies with the schema qualification and the access method, and
-- a guard that fails a deploy must not be able to misfire on formatting.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_index i
      JOIN pg_class t      ON t.oid = i.indrelid
      JOIN pg_namespace n  ON n.oid = t.relnamespace
      JOIN pg_attribute a  ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
     WHERE t.relname = 'dossier'
       AND n.nspname = current_schema()
       AND i.indisunique
       AND i.indnkeyatts = 1
       AND a.attname = 'ref'
  ) THEN
    RAISE EXCEPTION 'dossier.ref has no unique index — operation references cannot be allocated safely';
  END IF;
END $$;

-- DOWN
-- Additive. Dropping the columns loses the assignment, and every reference
-- already issued from them stays valid and readable — `dossier.ref` is a stored
-- string, not a join.
--
--   DROP INDEX IF EXISTS ux_service_type_ops_reference_code;
--   DROP INDEX IF EXISTS ux_corporate_entity_ops_reference_prefix;
--   ALTER TABLE service_type DROP CONSTRAINT IF EXISTS chk_service_type_ops_reference_code;
--   ALTER TABLE corporate_entity DROP CONSTRAINT IF EXISTS chk_entity_ops_reference_prefix;
--   ALTER TABLE service_type DROP COLUMN IF EXISTS ops_reference_code;
--   ALTER TABLE corporate_entity DROP COLUMN IF EXISTS ops_reference_prefix;
