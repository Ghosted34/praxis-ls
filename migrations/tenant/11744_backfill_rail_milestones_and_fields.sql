-- ============================================================================
-- TENANT DB — 11744 Backfill the complete operating defaults for rail services.
--
-- WHY THIS IS A FORWARD MIGRATION
-- 9091/9092 are provisioning seeds.  They are tracked separately in
-- public.schema_migration and therefore do not run again on an existing tenant.
-- 11743 added the three rail service_type rows, but an upgraded tenant had
-- already run those seeds, leaving the new rows without a chain, detail form,
-- assumptions, or financial-dictionary lines.  This file is deliberately under
-- migrations/tenant: migrateTenantDb applies it unqualified with search_path set
-- to live,public and then sandbox,public, so both tenant schemas are repaired.
--
-- NON-DESTRUCTIVE + IDEMPOTENT.  Every durable insert uses the table's natural
-- conflict key.  A tenant-authored version wins; this only publishes the shipped
-- system v1 where that version is absent and fills missing rows on that system v1.
-- ============================================================================

-- Keep the service-level defaults complete even if 11743 met a pre-existing row
-- whose duration or equipment settings were empty.
UPDATE service_type st
   SET default_duration_days = COALESCE(st.default_duration_days, v.days),
       duration_basis = COALESCE(st.duration_basis, 'WORKING_DAYS'),
       is_open_ended = false,
       captures_containers = true,
       container_detail_mode = 'GROUPED'
  FROM (VALUES
    ('RAIL_TRANSPORTATION', 8),
    ('RAIL_HINTERLAND_TRANSIT', 15),
    ('END_TO_END_RAIL_FREIGHT', 20)
  ) AS v(key, days)
 WHERE st.key = v.key;

-- ── 1. Fourteen-stage milestone chains ──────────────────────────────────────
CREATE TEMP TABLE _rail_stage (
  svc                         text NOT NULL,
  stage_seq                   integer NOT NULL,
  code                        text NOT NULL,
  label_en                    text NOT NULL,
  label_fr                    text NOT NULL,
  weight                      integer NOT NULL,
  min_duration_hours          integer NOT NULL,
  owner_tier                  text NOT NULL,
  is_anchor                   boolean NOT NULL,
  is_target_lock              boolean NOT NULL,
  is_client_visible           boolean NOT NULL,
  required_evidence_doc_type  text,
  chain_segment               text NOT NULL,
  cadence                     text,
  auto_advance_on_event       text,
  PRIMARY KEY (svc, code)
) ON COMMIT DROP;

INSERT INTO _rail_stage (
  svc, stage_seq, code, label_en, label_fr, weight, min_duration_hours,
  owner_tier, is_anchor, is_target_lock, is_client_visible,
  required_evidence_doc_type, chain_segment, cadence, auto_advance_on_event
) VALUES
  -- RAIL_TRANSPORTATION
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

  -- RAIL_HINTERLAND_TRANSIT
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
  ('RAIL_HINTERLAND_TRANSIT',14,'FILE_CLOSED','Final invoice & file closed','Facture finale et dossier clos',3,8,'INTERNAL',false,false,false,NULL,'MAIN',NULL,'invoice.issued'),

  -- END_TO_END_RAIL_FREIGHT
  ('END_TO_END_RAIL_FREIGHT', 1,'BOOKING_REQUEST','Booking requested','Demande de réservation',4,4,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
  ('END_TO_END_RAIL_FREIGHT', 2,'DOCS_VERIFIED','Shipping & transit documents verified','Documents vérifiés',5,8,'CLIENT',false,false,true,'BL','MAIN',NULL,NULL),
  ('END_TO_END_RAIL_FREIGHT', 3,'CARGO_PICKUP','Cargo collected from shipper / farm','Enlèvement chez le client / expéditeur',6,8,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
  ('END_TO_END_RAIL_FREIGHT', 4,'RAILHEAD_TRANSFER','Transfer to railhead & wagon loading','Acheminement gare et chargement',7,8,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
  ('END_TO_END_RAIL_FREIGHT', 5,'CUSTOMS_SEALED','Customs sealed & departure clearance','Plombage et formalités de départ',5,6,'AUTHORITY',false,false,true,'DECLARATION','MAIN',NULL,NULL),
  ('END_TO_END_RAIL_FREIGHT', 6,'TRAIN_DEPARTED','Train departed (ATD)','Train parti (ATD)',10,12,'CARRIER',true,false,true,NULL,'MAIN',NULL,NULL),
  ('END_TO_END_RAIL_FREIGHT', 7,'IN_RAIL_TRANSIT','In rail transit','Acheminement sur voie ferrée',14,24,'CARRIER',false,false,true,NULL,'MAIN',NULL,NULL),
  ('END_TO_END_RAIL_FREIGHT', 8,'BORDER_CROSSING','Border crossing / international transit','Passage frontière / transit',12,24,'AUTHORITY',false,false,true,NULL,'MAIN',NULL,NULL),
  ('END_TO_END_RAIL_FREIGHT', 9,'DEST_STATION_ARRIVED','Arrived destination railhead (ATA)','Arrivée gare destination (ATA)',10,12,'CARRIER',false,false,true,NULL,'MAIN',NULL,NULL),
  ('END_TO_END_RAIL_FREIGHT',10,'DEST_CLEARANCE','Destination customs clearance','Dédouanement à destination',8,16,'AUTHORITY',false,false,true,'RELEASE_ORDER','MAIN',NULL,NULL),
  ('END_TO_END_RAIL_FREIGHT',11,'FINAL_HAULAGE','Final delivery haulage dispatched','Mise en livraison finale par camion',7,8,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
  ('END_TO_END_RAIL_FREIGHT',12,'DELIVERY','Delivery to consignee (POD)','Livraison finale au destinataire',6,8,'INTERNAL',false,true,true,'POD','MAIN',NULL,'delivery_note.created'),
  ('END_TO_END_RAIL_FREIGHT',13,'EMPTY_RELEASE','Empty wagon / container returned','Restitution matériel / conteneur',3,8,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
  ('END_TO_END_RAIL_FREIGHT',14,'FILE_CLOSED','Final invoice & file closed','Facture finale et dossier clos',3,8,'INTERNAL',false,false,false,NULL,'MAIN',NULL,'invoice.issued');

-- Fail the migration rather than publish a partial or mathematically invalid
-- chain.  The same invariant is enforced in seed 9091.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(svc || ' (' || stage_count || ' stages, weight ' || total_weight || ')', ', ')
    INTO bad
    FROM (
      SELECT svc, COUNT(*) AS stage_count, SUM(weight) AS total_weight
        FROM _rail_stage
       GROUP BY svc
      HAVING COUNT(*) <> 14 OR SUM(weight) <> 100
    ) invalid;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'rail backfill: invalid milestone chain(s): %', bad;
  END IF;
END $$;

INSERT INTO milestone_template (
  service_type_id, version, is_active, name, is_system, system_code, source_version
)
SELECT st.service_type_id, 1, true,
       'Chaîne standard — ' || st.name_fr,
       true, st.key, 1
  FROM service_type st
 WHERE st.key IN (
   'RAIL_TRANSPORTATION',
   'RAIL_HINTERLAND_TRANSIT',
   'END_TO_END_RAIL_FREIGHT'
 )
   AND NOT EXISTS (
     SELECT 1
       FROM milestone_template existing
      WHERE existing.service_type_id = st.service_type_id
   )
ON CONFLICT (service_type_id, version) DO NOTHING;

-- Use the real milestone_template_stage column names.  Offsets are the ceiling
-- of cumulative chain weight × the service horizon, matching seed 9091.
INSERT INTO milestone_template_stage (
  milestone_template_id,
  stage_seq,
  code,
  label_fr,
  label_en,
  default_offset_days,
  weight,
  min_duration_hours,
  owner_tier,
  is_anchor,
  is_target_lock,
  is_client_visible,
  required_evidence_doc_type,
  auto_advance_on_event,
  chain_segment,
  cadence,
  is_system,
  system_code,
  source_version
)
SELECT
  mt.milestone_template_id,
  s.stage_seq,
  s.code,
  s.label_fr,
  s.label_en,
  CASE WHEN s.weight = 0 THEN 0
       ELSE CEIL(s.cumulative_weight / 100.0 * st.default_duration_days)::integer
  END,
  s.weight,
  s.min_duration_hours,
  s.owner_tier,
  s.is_anchor,
  s.is_target_lock,
  s.is_client_visible,
  s.required_evidence_doc_type,
  s.auto_advance_on_event,
  s.chain_segment,
  s.cadence,
  true,
  s.code,
  1
FROM (
  SELECT rs.*,
         SUM(rs.weight) OVER (
           PARTITION BY rs.svc, rs.chain_segment
           ORDER BY rs.stage_seq
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ) AS cumulative_weight
    FROM _rail_stage rs
) s
JOIN service_type st ON st.key = s.svc
JOIN milestone_template mt
  ON mt.service_type_id = st.service_type_id
 AND mt.version = 1
 AND mt.is_system
 AND mt.system_code = st.key
ON CONFLICT (milestone_template_id, code) DO NOTHING;

-- ── 2. Published assumptions and force-majeure exclusions ───────────────────
INSERT INTO service_type_assumption (
  service_type_id, seq, code, text_fr, text_en, is_client_visible, is_system
)
SELECT st.service_type_id, a.seq, a.code, a.text_fr, a.text_en, true, true
  FROM service_type st
  JOIN (VALUES
    ('RAIL_TRANSPORTATION',1,'RAILWAY_SCHEDULE',
      'Les circulations ferroviaires dépendent du plan de transport et des sillons alloués par la régie ferroviaire.',
      'Train movements depend on the operational timetable and track slots allocated by the rail authority.'),
    ('RAIL_TRANSPORTATION',2,'WAGON_AVAILABILITY',
      'La mise à disposition des wagons est sujette au parc effectif du transporteur ferroviaire.',
      'Wagon availability is subject to the railway operator''s active fleet.'),
    ('RAIL_TRANSPORTATION',3,'SIDING_ACCESS',
      'Les manœuvres sur embranchement particulier nécessitent l''accord préalable du gestionnaire d''infrastructure.',
      'Shunting on private sidings requires prior approval from the infrastructure manager.'),
    ('RAIL_TRANSPORTATION',4,'FORCE_MAJEURE',
      'Exclus : déraillement, avarie de voie, rupture caténaire, grève des cheminots, intempéries exceptionnelles.',
      'Excluded: derailment, track damage, overhead line failure, railway worker strike, exceptional weather.'),

    ('RAIL_HINTERLAND_TRANSIT',1,'BORDER_RAIL',
      'Les contrôles transfrontaliers en gare frontière s''effectuent selon les horaires d''ouverture des deux administrations.',
      'Cross-border rail inspections at border stations run on opening hours of both authorities.'),
    ('RAIL_HINTERLAND_TRANSIT',2,'RAIL_CONVOY',
      'Les trains de transit circulent en convoi cadencé selon les créneaux douaniers.',
      'Transit trains operate in scheduled convoys on customs-allocated slots.'),
    ('RAIL_HINTERLAND_TRANSIT',3,'FORCE_MAJEURE',
      'Exclus : coupure de voie ferrée, fermeture de frontière, insécurité du corridor, panne locomotive, grève.',
      'Excluded: rail cut, border closure, corridor insecurity, locomotive failure, strike.'),

    ('END_TO_END_RAIL_FREIGHT',1,'ORIGIN_PICKUP',
      'Les délais d''enlèvement supposent un accès carrossable au site de chargement et la mise à disposition effective de la marchandise.',
      'Pickup lead times assume vehicle access to loading site and goods ready for handover.'),
    ('END_TO_END_RAIL_FREIGHT',2,'RAILWAY_TIMETABLE',
      'Le transit ferroviaire s''exécute selon les sillons programmés de l''opérateur et les formalités aux gares de triage.',
      'Rail transit runs on published operator train slots and yard marshalling schedules.'),
    ('END_TO_END_RAIL_FREIGHT',3,'CROSS_BORDER',
      'Les délais de passage frontière et de dédouanement à destination dépendent des services douaniers des pays traversés.',
      'Cross-border and destination clearance timings depend on customs authorities in transit countries.'),
    ('END_TO_END_RAIL_FREIGHT',4,'FORCE_MAJEURE',
      'Exclus : coupure de voie ferrée, fermeture de frontière, intempéries exceptionnelles, insécurité du corridor, grève.',
      'Excluded: rail cuts, border closures, extreme weather, corridor insecurity, strikes.')
  ) AS a(key, seq, code, text_fr, text_en) ON a.key = st.key
ON CONFLICT (service_type_id, code) DO NOTHING;

-- ── 3. Versioned shipment-detail field sets ─────────────────────────────────
CREATE TEMP TABLE _rail_profile (
  svc text PRIMARY KEY,
  profile text NOT NULL UNIQUE
) ON COMMIT DROP;
INSERT INTO _rail_profile (svc, profile) VALUES
  ('RAIL_TRANSPORTATION','RAIL'),
  ('RAIL_HINTERLAND_TRANSIT','RAIL_HINTERLAND'),
  ('END_TO_END_RAIL_FREIGHT','END_TO_END_RAIL');

CREATE TEMP TABLE _rail_field_group (
  profile text NOT NULL,
  code text NOT NULL,
  label_fr text NOT NULL,
  label_en text NOT NULL,
  group_seq integer NOT NULL,
  PRIMARY KEY (profile, code)
) ON COMMIT DROP;
INSERT INTO _rail_field_group (profile, code, label_fr, label_en, group_seq) VALUES
  ('RAIL','TRANSPORT','Transport ferroviaire','Rail transport',10),
  ('RAIL','CARGO','Marchandise','Cargo',20),
  ('RAIL','CUSTOMS','Douane & commerce','Customs & trade',30),
  ('RAIL_HINTERLAND','TRANSPORT','Segment ferroviaire','Rail leg',10),
  ('RAIL_HINTERLAND','ROAD','Livraison terminale','Final delivery leg',20),
  ('RAIL_HINTERLAND','CARGO','Marchandise','Cargo',30),
  ('RAIL_HINTERLAND','CUSTOMS','Transit & douane','Transit & customs',40),
  ('END_TO_END_RAIL','PICKUP','Pré-acheminement','Pre-carriage (pickup)',10),
  ('END_TO_END_RAIL','TRANSPORT','Transport ferroviaire principal','Main rail transport',20),
  ('END_TO_END_RAIL','DELIVERY','Livraison finale','Final delivery',30),
  ('END_TO_END_RAIL','CARGO','Marchandise','Cargo',40),
  ('END_TO_END_RAIL','CUSTOMS','Douane & commerce','Customs & trade',50);

CREATE TEMP TABLE _rail_field (
  profile text NOT NULL,
  group_code text NOT NULL,
  seq numeric(10,4) NOT NULL,
  key text NOT NULL,
  label_fr text NOT NULL,
  label_en text NOT NULL,
  data_type text NOT NULL,
  is_required boolean NOT NULL,
  facet_role text,
  column_name text,
  width text NOT NULL,
  options_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  help_text_fr text,
  help_text_en text,
  is_client_visible boolean NOT NULL DEFAULT false,
  PRIMARY KEY (profile, key),
  FOREIGN KEY (profile, group_code) REFERENCES _rail_field_group(profile, code)
) ON COMMIT DROP;

INSERT INTO _rail_field (
  profile, group_code, seq, key, label_fr, label_en, data_type,
  is_required, facet_role, column_name, width
) VALUES
  -- Domestic rail: Transport, Cargo, Customs.
  ('RAIL','TRANSPORT',10,'bl_number','Lettre de voiture ferroviaire (CIM/LVF)','Rail Consignment Note (CIM/Waybill)','TEXT',false,'TRANSPORT_REF','bl_mawb','HALF'),
  ('RAIL','TRANSPORT',20,'rail_operator','Opérateur ferroviaire','Railway operator','RATE_PROVIDER',false,'CARRIER','rate_provider_id','HALF'),
  ('RAIL','TRANSPORT',30,'train_no','№ de train / convoi','Train / convoy No','TEXT',false,'CONVEYANCE','vessel_flight','HALF'),
  ('RAIL','TRANSPORT',40,'wagon_nos','№ de wagon(s) / rame','Wagon / rake No(s)','TEXT',false,NULL,NULL,'HALF'),
  ('RAIL','TRANSPORT',50,'pol','Gare / terminal de départ','Origin rail terminal / station','GEO_PLACE',true,'ORIGIN','pol','HALF'),
  ('RAIL','TRANSPORT',60,'pod','Gare / terminal d''arrivée','Destination rail terminal / station','GEO_PLACE',true,'DESTINATION','pod','HALF'),
  ('RAIL','TRANSPORT',70,'siding_branch','Embranchement particulier (ITE)','Private siding / industrial spur','TEXT',false,NULL,NULL,'HALF'),
  ('RAIL','TRANSPORT',80,'eta','ETA en gare','ETA at rail terminal','DATE',false,'ARRIVAL_DATE','eta','HALF'),
  ('RAIL','TRANSPORT',90,'ata','ATA en gare (arrivée réelle)','ATA at rail terminal (actual arrival)','DATE',false,'ARRIVAL_DATE','ata','HALF'),
  ('RAIL','TRANSPORT',100,'estimated_delivery_date','Date de livraison estimée du projet','Estimated Project Delivery Date','DATE',false,'DELIVERY_DATE','promised_delivery_date','HALF'),
  ('RAIL','TRANSPORT',110,'place_delivery','Lieu de livraison finale','Place of final delivery','GEO_PLACE',false,'FINAL_DELIVERY','place_delivery','HALF'),
  ('RAIL','CARGO',10,'commodity','Marchandise','Commodity','TEXT',true,'CARGO_DESC','commodity','HALF'),
  ('RAIL','CARGO',20,'commodity_desc','Description détaillée','Detailed description','TEXTAREA',false,NULL,'commodity_desc','FULL'),
  ('RAIL','CARGO',30,'gross_weight','Poids brut','Gross weight','NUMBER',false,'CARGO_WEIGHT','gross_weight','THIRD'),
  ('RAIL','CARGO',40,'weight_unit','Unité','Unit','SELECT',false,NULL,'weight_unit','THIRD'),
  ('RAIL','CARGO',50,'volume_cbm','Volume (m³)','Volume (CBM)','NUMBER',false,'CARGO_VOLUME','volume_cbm','THIRD'),
  ('RAIL','CARGO',60,'package_count','Nombre de colis','Package count','INTEGER',false,'CARGO_PACKAGES','package_count','HALF'),
  ('RAIL','CARGO',70,'marks_numbers','Marques & numéros','Marks & numbers','TEXT',false,'CARGO_MARKS','marks_numbers','HALF'),
  ('RAIL','CUSTOMS',10,'incoterm','Incoterm','Incoterm','SELECT',true,'INCOTERM','incoterm','THIRD'),
  ('RAIL','CUSTOMS',20,'customs_regime','Régime douanier','Customs regime','SELECT',false,'CUSTOMS_REGIME','customs_regime','THIRD'),
  ('RAIL','CUSTOMS',30,'declaration_no','№ de déclaration','Declaration No','TEXT',false,'CUSTOMS_REF',NULL,'THIRD'),

  -- Rail hinterland: railhead and border stations remain verified places; the
  -- final destination is a separate, verified road-delivery endpoint.
  ('RAIL_HINTERLAND','TRANSPORT',10,'bl_number','Lettre de voiture ferroviaire (CIM/LVF)','Rail Consignment Note (CIM/Waybill)','TEXT',false,'TRANSPORT_REF','bl_mawb','HALF'),
  ('RAIL_HINTERLAND','TRANSPORT',20,'rail_operator','Opérateur ferroviaire','Railway operator','RATE_PROVIDER',false,'CARRIER','rate_provider_id','HALF'),
  ('RAIL_HINTERLAND','TRANSPORT',30,'train_no','№ de train / convoi','Train / convoy No','TEXT',false,'CONVEYANCE','vessel_flight','HALF'),
  ('RAIL_HINTERLAND','TRANSPORT',40,'wagon_nos','№ de wagon(s) / rame','Wagon / rake No(s)','TEXT',false,NULL,NULL,'HALF'),
  ('RAIL_HINTERLAND','TRANSPORT',50,'pol','Gare de départ','Origin rail station','GEO_PLACE',true,'ORIGIN','pol','HALF'),
  ('RAIL_HINTERLAND','TRANSPORT',60,'border_station','Gare / poste frontière','Border rail post / station','GEO_PLACE',false,'ROUTE_VIA',NULL,'HALF'),
  ('RAIL_HINTERLAND','TRANSPORT',70,'entry_terminal','Gare / terminal d''entrée pays enclavé','Destination border railhead','GEO_PLACE',true,'ROUTE_VIA','pod','HALF'),
  ('RAIL_HINTERLAND','TRANSPORT',80,'eta','ETA gare frontière / terminal','ETA at railhead','DATE',false,'ARRIVAL_DATE','eta','HALF'),
  ('RAIL_HINTERLAND','TRANSPORT',90,'ata','ATA gare frontière / terminal','ATA at railhead','DATE',false,'ARRIVAL_DATE','ata','HALF'),
  ('RAIL_HINTERLAND','ROAD',10,'final_destination','Destination finale','Final destination','GEO_PLACE',true,'DESTINATION','place_delivery','HALF'),
  ('RAIL_HINTERLAND','ROAD',20,'transporter','Transporteur routier / acheminement','Road haulier (final leg)','TEXT',false,NULL,NULL,'HALF'),
  ('RAIL_HINTERLAND','ROAD',30,'estimated_delivery_date','Date de livraison estimée du projet','Estimated Project Delivery Date','DATE',false,'DELIVERY_DATE','promised_delivery_date','HALF'),
  ('RAIL_HINTERLAND','CARGO',10,'commodity','Marchandise','Commodity','TEXT',true,'CARGO_DESC','commodity','HALF'),
  ('RAIL_HINTERLAND','CARGO',20,'commodity_desc','Description détaillée','Detailed description','TEXTAREA',false,NULL,'commodity_desc','FULL'),
  ('RAIL_HINTERLAND','CARGO',30,'gross_weight','Poids brut','Gross weight','NUMBER',false,'CARGO_WEIGHT','gross_weight','THIRD'),
  ('RAIL_HINTERLAND','CARGO',40,'weight_unit','Unité','Unit','SELECT',false,NULL,'weight_unit','THIRD'),
  ('RAIL_HINTERLAND','CARGO',50,'volume_cbm','Volume (m³)','Volume (CBM)','NUMBER',false,'CARGO_VOLUME','volume_cbm','THIRD'),
  ('RAIL_HINTERLAND','CARGO',60,'package_count','Nombre de colis','Package count','INTEGER',false,'CARGO_PACKAGES','package_count','HALF'),
  ('RAIL_HINTERLAND','CARGO',70,'marks_numbers','Marques & numéros','Marks & numbers','TEXT',false,'CARGO_MARKS','marks_numbers','HALF'),
  ('RAIL_HINTERLAND','CUSTOMS',10,'transit_declaration','Déclaration de transit','Transit declaration','TEXT',false,'CUSTOMS_REF',NULL,'HALF'),
  ('RAIL_HINTERLAND','CUSTOMS',20,'customs_regime','Régime douanier','Customs regime','SELECT',false,'CUSTOMS_REGIME','customs_regime','HALF'),
  ('RAIL_HINTERLAND','CUSTOMS',30,'incoterm','Incoterm','Incoterm','SELECT',false,'INCOTERM','incoterm','HALF'),

  -- End-to-end rail: collection and final-delivery endpoints surround the main
  -- rail segment, followed by the same Cargo and Customs groups.
  ('END_TO_END_RAIL','PICKUP',10,'place_receipt','Lieu d''enlèvement','Place of collection','GEO_PLACE',true,'COLLECTION','place_receipt','HALF'),
  ('END_TO_END_RAIL','PICKUP',20,'pickup_transporter','Transporteur enlèvement','Pickup haulier','TEXT',false,NULL,NULL,'HALF'),
  ('END_TO_END_RAIL','PICKUP',30,'collection_date','Date d''enlèvement','Collection date','DATE',false,'DEPARTURE_DATE',NULL,'HALF'),
  ('END_TO_END_RAIL','TRANSPORT',10,'bl_number','Lettre de voiture ferroviaire (CIM/LVF)','Rail Consignment Note (CIM/Waybill)','TEXT',false,'TRANSPORT_REF','bl_mawb','HALF'),
  ('END_TO_END_RAIL','TRANSPORT',20,'rail_operator','Opérateur ferroviaire','Railway operator','RATE_PROVIDER',false,'CARRIER','rate_provider_id','HALF'),
  ('END_TO_END_RAIL','TRANSPORT',30,'train_no','№ de train / convoi','Train / convoy No','TEXT',false,'CONVEYANCE','vessel_flight','HALF'),
  ('END_TO_END_RAIL','TRANSPORT',40,'wagon_nos','№ de wagon(s) / rame','Wagon / rake No(s)','TEXT',false,NULL,NULL,'HALF'),
  ('END_TO_END_RAIL','TRANSPORT',50,'pol','Gare de départ','Origin rail station','GEO_PLACE',true,'ORIGIN','pol','HALF'),
  ('END_TO_END_RAIL','TRANSPORT',60,'pod','Gare d''arrivée / frontière','Destination rail station / border','GEO_PLACE',true,'ROUTE_VIA','pod','HALF'),
  ('END_TO_END_RAIL','TRANSPORT',70,'eta','ETA en gare','ETA at railhead','DATE',false,'ARRIVAL_DATE','eta','HALF'),
  ('END_TO_END_RAIL','TRANSPORT',80,'ata','ATA en gare (arrivée réelle)','ATA at railhead (actual arrival)','DATE',false,'ARRIVAL_DATE','ata','HALF'),
  ('END_TO_END_RAIL','DELIVERY',10,'place_delivery','Lieu de livraison finale','Place of final delivery','GEO_PLACE',true,'DESTINATION','place_delivery','HALF'),
  ('END_TO_END_RAIL','DELIVERY',20,'delivery_transporter','Transporteur livraison finale','Final delivery haulier','TEXT',false,NULL,NULL,'HALF'),
  ('END_TO_END_RAIL','DELIVERY',30,'estimated_delivery_date','Date de livraison estimée du projet','Estimated Project Delivery Date','DATE',false,'DELIVERY_DATE','promised_delivery_date','HALF'),
  ('END_TO_END_RAIL','CARGO',10,'commodity','Marchandise','Commodity','TEXT',true,'CARGO_DESC','commodity','HALF'),
  ('END_TO_END_RAIL','CARGO',20,'commodity_desc','Description détaillée','Detailed description','TEXTAREA',false,NULL,'commodity_desc','FULL'),
  ('END_TO_END_RAIL','CARGO',30,'gross_weight','Poids brut','Gross weight','NUMBER',false,'CARGO_WEIGHT','gross_weight','THIRD'),
  ('END_TO_END_RAIL','CARGO',40,'weight_unit','Unité','Unit','SELECT',false,NULL,'weight_unit','THIRD'),
  ('END_TO_END_RAIL','CARGO',50,'volume_cbm','Volume (m³)','Volume (CBM)','NUMBER',false,'CARGO_VOLUME','volume_cbm','THIRD'),
  ('END_TO_END_RAIL','CARGO',60,'package_count','Nombre de colis','Package count','INTEGER',false,'CARGO_PACKAGES','package_count','HALF'),
  ('END_TO_END_RAIL','CARGO',70,'marks_numbers','Marques & numéros','Marks & numbers','TEXT',false,'CARGO_MARKS','marks_numbers','HALF'),
  ('END_TO_END_RAIL','CUSTOMS',10,'incoterm','Incoterm','Incoterm','SELECT',true,'INCOTERM','incoterm','THIRD'),
  ('END_TO_END_RAIL','CUSTOMS',20,'customs_regime','Régime douanier','Customs regime','SELECT',false,'CUSTOMS_REGIME','customs_regime','THIRD'),
  ('END_TO_END_RAIL','CUSTOMS',30,'declaration_no','№ de déclaration','Declaration No','TEXT',false,'CUSTOMS_REF',NULL,'THIRD');

-- Shared option lists and validation rules.  A SELECT with [] is unusable, so
-- these are populated before the durable field rows are inserted.
UPDATE _rail_field SET options_json = '[
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

UPDATE _rail_field SET options_json = '[
  {"value":"IM4","label_fr":"IM4 — Mise à la consommation","label_en":"IM4 — Home use"},
  {"value":"IM7","label_fr":"IM7 — Entrepôt douanier","label_en":"IM7 — Customs warehouse"},
  {"value":"IM8","label_fr":"IM8 — Transit","label_en":"IM8 — Transit"},
  {"value":"EX1","label_fr":"EX1 — Exportation définitive","label_en":"EX1 — Permanent export"},
  {"value":"EX2","label_fr":"EX2 — Exportation temporaire","label_en":"EX2 — Temporary export"}
]'::jsonb WHERE key = 'customs_regime';

UPDATE _rail_field SET options_json = '[
  {"value":"KG","label_fr":"kg","label_en":"kg"},
  {"value":"TON","label_fr":"tonne","label_en":"tonne"},
  {"value":"LB","label_fr":"livre (lb)","label_en":"pound (lb)"}
]'::jsonb WHERE key = 'weight_unit';

UPDATE _rail_field
   SET validation_json = '{"min":0}'::jsonb
 WHERE data_type IN ('NUMBER','INTEGER');

UPDATE _rail_field
   SET is_client_visible = true
 WHERE key IN (
  'bl_number','rail_operator','train_no','wagon_nos','siding_branch',
  'pickup_transporter','delivery_transporter','transporter',
  'pol','pod','border_station','entry_terminal','place_receipt','place_delivery','final_destination',
  'eta','ata','collection_date','estimated_delivery_date',
  'commodity','package_count','gross_weight','weight_unit','volume_cbm',
  'declaration_no','transit_declaration','customs_regime','incoterm'
 );

UPDATE _rail_field
   SET help_text_fr = 'Renseigné à réception du document de transport — laissez vide à l''ouverture du dossier.',
       help_text_en = 'Filled in when the transport document arrives — leave blank when opening the file.'
 WHERE key = 'bl_number';
UPDATE _rail_field
   SET help_text_fr = 'Date réelle : renseignée après l''arrivée. Elle prime sur l''ETA partout où la date est affichée.',
       help_text_en = 'The actual date, entered after arrival. It supersedes the ETA everywhere the date is shown.'
 WHERE key = 'ata';

INSERT INTO service_type_field_set (
  service_type_id, version, is_active, name, is_system, source_version, published_at
)
SELECT st.service_type_id, 1, true,
       'Détails standard — ' || st.name_fr,
       true, 1, now()
  FROM service_type st
  JOIN _rail_profile p ON p.svc = st.key
 WHERE NOT EXISTS (
   SELECT 1
     FROM service_type_field_set existing
    WHERE existing.service_type_id = st.service_type_id
 )
ON CONFLICT (service_type_id, version) DO NOTHING;

INSERT INTO service_type_field (
  service_type_field_set_id,
  group_code,
  group_label_fr,
  group_label_en,
  group_seq,
  seq,
  key,
  label_fr,
  label_en,
  help_text_fr,
  help_text_en,
  data_type,
  options_json,
  validation_json,
  is_required,
  is_client_visible,
  is_active,
  is_system,
  facet_role,
  column_name,
  width
)
SELECT
  fs.service_type_field_set_id,
  f.group_code,
  g.label_fr,
  g.label_en,
  g.group_seq,
  f.seq,
  f.key,
  f.label_fr,
  f.label_en,
  f.help_text_fr,
  f.help_text_en,
  f.data_type,
  f.options_json,
  f.validation_json,
  f.is_required,
  f.is_client_visible,
  true,
  true,
  f.facet_role,
  f.column_name,
  f.width
FROM _rail_profile p
JOIN service_type st ON st.key = p.svc
JOIN service_type_field_set fs
  ON fs.service_type_id = st.service_type_id
 AND fs.version = 1
 AND fs.is_system
JOIN _rail_field f ON f.profile = p.profile
JOIN _rail_field_group g
  ON g.profile = f.profile
 AND g.code = f.group_code
ON CONFLICT (service_type_field_set_id, key) DO NOTHING;

-- ── 4. Financial dictionary mappings ────────────────────────────────────────
-- 9080 authored the catalogue before 11743's service types existed on upgraded
-- tenants, so its inner join could not create these rows.  Join by the published
-- English label as required by the backfill contract (not by tenant-facing UUID
-- or a guessed id).  This includes the shared operational lines, every dedicated
-- rail line, and the BASIC bundles 9080 declares for these services.
CREATE TEMP TABLE _rail_dictionary (
  svc text NOT NULL,
  label_en text NOT NULL,
  tier text NOT NULL,
  PRIMARY KEY (svc, label_en)
) ON COMMIT DROP;

INSERT INTO _rail_dictionary (svc, label_en, tier)
SELECT s.svc, d.label_en, d.tier
  FROM (VALUES
    ('Commissions on Disbursement','ADVANCED'),
    ('Documentation Fee','ADVANCED'),
    ('Extra Legal Work','ADVANCED'),
    ('File Opening','ADVANCED'),
    ('Import Declaration Fee','ADVANCED'),
    ('Rail Freight','BASIC'),
    ('Rail Shunting & Station Fee','ADVANCED'),
    ('Railhead Terminal Handling','BASIC'),
    ('Service Charges','ADVANCED'),
    ('Bank Caution','ADVANCED'),
    ('Bank Charges','ADVANCED'),
    ('Facility Payment (Customs)','ADVANCED'),
    ('Wagon Demurrage','ADVANCED'),
    ('Rail Escort & Security Fee','ADVANCED'),
    ('Ancillary Charges','FULL'),
    ('Document Authentication','FULL'),
    ('Local Insurance','ADVANCED'),
    ('Stamp','ADVANCED'),
    ('Transport Authorisation (Ministry of Transport)','ADVANCED')
  ) AS d(label_en, tier)
  CROSS JOIN (VALUES
    ('RAIL_TRANSPORTATION'),
    ('RAIL_HINTERLAND_TRANSIT'),
    ('END_TO_END_RAIL_FREIGHT')
  ) AS s(svc);

INSERT INTO _rail_dictionary (svc, label_en, tier) VALUES
  ('RAIL_TRANSPORTATION','Delivery at Destination','ADVANCED'),
  ('RAIL_HINTERLAND_TRANSIT','Convoy Security','ADVANCED'),
  ('RAIL_HINTERLAND_TRANSIT','Border Crossing Formalities','ADVANCED'),
  ('RAIL_HINTERLAND_TRANSIT','Rail Corridor Levy','ADVANCED'),
  ('RAIL_HINTERLAND_TRANSIT','Transit Title (T1)','ADVANCED'),
  ('RAIL_HINTERLAND_TRANSIT','Customs Formalities','ADVANCED'),
  ('END_TO_END_RAIL_FREIGHT','Border Crossing Formalities','ADVANCED'),
  ('END_TO_END_RAIL_FREIGHT','Cargo Pick-Up','ADVANCED'),
  ('END_TO_END_RAIL_FREIGHT','Delivery at Destination','ADVANCED'),
  ('END_TO_END_RAIL_FREIGHT','Origin Charges','ADVANCED'),
  ('END_TO_END_RAIL_FREIGHT','Final Destination Charges','ADVANCED')
ON CONFLICT (svc, label_en) DO NOTHING;

-- The normal form opens on the standard operational bundle, not an empty
-- ADVANCED picker.  These are the BASIC declarations from 9080's _dict_basic.
INSERT INTO _rail_dictionary (svc, label_en, tier) VALUES
  ('RAIL_TRANSPORTATION','Rail Freight','BASIC'),
  ('RAIL_TRANSPORTATION','Railhead Terminal Handling','BASIC'),
  ('RAIL_TRANSPORTATION','Documentation Fee','BASIC'),
  ('RAIL_TRANSPORTATION','File Opening','BASIC'),
  ('RAIL_TRANSPORTATION','Delivery at Destination','BASIC'),
  ('RAIL_HINTERLAND_TRANSIT','Rail Freight','BASIC'),
  ('RAIL_HINTERLAND_TRANSIT','Railhead Terminal Handling','BASIC'),
  ('RAIL_HINTERLAND_TRANSIT','Transit Title (T1)','BASIC'),
  ('RAIL_HINTERLAND_TRANSIT','Border Crossing Formalities','BASIC'),
  ('RAIL_HINTERLAND_TRANSIT','Customs Formalities','BASIC'),
  ('RAIL_HINTERLAND_TRANSIT','Documentation Fee','BASIC'),
  ('END_TO_END_RAIL_FREIGHT','Origin Charges','BASIC'),
  ('END_TO_END_RAIL_FREIGHT','Cargo Pick-Up','BASIC'),
  ('END_TO_END_RAIL_FREIGHT','Rail Freight','BASIC'),
  ('END_TO_END_RAIL_FREIGHT','Railhead Terminal Handling','BASIC'),
  ('END_TO_END_RAIL_FREIGHT','Final Destination Charges','BASIC'),
  ('END_TO_END_RAIL_FREIGHT','Delivery at Destination','BASIC'),
  ('END_TO_END_RAIL_FREIGHT','Documentation Fee','BASIC'),
  ('END_TO_END_RAIL_FREIGHT','File Opening','BASIC')
ON CONFLICT (svc, label_en) DO UPDATE SET tier = EXCLUDED.tier;

INSERT INTO service_type_dictionary_item (
  service_type_id, dictionary_item_id, tier, sort_order
)
SELECT st.service_type_id,
       di.dictionary_item_id,
       rd.tier,
       CASE rd.tier WHEN 'BASIC' THEN 100 WHEN 'ADVANCED' THEN 300 ELSE 500 END
         + row_number() OVER (
             PARTITION BY rd.svc, rd.tier
             ORDER BY rd.label_en
           )::integer
  FROM _rail_dictionary rd
  JOIN service_type st ON st.key = rd.svc
  JOIN dictionary_item di ON di.label_en = rd.label_en
ON CONFLICT (service_type_id, dictionary_item_id) DO NOTHING;

-- DOWN
-- Reverse only the three system defaults authored/backfilled here.  Child rows
-- are removed before parents; tenant-authored non-system versions are untouched.
--
-- DELETE FROM service_type_dictionary_item stdi
--  USING service_type st
--  WHERE stdi.service_type_id = st.service_type_id
--    AND st.key IN ('RAIL_TRANSPORTATION','RAIL_HINTERLAND_TRANSIT','END_TO_END_RAIL_FREIGHT');
--
-- DELETE FROM service_type_field_set fs
--  USING service_type st
--  WHERE fs.service_type_id = st.service_type_id
--    AND fs.version = 1 AND fs.is_system
--    AND st.key IN ('RAIL_TRANSPORTATION','RAIL_HINTERLAND_TRANSIT','END_TO_END_RAIL_FREIGHT');
--
-- DELETE FROM service_type_assumption a
--  USING service_type st
--  WHERE a.service_type_id = st.service_type_id AND a.is_system
--    AND st.key IN ('RAIL_TRANSPORTATION','RAIL_HINTERLAND_TRANSIT','END_TO_END_RAIL_FREIGHT');
--
-- DELETE FROM milestone_template_stage mts
--  USING milestone_template mt, service_type st
--  WHERE mts.milestone_template_id = mt.milestone_template_id
--    AND mt.service_type_id = st.service_type_id
--    AND mt.version = 1 AND mt.is_system AND mts.is_system
--    AND st.key IN ('RAIL_TRANSPORTATION','RAIL_HINTERLAND_TRANSIT','END_TO_END_RAIL_FREIGHT');
--
-- DELETE FROM milestone_template mt
--  USING service_type st
--  WHERE mt.service_type_id = st.service_type_id
--    AND mt.version = 1 AND mt.is_system
--    AND st.key IN ('RAIL_TRANSPORTATION','RAIL_HINTERLAND_TRANSIT','END_TO_END_RAIL_FREIGHT');
