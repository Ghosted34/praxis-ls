-- ============================================================================
-- TENANT SEED — 9092: the shipment/service detail form for every seeded service
-- type (0660).
--
-- WHAT THIS IS. One active v1 field set per service type, carrying the fields
-- that service actually needs — and NOTHING else. This is where the legacy
-- system's five hard-coded HTML blocks (sea / air / inland / warehouse /
-- representation, `view/operations/operations-registry.php`) become data a
-- manager can edit, extend and version from the Service Type screen.
--
-- IT IS A DEFAULT, NOT A LAW. Same rule as the milestone-template seed: a
-- service type that already has a field set is left completely alone, so a
-- re-run changes nothing and a tenant who has authored their own form keeps it.
--
-- WHY PROFILES. Sea import, sea export and end-to-end sea want the same form;
-- so do the three air variants. Authoring each one separately would be three
-- chances to let them drift apart for no reason. So the fields are written ONCE
-- per profile, expanded across the service types that use it, and then a
-- handful of deliberate per-service overrides are applied on top (an end-to-end
-- file's DESTINATION is the door, not the discharge port — the port becomes a
-- waypoint). Every difference between two service types is therefore visible in
-- one short list rather than buried in three near-identical blocks.
--
-- THE TWO RULES BEHIND EVERY `is_required` BELOW.
--
--   Required = knowable on the day the file is opened. Origin, destination,
--   commodity, incoterm: yes. A Bill of Lading number, a vessel, an ETA, a
--   flight number: no — those arrive days or weeks later, and a form that
--   demands them on day one gets fed invented values, which is worse than an
--   empty field. Completeness is tracked and surfaced instead of enforced.
--
--   WAREHOUSING AND BUSINESS REPRESENTATION CARRY NO FREIGHT VOCABULARY AT ALL.
--   Not a hidden port field, not an empty BL box, not an ETA. A storage file
--   asks about custody; a representation file asks about mandate and period.
--   This is the single most important thing in the file — the legacy system
--   showed a Port of Loading on a warehousing job, and that is precisely the
--   confusion the whole SSDC exists to end.
-- ============================================================================

-- ── Container types: give the specials a size ───────────────────────────────
-- WHY HERE AND NOT IN 0660. These rows are created by seed 9080, and seeds run
-- AFTER every tenant migration — on a fresh provision AND on an upgrade. An
-- UPDATE against them from a 0xxx migration therefore matches nothing on a new
-- tenant: the migration runs first, the rows appear afterwards. Verified the
-- hard way against a real database.
--
-- `extra` carries the structured facts anything computing on equipment needs:
-- `teu` for capacity, `size` for the rate lookup, `family` so the sized variants
-- of one kind still group together in a picker.
INSERT INTO dictionary_ref (kind, code, name_fr, name_en, extra, sort_order, is_system) VALUES
  ('CONTAINER_TYPE','FT20HC','20'' HC','20'' High Cube','{"teu":1,"size":"20HC","family":"DRY"}'::jsonb,15,true),
  ('CONTAINER_TYPE','RF20','20'' Frigo','20'' Reefer','{"teu":1,"size":"20","family":"REEFER","powered":true,"special":true}'::jsonb,110,true),
  ('CONTAINER_TYPE','RF40','40'' Frigo','40'' Reefer','{"teu":2,"size":"40","family":"REEFER","powered":true,"special":true}'::jsonb,120,true),
  ('CONTAINER_TYPE','RF40HC','40'' HC Frigo','40'' HC Reefer','{"teu":2,"size":"40HC","family":"REEFER","powered":true,"special":true}'::jsonb,130,true),
  ('CONTAINER_TYPE','FR20','20'' Flat Rack','20'' Flat Rack','{"teu":1,"size":"20","family":"FLATRACK","special":true}'::jsonb,140,true),
  ('CONTAINER_TYPE','FR40','40'' Flat Rack','40'' Flat Rack','{"teu":2,"size":"40","family":"FLATRACK","special":true}'::jsonb,150,true),
  ('CONTAINER_TYPE','OT20','20'' Open Top','20'' Open Top','{"teu":1,"size":"20","family":"OPENTOP","special":true}'::jsonb,160,true),
  ('CONTAINER_TYPE','OT40','40'' Open Top','40'' Open Top','{"teu":2,"size":"40","family":"OPENTOP","special":true}'::jsonb,170,true),
  ('CONTAINER_TYPE','TK20','20'' ISO Tank','20'' ISO Tank','{"teu":1,"size":"20","family":"ISOTANK","special":true}'::jsonb,180,true),
  ('CONTAINER_TYPE','TK40','40'' ISO Tank','40'' ISO Tank','{"teu":2,"size":"40","family":"ISOTANK","special":true}'::jsonb,190,true),
  ('CONTAINER_TYPE','VT20','20'' Ventilé','20'' Ventilated','{"teu":1,"size":"20","family":"VENTILATED","special":true}'::jsonb,200,true),
  ('CONTAINER_TYPE','VT40','40'' Ventilé','40'' Ventilated','{"teu":2,"size":"40","family":"VENTILATED","special":true}'::jsonb,210,true)
ON CONFLICT (kind, code) DO NOTHING;

-- The sized rows inherit the aliases 9081 gave their size-less ancestors, so
-- the dictionary finder keeps matching "flat rack", "frigo", "20 pieds" — with
-- the size appended, since that is now the distinguishing part.
UPDATE dictionary_ref
   SET extra = extra || '{"family":"DRY"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code IN ('FT20','FT40','FT40HC','FT45HC')
   AND NOT (extra ? 'family');
UPDATE dictionary_ref
   SET extra = extra || '{"family":"BULK"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'BULK' AND NOT (extra ? 'family');

-- Retire the size-less specials now that sized rows exist — but ONLY where
-- nothing points at them. A tenant that already priced a rate against the old
-- `FLATRACK` row keeps it: breaking a live rate card to tidy a picker is a bad
-- trade, and the sized rows sit alongside it either way.
--
-- Deactivation, not deletion — history stays readable and "restore defaults"
-- remains possible. The rename is what stops the two reading as duplicates in
-- an admin list that shows inactive rows.
UPDATE dictionary_ref dr
   SET is_active = false,
       name_fr = dr.name_fr || ' (taille non précisée)',
       name_en = COALESCE(dr.name_en, dr.name_fr) || ' (unspecified size)'
 WHERE dr.kind = 'CONTAINER_TYPE'
   AND dr.code IN ('FLATRACK','OPENTOP','REEFER','ISOTANK','VENTILATED')
   AND dr.is_active
   AND dr.name_fr NOT LIKE '%(taille non précisée)'
   AND NOT EXISTS (SELECT 1 FROM expense_rate er WHERE er.container_type_ref_id = dr.ref_id);

-- ── Staging: groups, fields, and which services use which profile ───────────
-- ON COMMIT DROP: the migrator runs each seed file in one transaction and
-- reuses the connection, so these must not survive into the next file.

CREATE TEMP TABLE _stf_profile (svc text PRIMARY KEY, profile text NOT NULL) ON COMMIT DROP;
INSERT INTO _stf_profile (svc, profile) VALUES
  ('SEA_FREIGHT_IMPORT','SEA'),
  ('SEA_FREIGHT_EXPORT','SEA'),
  ('END_TO_END_SEA_FREIGHT','SEA'),
  ('AIR_FREIGHT_IMPORT','AIR'),
  ('AIR_FREIGHT_EXPORT','AIR'),
  ('END_TO_END_AIR_FREIGHT','AIR'),
  ('HINTERLAND_TRANSIT','HINTERLAND'),
  ('INLAND_TRANSPORTATION','INLAND'),
  ('WAREHOUSING','WAREHOUSE'),
  ('BUSINESS_REPRESENTATION','REPRESENTATION'),
  ('CUSTOMS_BROKERAGE','CUSTOMS'),
  ('PROJECT_CARGO','PROJECT'),
  ('RAIL_TRANSPORTATION','RAIL'),
  ('RAIL_HINTERLAND_TRANSIT','RAIL_HINTERLAND');

CREATE TEMP TABLE _stf_group (
  profile text NOT NULL, code text NOT NULL,
  label_fr text NOT NULL, label_en text NOT NULL, seq integer NOT NULL,
  PRIMARY KEY (profile, code)
) ON COMMIT DROP;
INSERT INTO _stf_group (profile, code, label_fr, label_en, seq) VALUES
  ('SEA','TRANSPORT','Transport maritime','Sea transport',10),
  ('SEA','CARGO','Marchandise','Cargo',20),
  ('SEA','CUSTOMS','Douane & commerce','Customs & trade',30),

  ('AIR','TRANSPORT','Transport aérien','Air transport',10),
  ('AIR','CARGO','Marchandise','Cargo',20),
  ('AIR','CUSTOMS','Douane & commerce','Customs & trade',30),

  ('HINTERLAND','TRANSPORT','Segment maritime','Sea leg',10),
  ('HINTERLAND','ROAD','Segment terrestre','Road leg',20),
  ('HINTERLAND','CARGO','Marchandise','Cargo',30),
  ('HINTERLAND','CUSTOMS','Transit & douane','Transit & customs',40),

  ('INLAND','ROAD','Transport terrestre','Road transport',10),
  ('INLAND','ROUTE','Itinéraire','Route',20),
  ('INLAND','CARGO','Marchandise','Cargo',30),

  ('WAREHOUSE','STORAGE','Entreposage','Storage',10),
  ('WAREHOUSE','GOODS','Marchandise stockée','Stored goods',20),

  ('REPRESENTATION','MANDATE','Mandat','Mandate',10),
  ('REPRESENTATION','TERMS','Conditions','Terms',20),

  ('CUSTOMS','DECLARATION','Déclaration','Declaration',10),
  ('CUSTOMS','CARGO','Marchandise','Cargo',20),

  ('PROJECT','TRANSPORT','Transport','Transport',10),
  ('PROJECT','CARGO','Colis hors gabarit','Out-of-gauge cargo',20),
  ('PROJECT','CUSTOMS','Douane & commerce','Customs & trade',30),

  ('RAIL','TRANSPORT','Transport ferroviaire','Rail transport',10),
  ('RAIL','CARGO','Marchandise','Cargo',20),
  ('RAIL','CUSTOMS','Douane & commerce','Customs & trade',30),

  ('RAIL_HINTERLAND','TRANSPORT','Segment ferroviaire','Rail leg',10),
  ('RAIL_HINTERLAND','ROAD','Livraison terminale','Final delivery leg',20),
  ('RAIL_HINTERLAND','CARGO','Marchandise','Cargo',30),
  ('RAIL_HINTERLAND','CUSTOMS','Transit & douane','Transit & customs',40);

CREATE TEMP TABLE _stf_field (
  profile     text NOT NULL,
  group_code  text NOT NULL,
  seq         numeric(10,4) NOT NULL,
  key         text NOT NULL,
  label_fr    text NOT NULL,
  label_en    text NOT NULL,
  data_type   text NOT NULL DEFAULT 'TEXT',
  is_required boolean NOT NULL DEFAULT false,
  facet_role  text,
  column_name text,
  width       text NOT NULL DEFAULT 'HALF',
  ref_kind    text,
  options     jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation  jsonb NOT NULL DEFAULT '{}'::jsonb,
  help_fr     text,
  help_en     text,
  client_vis  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (profile, key)
) ON COMMIT DROP;

-- ── SEA ─────────────────────────────────────────────────────────────────────
INSERT INTO _stf_field (profile, group_code, seq, key, label_fr, label_en, data_type, is_required, facet_role, column_name, width) VALUES
  ('SEA','TRANSPORT',10,'bl_number','Connaissement (BL)','Bill of Lading','TEXT',false,'TRANSPORT_REF','bl_mawb','HALF'),
  ('SEA','TRANSPORT',20,'shipping_line','Compagnie maritime','Shipping line','RATE_PROVIDER',false,'CARRIER','rate_provider_id','HALF'),
  ('SEA','TRANSPORT',30,'vessel_name','Navire','Vessel','TEXT',false,'CONVEYANCE','vessel_flight','HALF'),
  ('SEA','TRANSPORT',40,'voyage_no','Voyage №','Voyage No','TEXT',false,'CONVEYANCE',NULL,'HALF'),
  ('SEA','TRANSPORT',50,'pol','Port de chargement (POL)','Port of loading (POL)','GEO_PLACE',true,'ORIGIN','pol','HALF'),
  ('SEA','TRANSPORT',60,'pod','Port de déchargement (POD)','Port of discharge (POD)','GEO_PLACE',true,'DESTINATION','pod','HALF'),
  ('SEA','TRANSPORT',70,'eta','ETA','ETA','DATE',false,'ARRIVAL_DATE','eta','HALF'),
  ('SEA','TRANSPORT',80,'ata','ATA (arrivée réelle)','ATA (actual arrival)','DATE',false,'ARRIVAL_DATE','ata','HALF'),
  ('SEA','TRANSPORT',90,'place_delivery','Lieu de livraison','Place of delivery','TEXT',false,NULL,'place_delivery','HALF'),
  ('SEA','CARGO',10,'commodity','Marchandise','Commodity','TEXT',true,'CARGO_DESC','commodity','HALF'),
  ('SEA','CARGO',20,'commodity_desc','Description détaillée','Detailed description','TEXTAREA',false,NULL,'commodity_desc','FULL'),
  ('SEA','CARGO',30,'gross_weight','Poids brut','Gross weight','NUMBER',false,'CARGO_WEIGHT','gross_weight','THIRD'),
  ('SEA','CARGO',40,'weight_unit','Unité','Unit','SELECT',false,NULL,'weight_unit','THIRD'),
  ('SEA','CARGO',50,'volume_cbm','Volume (m³)','Volume (CBM)','NUMBER',false,'CARGO_VOLUME','volume_cbm','THIRD'),
  ('SEA','CARGO',60,'package_count','Nombre de colis','Package count','INTEGER',false,'CARGO_PACKAGES','package_count','HALF'),
  ('SEA','CARGO',70,'marks_numbers','Marques & numéros','Marks & numbers','TEXT',false,'CARGO_MARKS','marks_numbers','HALF'),
  ('SEA','CUSTOMS',10,'incoterm','Incoterm','Incoterm','SELECT',true,'INCOTERM','incoterm','THIRD'),
  ('SEA','CUSTOMS',20,'customs_regime','Régime douanier','Customs regime','SELECT',false,'CUSTOMS_REGIME','customs_regime','THIRD'),
  ('SEA','CUSTOMS',30,'declaration_no','№ de déclaration','Declaration No','TEXT',false,'CUSTOMS_REF',NULL,'THIRD');

-- ── AIR ─────────────────────────────────────────────────────────────────────
-- Air is NOT sea with different words: it is priced on chargeable weight, the
-- transport reference is a pair (master + house air waybill), and there is no
-- vessel/voyage — so the fields differ in substance, not only in label.
INSERT INTO _stf_field (profile, group_code, seq, key, label_fr, label_en, data_type, is_required, facet_role, column_name, width) VALUES
  ('AIR','TRANSPORT',10,'mawb','LTA mère (MAWB)','Master Air Waybill (MAWB)','TEXT',false,'TRANSPORT_REF','bl_mawb','HALF'),
  ('AIR','TRANSPORT',20,'hawb','LTA fille (HAWB)','House Air Waybill (HAWB)','TEXT',false,'TRANSPORT_REF',NULL,'HALF'),
  ('AIR','TRANSPORT',30,'airline','Compagnie aérienne','Airline','RATE_PROVIDER',false,'CARRIER','rate_provider_id','HALF'),
  ('AIR','TRANSPORT',40,'flight_no','№ de vol','Flight No','TEXT',false,'CONVEYANCE','vessel_flight','HALF'),
  ('AIR','TRANSPORT',50,'origin_airport','Aéroport de départ','Origin airport','GEO_PLACE',true,'ORIGIN','pol','HALF'),
  ('AIR','TRANSPORT',60,'dest_airport','Aéroport d''arrivée','Destination airport','GEO_PLACE',true,'DESTINATION','pod','HALF'),
  ('AIR','TRANSPORT',70,'eta','ETA','ETA','DATE',false,'ARRIVAL_DATE','eta','HALF'),
  ('AIR','TRANSPORT',80,'ata','ATA (arrivée réelle)','ATA (actual arrival)','DATE',false,'ARRIVAL_DATE','ata','HALF'),
  ('AIR','CARGO',10,'commodity','Marchandise','Commodity','TEXT',true,'CARGO_DESC','commodity','HALF'),
  ('AIR','CARGO',20,'commodity_desc','Description détaillée','Detailed description','TEXTAREA',false,NULL,'commodity_desc','FULL'),
  ('AIR','CARGO',30,'gross_weight','Poids brut','Gross weight','NUMBER',false,'CARGO_WEIGHT','gross_weight','THIRD'),
  ('AIR','CARGO',40,'weight_unit','Unité','Unit','SELECT',false,NULL,'weight_unit','THIRD'),
  ('AIR','CARGO',50,'chargeable_weight','Poids taxable','Chargeable weight','NUMBER',false,NULL,NULL,'THIRD'),
  ('AIR','CARGO',60,'volume_cbm','Volume (m³)','Volume (CBM)','NUMBER',false,'CARGO_VOLUME','volume_cbm','THIRD'),
  ('AIR','CARGO',70,'package_count','Nombre de colis','Package count','INTEGER',false,'CARGO_PACKAGES','package_count','THIRD'),
  ('AIR','CARGO',80,'marks_numbers','Marques & numéros','Marks & numbers','TEXT',false,'CARGO_MARKS','marks_numbers','THIRD'),
  ('AIR','CUSTOMS',10,'incoterm','Incoterm','Incoterm','SELECT',true,'INCOTERM','incoterm','THIRD'),
  ('AIR','CUSTOMS',20,'customs_regime','Régime douanier','Customs regime','SELECT',false,'CUSTOMS_REGIME','customs_regime','THIRD'),
  ('AIR','CUSTOMS',30,'declaration_no','№ de déclaration','Declaration No','TEXT',false,'CUSTOMS_REF',NULL,'THIRD');

-- ── HINTERLAND TRANSIT (sea leg + bonded road corridor) ─────────────────────
-- The one composite case the legacy form got right (it rendered sea + inland
-- together). The discharge port is a WAYPOINT here, not the destination: the
-- cargo's destination is N'Djamena or Bangui, and every document that prints a
-- route must say so.
INSERT INTO _stf_field (profile, group_code, seq, key, label_fr, label_en, data_type, is_required, facet_role, column_name, width) VALUES
  ('HINTERLAND','TRANSPORT',10,'bl_number','Connaissement (BL)','Bill of Lading','TEXT',false,'TRANSPORT_REF','bl_mawb','HALF'),
  ('HINTERLAND','TRANSPORT',20,'shipping_line','Compagnie maritime','Shipping line','RATE_PROVIDER',false,'CARRIER','rate_provider_id','HALF'),
  ('HINTERLAND','TRANSPORT',30,'vessel_name','Navire','Vessel','TEXT',false,'CONVEYANCE','vessel_flight','HALF'),
  ('HINTERLAND','TRANSPORT',40,'pol','Port de chargement (POL)','Port of loading (POL)','GEO_PLACE',true,'ORIGIN','pol','HALF'),
  ('HINTERLAND','TRANSPORT',50,'entry_port','Port d''entrée','Port of entry','GEO_PLACE',true,'ROUTE_VIA','pod','HALF'),
  ('HINTERLAND','TRANSPORT',60,'eta','ETA au port d''entrée','ETA at port of entry','DATE',false,'ARRIVAL_DATE','eta','HALF'),
  ('HINTERLAND','TRANSPORT',70,'ata','ATA au port d''entrée','ATA at port of entry','DATE',false,'ARRIVAL_DATE','ata','HALF'),
  ('HINTERLAND','ROAD',10,'final_destination','Destination finale','Final destination','TEXT',true,'DESTINATION','place_delivery','HALF'),
  ('HINTERLAND','ROAD',20,'border_post','Poste frontalier','Border post','TEXT',false,'ROUTE_VIA',NULL,'HALF'),
  ('HINTERLAND','ROAD',30,'truck_plate','Immatriculation camion','Truck plate','TEXT',false,NULL,NULL,'HALF'),
  ('HINTERLAND','ROAD',40,'transporter','Transporteur','Haulier','TEXT',false,NULL,NULL,'HALF'),
  ('HINTERLAND','ROAD',50,'escort_required','Escorte requise','Escort required','BOOLEAN',false,NULL,NULL,'HALF'),
  ('HINTERLAND','ROAD',60,'corridor_delivery_eta','Livraison prévue à destination','Planned delivery at destination','DATE',false,NULL,'promised_delivery_date','HALF'),
  ('HINTERLAND','CARGO',10,'commodity','Marchandise','Commodity','TEXT',true,'CARGO_DESC','commodity','HALF'),
  ('HINTERLAND','CARGO',20,'commodity_desc','Description détaillée','Detailed description','TEXTAREA',false,NULL,'commodity_desc','FULL'),
  ('HINTERLAND','CARGO',30,'gross_weight','Poids brut','Gross weight','NUMBER',false,'CARGO_WEIGHT','gross_weight','THIRD'),
  ('HINTERLAND','CARGO',40,'weight_unit','Unité','Unit','SELECT',false,NULL,'weight_unit','THIRD'),
  ('HINTERLAND','CARGO',50,'package_count','Nombre de colis','Package count','INTEGER',false,'CARGO_PACKAGES','package_count','THIRD'),
  ('HINTERLAND','CARGO',60,'marks_numbers','Marques & numéros','Marks & numbers','TEXT',false,'CARGO_MARKS','marks_numbers','HALF'),
  ('HINTERLAND','CUSTOMS',10,'transit_declaration','Déclaration de transit','Transit declaration','TEXT',false,'CUSTOMS_REF',NULL,'HALF'),
  ('HINTERLAND','CUSTOMS',20,'customs_regime','Régime douanier','Customs regime','SELECT',false,'CUSTOMS_REGIME','customs_regime','HALF'),
  ('HINTERLAND','CUSTOMS',30,'incoterm','Incoterm','Incoterm','SELECT',false,'INCOTERM','incoterm','HALF');

-- ── INLAND TRANSPORTATION ───────────────────────────────────────────────────
-- No port, no BL, no incoterm: a domestic haul is a truck, two places and a
-- waybill.
INSERT INTO _stf_field (profile, group_code, seq, key, label_fr, label_en, data_type, is_required, facet_role, column_name, width) VALUES
  ('INLAND','ROAD',10,'waybill_no','№ de lettre de voiture','Waybill No','TEXT',false,'TRANSPORT_REF','bl_mawb','HALF'),
  ('INLAND','ROAD',20,'truck_plate','Immatriculation camion','Truck plate','TEXT',false,'CONVEYANCE','vessel_flight','HALF'),
  ('INLAND','ROAD',30,'trailer_plate','Immatriculation remorque','Trailer plate','TEXT',false,NULL,NULL,'HALF'),
  ('INLAND','ROAD',40,'transporter','Transporteur','Haulier','TEXT',false,NULL,NULL,'HALF'),
  ('INLAND','ROAD',50,'driver_name','Chauffeur','Driver','TEXT',false,NULL,NULL,'HALF'),
  ('INLAND','ROAD',60,'driver_phone','Téléphone chauffeur','Driver phone','TEXT',false,NULL,NULL,'HALF'),
  ('INLAND','ROUTE',10,'place_receipt','Lieu d''enlèvement','Place of collection','TEXT',true,'ORIGIN','place_receipt','HALF'),
  ('INLAND','ROUTE',20,'place_delivery','Lieu de livraison','Place of delivery','TEXT',true,'DESTINATION','place_delivery','HALF'),
  ('INLAND','ROUTE',30,'collection_date','Date d''enlèvement','Collection date','DATE',false,'DEPARTURE_DATE',NULL,'HALF'),
  ('INLAND','ROUTE',40,'eta','Livraison prévue','Planned delivery','DATE',false,'ARRIVAL_DATE','eta','HALF'),
  ('INLAND','ROUTE',50,'ata','Livraison effective','Actual delivery','DATE',false,'ARRIVAL_DATE','ata','HALF'),
  ('INLAND','CARGO',10,'commodity','Marchandise','Commodity','TEXT',true,'CARGO_DESC','commodity','HALF'),
  ('INLAND','CARGO',20,'commodity_desc','Description détaillée','Detailed description','TEXTAREA',false,NULL,'commodity_desc','FULL'),
  ('INLAND','CARGO',30,'gross_weight','Poids brut','Gross weight','NUMBER',false,'CARGO_WEIGHT','gross_weight','THIRD'),
  ('INLAND','CARGO',40,'weight_unit','Unité','Unit','SELECT',false,NULL,'weight_unit','THIRD'),
  ('INLAND','CARGO',50,'package_count','Nombre de colis','Package count','INTEGER',false,'CARGO_PACKAGES','package_count','THIRD'),
  ('INLAND','CARGO',60,'marks_numbers','Marques & numéros','Marks & numbers','TEXT',false,'CARGO_MARKS','marks_numbers','HALF');

-- ── WAREHOUSING — custody, not freight ──────────────────────────────────────
-- Read this list next to the sea one: no port, no vessel, no BL, no incoterm,
-- no ETA. A storage file answers WHERE the goods are, UNDER WHAT customs
-- status, FROM WHEN, and ON WHAT BASIS they are charged.
INSERT INTO _stf_field (profile, group_code, seq, key, label_fr, label_en, data_type, is_required, facet_role, column_name, width) VALUES
  ('WAREHOUSE','STORAGE',10,'warehouse_location','Entrepôt','Warehouse','TEXT',true,'CUSTODY_LOCATION',NULL,'HALF'),
  ('WAREHOUSE','STORAGE',20,'storage_area','Zone / emplacement','Area / bay','TEXT',false,NULL,NULL,'HALF'),
  ('WAREHOUSE','STORAGE',30,'bonded_status','Statut douanier','Bonded status','SELECT',true,'CUSTODY_STATUS',NULL,'HALF'),
  ('WAREHOUSE','STORAGE',40,'customs_regime','Régime douanier','Customs regime','SELECT',false,'CUSTOMS_REGIME','customs_regime','HALF'),
  ('WAREHOUSE','STORAGE',50,'stock_in_date','Date d''entrée','Stock-in date','DATE',false,'CUSTODY_IN',NULL,'HALF'),
  ('WAREHOUSE','STORAGE',60,'expected_stock_out','Sortie prévue','Expected stock-out','DATE',false,'CUSTODY_OUT',NULL,'HALF'),
  ('WAREHOUSE','STORAGE',70,'storage_basis','Base de facturation','Charging basis','SELECT',false,NULL,NULL,'HALF'),
  ('WAREHOUSE','STORAGE',80,'free_storage_days','Jours francs','Free days','INTEGER',false,NULL,NULL,'HALF'),
  ('WAREHOUSE','STORAGE',90,'handling_included','Manutention incluse','Handling included','BOOLEAN',false,NULL,NULL,'HALF'),
  ('WAREHOUSE','GOODS',10,'commodity','Marchandise','Goods','TEXT',true,'CARGO_DESC','commodity','HALF'),
  ('WAREHOUSE','GOODS',20,'commodity_desc','Description détaillée','Detailed description','TEXTAREA',false,NULL,'commodity_desc','FULL'),
  ('WAREHOUSE','GOODS',30,'package_count','Nombre de colis / palettes','Packages / pallets','INTEGER',false,'CARGO_PACKAGES','package_count','THIRD'),
  ('WAREHOUSE','GOODS',40,'gross_weight','Poids brut','Gross weight','NUMBER',false,'CARGO_WEIGHT','gross_weight','THIRD'),
  ('WAREHOUSE','GOODS',50,'weight_unit','Unité','Unit','SELECT',false,NULL,'weight_unit','THIRD'),
  ('WAREHOUSE','GOODS',60,'volume_cbm','Volume (m³)','Volume (CBM)','NUMBER',false,'CARGO_VOLUME','volume_cbm','THIRD'),
  ('WAREHOUSE','GOODS',70,'marks_numbers','Marques & numéros','Marks & numbers','TEXT',false,'CARGO_MARKS','marks_numbers','THIRD'),
  ('WAREHOUSE','GOODS',80,'temperature_control','Température dirigée','Temperature controlled','BOOLEAN',false,NULL,NULL,'THIRD');

-- ── BUSINESS REPRESENTATION — a mandate, not a movement ─────────────────────
INSERT INTO _stf_field (profile, group_code, seq, key, label_fr, label_en, data_type, is_required, facet_role, column_name, width) VALUES
  ('REPRESENTATION','MANDATE',10,'scope_summary','Objet du mandat','Scope of mandate','TEXTAREA',true,'SCOPE_SUMMARY',NULL,'FULL'),
  ('REPRESENTATION','MANDATE',20,'principal_contact','Interlocuteur mandant','Principal contact','TEXT',false,'COUNTERPARTY',NULL,'HALF'),
  ('REPRESENTATION','MANDATE',30,'contact_email','E-mail','Email','TEXT',false,NULL,NULL,'HALF'),
  ('REPRESENTATION','MANDATE',40,'contact_phone','Téléphone','Phone','TEXT',false,NULL,NULL,'HALF'),
  ('REPRESENTATION','MANDATE',50,'territory_covered','Territoire couvert','Territory covered','TEXT',false,NULL,NULL,'HALF'),
  ('REPRESENTATION','TERMS',10,'mandate_start','Début du mandat','Mandate start','DATE',true,'PERIOD_START',NULL,'HALF'),
  ('REPRESENTATION','TERMS',20,'mandate_end','Fin du mandat','Mandate end','DATE',false,'PERIOD_END',NULL,'HALF'),
  ('REPRESENTATION','TERMS',30,'retainer_basis','Mode de rémunération','Remuneration basis','SELECT',false,NULL,NULL,'HALF'),
  ('REPRESENTATION','TERMS',40,'notice_period_days','Préavis (jours)','Notice period (days)','INTEGER',false,NULL,NULL,'HALF'),
  ('REPRESENTATION','TERMS',50,'renewal_terms','Conditions de renouvellement','Renewal terms','TEXTAREA',false,NULL,NULL,'FULL');

-- ── CUSTOMS BROKERAGE ───────────────────────────────────────────────────────
-- The file never leaves the port/airport zone; the transport document is an
-- INPUT to the declaration rather than a description of a movement we run.
INSERT INTO _stf_field (profile, group_code, seq, key, label_fr, label_en, data_type, is_required, facet_role, column_name, width) VALUES
  ('CUSTOMS','DECLARATION',10,'declaration_no','№ de déclaration','Declaration No','TEXT',false,'CUSTOMS_REF',NULL,'HALF'),
  ('CUSTOMS','DECLARATION',20,'customs_regime','Régime douanier','Customs regime','SELECT',true,'CUSTOMS_REGIME','customs_regime','HALF'),
  ('CUSTOMS','DECLARATION',30,'customs_office','Bureau de douane','Customs office','TEXT',false,NULL,NULL,'HALF'),
  ('CUSTOMS','DECLARATION',40,'transport_doc_ref','Document de transport (BL/LTA)','Transport document (BL/AWB)','TEXT',false,'TRANSPORT_REF','bl_mawb','HALF'),
  ('CUSTOMS','DECLARATION',50,'declared_value','Valeur déclarée','Declared value','NUMBER',false,NULL,NULL,'HALF'),
  ('CUSTOMS','DECLARATION',60,'declared_currency','Devise','Currency','CURRENCY',false,NULL,NULL,'HALF'),
  ('CUSTOMS','DECLARATION',70,'incoterm','Incoterm','Incoterm','SELECT',true,'INCOTERM','incoterm','HALF'),
  ('CUSTOMS','DECLARATION',80,'clearance_date','Date de mainlevée','Clearance date','DATE',false,NULL,NULL,'HALF'),
  ('CUSTOMS','CARGO',10,'commodity','Marchandise','Commodity','TEXT',true,'CARGO_DESC','commodity','HALF'),
  ('CUSTOMS','CARGO',20,'hs_code','Position tarifaire (SH)','HS code','TEXT',false,NULL,NULL,'HALF'),
  ('CUSTOMS','CARGO',30,'gross_weight','Poids brut','Gross weight','NUMBER',false,'CARGO_WEIGHT','gross_weight','THIRD'),
  ('CUSTOMS','CARGO',40,'weight_unit','Unité','Unit','SELECT',false,NULL,'weight_unit','THIRD'),
  ('CUSTOMS','CARGO',50,'package_count','Nombre de colis','Package count','INTEGER',false,'CARGO_PACKAGES','package_count','THIRD'),
  ('CUSTOMS','CARGO',60,'marks_numbers','Marques & numéros','Marks & numbers','TEXT',false,'CARGO_MARKS','marks_numbers','HALF');

-- ── PROJECT / BREAK-BULK CARGO ──────────────────────────────────────────────
-- What makes a project file different is not the route, it is the PIECE: its
-- weight, its dimensions, what it takes to lift it and whether the road can
-- carry it. Those questions have never had a home in this system.
INSERT INTO _stf_field (profile, group_code, seq, key, label_fr, label_en, data_type, is_required, facet_role, column_name, width) VALUES
  ('PROJECT','TRANSPORT',10,'bl_number','Connaissement / document de transport','Bill of Lading / transport doc','TEXT',false,'TRANSPORT_REF','bl_mawb','HALF'),
  ('PROJECT','TRANSPORT',20,'carrier','Transporteur / compagnie','Carrier','RATE_PROVIDER',false,'CARRIER','rate_provider_id','HALF'),
  ('PROJECT','TRANSPORT',30,'vessel_name','Navire / moyen de transport','Vessel / conveyance','TEXT',false,'CONVEYANCE','vessel_flight','HALF'),
  ('PROJECT','TRANSPORT',40,'pol','Origine','Origin','GEO_PLACE',true,'ORIGIN','pol','HALF'),
  ('PROJECT','TRANSPORT',50,'pod','Destination','Destination','GEO_PLACE',true,'DESTINATION','pod','HALF'),
  ('PROJECT','TRANSPORT',60,'eta','ETA','ETA','DATE',false,'ARRIVAL_DATE','eta','HALF'),
  ('PROJECT','TRANSPORT',70,'ata','ATA (arrivée réelle)','ATA (actual arrival)','DATE',false,'ARRIVAL_DATE','ata','HALF'),
  ('PROJECT','CARGO',10,'commodity','Nature du colis','Nature of cargo','TEXT',true,'CARGO_DESC','commodity','HALF'),
  ('PROJECT','CARGO',20,'commodity_desc','Description détaillée','Detailed description','TEXTAREA',false,NULL,'commodity_desc','FULL'),
  ('PROJECT','CARGO',30,'piece_count','Nombre de colis','Number of pieces','INTEGER',false,'CARGO_PACKAGES','package_count','THIRD'),
  ('PROJECT','CARGO',40,'gross_weight','Poids brut total','Total gross weight','NUMBER',false,'CARGO_WEIGHT','gross_weight','THIRD'),
  ('PROJECT','CARGO',50,'weight_unit','Unité','Unit','SELECT',false,NULL,'weight_unit','THIRD'),
  ('PROJECT','CARGO',60,'heaviest_piece_kg','Colis le plus lourd (kg)','Heaviest piece (kg)','NUMBER',false,NULL,NULL,'THIRD'),
  ('PROJECT','CARGO',70,'max_dimensions','Dimensions max (L×l×h)','Max dimensions (L×W×H)','TEXT',false,NULL,NULL,'THIRD'),
  ('PROJECT','CARGO',80,'volume_cbm','Volume (m³)','Volume (CBM)','NUMBER',false,'CARGO_VOLUME','volume_cbm','THIRD'),
  ('PROJECT','CARGO',90,'lifting_equipment','Moyens de levage','Lifting equipment','TEXT',false,NULL,NULL,'HALF'),
  ('PROJECT','CARGO',100,'route_survey_required','Étude d''itinéraire requise','Route survey required','BOOLEAN',false,NULL,NULL,'HALF'),
  ('PROJECT','CARGO',110,'special_permits','Autorisations spéciales','Special permits','TEXT',false,NULL,NULL,'FULL'),
  ('PROJECT','CARGO',120,'marks_numbers','Marques & numéros','Marks & numbers','TEXT',false,'CARGO_MARKS','marks_numbers','HALF'),
  ('PROJECT','CUSTOMS',10,'incoterm','Incoterm','Incoterm','SELECT',true,'INCOTERM','incoterm','THIRD'),
  ('PROJECT','CUSTOMS',20,'customs_regime','Régime douanier','Customs regime','SELECT',false,'CUSTOMS_REGIME','customs_regime','THIRD'),
  ('PROJECT','CUSTOMS',30,'declaration_no','№ de déclaration','Declaration No','TEXT',false,'CUSTOMS_REF',NULL,'THIRD'),

  -- ── RAIL ────────────────────────────────────────────────────────────────────
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

  -- ── RAIL HINTERLAND ─────────────────────────────────────────────────────────
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
  ('RAIL_HINTERLAND','CUSTOMS',30,'incoterm','Incoterm','Incoterm','SELECT',false,'INCOTERM','incoterm','HALF');

-- ── Option lists, written once and applied by key ───────────────────────────
-- Repeating an eleven-element Incoterm array in eight places is eight chances
-- to let one of them fall out of date.
UPDATE _stf_field SET options = '[
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

-- The regimes `transit_order.customs_regime` already constrains (0310), so a
-- file and the transit order raised from it speak the same vocabulary.
UPDATE _stf_field SET options = '[
  {"value":"IM4","label_fr":"IM4 — Mise à la consommation","label_en":"IM4 — Home use"},
  {"value":"IM7","label_fr":"IM7 — Entrepôt douanier","label_en":"IM7 — Customs warehouse"},
  {"value":"IM8","label_fr":"IM8 — Transit","label_en":"IM8 — Transit"},
  {"value":"EX1","label_fr":"EX1 — Exportation définitive","label_en":"EX1 — Permanent export"},
  {"value":"EX2","label_fr":"EX2 — Exportation temporaire","label_en":"EX2 — Temporary export"}
]'::jsonb WHERE key = 'customs_regime';

-- Matches chk_dossier_weight_unit (0660) — the picker cannot offer a value the
-- column would reject.
UPDATE _stf_field SET options = '[
  {"value":"KG","label_fr":"kg","label_en":"kg"},
  {"value":"TON","label_fr":"tonne","label_en":"tonne"},
  {"value":"LB","label_fr":"livre (lb)","label_en":"pound (lb)"}
]'::jsonb WHERE key = 'weight_unit';

UPDATE _stf_field SET options = '[
  {"value":"BONDED","label_fr":"Sous douane","label_en":"Bonded"},
  {"value":"NON_BONDED","label_fr":"Hors douane","label_en":"Non-bonded"}
]'::jsonb WHERE key = 'bonded_status';

UPDATE _stf_field SET options = '[
  {"value":"PER_PALLET","label_fr":"Par palette / jour","label_en":"Per pallet / day"},
  {"value":"PER_SQM","label_fr":"Par m² / jour","label_en":"Per m² / day"},
  {"value":"PER_CBM","label_fr":"Par m³ / jour","label_en":"Per CBM / day"},
  {"value":"PER_TON","label_fr":"Par tonne / jour","label_en":"Per tonne / day"},
  {"value":"PER_CONTAINER","label_fr":"Par conteneur / jour","label_en":"Per container / day"},
  {"value":"FLAT_MONTHLY","label_fr":"Forfait mensuel","label_en":"Flat monthly"}
]'::jsonb WHERE key = 'storage_basis';

UPDATE _stf_field SET options = '[
  {"value":"MONTHLY_RETAINER","label_fr":"Honoraires mensuels","label_en":"Monthly retainer"},
  {"value":"PER_ASSIGNMENT","label_fr":"Par mission","label_en":"Per assignment"},
  {"value":"COMMISSION","label_fr":"Commission sur affaires","label_en":"Commission on business"},
  {"value":"MIXED","label_fr":"Mixte","label_en":"Mixed"}
]'::jsonb WHERE key = 'retainer_basis';

-- Numeric floors. A negative weight or a negative package count is not a typo
-- worth storing, and the browser is not the place that decision gets made.
UPDATE _stf_field SET validation = '{"min":0}'::jsonb
 WHERE data_type IN ('NUMBER','INTEGER');
UPDATE _stf_field SET validation = '{"min":0,"max":3650}'::jsonb
 WHERE key IN ('free_storage_days','notice_period_days');

-- What the client sees on the portal beside the milestone chain. Deliberately
-- narrow: a route, a reference, a date and what the goods are. Never a rate
-- basis, never an internal contact, never a customs office.
UPDATE _stf_field SET client_vis = true WHERE key IN (
  'bl_number','mawb','hawb','waybill_no','transport_doc_ref',
  'vessel_name','flight_no','shipping_line','airline','carrier',
  'rail_operator','train_no','wagon_nos','siding_branch',
  'pol','pod','origin_airport','dest_airport','entry_port','border_station','entry_terminal',
  'place_receipt','place_delivery','final_destination',
  'eta','ata','collection_date','corridor_delivery_eta','estimated_delivery_date',
  'commodity','package_count','piece_count','gross_weight','weight_unit','volume_cbm',
  'warehouse_location','bonded_status','stock_in_date','expected_stock_out',
  'declaration_no','transit_declaration','customs_regime','incoterm',
  'mandate_start','mandate_end','scope_summary'
);

-- Help text where a label alone has proven not to be enough.
UPDATE _stf_field SET
  help_fr = 'Renseigné à réception du document de transport — laissez vide à l''ouverture du dossier.',
  help_en = 'Filled in when the transport document arrives — leave blank when opening the file.'
 WHERE key IN ('bl_number','mawb','hawb','waybill_no','transport_doc_ref');
UPDATE _stf_field SET
  help_fr = 'Date réelle : renseignée après l''arrivée. Elle prime sur l''ETA partout où la date est affichée.',
  help_en = 'The actual date, entered after arrival. It supersedes the ETA everywhere the date is shown.'
 WHERE key = 'ata';
UPDATE _stf_field SET
  help_fr = 'Jours de stockage gratuits avant facturation du magasinage.',
  help_en = 'Free storage days before storage charges start.'
 WHERE key = 'free_storage_days';
UPDATE _stf_field SET
  help_fr = 'Le port d''entrée n''est pas la destination : la marchandise poursuit vers le pays enclavé.',
  help_en = 'The port of entry is not the destination — the cargo continues to the landlocked country.'
 WHERE key = 'entry_port';

-- ── Expand profiles onto the real service types, then override ──────────────
CREATE TEMP TABLE _stf_expanded ON COMMIT DROP AS
SELECT p.svc, f.*
  FROM _stf_field f
  JOIN _stf_profile p ON p.profile = f.profile;

-- End-to-end files are door-to-door: the DESTINATION facet every document
-- prints must be the delivery address, and the discharge port becomes a
-- waypoint on the way there. This is the whole reason facet roles are per
-- service type rather than per profile.
UPDATE _stf_expanded SET facet_role = 'ROUTE_VIA'
 WHERE svc IN ('END_TO_END_SEA_FREIGHT','END_TO_END_AIR_FREIGHT')
   AND key IN ('pod','dest_airport');
UPDATE _stf_expanded SET facet_role = 'DESTINATION', is_required = true
 WHERE svc = 'END_TO_END_SEA_FREIGHT' AND key = 'place_delivery';

-- The air profile has no place-of-delivery field at all, so end-to-end air
-- needs one adding rather than re-tagging.
INSERT INTO _stf_expanded (svc, profile, group_code, seq, key, label_fr, label_en,
                           data_type, is_required, facet_role, column_name, width,
                           ref_kind, options, validation, help_fr, help_en, client_vis)
VALUES ('END_TO_END_AIR_FREIGHT','AIR','TRANSPORT',85,'place_delivery',
        'Lieu de livraison','Place of delivery','TEXT',true,'DESTINATION','place_delivery','HALF',
        NULL,'[]'::jsonb,'{}'::jsonb,NULL,NULL,true);

-- Export files load here and leave; "port of discharge" is the foreign end, and
-- an ATA at that end is somebody else's record, not ours.
UPDATE _stf_expanded SET is_required = false
 WHERE svc IN ('SEA_FREIGHT_EXPORT','AIR_FREIGHT_EXPORT') AND key = 'ata';

-- ── Sanity: fail the seed rather than ship a broken form ────────────────────
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(DISTINCT svc, ', ') INTO bad
    FROM _stf_expanded e
   WHERE NOT EXISTS (SELECT 1 FROM service_type st WHERE st.key = e.svc);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'service-type field seed: unknown service type(s) — %', bad;
  END IF;

  SELECT string_agg(DISTINCT svc, ', ') INTO bad
    FROM _stf_expanded GROUP BY svc HAVING COUNT(*) < 5;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'service-type field seed: too few fields on — %', bad;
  END IF;

  -- Every column a field binds to must exist on `dossier`. Catching this here
  -- turns a typo into a failed seed instead of a 42703 on the first save.
  SELECT string_agg(DISTINCT column_name, ', ') INTO bad
    FROM _stf_expanded e
   WHERE e.column_name IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns c
        WHERE c.table_name = 'dossier' AND c.column_name = e.column_name
     );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'service-type field seed: no dossier column(s) — %', bad;
  END IF;

  -- One dossier column can back at most ONE field per service type: two fields
  -- writing `bl_mawb` would silently overwrite each other.
  SELECT string_agg(svc || '.' || column_name, ', ') INTO bad
    FROM _stf_expanded WHERE column_name IS NOT NULL
   GROUP BY svc, column_name HAVING COUNT(*) > 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'service-type field seed: column bound twice — %', bad;
  END IF;

  -- A SELECT with no options renders an empty dropdown — always a mistake.
  SELECT string_agg(DISTINCT svc || '.' || key, ', ') INTO bad
    FROM _stf_expanded
   WHERE data_type IN ('SELECT','MULTISELECT') AND jsonb_array_length(options) = 0;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'service-type field seed: SELECT with no options — %', bad;
  END IF;

  -- The product rule from the header, enforced: no freight vocabulary on the
  -- two service types that must never show it.
  SELECT string_agg(svc || '.' || key, ', ') INTO bad
    FROM _stf_expanded
   WHERE svc IN ('WAREHOUSING','BUSINESS_REPRESENTATION')
     AND (column_name IN ('pol','pod','bl_mawb','vessel_flight','eta','ata')
          OR facet_role IN ('TRANSPORT_REF','CONVEYANCE','CARRIER','ORIGIN','DESTINATION','ARRIVAL_DATE','DEPARTURE_DATE'));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'service-type field seed: freight fields leaked onto a non-freight service — %', bad;
  END IF;
END $$;

-- ── Field sets: one active v1 per service type that has none ────────────────
INSERT INTO service_type_field_set (service_type_id, version, is_active, name, is_system, source_version, published_at)
SELECT st.service_type_id, 1, true, 'Détails standard — ' || st.name_fr, true, 1, now()
  FROM service_type st
 WHERE st.key IN (SELECT DISTINCT svc FROM _stf_expanded)
   AND NOT EXISTS (
     SELECT 1 FROM service_type_field_set fs WHERE fs.service_type_id = st.service_type_id
   )
ON CONFLICT (service_type_id, version) DO NOTHING;

INSERT INTO service_type_field (
  service_type_field_set_id, group_code, group_label_fr, group_label_en, group_seq,
  seq, key, label_fr, label_en, help_text_fr, help_text_en,
  data_type, options_json, ref_kind, validation_json,
  is_required, is_client_visible, is_system, facet_role, column_name, width)
SELECT
  fs.service_type_field_set_id,
  e.group_code, g.label_fr, g.label_en, g.seq,
  e.seq, e.key, e.label_fr, e.label_en, e.help_fr, e.help_en,
  e.data_type, e.options, e.ref_kind, e.validation,
  e.is_required, e.client_vis, true, e.facet_role, e.column_name, e.width
FROM _stf_expanded e
JOIN service_type st ON st.key = e.svc
JOIN service_type_field_set fs
  ON fs.service_type_id = st.service_type_id AND fs.is_system AND fs.version = 1
JOIN _stf_group g ON g.profile = e.profile AND g.code = e.group_code
ON CONFLICT (service_type_field_set_id, key) DO NOTHING;

-- ── Equipment capture, per service type ─────────────────────────────────────
-- On where boxes are the unit of work. Off for air (ULDs are the airline's
-- equipment, not ours), off for representation, and off for warehousing — a
-- container yard IS warehousing, but the toggle is right there on the service
-- type for a tenant who runs one, and defaulting it on would put a freight
-- table on every storage file.
UPDATE service_type
   SET captures_containers = true, container_detail_mode = 'GROUPED'
 WHERE key IN (
   'SEA_FREIGHT_IMPORT','SEA_FREIGHT_EXPORT','END_TO_END_SEA_FREIGHT',
   'HINTERLAND_TRANSIT','INLAND_TRANSPORTATION','CUSTOMS_BROKERAGE','PROJECT_CARGO',
   'RAIL_TRANSPORTATION','RAIL_HINTERLAND_TRANSIT'
 );

-- DOWN
-- A seed is data, not schema, so "undoing" it means removing the rows it
-- authored — and only where nothing has been built on them. In order:
--
-- 1. The forms. Safe only while no file has been created against one; a dossier
--    pinned to a version it can no longer read would render its details as raw
--    keys. Check first:
--      SELECT COUNT(*) FROM dossier WHERE service_type_field_set_id IS NOT NULL;
--
--   DELETE FROM service_type_field f USING service_type_field_set s
--    WHERE f.service_type_field_set_id = s.service_type_field_set_id AND s.is_system;
--   DELETE FROM service_type_field_set WHERE is_system
--     AND NOT EXISTS (SELECT 1 FROM dossier d
--                      WHERE d.service_type_field_set_id = service_type_field_set.service_type_field_set_id);
--
-- 2. The equipment toggle.
--   UPDATE service_type SET captures_containers = false, container_detail_mode = 'GROUPED';
--
-- 3. The sized container types, and the size-less ones they replaced. Only
--    after confirming nothing references them — an expense_rate or a container
--    line pointing at a deleted ref_id is a broken rate card and a broken file:
--      SELECT code FROM dictionary_ref dr WHERE dr.kind = 'CONTAINER_TYPE'
--        AND (EXISTS (SELECT 1 FROM expense_rate er WHERE er.container_type_ref_id = dr.ref_id)
--          OR EXISTS (SELECT 1 FROM dossier_container_line l WHERE l.container_type_ref_id = dr.ref_id));
--
--   DELETE FROM dictionary_ref WHERE kind = 'CONTAINER_TYPE'
--     AND code IN ('FT20HC','RF20','RF40','RF40HC','FR20','FR40','OT20','OT40','TK20','TK40','VT20','VT40');
--   UPDATE dictionary_ref SET is_active = true,
--          name_fr = replace(name_fr, ' (taille non précisée)', ''),
--          name_en = replace(name_en, ' (unspecified size)', '')
--    WHERE kind = 'CONTAINER_TYPE'
--      AND code IN ('FLATRACK','OPENTOP','REEFER','ISOTANK','VENTILATED');
