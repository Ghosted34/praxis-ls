-- ============================================================================
-- TENANT DB — 14220 A quote request can name the two doors as well as the two
-- ports: where we collect the cargo, and where we deliver it.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- The portal's quote sheet asked "From" and "To" as two text boxes. That is
-- one question for a port-to-port move and the wrong question for the move a
-- client who has not shipped yet usually wants: collected from a supplier's
-- yard in Guangzhou, flown out of Canton, landed at Douala, delivered to a
-- warehouse in Bonabéri. Four places, two of them addresses, and the form had
-- room for two strings — so the doors went into the cargo description or
-- nowhere, and the desk priced a port-to-port move nobody had asked for.
--
-- The operations file already asks this exact question as "Place of
-- collection" / "Place of delivery" (place_receipt / place_delivery, 0678);
-- these columns are the quote-side half of the same two fields, so a request
-- converted into a file carries its doors across instead of being retyped.
--
-- ── THE SAME PAIRING AS 12756, WITHOUT ITS FOREIGN KEYS ────────────────────
--
-- Text + the verified place behind it, as origin/destination were given in
-- 12756: the text is what the client picked or wrote and is what the desk
-- reads; the place id is the geo_place behind it when there is one. Both ends
-- are optional — NULL is the ordinary port-to-port request, not a broken one.
--
-- The place ids are PLAIN uuid columns, not REFERENCES geo_place like 12756's.
-- quote_request exists before this file, and a constraint added to an
-- existing table above 13791 aborts provisioning a fresh tenant: 13791 mirrors
-- live's constraints into sandbox while sandbox is still at 13791, where these
-- columns do not exist yet (tests/unit/migration-constraint-ordering.test.js).
-- What the FK would have guaranteed is held in code instead:
--   · the only writer is the portal's createClientQuote, through
--     portal_places.resolveQuotePlaces — which stores the id of a geo_place
--     row it has just read or created, never an id the browser sent unread;
--   · the portal reads ids back through a join or geo_place.repo.findByIds,
--     so an id whose place was deleted reads as "no pin" — the outcome ON
--     DELETE SET NULL would have produced — and the text still stands. The
--     application never deletes a geo_place (a place is retired with
--     is_active), so a dangling id takes a hand-run DELETE to create.
-- ============================================================================

ALTER TABLE quote_request
  ADD COLUMN IF NOT EXISTS collection_location text;
ALTER TABLE quote_request
  ADD COLUMN IF NOT EXISTS collection_place_id uuid;

ALTER TABLE quote_request
  ADD COLUMN IF NOT EXISTS delivery_location text;
ALTER TABLE quote_request
  ADD COLUMN IF NOT EXISTS delivery_place_id uuid;

COMMENT ON COLUMN quote_request.collection_location IS
  'Where the cargo is collected, before the main leg — often an address. NULL when the client delivers to the port/airport themselves.';
COMMENT ON COLUMN quote_request.collection_place_id IS
  'geo_place id behind collection_location, resolved server-side (no FK — see 14220). NULL when the requester wrote free text.';
COMMENT ON COLUMN quote_request.delivery_location IS
  'Where the cargo is delivered, after the main leg — often an address. NULL when the client collects at the port/airport.';
COMMENT ON COLUMN quote_request.delivery_place_id IS
  'geo_place id behind delivery_location, resolved server-side (no FK — see 14220). NULL when the requester wrote free text.';

-- ============================================================================
-- VERIFY
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'quote_request'
--      AND column_name IN ('collection_location','collection_place_id',
--                          'delivery_location','delivery_place_id');
--   -- expect 4 rows
--
-- DOWN
--   ALTER TABLE quote_request
--     DROP COLUMN IF EXISTS delivery_place_id,
--     DROP COLUMN IF EXISTS delivery_location,
--     DROP COLUMN IF EXISTS collection_place_id,
--     DROP COLUMN IF EXISTS collection_location;
--   -- Loses the doors on every request that named one. Revert
--   -- quote_request.repo's insert first: it writes all four columns, so every
--   -- quote request insert would otherwise fail naming the missing column.
-- ============================================================================
