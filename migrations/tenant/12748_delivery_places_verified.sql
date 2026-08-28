-- ============================================================================
-- TENANT DB — 12748  Every field that names WHERE cargo is delivered becomes a
--                    verified place field. Scoped by COLUMN, not by role.
--
-- WHAT IS WRONG, AND WHERE IT SHOWS. Open an AIR FREIGHT file and the wizard
-- draws "Origin airport" and "Destination airport" as place pickers, and "Place
-- of delivery" as a plain text box beside them. The delivery address — the one
-- field a customer telephones about, the one the delivery note prints, and the
-- one `itinerary.legsFromTemplate` builds the final leg from — is the only
-- location on the form that nobody verified.
--
-- WHY THE TWO EARLIER PASSES MISSED IT.
--
--   0676 promoted TEXT → GEO_PLACE by facet_role, and its role list was
--        ORIGIN / DESTINATION / ROUTE_VIA / CUSTODY_LOCATION. `place_delivery`
--        did not carry any of them.
--
--   0678 introduced COLLECTION and FINAL_DELIVERY, promoted the rows whose role
--        was NULL, and INSERTED the field for the sets that lacked it — guarded
--        `WHERE NOT EXISTS (… x.key = v.key OR x.column_name = v.column_name)`.
--
-- Both guards are individually correct and together they leave a hole: a set
-- that ALREADY had a `place_delivery` field carrying some OTHER role (a
-- DESTINATION tagging, a role a tenant chose) is skipped by 0678's insert
-- because the column is taken, and skipped by both promotions because the role
-- does not match. It stays TEXT for ever.
--
-- THE FIX IS TO STOP ASKING ABOUT THE ROLE. `chk_stf_column_name` (0660)
-- reserves `place_delivery` and `place_receipt` for exactly one meaning each, so
-- a field bound to that column NAMES A PLACE whatever anybody tagged it. That is
-- the durable test, and it covers the sets a tenant authored themselves.
--
-- WHY THIS IS SAFE, AND WHY IT IS NOT A DATA MIGRATION. The two data types store
-- the same thing: GEO_PLACE writes the place's display name as text, exactly as
-- TEXT did (shipment_details.service — the GEO_PLACE case returns
-- String(value).trim()). Nothing is rewritten and no existing value becomes
-- invalid. What changes is the CONTROL the browser draws and the verification
-- the save path may then demand. A value already on a file that is not in the
-- catalogue keeps displaying and is offered for upgrade rather than erased.
--
-- NOT TOUCHED, deliberately:
--   * fields a tenant has already changed to some other type — only TEXT is
--     promoted, so a hand-authored SELECT of three depots is left alone;
--   * retired fields (is_active = false), which nothing renders;
--   * any other column. This migration is about the two door-leg places and
--     says so in its WHERE clause.
--
-- Idempotent: the WHERE excludes rows already converted, so a re-run is a no-op.
-- ============================================================================

UPDATE service_type_field
   SET data_type = 'GEO_PLACE'
 WHERE column_name IN ('place_delivery', 'place_receipt')
   AND data_type = 'TEXT'
   AND is_active IS NOT false;

-- The role, for the rows that still have none. `shipment_details.PLACE_ROLES`
-- gates verification on the ROLE, so a field promoted above without one would
-- draw the picker and skip the check behind it — a control that looks verified
-- and is not, which is worse than the plain box it replaced.
--
-- Rows that already carry a role keep it: the two end-to-end service types tag
-- `place_delivery` as DESTINATION on purpose (0678 explains why — on a
-- door-to-door file the delivery address IS the destination every document
-- prints), and DESTINATION is in PLACE_ROLES already.
UPDATE service_type_field
   SET facet_role = CASE WHEN column_name = 'place_receipt' THEN 'COLLECTION' ELSE 'FINAL_DELIVERY' END
 WHERE column_name IN ('place_delivery', 'place_receipt')
   AND facet_role IS NULL
   AND is_active IS NOT false;

-- DOWN
--   Deliberately not reversed. Demoting these to TEXT would take the picker away
--   from files that now hold verified places, and the value would survive either
--   way — so the "reversal" would lose the verification and change nothing a
--   reader could see. To roll back, restore the specific rows from a backup.
--   UPDATE service_type_field SET data_type = 'TEXT'
--    WHERE column_name IN ('place_delivery','place_receipt') AND data_type = 'GEO_PLACE';
