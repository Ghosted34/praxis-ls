-- ============================================================================
-- 11743 — Seed Rail Transportation & Rail Hinterland Transit.
--
-- 1. Updates itinerary leg mode constraint to support RAIL.
-- 2. Seeds RAIL_TRANSPORTATION (Domestic Inland, code RT) and
--    RAIL_HINTERLAND_TRANSIT (Transit Hinterland, code RH) into service_type.
-- 3. Sets default durations, container capture toggles, and itinerary templates.
-- 4. Seeds 14-stage standard milestone chains and published assumptions.
-- 5. Seeds active v1 shipment detail field sets and fields.
-- 6. Maps financial dictionary items into service_type_dictionary_item.
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

-- ── 3. Milestone Templates (v1) ─────────────────────────────────────────────
INSERT INTO milestone_template (service_type_id, version, is_active, name, is_system, system_code, source_version)
SELECT st.service_type_id, 1, true, 'Chaîne standard — ' || st.name_fr, true, st.key, 1
  FROM service_type st
 WHERE st.key IN ('RAIL_TRANSPORTATION', 'RAIL_HINTERLAND_TRANSIT')
ON CONFLICT (service_type_id, version) DO NOTHING;

-- Milestone stages staging
CREATE TEMP TABLE _tmp_rail_stages (
  svc        text    NOT NULL,
  seq        integer NOT NULL,
  code       text    NOT NULL,
  label_en   text    NOT NULL,
  label_fr   text    NOT NULL,
  weight     integer NOT NULL,
  min_h      integer NOT NULL,
  owner      text    NOT NULL,
  anchor     boolean NOT NULL DEFAULT false,
  lock       boolean NOT NULL DEFAULT false,
  visible    boolean NOT NULL DEFAULT true,
  evidence   text,
  segment    text    NOT NULL DEFAULT 'MAIN',
  cadence    text,
  auto_event text,
  PRIMARY KEY (svc, code)
) ON COMMIT DROP;

INSERT INTO _tmp_rail_stages (svc,seq,code,label_en,label_fr,weight,min_h,owner,anchor,lock,visible,evidence,segment,cadence,auto_event) VALUES
 ('RAIL_TRANSPORTATION', 1,'BOOKING_REQUEST','Booking requested','Demande de réservation',4,4,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('RAIL_TRANSPORTATION', 2,'DOCS_VERIFIED','Rail documents verified','Documents ferroviaires vérifiés',5,4,'CLIENT',false,false,true,'BL','MAIN',NULL,NULL),
 ('RAIL_TRANSPORTATION', 3,'WAGON_ASSIGNED','Wagon / rake assigned','Wagons / rame affectés',6,4,'CARRIER',false,false,true,NULL,'MAIN',NULL,NULL),
 ('RAIL_TRANSPORTATION', 4,'LOADING_WAGON','Cargo loaded on wagon','Chargement sur wagon',8,6,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('RAIL_TRANSPORTATION', 5,'CUSTOMS_SEALED','Customs sealed & cleared for departure','Plombage et formalités de départ',5,4,'AUTHORITY',false,false,true,'DECLARATION','MAIN',NULL,NULL),
 ('RAIL_TRANSPORTATION', 6,'TRAIN_DEPARTED','Train departed (ATD)','Train parti (ATD)',12,6,'CARRIER',true,false,true,NULL,'MAIN',NULL,NULL),
 ('RAIL_TRANSPORTATION', 7,'IN_RAIL_TRANSIT','In rail transit','Acheminement sur voie ferrée',16,12,'CARRIER',false,false,true,NULL,'MAIN',NULL,NULL),
 ('RAIL_TRANSPORTATION', 8,'RAIL_CHECKPOINT','Rail checkpoint clearance','Pointage et contrôle d''étape',6,4,'AUTHORITY',false,false,true,NULL,'MAIN',NULL,NULL),
 ('RAIL_TRANSPORTATION', 9,'DEST_STATION_ARRIVED','Arrived at destination station (ATA)','Arrivée gare de destination (ATA)',10,6,'CARRIER',false,false,true,NULL,'MAIN',NULL,NULL),
 ('RAIL_TRANSPORTATION',10,'WAGON_SPOTTED','Wagon spotted at siding / platform','Mise à quai / voie de déchargement',5,4,'TERMINAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('RAIL_TRANSPORTATION',11,'OFFLOADING','Offloading completed','Déchargement terminé',7,6,'TERMINAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('RAIL_TRANSPORTATION',12,'DELIVERY','Delivery to consignee','Livraison au destinataire',8,6,'INTERNAL',false,true,true,'POD','MAIN',NULL,'delivery_note.created'),
 ('RAIL_TRANSPORTATION',13,'EMPTY_RELEASE','Empty wagon / container released','Restitution wagon / conteneur vide',4,4,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('RAIL_TRANSPORTATION',14,'FILE_CLOSED','Final invoice & file closed','Facture finale et dossier clos',4,8,'INTERNAL',false,false,false,NULL,'MAIN',NULL,'invoice.issued'),

 ('RAIL_HINTERLAND_TRANSIT', 1,'TRANSPORT_ORDER','Transport order received','Ordre de transport reçu',4,4,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('RAIL_HINTERLAND_TRANSIT', 2,'TRANSIT_DOCS','Transit documents verified','Documents de transit vérifiés',5,8,'CLIENT',false,false,true,'BL','MAIN',NULL,NULL),
 ('RAIL_HINTERLAND_TRANSIT', 3,'T1_LODGED','Transit declaration lodged','Déclaration de transit déposée',6,8,'INTERNAL',false,false,true,'DECLARATION','MAIN',NULL,'transit_order.created'),
 ('RAIL_HINTERLAND_TRANSIT', 4,'TRANSIT_BOND','Transit bond secured','Caution de transit constituée',5,8,'INTERNAL',false,false,true,'BOND','MAIN',NULL,NULL),
 ('RAIL_HINTERLAND_TRANSIT', 5,'WAGON_LOADED','Loaded on rail wagons','Chargement sur wagons',6,8,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('RAIL_HINTERLAND_TRANSIT', 6,'SEALED_ESCORT','Customs sealing / escort','Plombage et escorte ferroviaire',5,8,'AUTHORITY',false,false,true,NULL,'MAIN',NULL,NULL),
 ('RAIL_HINTERLAND_TRANSIT', 7,'TRAIN_DEPARTED','Train departed','Train parti',10,12,'CARRIER',true,false,true,NULL,'MAIN',NULL,NULL),
 ('RAIL_HINTERLAND_TRANSIT', 8,'BORDER_CROSSING','Border rail crossing','Passage frontière ferroviaire',14,24,'AUTHORITY',false,false,true,NULL,'MAIN',NULL,NULL),
 ('RAIL_HINTERLAND_TRANSIT', 9,'DEST_STATION_ARRIVAL','Arrival at destination railhead','Arrivée gare destination',15,24,'CARRIER',false,false,true,NULL,'MAIN',NULL,NULL),
 ('RAIL_HINTERLAND_TRANSIT',10,'DEST_CLEARANCE','Destination clearance','Dédouanement à destination',8,16,'AUTHORITY',false,false,true,'RELEASE_ORDER','MAIN',NULL,NULL),
 ('RAIL_HINTERLAND_TRANSIT',11,'OFFLOADING','Offloading at rail terminal','Déchargement terminal ferroviaire',6,8,'TERMINAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('RAIL_HINTERLAND_TRANSIT',12,'DELIVERY','Delivery to consignee','Livraison au destinataire',8,8,'INTERNAL',false,true,true,'POD','MAIN',NULL,'delivery_note.created'),
 ('RAIL_HINTERLAND_TRANSIT',13,'T1_DISCHARGED','Transit discharged / bond released','Transit apuré / caution levée',5,24,'AUTHORITY',false,false,true,'BOND','MAIN',NULL,NULL),
 ('RAIL_HINTERLAND_TRANSIT',14,'FILE_CLOSED','Final invoice & file closed','Facture finale et dossier clos',3,8,'INTERNAL',false,false,false,NULL,'MAIN',NULL,'invoice.issued');

INSERT INTO milestone_template_stage (
  milestone_template_id, seq, code, name_en, name_fr,
  weight, min_duration_hours, default_offset_days, owner_tier,
  is_anchor, is_target_lock, is_client_visible, evidence_type,
  chain_segment, cadence_pattern, auto_advance_on_event,
  is_system, system_code, source_version
)
SELECT
  mt.milestone_template_id, s.seq, s.code, s.label_en, s.label_fr,
  s.weight, s.min_h,
  round((SUM(s.weight) OVER (PARTITION BY s.svc, s.segment ORDER BY s.seq) - s.weight)::numeric * st.default_duration_days / 100.0, 1),
  s.owner, s.anchor, s.lock, s.visible, s.evidence,
  s.segment, s.cadence, s.auto_event,
  true, s.code, 1
FROM _tmp_rail_stages s
JOIN service_type st ON st.key = s.svc
JOIN milestone_template mt
  ON mt.service_type_id = st.service_type_id AND mt.is_system AND mt.version = 1
ON CONFLICT (milestone_template_id, code) DO NOTHING;

-- Published Assumptions
INSERT INTO service_type_assumption (service_type_id, seq, code, text_fr, text_en, is_client_visible, is_system)
SELECT st.service_type_id, a.seq, a.code, a.fr, a.en, a.vis, true
  FROM service_type st
  JOIN (VALUES
    ('RAIL_TRANSPORTATION',1,'RAILWAY_SCHEDULE','Les circulations ferroviaires dépendent du plan de transport et des sillons alloués par la régie ferroviaire.','Train movements depend on the operational timetable and track slots allocated by the rail authority.',true),
    ('RAIL_TRANSPORTATION',2,'WAGON_AVAILABILITY','La mise à disposition des wagons est sujette au parc effectif du transporteur ferroviaire.','Wagon availability is subject to the railway operator''s active fleet.',true),
    ('RAIL_TRANSPORTATION',3,'SIDING_ACCESS','Les manœuvres sur embranchement particulier nécessitent l''accord préalable du gestionnaire d''infrastructure.','Shunting on private sidings requires prior approval from the infrastructure manager.',true),
    ('RAIL_TRANSPORTATION',4,'FORCE_MAJEURE','Exclus : déraillement, avarie de voie, rupture caténaire, grève des cheminots, intempéries exceptionnelles.','Excluded: derailment, track damage, overhead line failure, railway worker strike, exceptional weather.',true),
    ('RAIL_HINTERLAND_TRANSIT',1,'BORDER_RAIL','Les contrôles transfrontaliers en gare frontière s''effectuent selon les horaires d''ouverture des deux administrations.','Cross-border rail inspections at border stations run on opening hours of both authorities.',true),
    ('RAIL_HINTERLAND_TRANSIT',2,'RAIL_CONVOY','Les trains de transit circulent en convoi cadencé selon les créneaux douaniers.','Transit trains operate in scheduled convoys on customs-allocated slots.',true),
    ('RAIL_HINTERLAND_TRANSIT',3,'FORCE_MAJEURE','Exclus : coupure de voie ferrée, fermeture de frontière, insécurité du corridor, panne locomotive, grève.','Excluded: rail cut, border closure, corridor insecurity, locomotive failure, strike.',true)
  ) AS a(key, seq, code, fr, en, vis) ON a.key = st.key
ON CONFLICT (service_type_id, code) DO NOTHING;

-- ── 4. Service Type Field Sets (v1) & Fields ────────────────────────────────
INSERT INTO service_type_field_set (service_type_id, version, is_active, name, is_system, source_version, published_at)
SELECT st.service_type_id, 1, true, 'Détails standard — ' || st.name_fr, true, 1, now()
  FROM service_type st
 WHERE st.key IN ('RAIL_TRANSPORTATION', 'RAIL_HINTERLAND_TRANSIT')
ON CONFLICT (service_type_id, version) DO NOTHING;

CREATE TEMP TABLE _tmp_rail_fields (
  svc         text NOT NULL,
  group_code  text NOT NULL,
  group_fr    text NOT NULL,
  group_en    text NOT NULL,
  group_seq   integer NOT NULL,
  seq         numeric(10,4) NOT NULL,
  key         text NOT NULL,
  label_fr    text NOT NULL,
  label_en    text NOT NULL,
  data_type   text NOT NULL DEFAULT 'TEXT',
  is_required boolean NOT NULL DEFAULT false,
  facet_role  text,
  column_name text,
  width       text NOT NULL DEFAULT 'HALF',
  options     jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation  jsonb NOT NULL DEFAULT '{}'::jsonb,
  help_fr     text,
  help_en     text,
  client_vis  boolean NOT NULL DEFAULT true,
  PRIMARY KEY (svc, key)
) ON COMMIT DROP;

INSERT INTO _tmp_rail_fields (svc, group_code, group_fr, group_en, group_seq, seq, key, label_fr, label_en, data_type, is_required, facet_role, column_name, width) VALUES
  ('RAIL_TRANSPORTATION','TRANSPORT','Transport ferroviaire','Rail transport',10,10,'bl_number','Lettre de voiture ferroviaire (CIM/LVF)','Rail Consignment Note (CIM/Waybill)','TEXT',false,'TRANSPORT_REF','bl_mawb','HALF'),
  ('RAIL_TRANSPORTATION','TRANSPORT','Transport ferroviaire','Rail transport',10,20,'rail_operator','Opérateur ferroviaire','Railway operator','RATE_PROVIDER',false,'CARRIER','rate_provider_id','HALF'),
  ('RAIL_TRANSPORTATION','TRANSPORT','Transport ferroviaire','Rail transport',10,30,'train_no','№ de train / convoi','Train / convoy No','TEXT',false,'CONVEYANCE','vessel_flight','HALF'),
  ('RAIL_TRANSPORTATION','TRANSPORT','Transport ferroviaire','Rail transport',10,40,'wagon_nos','№ de wagon(s) / rame','Wagon / rake No(s)','TEXT',false,NULL,NULL,'HALF'),
  ('RAIL_TRANSPORTATION','TRANSPORT','Transport ferroviaire','Rail transport',10,50,'pol','Gare / terminal de départ','Origin rail terminal / station','GEO_PLACE',true,'ORIGIN','pol','HALF'),
  ('RAIL_TRANSPORTATION','TRANSPORT','Transport ferroviaire','Rail transport',10,60,'pod','Gare / terminal d''arrivée','Destination rail terminal / station','GEO_PLACE',true,'DESTINATION','pod','HALF'),
  ('RAIL_TRANSPORTATION','TRANSPORT','Transport ferroviaire','Rail transport',10,70,'siding_branch','Embranchement particulier (ITE)','Private siding / industrial spur','TEXT',false,NULL,NULL,'HALF'),
  ('RAIL_TRANSPORTATION','TRANSPORT','Transport ferroviaire','Rail transport',10,80,'eta','ETA en gare','ETA at rail terminal','DATE',false,'ARRIVAL_DATE','eta','HALF'),
  ('RAIL_TRANSPORTATION','TRANSPORT','Transport ferroviaire','Rail transport',10,90,'ata','ATA en gare (arrivée réelle)','ATA at rail terminal (actual arrival)','DATE',false,'ARRIVAL_DATE','ata','HALF'),
  ('RAIL_TRANSPORTATION','TRANSPORT','Transport ferroviaire','Rail transport',10,100,'estimated_delivery_date','Date de livraison estimée du projet','Estimated Project Delivery Date','DATE',false,'DELIVERY_DATE','promised_delivery_date','HALF'),
  ('RAIL_TRANSPORTATION','TRANSPORT','Transport ferroviaire','Rail transport',10,110,'place_delivery','Lieu de livraison finale','Place of final delivery','GEO_PLACE',false,'FINAL_DELIVERY','place_delivery','HALF'),
  ('RAIL_TRANSPORTATION','CARGO','Marchandise','Cargo',20,10,'commodity','Marchandise','Commodity','TEXT',true,'CARGO_DESC','commodity','HALF'),
  ('RAIL_TRANSPORTATION','CARGO','Marchandise','Cargo',20,20,'commodity_desc','Description détaillée','Detailed description','TEXTAREA',false,NULL,'commodity_desc','FULL'),
  ('RAIL_TRANSPORTATION','CARGO','Marchandise','Cargo',20,30,'gross_weight','Poids brut','Gross weight','NUMBER',false,'CARGO_WEIGHT','gross_weight','THIRD'),
  ('RAIL_TRANSPORTATION','CARGO','Marchandise','Cargo',20,40,'weight_unit','Unité','Unit','SELECT',false,NULL,'weight_unit','THIRD'),
  ('RAIL_TRANSPORTATION','CARGO','Marchandise','Cargo',20,50,'volume_cbm','Volume (m³)','Volume (CBM)','NUMBER',false,'CARGO_VOLUME','volume_cbm','THIRD'),
  ('RAIL_TRANSPORTATION','CARGO','Marchandise','Cargo',20,60,'package_count','Nombre de colis','Package count','INTEGER',false,'CARGO_PACKAGES','package_count','HALF'),
  ('RAIL_TRANSPORTATION','CARGO','Marchandise','Cargo',20,70,'marks_numbers','Marques & numéros','Marks & numbers','TEXT',false,'CARGO_MARKS','marks_numbers','HALF'),
  ('RAIL_TRANSPORTATION','CUSTOMS','Douane & commerce','Customs & trade',30,10,'incoterm','Incoterm','Incoterm','SELECT',true,'INCOTERM','incoterm','THIRD'),
  ('RAIL_TRANSPORTATION','CUSTOMS','Douane & commerce','Customs & trade',30,20,'customs_regime','Régime douanier','Customs regime','SELECT',false,'CUSTOMS_REGIME','customs_regime','THIRD'),
  ('RAIL_TRANSPORTATION','CUSTOMS','Douane & commerce','Customs & trade',30,30,'declaration_no','№ de déclaration','Declaration No','TEXT',false,'CUSTOMS_REF',NULL,'THIRD'),

  ('RAIL_HINTERLAND_TRANSIT','TRANSPORT','Segment ferroviaire','Rail leg',10,10,'bl_number','Lettre de voiture ferroviaire (CIM/LVF)','Rail Consignment Note (CIM/Waybill)','TEXT',false,'TRANSPORT_REF','bl_mawb','HALF'),
  ('RAIL_HINTERLAND_TRANSIT','TRANSPORT','Segment ferroviaire','Rail leg',10,20,'rail_operator','Opérateur ferroviaire','Railway operator','RATE_PROVIDER',false,'CARRIER','rate_provider_id','HALF'),
  ('RAIL_HINTERLAND_TRANSIT','TRANSPORT','Segment ferroviaire','Rail leg',10,30,'train_no','№ de train / convoi','Train / convoy No','TEXT',false,'CONVEYANCE','vessel_flight','HALF'),
  ('RAIL_HINTERLAND_TRANSIT','TRANSPORT','Segment ferroviaire','Rail leg',10,40,'wagon_nos','№ de wagon(s) / rame','Wagon / rake No(s)','TEXT',false,NULL,NULL,'HALF'),
  ('RAIL_HINTERLAND_TRANSIT','TRANSPORT','Segment ferroviaire','Rail leg',10,50,'pol','Gare de départ','Origin rail station','GEO_PLACE',true,'ORIGIN','pol','HALF'),
  ('RAIL_HINTERLAND_TRANSIT','TRANSPORT','Segment ferroviaire','Rail leg',10,60,'border_station','Gare / poste frontière','Border rail post / station','GEO_PLACE',false,'ROUTE_VIA',NULL,'HALF'),
  ('RAIL_HINTERLAND_TRANSIT','TRANSPORT','Segment ferroviaire','Rail leg',10,70,'entry_terminal','Gare / terminal d''entrée pays enclavé','Destination border railhead','GEO_PLACE',true,'ROUTE_VIA','pod','HALF'),
  ('RAIL_HINTERLAND_TRANSIT','TRANSPORT','Segment ferroviaire','Rail leg',10,80,'eta','ETA gare frontière / terminal','ETA at railhead','DATE',false,'ARRIVAL_DATE','eta','HALF'),
  ('RAIL_HINTERLAND_TRANSIT','TRANSPORT','Segment ferroviaire','Rail leg',10,90,'ata','ATA gare frontière / terminal','ATA at railhead','DATE',false,'ARRIVAL_DATE','ata','HALF'),
  ('RAIL_HINTERLAND_TRANSIT','ROAD','Livraison terminale','Final delivery leg',20,10,'final_destination','Destination finale','Final destination','GEO_PLACE',true,'DESTINATION','place_delivery','HALF'),
  ('RAIL_HINTERLAND_TRANSIT','ROAD','Livraison terminale','Final delivery leg',20,20,'transporter','Transporteur routier / acheminement','Road haulier (final leg)','TEXT',false,NULL,NULL,'HALF'),
  ('RAIL_HINTERLAND_TRANSIT','ROAD','Livraison terminale','Final delivery leg',20,30,'estimated_delivery_date','Date de livraison estimée du projet','Estimated Project Delivery Date','DATE',false,'DELIVERY_DATE','promised_delivery_date','HALF'),
  ('RAIL_HINTERLAND_TRANSIT','CARGO','Marchandise','Cargo',30,10,'commodity','Marchandise','Commodity','TEXT',true,'CARGO_DESC','commodity','HALF'),
  ('RAIL_HINTERLAND_TRANSIT','CARGO','Marchandise','Cargo',30,20,'commodity_desc','Description détaillée','Detailed description','TEXTAREA',false,NULL,'commodity_desc','FULL'),
  ('RAIL_HINTERLAND_TRANSIT','CARGO','Marchandise','Cargo',30,30,'gross_weight','Poids brut','Gross weight','NUMBER',false,'CARGO_WEIGHT','gross_weight','THIRD'),
  ('RAIL_HINTERLAND_TRANSIT','CARGO','Marchandise','Cargo',30,40,'weight_unit','Unité','Unit','SELECT',false,NULL,'weight_unit','THIRD'),
  ('RAIL_HINTERLAND_TRANSIT','CARGO','Marchandise','Cargo',30,50,'volume_cbm','Volume (m³)','Volume (CBM)','NUMBER',false,'CARGO_VOLUME','volume_cbm','THIRD'),
  ('RAIL_HINTERLAND_TRANSIT','CARGO','Marchandise','Cargo',30,60,'package_count','Nombre de colis','Package count','INTEGER',false,'CARGO_PACKAGES','package_count','HALF'),
  ('RAIL_HINTERLAND_TRANSIT','CARGO','Marchandise','Cargo',30,70,'marks_numbers','Marques & numéros','Marks & numbers','TEXT',false,'CARGO_MARKS','marks_numbers','HALF'),
  ('RAIL_HINTERLAND_TRANSIT','CUSTOMS','Transit & douane','Transit & customs',40,10,'transit_declaration','Déclaration de transit','Transit declaration','TEXT',false,'CUSTOMS_REF',NULL,'HALF'),
  ('RAIL_HINTERLAND_TRANSIT','CUSTOMS','Transit & douane','Transit & customs',40,20,'customs_regime','Régime douanier','Customs regime','SELECT',false,'CUSTOMS_REGIME','customs_regime','HALF'),
  ('RAIL_HINTERLAND_TRANSIT','CUSTOMS','Transit & douane','Transit & customs',40,30,'incoterm','Incoterm','Incoterm','SELECT',false,'INCOTERM','incoterm','HALF');

UPDATE _tmp_rail_fields SET options = '[
  {"value":"EXW","label_fr":"EXW — À l''usine","label_en":"EXW — Ex Works"},
  {"value":"FCA","label_fr":"FCA — Franco transporteur","label_en":"FCA — Free Carrier"},
  {"value":"FAS","label_fr":"FAS — Franco le long du navire","label_en":"FAS — Free Alongside Ship"},
  {"value":"FOB","label_fr":"FOB — Franco à bord","label_en":"FOB — Free On Board"},
  {"value":"CFR","label_fr":"CFR — Coût et fret","label_en":"CFR — Cost and Freight"},
  {"value":"CIF","label_fr":"CIF — Coût, assurance et fret","label_en":"CIF — Cost, Insurance and Freight"},
  {"value":"CPT","label_fr":"CPT — Port payé jusqu''à","label_en":"CPT — Carriage Paid To"},
  {"value":"CIP","label_fr":"CIP — Port payé, assurance comprise","label_en":"CIP — Carriage and Insurance Paid To"},
  {"value":"DAP","label_fr":"DAP — Rendu au lieu convenu","label_en":"DAP — Delivered At Place"},
  {"value":"DPU","label_fr":"DPU — Rendu au lieu déchargé","label_en":"DPU — Delivered At Place Unloaded"},
  {"value":"DDP","label_fr":"DDP — Rendu droits acquittés","label_en":"DDP — Delivered Duty Paid"}
]'::jsonb WHERE key = 'incoterm';

UPDATE _tmp_rail_fields SET options = '[
  {"value":"IM4","label_fr":"IM4 — Mise à la consommation","label_en":"IM4 — Home use"},
  {"value":"IM7","label_fr":"IM7 — Entrepôt douanier","label_en":"IM7 — Customs warehouse"},
  {"value":"IM8","label_fr":"IM8 — Transit","label_en":"IM8 — Transit"},
  {"value":"EX1","label_fr":"EX1 — Exportation définitive","label_en":"EX1 — Permanent export"},
  {"value":"EX2","label_fr":"EX2 — Exportation temporaire","label_en":"EX2 — Temporary export"}
]'::jsonb WHERE key = 'customs_regime';

UPDATE _tmp_rail_fields SET options = '[
  {"value":"KG","label_fr":"kg","label_en":"kg"},
  {"value":"TON","label_fr":"tonne","label_en":"tonne"},
  {"value":"LB","label_fr":"livre (lb)","label_en":"pound (lb)"}
]'::jsonb WHERE key = 'weight_unit';

UPDATE _tmp_rail_fields SET validation = '{"min":0}'::jsonb WHERE data_type IN ('NUMBER','INTEGER');

INSERT INTO service_type_field (
  service_type_field_set_id, group_code, group_label_fr, group_label_en, group_seq,
  seq, key, label_fr, label_en, help_text_fr, help_text_en,
  data_type, options_json, validation_json,
  is_required, is_client_visible, is_system, facet_role, column_name, width)
SELECT
  fs.service_type_field_set_id,
  f.group_code, f.group_fr, f.group_en, f.group_seq,
  f.seq, f.key, f.label_fr, f.label_en, f.help_fr, f.help_en,
  f.data_type, f.options, f.validation,
  f.is_required, f.client_vis, true, f.facet_role, f.column_name, f.width
FROM _tmp_rail_fields f
JOIN service_type st ON st.key = f.svc
JOIN service_type_field_set fs
  ON fs.service_type_id = st.service_type_id AND fs.is_system AND fs.version = 1
ON CONFLICT (service_type_field_set_id, key) DO NOTHING;

-- ── 5. Financial dictionary applicability ───────────────────────────────────
-- Connect common lines and rail-specific charges to the two new services.
INSERT INTO service_type_dictionary_item (service_type_id, dictionary_item_id, tier, sort_order)
SELECT st.service_type_id, di.dictionary_item_id, 'BASIC', 100
  FROM service_type st
  CROSS JOIN dictionary_item di
 WHERE st.key IN ('RAIL_TRANSPORTATION', 'RAIL_HINTERLAND_TRANSIT')
   AND di.key IN (
     'DISBURSEMENT_COMMISSION','DOCUMENTATION_FEE','FILE_OPENING',
     'SERVICE_CHARGES','BANK_CHARGES','LOCAL_INSURANCE','STAMP',
     'TRANSPORT_AUTHORISATION','RAIL_FREIGHT','RAIL_TERMINAL_HANDLING',
     'TRANSIT_TITLE_T1','BORDER_CROSSING_FORMALITIES','CUSTOMS_FORMALITIES'
   )
ON CONFLICT (service_type_id, dictionary_item_id) DO NOTHING;

INSERT INTO service_type_dictionary_item (service_type_id, dictionary_item_id, tier, sort_order)
SELECT st.service_type_id, di.dictionary_item_id, 'ADVANCED', 300
  FROM service_type st
  CROSS JOIN dictionary_item di
 WHERE st.key IN ('RAIL_TRANSPORTATION', 'RAIL_HINTERLAND_TRANSIT')
   AND di.key IN (
     'EXTRA_LEGAL_WORK','IMPORT_DECLARATION_FEE','BANK_CAUTION',
     'FACILITY_PAYMENT','RAIL_SHUNTING_FEE','WAGON_DEMURRAGE',
     'RAIL_ESCORT_FEE','RAIL_CORRIDOR_LEVY','CONVOY_SECURITY'
   )
ON CONFLICT (service_type_id, dictionary_item_id) DO NOTHING;
