-- ============================================================================
-- TENANT SEED — 9087 The two seeded services that are not a route.
--
-- 12774 defaults every service to ROUTE, which is right for thirteen of the
-- fifteen 9080 seeds. These are the two it is wrong for:
--
--   WAREHOUSING              a place and a duration, no journey.
--   BUSINESS_REPRESENTATION  no movement at all — the enquiry IS the message.
--
-- Customs brokerage stays ROUTE deliberately: a clearance file has an origin and
-- an Incoterm, and the desk needs both to price it, even though the goods never
-- leave the port zone. Project cargo stays ROUTE for the same reason — it is
-- unusual freight, not an absence of freight.
--
-- Idempotent by predicate, not by ON CONFLICT: an UPDATE that sets a column to a
-- constant is the same UPDATE every time it runs. The `enquiry_shape = 'ROUTE'`
-- clause is what stops a re-run from stamping over a tenant who has since made
-- their own choice — the seed only ever moves a row off the default.
-- ============================================================================

UPDATE service_type
   SET enquiry_shape = 'STORAGE'
 WHERE key = 'WAREHOUSING'
   AND enquiry_shape = 'ROUTE';

UPDATE service_type
   SET enquiry_shape = 'NONE'
 WHERE key = 'BUSINESS_REPRESENTATION'
   AND enquiry_shape = 'ROUTE';

-- ============================================================================
-- VERIFY
--   SELECT key, enquiry_shape FROM service_type
--    WHERE enquiry_shape <> 'ROUTE' ORDER BY key;
--     -- BUSINESS_REPRESENTATION NONE, WAREHOUSING STORAGE
--
-- DOWN
--   UPDATE service_type SET enquiry_shape = 'ROUTE'
--    WHERE key IN ('WAREHOUSING', 'BUSINESS_REPRESENTATION');
-- ============================================================================
