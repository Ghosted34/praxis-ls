-- ============================================================================
-- TENANT DB — 12772  Container capture: PER_BOX becomes the default, everywhere.
--
-- WHAT CHANGED, AND WHY.
--
-- 12769 flipped the shipping service types (sea, air, rail, project, hinterland)
-- to PER_BOX so a containerised file could record each box's number and seal,
-- not just its counts. It scoped the flip to a hand-listed set of service-type
-- keys. Two things followed from that:
--
--   1. The key list ('SEA','AIR','HINTERLAND','PROJECT', 'RAIL%', 'END_TO_END_RAIL')
--      never matched the keys the seed actually ships ('SEA_FREIGHT_IMPORT',
--      'HINTERLAND_TRANSIT', 'PROJECT_CARGO', …), so on a seeded tenant the flip
--      touched only the two 'RAIL%' rows. Most containerised files stayed GROUPED
--      and the container-number fields never appeared.
--
--   2. A service type a tenant switches ON later, or one added by hand, inherits
--      the column default — 'GROUPED' (0660) — so it captures counts only.
--
-- This migration makes PER_BOX the default for EVERYONE, key-independently:
--
--   * Every GROUPED row becomes PER_BOX. The condition is the mode, not a key
--     list, so it covers the freight types 12769 missed and any tenant-authored
--     service type too. The mode is inert while `captures_containers` is false,
--     so flipping a non-equipment type is harmless and future-proofs it: turn
--     equipment capture on later and it is PER_BOX, not GROUPED.
--   * The column default flips to 'PER_BOX', so a service type created after this
--     captures box-level detail unless a tenant deliberately chooses GROUPED.
--
-- PER_BOX is a SUPERSET of GROUPED — it only ADDS the ability to record a
-- `container_no` / `seal_no` per unit, and never requires one — so widening the
-- flip strands no workflow. GROUPED remains a supported choice under Service
-- types → Details for a tenant who wants counts only.
--
-- IDEMPOTENT. The UPDATE is a no-op on the second pass (nothing left GROUPED
-- that this run did not already move), and SET DEFAULT sets the same value
-- again. The RLS session GUC is set for every tenant DB (see run-migrations.js),
-- so both statements apply within the current tenant boundary.
-- ============================================================================

UPDATE service_type
   SET container_detail_mode = 'PER_BOX'
 WHERE container_detail_mode = 'GROUPED';

ALTER TABLE service_type
  ALTER COLUMN container_detail_mode SET DEFAULT 'PER_BOX';

-- DOWN
-- ALTER TABLE service_type
--   ALTER COLUMN container_detail_mode SET DEFAULT 'GROUPED';
--
-- The data flip is deliberately NOT reversed. Reversing it would hide the
-- container_no / seal_no fields in the editor again; the recorded units
-- (dossier_container_unit) are NOT deleted — PER_BOX is a superset — so a
-- re-flip forward makes them visible again with no data loss. Restoring the
-- column default is enough to undo the schema half; only revert the stored
-- modes by hand, per service type, once you have confirmed no operator has come
-- to rely on the per-box detail (e.g. a delivery-note preview that names a box).
