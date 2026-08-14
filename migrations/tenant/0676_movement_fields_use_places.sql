-- ============================================================================
-- 0676 — every field that names WHERE cargo goes becomes a verified place field.
--
-- WHAT WAS WRONG. 9092 seeded the detail forms, and it got the shape right but
-- the TYPE inconsistent. Sea and air files carry `GEO_PLACE` origins and
-- destinations, so those render the port picker. But:
--
--   * INLAND `place_receipt` / `place_delivery`      → TEXT
--   * HINTERLAND `final_destination`                  → TEXT
--   * end-to-end `place_delivery` (9092's override)   → TEXT
--   * WAREHOUSE `warehouse_location`                  → TEXT
--
-- …were plain text boxes. So the two service types whose ENTIRE job is a road
-- movement, and the one whose job is custody of goods at a location, were the
-- ones that could not name a location the map could plot. An inland file was
-- typed as "Douala port to Ndjamena warehouse" and appeared nowhere.
--
-- WHY THIS IS SAFE, AND WHY IT IS NOT A DATA MIGRATION. The two types store the
-- same thing: `GEO_PLACE` writes the place's display name as text, exactly as
-- TEXT did (see shipment_details.service — the GEO_PLACE case returns
-- String(value)). Nothing is rewritten, no existing value becomes invalid, and
-- `column_name` bindings are untouched. What changes is the CONTROL the browser
-- renders and the verification the save path can therefore demand. An existing
-- value that is not in the catalogue keeps displaying and is offered for upgrade
-- rather than being erased.
--
-- SCOPED BY ROLE, NOT BY KEY. The WHERE clause selects on `facet_role`, not on a
-- list of field keys, so a tenant who added their own ORIGIN field to a service
-- type gets the picker too, and a tenant who renamed one keeps it. The roles
-- chosen are exactly the four that mean "a geographic point":
-- ORIGIN, DESTINATION, ROUTE_VIA, CUSTODY_LOCATION.
--
-- NOT TOUCHED, deliberately:
--   * anything a tenant has already changed to a non-TEXT type — this only
--     promotes TEXT, so a hand-authored SELECT of three depots is left alone;
--   * retired fields (is_active = false), which nothing renders anyway;
--   * any other facet role. CARGO_DESC is prose, CUSTOMS_REF is a number, and a
--     picker on either would be an obstruction.
--
-- Idempotent: the UPDATE's WHERE excludes rows it has already converted, so a
-- second run matches nothing.
-- ============================================================================

UPDATE service_type_field
   SET data_type = 'GEO_PLACE'
 WHERE data_type = 'TEXT'
   AND is_active IS NOT false
   AND facet_role IN ('ORIGIN', 'DESTINATION', 'ROUTE_VIA', 'CUSTODY_LOCATION');

-- The placeholder still says "type the delivery address", which is now wrong
-- advice: the control is a picker. Only replaced where it is still the seeded
-- text — a tenant who wrote their own hint keeps it.
UPDATE service_type_field
   SET placeholder = NULL
 WHERE data_type = 'GEO_PLACE'
   AND facet_role IN ('ORIGIN', 'DESTINATION', 'ROUTE_VIA', 'CUSTODY_LOCATION')
   AND placeholder IS NOT NULL
   AND placeholder ~* '^(e\.?g\.?|ex\.?|type|enter|saisir)\b';

-- DOWN
-- IRREVERSIBLE: the pre-conversion data_type of each field is not recorded, and
-- reversing by facet_role would flatten a tenant's own GEO_PLACE fields to TEXT
-- alongside the ones this file converted. The conversion is additive in effect
-- (no stored value changes meaning, no column binding moves), so the recovery
-- for an unwanted conversion is to set the individual field's type back from the
-- Service types → Details screen, which is a supported edit and leaves an audit
-- row. Restoring the dump is the answer for a wholesale revert.
