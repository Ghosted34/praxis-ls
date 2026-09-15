-- ============================================================================
-- TENANT — 12774 What a quote enquiry for this service has to ask.
--
-- ── THE BUG THIS ENDS ──────────────────────────────────────────────────────
--
-- The public quote form decided which questions to ask from the TRANSPORT MODE,
-- and the mode is derived from `service_type.key` (`_shared/service-mode.js`).
-- Everything that was not warehousing therefore got the freight branch: origin,
-- destination, and a REQUIRED Incoterm.
--
-- For Business Representation — a client asking the tenant to act for them
-- locally, with no cargo at all — that is three questions with no honest answer,
-- in front of a stranger, before the form will let them continue. They invent
-- something or they leave.
--
-- ── WHY A COLUMN AND NOT MORE KEYWORDS ─────────────────────────────────────
--
-- Adding 'REPRESENTATION' to the mode table would fix these fifteen rows and
-- fail on the sixteenth. Services are DATA (0310_operations.sql — "user
-- creatable"): a tenant adds Consultancy tomorrow, its key matches nothing, and
-- it silently inherits the freight branch again. Guessing from a string is fine
-- for a GLYPH, where being wrong costs an icon; it is not fine for deciding
-- which fields a prospect must fill before they can talk to a salesperson.
--
-- The tenant knows the answer. This is where they say it.
--
-- ── AND WHY IT IS NOT `territory` ──────────────────────────────────────────
--
-- `territory` (INTERNATIONAL_IMPORT | DOMESTIC_INLAND | …) is where the goods
-- move, which is an operational fact about routing a dossier. This is the shape
-- of a CONVERSATION with somebody who is not a client yet. Overloading territory
-- would make the sales form a hostage of the operations taxonomy — the same
-- mistake 12755 avoided when it gave marketing pillars their own table rather
-- than reusing territory for them.
--
-- ── THE THREE SHAPES ───────────────────────────────────────────────────────
--
--   ROUTE    from somewhere to somewhere, on an agreed delivery term.
--            Origin, destination, Incoterm. The default, and correct for every
--            freight service and for customs brokerage, whose file has an
--            origin and an Incoterm even though the goods never leave the port.
--   STORAGE  a place and a duration, no journey. Warehousing.
--   NONE     no movement to describe. The enquiry is the message. Business
--            representation, consultancy, agency work.
--
-- DEFAULT 'ROUTE' so every existing row keeps today's behaviour and a tenant
-- who never touches this column is unaffected. Seed 9087 sets the two that are
-- not ROUTE.
-- ============================================================================

ALTER TABLE service_type
  ADD COLUMN IF NOT EXISTS enquiry_shape text NOT NULL DEFAULT 'ROUTE';

ALTER TABLE service_type
  DROP CONSTRAINT IF EXISTS service_type_enquiry_shape_chk;

-- ADD CONSTRAINT has no IF NOT EXISTS in any Postgres version, so the guard is
-- an explicit catalog check — the shape `scripts/db/check-migration-idempotency.js`
-- requires and 12755 already uses for its accent CHECK.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'service_type_enquiry_shape_chk'
       AND conrelid = 'service_type'::regclass
  ) THEN
    ALTER TABLE service_type
      ADD CONSTRAINT service_type_enquiry_shape_chk
      CHECK (enquiry_shape IN ('ROUTE', 'STORAGE', 'NONE'));
  END IF;
END $$;

COMMENT ON COLUMN service_type.enquiry_shape IS
  'What a public quote enquiry must ask for this service: ROUTE (origin, destination, Incoterm) | STORAGE (place, duration) | NONE (no movement — the message is the enquiry). Sales-side, unrelated to territory, which is operational.';

-- ============================================================================
-- VERIFY
--   SELECT key, enquiry_shape FROM service_type ORDER BY key;
--     -- every row 'ROUTE' until seed 9087 runs
--   UPDATE service_type SET enquiry_shape = 'MAYBE' WHERE key = 'WAREHOUSING';
--     -- expect: violates service_type_enquiry_shape_chk
--
-- DOWN
--   ALTER TABLE service_type
--     DROP CONSTRAINT IF EXISTS service_type_enquiry_shape_chk,
--     DROP COLUMN IF EXISTS enquiry_shape;
--   -- The public read stops sending the field and the wizard falls back to
--   -- ROUTE for everything, which is exactly the behaviour before this column.
-- ============================================================================
