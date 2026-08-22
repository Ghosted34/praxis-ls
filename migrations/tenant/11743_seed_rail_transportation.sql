-- ============================================================================
-- 11743 — Seed Rail Transportation, Rail Hinterland Transit & End-to-End Rail Freight.
--
-- 1. Updates itinerary leg mode constraint to support RAIL.
-- 2. Seeds RAIL_TRANSPORTATION (Domestic Inland, code RT),
--    RAIL_HINTERLAND_TRANSIT (Transit Hinterland, code RH), and
--    END_TO_END_RAIL_FREIGHT (End-to-End International, code ER) into service_type.
-- ============================================================================

-- ── 1. Itinerary leg mode constraint ────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE dossier_itinerary_leg DROP CONSTRAINT IF EXISTS dossier_itinerary_leg_mode_check;
  ALTER TABLE dossier_itinerary_leg ADD CONSTRAINT dossier_itinerary_leg_mode_check
    CHECK (mode IN ('AIR','SEA','LAND','RAIL','OTHER'));
END $$;

-- ── 2. Service types ────────────────────────────────────────────────────────
INSERT INTO service_type (
  key, name_fr, name_en, territory, is_system, is_active,
  default_duration_days, duration_basis, is_open_ended,
  captures_containers, container_detail_mode,
  itinerary_template, ops_reference_code
) VALUES
(
  'RAIL_TRANSPORTATION',
  'Transport Ferroviaire',
  'Rail Transportation',
  'DOMESTIC_INLAND',
  true, true,
  8, 'WORKING_DAYS', false,
  true, 'GROUPED',
  '[{"leg_type":"PICKUP","mode":"LAND","is_optional":true},{"leg_type":"MAIN_CARRIAGE","mode":"RAIL"},{"leg_type":"FINAL_DELIVERY","mode":"LAND","is_optional":true}]'::jsonb,
  'RT'
),
(
  'RAIL_HINTERLAND_TRANSIT',
  'Transit Ferroviaire Hinterland',
  'Rail Hinterland Transit',
  'TRANSIT_HINTERLAND',
  true, true,
  15, 'WORKING_DAYS', false,
  true, 'GROUPED',
  '[{"leg_type":"INLAND_TRANSIT","mode":"RAIL"},{"leg_type":"CUSTOMS","mode":"OTHER","is_optional":true},{"leg_type":"FINAL_DELIVERY","mode":"LAND","is_optional":true}]'::jsonb,
  'RH'
),
(
  'END_TO_END_RAIL_FREIGHT',
  'Fret Ferroviaire Porte-à-Porte',
  'End-to-End Rail Freight',
  'END_TO_END_INTERNATIONAL',
  true, true,
  20, 'WORKING_DAYS', false,
  true, 'GROUPED',
  '[{"leg_type":"PICKUP","mode":"LAND"},{"leg_type":"MAIN_CARRIAGE","mode":"RAIL"},{"leg_type":"CUSTOMS","mode":"OTHER"},{"leg_type":"FINAL_DELIVERY","mode":"LAND"}]'::jsonb,
  'ER'
)
ON CONFLICT (key) DO UPDATE SET
  name_fr = EXCLUDED.name_fr,
  name_en = EXCLUDED.name_en,
  territory = EXCLUDED.territory,
  default_duration_days = COALESCE(service_type.default_duration_days, EXCLUDED.default_duration_days),
  duration_basis = COALESCE(service_type.duration_basis, EXCLUDED.duration_basis),
  captures_containers = EXCLUDED.captures_containers,
  container_detail_mode = EXCLUDED.container_detail_mode,
  itinerary_template = CASE WHEN service_type.itinerary_template = '[]'::jsonb THEN EXCLUDED.itinerary_template ELSE service_type.itinerary_template END,
  ops_reference_code = COALESCE(service_type.ops_reference_code, EXCLUDED.ops_reference_code);

-- DOWN
-- DELETE FROM service_type WHERE is_system AND key IN ('RAIL_TRANSPORTATION','RAIL_HINTERLAND_TRANSIT','END_TO_END_RAIL_FREIGHT');
-- ALTER TABLE dossier_itinerary_leg DROP CONSTRAINT IF EXISTS dossier_itinerary_leg_mode_check;
-- ALTER TABLE dossier_itinerary_leg ADD CONSTRAINT dossier_itinerary_leg_mode_check CHECK (mode IN ('AIR','SEA','LAND','OTHER'));
