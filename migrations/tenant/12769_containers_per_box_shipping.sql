-- ============================================================================
-- TENANT DB — 12769  Container capture: PER_BOX for the shipping service types.
--
-- WHAT CHANGED, AND WHY.
--
-- The container editor (0660, 10708) supports two levels of detail per service
-- type:
--
--   GROUPED  — how many of each type ("2 × 40' HC"). Enough for anything
--              charged per type or per TEU.
--   PER_BOX  — additionally the container NUMBER and seal on each box, which
--              are what a delivery note has to name so the client signs against
--              *this* container rather than "one of the two". They arrive with
--              the Bill of Lading, days later, so they are not required to save.
--
-- Every service type was seeded GROUPED (9092:668, the default in 0660:293), so
-- the "Edit containers" dialog on a sea file never asked for MSKU1234567 and
-- the delivery note had nowhere to pull it from. On a freight file whose cargo
-- physically travels in boxes with reference codes on the outside, GROUPED
-- discards the one fact the receiver needs.
--
-- This migration flips the shipping service types — sea, air, rail, and the
-- hinterland and project variants that carry containers — to PER_BOX. Existing
-- container lines keep their counts (the shape is the same, PER_BOX only adds
-- the ability to record `container_no` / `seal_no` on each unit). The editor
-- immediately begins prompting for the number and seal on every new box.
--
-- WHAT IS NOT TOUCHED. Service types that do not carry containers (customs
-- brokerage, representation, warehousing rentals) are guarded by
-- `captures_containers = true` so they stay unchanged. Any service type that
-- has already been switched to PER_BOX by hand is untouched by the second
-- guard.
--
-- IDEMPOTENT. Running twice is a no-op — nothing to switch on the second pass.
-- The RLS session GUC is set for every tenant DB (see run-migrations.js), so
-- this UPDATE applies within the current tenant boundary.
-- ============================================================================

UPDATE service_type
   SET container_detail_mode = 'PER_BOX'
 WHERE captures_containers = true
   AND container_detail_mode = 'GROUPED'
   AND (
     key IN ('SEA', 'AIR', 'HINTERLAND', 'PROJECT')
     OR key LIKE 'RAIL%'
     OR key = 'END_TO_END_RAIL'
   );

-- DOWN
-- UPDATE service_type
--    SET container_detail_mode = 'GROUPED'
--  WHERE container_detail_mode = 'PER_BOX'
--    AND (
--      key IN ('SEA', 'AIR', 'HINTERLAND', 'PROJECT')
--      OR key LIKE 'RAIL%'
--      OR key = 'END_TO_END_RAIL'
--    );
--
-- Reversing this hides the container_no / seal_no fields in the editor again;
-- the recorded units (dossier_container_unit) are NOT deleted — the shape is a
-- superset — so a re-flip forward makes them visible again with no data loss.
-- Only run the DOWN if you have confirmed no operator has come to rely on the
-- per-box detail, since dropping the prompts silently strands any workflow
-- (e.g. delivery-note preview) that expects a per-box number.
