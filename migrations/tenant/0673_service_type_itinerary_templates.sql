-- 0673 — service types own their default itinerary shape.
ALTER TABLE service_type ADD COLUMN IF NOT EXISTS itinerary_template jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE service_type SET itinerary_template = v.template::jsonb
FROM (VALUES
 ('SEA_FREIGHT_IMPORT','[{"leg_type":"MAIN_CARRIAGE","mode":"SEA"},{"leg_type":"CUSTOMS","mode":"OTHER","is_optional":true},{"leg_type":"FINAL_DELIVERY","mode":"LAND","is_optional":true}]'),
 ('SEA_FREIGHT_EXPORT','[{"leg_type":"MAIN_CARRIAGE","mode":"SEA"},{"leg_type":"FINAL_DELIVERY","mode":"LAND","is_optional":true}]'),
 ('AIR_FREIGHT_IMPORT','[{"leg_type":"MAIN_CARRIAGE","mode":"AIR"},{"leg_type":"CUSTOMS","mode":"OTHER","is_optional":true},{"leg_type":"FINAL_DELIVERY","mode":"LAND","is_optional":true}]'),
 ('AIR_FREIGHT_EXPORT','[{"leg_type":"MAIN_CARRIAGE","mode":"AIR"},{"leg_type":"FINAL_DELIVERY","mode":"LAND","is_optional":true}]'),
 ('HINTERLAND_TRANSIT','[{"leg_type":"INLAND_TRANSIT","mode":"LAND"},{"leg_type":"FINAL_DELIVERY","mode":"LAND","is_optional":true}]'),
 ('INLAND_TRANSPORTATION','[{"leg_type":"PICKUP","mode":"LAND"},{"leg_type":"INLAND_TRANSIT","mode":"LAND"},{"leg_type":"FINAL_DELIVERY","mode":"LAND"}]'),
 ('END_TO_END_AIR_FREIGHT','[{"leg_type":"PICKUP","mode":"LAND"},{"leg_type":"MAIN_CARRIAGE","mode":"AIR"},{"leg_type":"CUSTOMS","mode":"OTHER"},{"leg_type":"FINAL_DELIVERY","mode":"LAND"}]'),
 ('END_TO_END_SEA_FREIGHT','[{"leg_type":"PICKUP","mode":"LAND"},{"leg_type":"MAIN_CARRIAGE","mode":"SEA"},{"leg_type":"CUSTOMS","mode":"OTHER"},{"leg_type":"FINAL_DELIVERY","mode":"LAND"}]'),
 ('PROJECT_CARGO','[{"leg_type":"MAIN_CARRIAGE","mode":"LAND","is_optional":true},{"leg_type":"FINAL_DELIVERY","mode":"LAND","is_optional":true}]')
) AS v(key, template) WHERE service_type.key = v.key AND service_type.itinerary_template = '[]'::jsonb;

-- DOWN
-- ALTER TABLE service_type DROP COLUMN IF EXISTS itinerary_template;
