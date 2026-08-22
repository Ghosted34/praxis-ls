-- ============================================================================
-- TENANT SEED — 9091 The 14 system-default milestone stages per service type.
--
-- THE GAP THIS CLOSES. 9080 seeds twelve system service types. Nothing seeded a
-- single milestone template, so `milestone.instantiate` raised NO_TEMPLATE on
-- every dossier of every real tenant and the 360° chain rendered empty. Only
-- `scripts/tenant/seed-sandbox.sql` ever created chains, and only for three
-- services, five stages each. A forwarder's milestone chain IS their operating
-- procedure: shipping the product with none at all means every tenant either
-- authors twelve chains by hand before they can open a file, or works without
-- milestones. This file ships a real one for each service.
--
-- SYSTEM DEFAULT, NOT SYSTEM ENFORCED — the financial-dictionary pattern.
-- Every row lands with is_system / system_code / source_version so the UI can
-- show what has drifted from the shipped default and offer to restore it, and
-- every row is otherwise an ordinary editable row: rename it, re-weight it,
-- delete it, insert between two. Fourteen is the shipped length, not a rule
-- (the floor is 3 and the ceiling is 15 — 0650). A tenant who runs a ten-stage
-- chain is using the product correctly.
--
-- WEIGHTS ARE A DURATION MODEL, NOT A PROGRESS BAR. Each stage's weight is its
-- share of the file's working-time horizon, summing to 100 per chain segment.
-- They encode where time actually goes on a Douala lane: the ocean leg and the
-- final delivery dominate a sea import; the border crossing and the second
-- inland leg dominate a N'Djamena transit; on an air export nothing matters
-- until the flight leaves. Re-weighting is the main thing a tenant will want to
-- do, and it is one number per row.
--
-- `default_offset_days` IS DERIVED, NOT AUTHORED. It is the fallback the engine
-- uses when a dossier has NO target date at all, and hand-writing 168 of them
-- guarantees they drift out of step with the weights. Computed below as the
-- cumulative weight share of the service's default duration, so the two models
-- always agree.
--
-- FLAGS THAT CARRY REAL BEHAVIOUR:
--   is_anchor         the schedule is provisional until this happens (a vessel
--                     berths when it berths; everything after re-forecasts from
--                     the actual, not from the plan).
--   is_target_lock    the SLA-protected commitment. Upstream slip compresses
--                     what remains instead of moving this date — down to each
--                     stage's floor, then it reports the breach.
--   is_client_visible money-adjacent and internal stages are OFF. A client
--                     tracking their container should not watch our invoicing.
--   auto_advance_on_event  the declarative trigger. Seeded for the three op
--                     documents that already emit (transit order, delivery
--                     note, invoice), so auto-advance works out of the box
--                     rather than waiting on a hand-written setting.
--
-- IDEMPOTENT + NON-DESTRUCTIVE: a service type that ALREADY has any template is
-- skipped entirely — a re-run never overwrites a tenant's own chain.
-- ============================================================================

-- ── Service-level defaults: how long, measured how, and does it end ─────────
-- MONTHS for business representation because a mandate is a year, not 250 days.
-- is_open_ended marks the two services that are not a race to a date: their
-- steady-state stages run on cadence and never enter the horizon maths.
UPDATE service_type st SET
  default_duration_days = v.days,
  duration_basis        = v.basis,
  is_open_ended         = v.open_ended
FROM (VALUES
    ('SEA_FREIGHT_IMPORT',      25, 'WORKING_DAYS', false),
    ('SEA_FREIGHT_EXPORT',      15, 'WORKING_DAYS', false),
    ('AIR_FREIGHT_IMPORT',       8, 'WORKING_DAYS', false),
    ('AIR_FREIGHT_EXPORT',       6, 'WORKING_DAYS', false),
    ('HINTERLAND_TRANSIT',      20, 'WORKING_DAYS', false),
    ('INLAND_TRANSPORTATION',    5, 'WORKING_DAYS', false),
    ('WAREHOUSING',              3, 'WORKING_DAYS', true),
    ('END_TO_END_AIR_FREIGHT',  12, 'WORKING_DAYS', false),
    ('END_TO_END_SEA_FREIGHT',  35, 'WORKING_DAYS', false),
    ('BUSINESS_REPRESENTATION', 12, 'MONTHS',       true),
    ('CUSTOMS_BROKERAGE',        7, 'WORKING_DAYS', false),
    ('PROJECT_CARGO',           45, 'WORKING_DAYS', false),
    ('RAIL_TRANSPORTATION',       8, 'WORKING_DAYS', false),
    ('RAIL_HINTERLAND_TRANSIT', 15, 'WORKING_DAYS', false),
    ('END_TO_END_RAIL_FREIGHT',  20, 'WORKING_DAYS', false)
) AS v(key, days, basis, open_ended)
WHERE st.key = v.key AND st.default_duration_days IS NULL;

-- ── Staging: one row per stage, reviewable one line at a time ───────────────
-- Authored once here and everything else derived from it (the template rows,
-- the offsets, the ordering) — the same discipline 9080 uses for the 176
-- dictionary lines, and what keeps 168 stages checkable by a human.
CREATE TEMP TABLE _ms_stage (
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

-- Segment horizons. MAIN takes the service's own duration; the open-ended
-- services size each bounded segment separately (a warehousing receipt is a
-- 3-day job, its release a 2-day one, and the storage between them is not a
-- duration at all).
CREATE TEMP TABLE _ms_segment (
  svc     text NOT NULL,
  segment text NOT NULL,
  days    integer NOT NULL,
  PRIMARY KEY (svc, segment)
) ON COMMIT DROP;

INSERT INTO _ms_segment (svc, segment, days)
SELECT st.key, 'MAIN', st.default_duration_days
  FROM service_type st
 WHERE st.key IN ('SEA_FREIGHT_IMPORT','SEA_FREIGHT_EXPORT','AIR_FREIGHT_IMPORT','AIR_FREIGHT_EXPORT',
                  'HINTERLAND_TRANSIT','INLAND_TRANSPORTATION','END_TO_END_AIR_FREIGHT',
                  'END_TO_END_SEA_FREIGHT','CUSTOMS_BROKERAGE','PROJECT_CARGO',
                  'RAIL_TRANSPORTATION','RAIL_HINTERLAND_TRANSIT','END_TO_END_RAIL_FREIGHT')
   AND st.default_duration_days IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO _ms_segment (svc, segment, days) VALUES
  ('WAREHOUSING','INBOUND',3), ('WAREHOUSING','OUTBOUND',2), ('WAREHOUSING','STEADY',0),
  ('BUSINESS_REPRESENTATION','MANDATE',20), ('BUSINESS_REPRESENTATION','RENEWAL',10),
  ('BUSINESS_REPRESENTATION','STEADY',0)
ON CONFLICT DO NOTHING;

-- ── 1. SEA_FREIGHT_IMPORT — Fret Maritime Import ────────────────────────────
INSERT INTO _ms_stage (svc,seq,code,label_en,label_fr,weight,min_h,owner,anchor,lock,visible,evidence,segment,cadence,auto_event) VALUES
 ('SEA_FREIGHT_IMPORT', 1,'PRE_ALERT','Pre-alert & work order','Pré-alerte et ordre de travail',3,4,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('SEA_FREIGHT_IMPORT', 2,'DOCS_VERIFIED','Shipping documents verified','Documents d''expédition vérifiés',5,8,'CLIENT',false,false,true,'BL','MAIN',NULL,NULL),
 ('SEA_FREIGHT_IMPORT', 3,'ARRIVAL_NOTICE','Arrival notice received','Avis d''arrivée reçu',4,4,'CARRIER',false,false,true,NULL,'MAIN',NULL,NULL),
 ('SEA_FREIGHT_IMPORT', 4,'VESSEL_ARRIVED','Vessel arrived (ATA)','Navire arrivé (ATA)',15,12,'CARRIER',true,false,true,NULL,'MAIN',NULL,NULL),
 ('SEA_FREIGHT_IMPORT', 5,'DISCHARGE','Cargo discharged','Marchandise déchargée',6,12,'TERMINAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('SEA_FREIGHT_IMPORT', 6,'DECLARATION_LODGED','Customs declaration lodged','Déclaration en douane déposée',8,8,'INTERNAL',false,false,true,'DECLARATION','MAIN',NULL,NULL),
 ('SEA_FREIGHT_IMPORT', 7,'INSPECTION','Customs inspection / scanning','Inspection douanière / scanner',8,8,'AUTHORITY',false,false,true,NULL,'MAIN',NULL,NULL),
 ('SEA_FREIGHT_IMPORT', 8,'DUTIES_PAID','Duties & taxes paid','Droits et taxes payés',7,4,'CLIENT',false,false,true,'PAYMENT_PROOF','MAIN',NULL,NULL),
 ('SEA_FREIGHT_IMPORT', 9,'CUSTOMS_RELEASED','Customs release (BAE)','Bon à enlever délivré',6,4,'AUTHORITY',false,false,true,'RELEASE_ORDER','MAIN',NULL,NULL),
 ('SEA_FREIGHT_IMPORT',10,'CARRIER_RELEASE','Carrier release / D.O. issued','Bon de livraison armateur',5,8,'CARRIER',false,false,true,NULL,'MAIN',NULL,NULL),
 ('SEA_FREIGHT_IMPORT',11,'TERMINAL_EXIT','Terminal exit / gate-out','Sortie terminal',6,6,'TERMINAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('SEA_FREIGHT_IMPORT',12,'DELIVERY','Delivery to consignee','Livraison au destinataire',15,8,'INTERNAL',false,true,true,'POD','MAIN',NULL,'delivery_note.created'),
 ('SEA_FREIGHT_IMPORT',13,'EMPTY_RETURN','Empty container returned','Conteneur vide restitué',6,8,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('SEA_FREIGHT_IMPORT',14,'FILE_CLOSED','Final invoice & file closed','Facture finale et dossier clos',6,8,'INTERNAL',false,false,false,NULL,'MAIN',NULL,'invoice.issued')
ON CONFLICT DO NOTHING;

-- ── 2. SEA_FREIGHT_EXPORT — Fret Maritime Export ────────────────────────────
INSERT INTO _ms_stage (svc,seq,code,label_en,label_fr,weight,min_h,owner,anchor,lock,visible,evidence,segment,cadence,auto_event) VALUES
 ('SEA_FREIGHT_EXPORT', 1,'BOOKING_REQUEST','Booking requested','Demande de réservation',4,4,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('SEA_FREIGHT_EXPORT', 2,'DOCS_VERIFIED','Export documents verified','Documents d''export vérifiés',5,8,'CLIENT',false,false,true,'INVOICE','MAIN',NULL,NULL),
 ('SEA_FREIGHT_EXPORT', 3,'BOOKING_CONFIRMED','Booking confirmed','Réservation confirmée',6,8,'CARRIER',false,false,true,'BOOKING_CONFIRMATION','MAIN',NULL,NULL),
 ('SEA_FREIGHT_EXPORT', 4,'EMPTY_PICKUP','Empty container picked up','Conteneur vide enlevé',5,8,'CARRIER',false,false,true,NULL,'MAIN',NULL,NULL),
 ('SEA_FREIGHT_EXPORT', 5,'STUFFING','Cargo stuffed & sealed','Empotage et plombage',8,8,'INTERNAL',false,false,true,'PACKING_LIST','MAIN',NULL,NULL),
 ('SEA_FREIGHT_EXPORT', 6,'EXPORT_DECLARATION','Export declaration lodged','Déclaration d''export déposée',8,8,'INTERNAL',false,false,true,'DECLARATION','MAIN',NULL,NULL),
 ('SEA_FREIGHT_EXPORT', 7,'CUSTOMS_INSPECTION','Customs inspection','Inspection douanière',7,8,'AUTHORITY',false,false,true,NULL,'MAIN',NULL,NULL),
 ('SEA_FREIGHT_EXPORT', 8,'TRANSFER_TO_PORT','Haulage to port','Acheminement au port',6,6,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('SEA_FREIGHT_EXPORT', 9,'GATE_IN','Gate-in / terminal acceptance','Entrée terminal',6,6,'TERMINAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('SEA_FREIGHT_EXPORT',10,'BOARDING_AUTH','Boarding authorisation','Autorisation d''embarquement',5,4,'AUTHORITY',false,false,true,'PERMIT','MAIN',NULL,NULL),
 ('SEA_FREIGHT_EXPORT',11,'VESSEL_LOADED','Loaded on vessel','Chargé à bord',8,8,'TERMINAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('SEA_FREIGHT_EXPORT',12,'VESSEL_DEPARTED','Vessel departed (ATD)','Navire parti (ATD)',12,4,'CARRIER',true,true,true,NULL,'MAIN',NULL,NULL),
 ('SEA_FREIGHT_EXPORT',13,'BL_RELEASED','Bill of lading released','Connaissement délivré',10,8,'CARRIER',false,false,true,'BL','MAIN',NULL,NULL),
 ('SEA_FREIGHT_EXPORT',14,'FILE_CLOSED','Final invoice & file closed','Facture finale et dossier clos',10,8,'INTERNAL',false,false,false,NULL,'MAIN',NULL,'invoice.issued')
ON CONFLICT DO NOTHING;

-- ── 3. AIR_FREIGHT_IMPORT — Fret Aérien Import ──────────────────────────────
INSERT INTO _ms_stage (svc,seq,code,label_en,label_fr,weight,min_h,owner,anchor,lock,visible,evidence,segment,cadence,auto_event) VALUES
 ('AIR_FREIGHT_IMPORT', 1,'PRE_ALERT','Pre-alert received','Pré-alerte reçue',4,2,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('AIR_FREIGHT_IMPORT', 2,'DOCS_VERIFIED','Documents verified (MAWB, invoice)','Documents vérifiés (LTA, facture)',6,4,'CLIENT',false,false,true,'AWB','MAIN',NULL,NULL),
 ('AIR_FREIGHT_IMPORT', 3,'FLIGHT_DEPARTED','Flight departed origin','Vol parti de l''origine',8,2,'CARRIER',false,false,true,NULL,'MAIN',NULL,NULL),
 ('AIR_FREIGHT_IMPORT', 4,'FLIGHT_ARRIVED','Flight arrived','Vol arrivé',10,2,'CARRIER',true,false,true,NULL,'MAIN',NULL,NULL),
 ('AIR_FREIGHT_IMPORT', 5,'MANIFEST_BREAKDOWN','Manifest breakdown at handler','Éclatement manifeste',5,4,'TERMINAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('AIR_FREIGHT_IMPORT', 6,'DECLARATION_LODGED','Import declaration lodged','Déclaration d''import déposée',9,4,'INTERNAL',false,false,true,'DECLARATION','MAIN',NULL,NULL),
 ('AIR_FREIGHT_IMPORT', 7,'INSPECTION','Customs inspection','Inspection douanière',9,4,'AUTHORITY',false,false,true,NULL,'MAIN',NULL,NULL),
 ('AIR_FREIGHT_IMPORT', 8,'DUTIES_PAID','Duties & taxes paid','Droits et taxes payés',8,4,'CLIENT',false,false,true,'PAYMENT_PROOF','MAIN',NULL,NULL),
 ('AIR_FREIGHT_IMPORT', 9,'CUSTOMS_RELEASED','Customs release (BAE)','Bon à enlever délivré',7,2,'AUTHORITY',false,false,true,'RELEASE_ORDER','MAIN',NULL,NULL),
 ('AIR_FREIGHT_IMPORT',10,'HANDLING_SETTLED','Handling & storage settled','Frais de magasinage réglés',6,2,'INTERNAL',false,false,false,NULL,'MAIN',NULL,NULL),
 ('AIR_FREIGHT_IMPORT',11,'CARGO_RELEASED','Cargo released from bond','Marchandise sortie du magasin',7,4,'TERMINAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('AIR_FREIGHT_IMPORT',12,'DELIVERY','Delivery to consignee','Livraison au destinataire',12,4,'INTERNAL',false,true,true,NULL,'MAIN',NULL,'delivery_note.created'),
 ('AIR_FREIGHT_IMPORT',13,'POD','Proof of delivery signed','Bon de livraison signé',5,2,'CLIENT',false,false,true,'POD','MAIN',NULL,NULL),
 ('AIR_FREIGHT_IMPORT',14,'FILE_CLOSED','Final invoice & file closed','Facture finale et dossier clos',4,8,'INTERNAL',false,false,false,NULL,'MAIN',NULL,'invoice.issued')
ON CONFLICT DO NOTHING;

-- ── 4. AIR_FREIGHT_EXPORT — Fret Aérien Export ──────────────────────────────
INSERT INTO _ms_stage (svc,seq,code,label_en,label_fr,weight,min_h,owner,anchor,lock,visible,evidence,segment,cadence,auto_event) VALUES
 ('AIR_FREIGHT_EXPORT', 1,'BOOKING_REQUEST','Booking requested','Demande de réservation',5,2,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('AIR_FREIGHT_EXPORT', 2,'DOCS_VERIFIED','Export documents verified','Documents d''export vérifiés',6,4,'CLIENT',false,false,true,'INVOICE','MAIN',NULL,NULL),
 ('AIR_FREIGHT_EXPORT', 3,'SPACE_CONFIRMED','Space confirmed','Espace confirmé',7,4,'CARRIER',false,false,true,'BOOKING_CONFIRMATION','MAIN',NULL,NULL),
 ('AIR_FREIGHT_EXPORT', 4,'CARGO_RECEIVED','Cargo received','Marchandise réceptionnée',7,4,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('AIR_FREIGHT_EXPORT', 5,'EXPORT_DECLARATION','Export declaration lodged','Déclaration d''export déposée',9,4,'INTERNAL',false,false,true,'DECLARATION','MAIN',NULL,NULL),
 ('AIR_FREIGHT_EXPORT', 6,'CUSTOMS_INSPECTION','Customs inspection','Inspection douanière',8,4,'AUTHORITY',false,false,true,NULL,'MAIN',NULL,NULL),
 ('AIR_FREIGHT_EXPORT', 7,'SECURITY_SCREENING','Security screening','Contrôle de sûreté',6,2,'TERMINAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('AIR_FREIGHT_EXPORT', 8,'AWB_ISSUED','Air waybill issued','LTA émise',6,2,'CARRIER',false,false,true,'AWB','MAIN',NULL,NULL),
 ('AIR_FREIGHT_EXPORT', 9,'AIRLINE_ACCEPTANCE','Airline acceptance (RCS)','Acceptation compagnie (RCS)',7,2,'CARRIER',false,false,true,NULL,'MAIN',NULL,NULL),
 ('AIR_FREIGHT_EXPORT',10,'FLIGHT_DEPARTED','Flight departed','Vol parti',12,2,'CARRIER',true,true,true,NULL,'MAIN',NULL,NULL),
 ('AIR_FREIGHT_EXPORT',11,'FLIGHT_ARRIVED','Flight arrived destination','Vol arrivé à destination',9,2,'CARRIER',false,false,true,NULL,'MAIN',NULL,NULL),
 ('AIR_FREIGHT_EXPORT',12,'DEST_CLEARANCE','Destination clearance','Dédouanement à destination',8,8,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('AIR_FREIGHT_EXPORT',13,'POD','Proof of delivery','Preuve de livraison',6,4,'CLIENT',false,false,true,'POD','MAIN',NULL,'delivery_note.created'),
 ('AIR_FREIGHT_EXPORT',14,'FILE_CLOSED','Final invoice & file closed','Facture finale et dossier clos',4,8,'INTERNAL',false,false,false,NULL,'MAIN',NULL,'invoice.issued')
ON CONFLICT DO NOTHING;

-- ── 5. HINTERLAND_TRANSIT — Transit Hinterland ──────────────────────────────
-- The Douala → N'Djamena / Bangui corridor. Heavy weights on the two inland
-- legs and the border because that is where the weeks actually go.
INSERT INTO _ms_stage (svc,seq,code,label_en,label_fr,weight,min_h,owner,anchor,lock,visible,evidence,segment,cadence,auto_event) VALUES
 ('HINTERLAND_TRANSIT', 1,'TRANSPORT_ORDER','Transport order received','Ordre de transport reçu',4,4,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('HINTERLAND_TRANSIT', 2,'TRANSIT_DOCS','Transit documents verified','Documents de transit vérifiés',5,8,'CLIENT',false,false,true,'BL','MAIN',NULL,NULL),
 ('HINTERLAND_TRANSIT', 3,'T1_LODGED','Transit declaration lodged','Déclaration de transit déposée',7,8,'INTERNAL',false,false,true,'DECLARATION','MAIN',NULL,'transit_order.created'),
 ('HINTERLAND_TRANSIT', 4,'TRANSIT_BOND','Transit bond secured','Caution de transit constituée',5,8,'INTERNAL',false,false,true,'BOND','MAIN',NULL,NULL),
 ('HINTERLAND_TRANSIT', 5,'CARRIER_RELEASE','Carrier release obtained','Bon de livraison obtenu',5,8,'CARRIER',false,false,true,NULL,'MAIN',NULL,NULL),
 ('HINTERLAND_TRANSIT', 6,'TRUCK_LOADED','Loaded on truck','Chargement sur camion',6,8,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('HINTERLAND_TRANSIT', 7,'SEALED_ESCORT','Customs sealing / escort','Plombage et escorte douanière',5,8,'AUTHORITY',false,false,true,NULL,'MAIN',NULL,NULL),
 ('HINTERLAND_TRANSIT', 8,'LEG1_DEPART','Departure — leg 1','Départ — tronçon 1',8,12,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('HINTERLAND_TRANSIT', 9,'BORDER_CROSSING','Border crossing','Passage frontière',12,24,'AUTHORITY',false,false,true,NULL,'MAIN',NULL,NULL),
 ('HINTERLAND_TRANSIT',10,'LEG2_ARRIVAL','Arrival at destination','Arrivée à destination',15,24,'INTERNAL',true,false,true,NULL,'MAIN',NULL,NULL),
 ('HINTERLAND_TRANSIT',11,'DEST_CLEARANCE','Destination clearance','Dédouanement à destination',8,16,'AUTHORITY',false,false,true,'RELEASE_ORDER','MAIN',NULL,NULL),
 ('HINTERLAND_TRANSIT',12,'DELIVERY','Delivery to consignee','Livraison au destinataire',10,8,'INTERNAL',false,true,true,'POD','MAIN',NULL,'delivery_note.created'),
 ('HINTERLAND_TRANSIT',13,'T1_DISCHARGED','Transit discharged / bond released','Transit apuré / caution levée',6,24,'AUTHORITY',false,false,true,'BOND','MAIN',NULL,NULL),
 ('HINTERLAND_TRANSIT',14,'FILE_CLOSED','Final invoice & file closed','Facture finale et dossier clos',4,8,'INTERNAL',false,false,false,NULL,'MAIN',NULL,'invoice.issued')
ON CONFLICT DO NOTHING;

-- ── 6. INLAND_TRANSPORTATION — Transport Terrestre ──────────────────────────
INSERT INTO _ms_stage (svc,seq,code,label_en,label_fr,weight,min_h,owner,anchor,lock,visible,evidence,segment,cadence,auto_event) VALUES
 ('INLAND_TRANSPORTATION', 1,'TRANSPORT_ORDER','Transport order received','Ordre de transport reçu',5,2,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('INLAND_TRANSPORTATION', 2,'DOCS_VERIFIED','Documents verified','Documents vérifiés',4,2,'CLIENT',false,false,true,NULL,'MAIN',NULL,NULL),
 ('INLAND_TRANSPORTATION', 3,'TRUCK_ASSIGNED','Truck & driver assigned','Camion et chauffeur affectés',6,4,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('INLAND_TRANSPORTATION', 4,'TRUCK_POSITIONED','Truck positioned at loading point','Camion positionné au chargement',7,4,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('INLAND_TRANSPORTATION', 5,'LOADING','Loading','Chargement',8,4,'CLIENT',false,false,true,NULL,'MAIN',NULL,NULL),
 ('INLAND_TRANSPORTATION', 6,'DEPARTURE','Departure from origin','Départ de l''origine',6,2,'INTERNAL',true,false,true,NULL,'MAIN',NULL,NULL),
 ('INLAND_TRANSPORTATION', 7,'IN_TRANSIT','In transit','En route',14,8,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('INLAND_TRANSPORTATION', 8,'CHECKPOINT','Checkpoint formalities','Formalités aux postes de contrôle',6,2,'AUTHORITY',false,false,true,NULL,'MAIN',NULL,NULL),
 ('INLAND_TRANSPORTATION', 9,'ARRIVAL','Arrival at destination','Arrivée à destination',10,4,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('INLAND_TRANSPORTATION',10,'OFFLOADING','Offloading','Déchargement',8,4,'CLIENT',false,false,true,NULL,'MAIN',NULL,NULL),
 ('INLAND_TRANSPORTATION',11,'POD','Delivery confirmed (POD)','Livraison confirmée (BL signé)',8,2,'CLIENT',false,true,true,'POD','MAIN',NULL,'delivery_note.created'),
 ('INLAND_TRANSPORTATION',12,'TRUCK_RELEASED','Truck released','Camion libéré',6,2,'INTERNAL',false,false,false,NULL,'MAIN',NULL,NULL),
 ('INLAND_TRANSPORTATION',13,'FINAL_INVOICE','Final invoice issued','Facture finale émise',6,8,'INTERNAL',false,false,false,NULL,'MAIN',NULL,'invoice.issued'),
 ('INLAND_TRANSPORTATION',14,'FILE_CLOSED','File closed','Dossier clos',6,8,'INTERNAL',false,false,false,NULL,'MAIN',NULL,NULL)
ON CONFLICT DO NOTHING;

-- ── 7. WAREHOUSING — Entreposage (open-ended, three segments) ───────────────
-- Storage is not a race to a date. The inbound and outbound segments are real
-- bounded jobs with their own horizons; the three stages between them run on
-- cadence, carry no weight, and never read as overdue — which is the whole
-- reason `is_open_ended` and `chain_segment` exist.
INSERT INTO _ms_stage (svc,seq,code,label_en,label_fr,weight,min_h,owner,anchor,lock,visible,evidence,segment,cadence,auto_event) VALUES
 ('WAREHOUSING', 1,'WORK_ORDER','Storage work order','Ordre d''entreposage',10,2,'INTERNAL',false,false,true,NULL,'INBOUND',NULL,NULL),
 ('WAREHOUSING', 2,'INBOUND_BOOKED','Inbound slot booked','Créneau de réception réservé',15,4,'CLIENT',false,false,true,NULL,'INBOUND',NULL,NULL),
 ('WAREHOUSING', 3,'GATE_IN','Receipt / gate-in','Réception / entrée',15,4,'INTERNAL',true,false,true,NULL,'INBOUND',NULL,NULL),
 ('WAREHOUSING', 4,'INSPECTION_COUNT','Verification & count','Vérification et comptage',20,4,'INTERNAL',false,false,true,'INSPECTION_REPORT','INBOUND',NULL,NULL),
 ('WAREHOUSING', 5,'PUT_AWAY','Put-away','Rangement',25,4,'INTERNAL',false,false,true,NULL,'INBOUND',NULL,NULL),
 ('WAREHOUSING', 6,'GRN_ISSUED','Goods received note issued','Bon de réception émis',15,2,'INTERNAL',false,true,true,'GRN','INBOUND',NULL,NULL),
 ('WAREHOUSING', 7,'INVENTORY_CONTROL','Inventory control','Contrôle des stocks',0,0,'INTERNAL',false,false,true,NULL,'STEADY','DAILY',NULL),
 ('WAREHOUSING', 8,'CYCLE_COUNT','Cycle count','Inventaire tournant',0,0,'INTERNAL',false,false,true,'COUNT_SHEET','STEADY','MONTHLY',NULL),
 ('WAREHOUSING', 9,'STORAGE_BILLING','Storage period billed','Période de stockage facturée',0,0,'INTERNAL',false,false,false,NULL,'STEADY','MONTHLY','invoice.issued'),
 ('WAREHOUSING',10,'RELEASE_ORDER','Release order received','Ordre de sortie reçu',15,2,'CLIENT',true,false,true,'RELEASE_ORDER','OUTBOUND',NULL,NULL),
 ('WAREHOUSING',11,'PICK','Pick','Prélèvement',20,2,'INTERNAL',false,false,true,NULL,'OUTBOUND',NULL,NULL),
 ('WAREHOUSING',12,'PACK_STAGE','Pack & stage','Emballage et mise à quai',20,2,'INTERNAL',false,false,true,NULL,'OUTBOUND',NULL,NULL),
 ('WAREHOUSING',13,'GATE_OUT','Dispatch / gate-out','Expédition / sortie',25,2,'INTERNAL',false,true,true,'POD','OUTBOUND',NULL,'delivery_note.created'),
 ('WAREHOUSING',14,'FILE_CLOSED','Handover confirmed & closed','Remise confirmée et dossier clos',20,4,'INTERNAL',false,false,false,NULL,'OUTBOUND',NULL,NULL)
ON CONFLICT DO NOTHING;

-- ── 8. END_TO_END_AIR_FREIGHT — Fret Aérien Porte-à-Porte ───────────────────
INSERT INTO _ms_stage (svc,seq,code,label_en,label_fr,weight,min_h,owner,anchor,lock,visible,evidence,segment,cadence,auto_event) VALUES
 ('END_TO_END_AIR_FREIGHT', 1,'BOOKING','Booking','Réservation',4,2,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('END_TO_END_AIR_FREIGHT', 2,'DOCS_VERIFIED','Documents verified','Documents vérifiés',4,4,'CLIENT',false,false,true,'INVOICE','MAIN',NULL,NULL),
 ('END_TO_END_AIR_FREIGHT', 3,'ORIGIN_PICKUP','Origin pickup','Enlèvement à l''origine',6,4,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('END_TO_END_AIR_FREIGHT', 4,'EXPORT_CLEARANCE','Export clearance','Dédouanement export',7,4,'AUTHORITY',false,false,true,'DECLARATION','MAIN',NULL,NULL),
 ('END_TO_END_AIR_FREIGHT', 5,'AIRLINE_ACCEPTANCE','Airline acceptance','Acceptation compagnie',6,2,'CARRIER',false,false,true,NULL,'MAIN',NULL,NULL),
 ('END_TO_END_AIR_FREIGHT', 6,'FLIGHT_DEPARTED','Flight departed','Vol parti',8,2,'CARRIER',false,false,true,NULL,'MAIN',NULL,NULL),
 ('END_TO_END_AIR_FREIGHT', 7,'FLIGHT_ARRIVED','Flight arrived','Vol arrivé',10,2,'CARRIER',true,false,true,NULL,'MAIN',NULL,NULL),
 ('END_TO_END_AIR_FREIGHT', 8,'IMPORT_DECLARATION','Import declaration lodged','Déclaration d''import déposée',8,4,'INTERNAL',false,false,true,'DECLARATION','MAIN',NULL,NULL),
 ('END_TO_END_AIR_FREIGHT', 9,'INSPECTION','Customs inspection','Inspection douanière',8,4,'AUTHORITY',false,false,true,NULL,'MAIN',NULL,NULL),
 ('END_TO_END_AIR_FREIGHT',10,'DUTIES_PAID','Duties & taxes paid','Droits et taxes payés',7,4,'CLIENT',false,false,true,'PAYMENT_PROOF','MAIN',NULL,NULL),
 ('END_TO_END_AIR_FREIGHT',11,'CUSTOMS_RELEASED','Customs release','Mainlevée douanière',7,2,'AUTHORITY',false,false,true,'RELEASE_ORDER','MAIN',NULL,NULL),
 ('END_TO_END_AIR_FREIGHT',12,'CARGO_RELEASED','Cargo released','Marchandise libérée',6,4,'TERMINAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('END_TO_END_AIR_FREIGHT',13,'DELIVERY_POD','Delivery & POD','Livraison et preuve de livraison',15,4,'INTERNAL',false,true,true,'POD','MAIN',NULL,'delivery_note.created'),
 ('END_TO_END_AIR_FREIGHT',14,'FILE_CLOSED','Final invoice & file closed','Facture finale et dossier clos',4,8,'INTERNAL',false,false,false,NULL,'MAIN',NULL,'invoice.issued')
ON CONFLICT DO NOTHING;

-- ── 9. END_TO_END_SEA_FREIGHT — Fret Maritime Porte-à-Porte ─────────────────
INSERT INTO _ms_stage (svc,seq,code,label_en,label_fr,weight,min_h,owner,anchor,lock,visible,evidence,segment,cadence,auto_event) VALUES
 ('END_TO_END_SEA_FREIGHT', 1,'BOOKING','Booking','Réservation',3,4,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('END_TO_END_SEA_FREIGHT', 2,'DOCS_VERIFIED','Documents verified','Documents vérifiés',4,8,'CLIENT',false,false,true,'INVOICE','MAIN',NULL,NULL),
 ('END_TO_END_SEA_FREIGHT', 3,'ORIGIN_PICKUP','Origin pickup','Enlèvement à l''origine',5,8,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('END_TO_END_SEA_FREIGHT', 4,'EXPORT_CLEARANCE','Export clearance','Dédouanement export',6,8,'AUTHORITY',false,false,true,'DECLARATION','MAIN',NULL,NULL),
 ('END_TO_END_SEA_FREIGHT', 5,'GATE_IN_ORIGIN','Gate-in at origin port','Entrée port d''origine',5,6,'TERMINAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('END_TO_END_SEA_FREIGHT', 6,'VESSEL_DEPARTED','Vessel departed','Navire parti',7,4,'CARRIER',false,false,true,NULL,'MAIN',NULL,NULL),
 ('END_TO_END_SEA_FREIGHT', 7,'OCEAN_TRANSIT','Ocean transit','Transit maritime',14,48,'CARRIER',false,false,true,NULL,'MAIN',NULL,NULL),
 ('END_TO_END_SEA_FREIGHT', 8,'VESSEL_ARRIVED','Vessel arrived (ATA)','Navire arrivé (ATA)',10,12,'CARRIER',true,false,true,NULL,'MAIN',NULL,NULL),
 ('END_TO_END_SEA_FREIGHT', 9,'DISCHARGE','Discharge','Déchargement',6,12,'TERMINAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('END_TO_END_SEA_FREIGHT',10,'IMPORT_DECLARATION','Import declaration lodged','Déclaration d''import déposée',8,8,'INTERNAL',false,false,true,'DECLARATION','MAIN',NULL,NULL),
 ('END_TO_END_SEA_FREIGHT',11,'CUSTOMS_CLEARED','Customs cleared','Dédouanement obtenu',9,8,'AUTHORITY',false,false,true,'RELEASE_ORDER','MAIN',NULL,NULL),
 ('END_TO_END_SEA_FREIGHT',12,'TERMINAL_EXIT','Terminal exit','Sortie terminal',6,6,'TERMINAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('END_TO_END_SEA_FREIGHT',13,'DELIVERY_POD','Delivery & POD','Livraison et preuve de livraison',13,8,'INTERNAL',false,true,true,'POD','MAIN',NULL,'delivery_note.created'),
 ('END_TO_END_SEA_FREIGHT',14,'FILE_CLOSED','Final invoice & file closed','Facture finale et dossier clos',4,8,'INTERNAL',false,false,false,NULL,'MAIN',NULL,'invoice.issued')
ON CONFLICT DO NOTHING;

-- ── 10. BUSINESS_REPRESENTATION — Représentation Commerciale (open-ended) ────
-- Yearly renewable, milestone-based, performance reviewed on delivery — the
-- contract model from the kickoff (§12). The mandate is a bounded set-up job,
-- the middle is a monthly/quarterly rhythm, and the renewal window is its own
-- short bounded segment ending on the contract anniversary.
INSERT INTO _ms_stage (svc,seq,code,label_en,label_fr,weight,min_h,owner,anchor,lock,visible,evidence,segment,cadence,auto_event) VALUES
 ('BUSINESS_REPRESENTATION', 1,'MANDATE_SIGNED','Mandate signed','Mandat signé',20,8,'CLIENT',true,false,true,'CONTRACT','MANDATE',NULL,NULL),
 ('BUSINESS_REPRESENTATION', 2,'SCOPE_AGREED','Scope & KPIs agreed','Périmètre et KPI validés',20,8,'INTERNAL',false,false,true,'SCOPE_DOCUMENT','MANDATE',NULL,NULL),
 ('BUSINESS_REPRESENTATION', 3,'KICKOFF','Kick-off held','Réunion de lancement tenue',20,4,'INTERNAL',false,false,true,NULL,'MANDATE',NULL,NULL),
 ('BUSINESS_REPRESENTATION', 4,'REGISTRATIONS','Registrations & accreditations filed','Immatriculations et agréments déposés',25,24,'AUTHORITY',false,false,true,'PERMIT','MANDATE',NULL,NULL),
 ('BUSINESS_REPRESENTATION', 5,'REP_ACTIVE','Representation live','Représentation active',15,8,'INTERNAL',false,true,true,NULL,'MANDATE',NULL,NULL),
 ('BUSINESS_REPRESENTATION', 6,'MONTHLY_REPORT','Monthly activity report','Rapport d''activité mensuel',0,0,'INTERNAL',false,false,true,'REPORT','STEADY','MONTHLY',NULL),
 ('BUSINESS_REPRESENTATION', 7,'CLIENT_REVIEW','Client review meeting','Revue client',0,0,'CLIENT',false,false,true,NULL,'STEADY','MONTHLY',NULL),
 ('BUSINESS_REPRESENTATION', 8,'COMPLIANCE_FILING','Statutory filing','Déclaration statutaire',0,0,'AUTHORITY',false,false,true,'DECLARATION','STEADY','QUARTERLY',NULL),
 ('BUSINESS_REPRESENTATION', 9,'MARKET_INTEL','Market intelligence report','Note de veille marché',0,0,'INTERNAL',false,false,true,'REPORT','STEADY','QUARTERLY',NULL),
 ('BUSINESS_REPRESENTATION',10,'RETAINER_INVOICE','Retainer invoiced','Honoraires facturés',0,0,'INTERNAL',false,false,false,NULL,'STEADY','MONTHLY','invoice.issued'),
 ('BUSINESS_REPRESENTATION',11,'ESCALATION_LOG','Escalations logged & closed','Escalades enregistrées et clôturées',0,0,'INTERNAL',false,false,true,NULL,'STEADY','MONTHLY',NULL),
 ('BUSINESS_REPRESENTATION',12,'PERFORMANCE_REVIEW','Annual performance review','Revue annuelle de performance',35,8,'CLIENT',false,false,true,'REPORT','RENEWAL',NULL,NULL),
 ('BUSINESS_REPRESENTATION',13,'RENEWAL_DECISION','Renewal decision','Décision de renouvellement',40,8,'CLIENT',false,true,true,'CONTRACT','RENEWAL',NULL,NULL),
 ('BUSINESS_REPRESENTATION',14,'FILE_CLOSED','Renewed or closed out','Renouvelé ou clôturé',25,8,'INTERNAL',false,false,false,NULL,'RENEWAL',NULL,NULL)
ON CONFLICT DO NOTHING;

-- ── 11. CUSTOMS_BROKERAGE — Dédouanement ────────────────────────────────────
-- Clearance only: no transport legs, so the weight sits in the declaration,
-- the assessment and the physical inspection.
INSERT INTO _ms_stage (svc,seq,code,label_en,label_fr,weight,min_h,owner,anchor,lock,visible,evidence,segment,cadence,auto_event) VALUES
 ('CUSTOMS_BROKERAGE', 1,'INSTRUCTION','Clearance instruction received','Instruction de dédouanement reçue',5,2,'CLIENT',false,false,true,NULL,'MAIN',NULL,NULL),
 ('CUSTOMS_BROKERAGE', 2,'DOCS_VERIFIED','Documents verified','Documents vérifiés',8,4,'CLIENT',false,false,true,'BL','MAIN',NULL,NULL),
 ('CUSTOMS_BROKERAGE', 3,'HS_CLASSIFICATION','Tariff classification','Classification tarifaire',8,4,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('CUSTOMS_BROKERAGE', 4,'VALUATION_CHECK','Valuation check','Contrôle de la valeur',6,4,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('CUSTOMS_BROKERAGE', 5,'DECLARATION_PREPARED','Declaration prepared','Déclaration préparée',8,4,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('CUSTOMS_BROKERAGE', 6,'DECLARATION_LODGED','Declaration lodged','Déclaration déposée',8,2,'INTERNAL',true,false,true,'DECLARATION','MAIN',NULL,NULL),
 ('CUSTOMS_BROKERAGE', 7,'ASSESSMENT_ISSUED','Duty assessment issued','Liquidation émise',8,4,'AUTHORITY',false,false,true,'ASSESSMENT','MAIN',NULL,NULL),
 ('CUSTOMS_BROKERAGE', 8,'DUTIES_PAID','Duties & taxes paid','Droits et taxes payés',10,4,'CLIENT',false,false,true,'PAYMENT_PROOF','MAIN',NULL,NULL),
 ('CUSTOMS_BROKERAGE', 9,'INSPECTION','Inspection / scanning','Inspection / scanner',10,8,'AUTHORITY',false,false,true,NULL,'MAIN',NULL,NULL),
 ('CUSTOMS_BROKERAGE',10,'QUERY_RESOLUTION','Customs query resolved','Contentieux / réserve levé',7,8,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('CUSTOMS_BROKERAGE',11,'BAE_ISSUED','Release order (BAE) issued','Bon à enlever délivré',10,2,'AUTHORITY',false,true,true,'RELEASE_ORDER','MAIN',NULL,NULL),
 ('CUSTOMS_BROKERAGE',12,'DOCS_HANDOVER','Cleared documents handed over','Documents dédouanés remis',5,2,'INTERNAL',false,false,true,'DECLARATION','MAIN',NULL,NULL),
 ('CUSTOMS_BROKERAGE',13,'FINAL_INVOICE','Final invoice issued','Facture finale émise',4,8,'INTERNAL',false,false,false,NULL,'MAIN',NULL,'invoice.issued'),
 ('CUSTOMS_BROKERAGE',14,'FILE_CLOSED','File closed','Dossier clos',3,8,'INTERNAL',false,false,false,NULL,'MAIN',NULL,NULL)
ON CONFLICT DO NOTHING;

-- ── 12. PROJECT_CARGO — Cargaison Spéciale ──────────────────────────────────
-- Break-bulk and heavy lift. The long floors are the point: a convoy permit or
-- a lift plan cannot be compressed into an afternoon because an upstream stage
-- ran late, and the engine must refuse to pretend otherwise.
INSERT INTO _ms_stage (svc,seq,code,label_en,label_fr,weight,min_h,owner,anchor,lock,visible,evidence,segment,cadence,auto_event) VALUES
 ('PROJECT_CARGO', 1,'FEASIBILITY','Feasibility & route survey','Étude de faisabilité et reconnaissance',5,24,'INTERNAL',false,false,true,'REPORT','MAIN',NULL,NULL),
 ('PROJECT_CARGO', 2,'METHOD_STATEMENT','Lift plan & method statement approved','Plan de levage et mode opératoire validés',6,24,'INTERNAL',false,false,true,'METHOD_STATEMENT','MAIN',NULL,NULL),
 ('PROJECT_CARGO', 3,'PERMITS','Abnormal-load permits & escorts','Autorisations convoi exceptionnel et escortes',9,48,'AUTHORITY',false,false,true,'PERMIT','MAIN',NULL,NULL),
 ('PROJECT_CARGO', 4,'EQUIPMENT_BOOKED','Cranes / lowbeds / space booked','Grues, porte-chars et espace réservés',6,24,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('PROJECT_CARGO', 5,'INSURANCE_BOUND','Cargo insurance bound','Assurance facultés souscrite',5,8,'CLIENT',false,false,true,'INSURANCE','MAIN',NULL,NULL),
 ('PROJECT_CARGO', 6,'ORIGIN_LOADING','Loading at origin','Chargement à l''origine',8,12,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('PROJECT_CARGO', 7,'EXPORT_CLEARANCE','Export clearance','Dédouanement export',6,8,'AUTHORITY',false,false,true,'DECLARATION','MAIN',NULL,NULL),
 ('PROJECT_CARGO', 8,'MAIN_CARRIAGE','Main carriage','Transport principal',12,48,'CARRIER',false,false,true,NULL,'MAIN',NULL,NULL),
 ('PROJECT_CARGO', 9,'ARRIVAL_DISCHARGE','Arrival & heavy-lift discharge','Arrivée et déchargement lourd',9,24,'TERMINAL',true,false,true,NULL,'MAIN',NULL,NULL),
 ('PROJECT_CARGO',10,'IMPORT_CLEARANCE','Import clearance','Dédouanement import',8,8,'AUTHORITY',false,false,true,'DECLARATION','MAIN',NULL,NULL),
 ('PROJECT_CARGO',11,'HEAVY_HAUL','Heavy haulage to site','Transport exceptionnel vers le site',12,24,'INTERNAL',false,false,true,NULL,'MAIN',NULL,NULL),
 ('PROJECT_CARGO',12,'SITE_DELIVERY','Delivery & offloading at site','Livraison et déchargement sur site',9,12,'INTERNAL',false,true,true,'POD','MAIN',NULL,'delivery_note.created'),
 ('PROJECT_CARGO',13,'SITE_ACCEPTANCE','Site acceptance','Réception sur site',3,8,'CLIENT',false,false,true,'ACCEPTANCE_CERTIFICATE','MAIN',NULL,NULL),
 ('PROJECT_CARGO',14,'FILE_CLOSED','Final invoice & file closed','Facture finale et dossier clos',2,8,'INTERNAL',false,false,false,NULL,'MAIN',NULL,'invoice.issued')
ON CONFLICT DO NOTHING;

-- ── 13. RAIL_TRANSPORTATION — Transport Ferroviaire ─────────────────────────
INSERT INTO _ms_stage (svc,seq,code,label_en,label_fr,weight,min_h,owner,anchor,lock,visible,evidence,segment,cadence,auto_event) VALUES
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
 ('RAIL_TRANSPORTATION',14,'FILE_CLOSED','Final invoice & file closed','Facture finale et dossier clos',4,8,'INTERNAL',false,false,false,NULL,'MAIN',NULL,'invoice.issued')
ON CONFLICT DO NOTHING;

-- ── 14. RAIL_HINTERLAND_TRANSIT — Transit Ferroviaire Hinterland ────────────
INSERT INTO _ms_stage (svc,seq,code,label_en,label_fr,weight,min_h,owner,anchor,lock,visible,evidence,segment,cadence,auto_event) VALUES
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

-- ── 15. END_TO_END_RAIL_FREIGHT — Fret Ferroviaire Porte-à-Porte ────────────
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
 ('END_TO_END_RAIL_FREIGHT',14,'FILE_CLOSED','Final invoice & file closed','Facture finale et dossier clos',3,8,'INTERNAL',false,false,false,NULL,'MAIN',NULL,'invoice.issued')
ON CONFLICT DO NOTHING;

-- ── Guard: every chain segment must sum to exactly 100 ──────────────────────
-- The weights ARE the duration model; a segment summing to 97 silently shortens
-- every forecast on that service by 3%. Cheaper to fail the seed than to debug
-- that from a client complaint six months later.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(svc || '/' || segment || '=' || total, ', ')
    INTO bad
    FROM (SELECT svc, segment, SUM(weight) AS total
            FROM _ms_stage GROUP BY svc, segment
           HAVING SUM(weight) <> CASE WHEN segment = 'STEADY' THEN 0 ELSE 100 END) x;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'milestone seed: weight sums are wrong — %', bad;
  END IF;
  IF EXISTS (SELECT 1 FROM _ms_stage GROUP BY svc HAVING COUNT(*) <> 14) THEN
    RAISE EXCEPTION 'milestone seed: every service type must ship exactly 14 stages';
  END IF;
END $$;

-- ── Templates: one active v1 per service type that has none ─────────────────
-- The NOT EXISTS is the "system default, not system enforced" rule in one
-- clause: a tenant who has already authored a chain for a service keeps it,
-- and a re-run of this seed changes nothing.
INSERT INTO milestone_template (service_type_id, version, is_active, name, is_system, system_code, source_version)
SELECT st.service_type_id, 1, true, 'Chaîne standard — ' || st.name_fr, true, st.key, 1
  FROM service_type st
 WHERE st.key IN (SELECT DISTINCT svc FROM _ms_stage)
   AND NOT EXISTS (SELECT 1 FROM milestone_template mt WHERE mt.service_type_id = st.service_type_id)
ON CONFLICT (service_type_id, version) DO NOTHING;

-- ── Stages, with offsets derived from the cumulative weight share ───────────
INSERT INTO milestone_template_stage (
  milestone_template_id, stage_seq, code, label_fr, label_en, default_offset_days,
  weight, min_duration_hours, owner_tier, is_anchor, is_target_lock, is_client_visible,
  required_evidence_doc_type, auto_advance_on_event, chain_segment, cadence,
  is_system, system_code, source_version)
SELECT
  mt.milestone_template_id,
  s.seq,
  s.code,
  s.label_fr,
  s.label_en,
  -- Fallback only: used when a dossier has no target date of any kind. Ceiling
  -- so a stage never lands on day 0 alongside the file's opening.
  CASE WHEN s.weight = 0 THEN 0
       ELSE CEIL(cum.cum_weight / 100.0 * COALESCE(seg.days, 0))::integer END,
  s.weight, s.min_h, s.owner, s.anchor, s.lock, s.visible,
  s.evidence, s.auto_event, s.segment, s.cadence,
  true, s.code, 1
FROM _ms_stage s
JOIN service_type st ON st.key = s.svc
JOIN milestone_template mt
  ON mt.service_type_id = st.service_type_id
 AND mt.is_system AND mt.version = 1
LEFT JOIN _ms_segment seg ON seg.svc = s.svc AND seg.segment = s.segment
JOIN LATERAL (
  SELECT SUM(x.weight) AS cum_weight
    FROM _ms_stage x
   WHERE x.svc = s.svc AND x.segment = s.segment AND x.seq <= s.seq
) cum ON true
ON CONFLICT (milestone_template_id, code) DO NOTHING;

-- ── Published assumptions register ──────────────────────────────────────────
-- What the schedule DEPENDS ON, written down and shown to the client next to
-- the chain. Every one of these is a counterparty whose hours we do not
-- control; publishing them is what makes a missed date a conversation instead
-- of an argument, and what makes the force-majeure exclusions credible when
-- they are invoked. FORCE_MAJEURE codes are also the vocabulary the engine
-- uses when ops overrides delay attribution (0650).
INSERT INTO service_type_assumption (service_type_id, seq, code, text_fr, text_en, is_client_visible, is_system)
SELECT st.service_type_id, a.seq, a.code, a.fr, a.en, a.vis, true
  FROM service_type st
  JOIN (VALUES
    -- Sea import
    ('SEA_FREIGHT_IMPORT',1,'CUSTOMS_HOURS','La douane (CAMCIS / GUCE) traite du lundi au vendredi, 07h30–15h30. Une déclaration déposée après 14h00 est liquidée le jour ouvrable suivant.','Customs (CAMCIS / GUCE) processes Mon–Fri, 07:30–15:30. Declarations lodged after 14:00 are assessed the next working day.',true),
    ('SEA_FREIGHT_IMPORT',2,'TERMINAL_HOURS','Les opérations de terminal ont lieu du lundi au samedi, 06h00–18h00. Dimanches et jours fériés exclus.','Terminal gate operations run Mon–Sat, 06:00–18:00. Sundays and public holidays excluded.',true),
    ('SEA_FREIGHT_IMPORT',3,'LINE_COUNTER_HOURS','Les guichets de mainlevée des compagnies maritimes ouvrent du lundi au vendredi 08h00–16h00 et le samedi 08h00–12h00.','Shipping-line release counters open Mon–Fri 08:00–16:00 and Sat 08:00–12:00.',true),
    ('SEA_FREIGHT_IMPORT',4,'FREE_TIME','Les franchises de surestaries et de détention sont propres à chaque compagnie (couramment 11 / 7 jours à compter du déchargement) et ne constituent pas un engagement de délai.','Demurrage and detention free time is carrier-specific (commonly 11 / 7 days from discharge) and is not a delivery commitment.',true),
    ('SEA_FREIGHT_IMPORT',5,'INSPECTION_CHANNEL','Les déclarations orientées en circuit rouge ou jaune ajoutent un jour ouvrable pour scanner ou visite physique.','Declarations routed to the red or yellow channel add one working day for scanning or physical inspection.',true),
    ('SEA_FREIGHT_IMPORT',6,'FORCE_MAJEURE','Exclus : grève portuaire, panne du système douanier, omission ou report d''escale du navire, intempéries exceptionnelles, troubles civils.','Excluded: port strike, customs system outage, vessel omission or roll-over, exceptional weather, civil disruption.',true),
    -- Sea export
    ('SEA_FREIGHT_EXPORT',1,'CUTOFF','Les délais s''entendent sous réserve du respect des cut-off documentaire et physique de la compagnie, généralement 72h et 24h avant l''ETD.','Timings assume the carrier''s documentation and physical cut-offs are met — typically 72h and 24h before ETD.',true),
    ('SEA_FREIGHT_EXPORT',2,'CUSTOMS_HOURS','La douane traite du lundi au vendredi, 07h30–15h30.','Customs processes Mon–Fri, 07:30–15:30.',true),
    ('SEA_FREIGHT_EXPORT',3,'TERMINAL_HOURS','Entrée au terminal du lundi au samedi, 06h00–18h00.','Terminal gate-in Mon–Sat, 06:00–18:00.',true),
    ('SEA_FREIGHT_EXPORT',4,'BL_RELEASE','Le connaissement est délivré après règlement intégral du fret et des frais locaux.','The bill of lading is released once freight and local charges are settled in full.',true),
    ('SEA_FREIGHT_EXPORT',5,'FORCE_MAJEURE','Exclus : report ou annulation d''escale, grève portuaire, panne du système douanier, intempéries exceptionnelles.','Excluded: vessel roll-over or omission, port strike, customs system outage, exceptional weather.',true),
    -- Air import
    ('AIR_FREIGHT_IMPORT',1,'HANDLER_HOURS','Le magasin sous douane de l''aéroport opère du lundi au samedi, 08h00–17h00.','The airport bonded warehouse operates Mon–Sat, 08:00–17:00.',true),
    ('AIR_FREIGHT_IMPORT',2,'CUSTOMS_HOURS','La douane aéroportuaire traite du lundi au vendredi, 07h30–15h30.','Airport customs processes Mon–Fri, 07:30–15:30.',true),
    ('AIR_FREIGHT_IMPORT',3,'STORAGE_CHARGES','La franchise de magasinage est de 48 heures à compter de l''arrivée du vol — au-delà, les frais du magasinier sont refacturés.','Free storage is 48 hours from flight arrival — beyond that the handler''s charges are passed through.',true),
    ('AIR_FREIGHT_IMPORT',4,'INSPECTION_CHANNEL','Les envois orientés en visite physique ajoutent un jour ouvrable.','Consignments routed to physical inspection add one working day.',true),
    ('AIR_FREIGHT_IMPORT',5,'FORCE_MAJEURE','Exclus : annulation ou déroutement de vol, capacité offloadée par la compagnie, panne du système douanier, fermeture d''aéroport.','Excluded: flight cancellation or diversion, airline offload, customs system outage, airport closure.',true),
    -- Air export
    ('AIR_FREIGHT_EXPORT',1,'CUTOFF','Les délais supposent la remise du fret avant le cut-off de la compagnie, généralement 4 heures avant le départ.','Timings assume cargo handover before the airline cut-off, typically 4 hours before departure.',true),
    ('AIR_FREIGHT_EXPORT',2,'SCREENING','Le contrôle de sûreté est obligatoire et peut imposer un dépotage complet des palettes.','Security screening is mandatory and may require a full pallet break-down.',true),
    ('AIR_FREIGHT_EXPORT',3,'CAPACITY','La confirmation d''espace reste soumise à la capacité effective du vol — un fret peut être offloadé par la compagnie.','Space confirmation remains subject to actual flight capacity — cargo may be offloaded by the airline.',true),
    ('AIR_FREIGHT_EXPORT',4,'FORCE_MAJEURE','Exclus : annulation de vol, offload compagnie, restriction de sûreté, fermeture d''aéroport.','Excluded: flight cancellation, airline offload, security restriction, airport closure.',true),
    -- Hinterland transit
    ('HINTERLAND_TRANSIT',1,'BORDER_HOURS','Les postes frontières opèrent du lundi au samedi, 07h00–18h00, et sont fermés les jours fériés des deux pays.','Border posts operate Mon–Sat, 07:00–18:00, and close on public holidays of BOTH countries.',true),
    ('HINTERLAND_TRANSIT',2,'CONVOY','Les mouvements sous escorte douanière partent en convoi selon le calendrier de la douane, non à la demande.','Movements under customs escort depart in convoy on the customs schedule, not on demand.',true),
    ('HINTERLAND_TRANSIT',3,'ROAD_CONDITIONS','Les temps de route supposent un corridor praticable — la saison des pluies (juillet–octobre) allonge sensiblement les tronçons.','Road times assume a passable corridor — the rainy season (July–October) materially lengthens the legs.',true),
    ('HINTERLAND_TRANSIT',4,'NIGHT_DRIVING','La conduite de nuit n''est pas prise en compte dans les délais pour des raisons de sécurité.','Night driving is excluded from the schedule for safety reasons.',true),
    ('HINTERLAND_TRANSIT',5,'BOND_DISCHARGE','L''apurement du transit dépend du retour du document visé par la douane de destination.','Transit discharge depends on the return of the document endorsed by destination customs.',true),
    ('HINTERLAND_TRANSIT',6,'FORCE_MAJEURE','Exclus : fermeture de frontière, insécurité du corridor, coupure de route, grève des transporteurs, panne du système douanier.','Excluded: border closure, corridor insecurity, road cuts, haulier strike, customs system outage.',true),
    -- Inland transport
    ('INLAND_TRANSPORTATION',1,'LOADING_WINDOW','Les délais supposent un accès au site et une mise à disposition de la marchandise pendant les heures ouvrables du client.','Timings assume site access and cargo availability during the client''s working hours.',true),
    ('INLAND_TRANSPORTATION',2,'WAITING_TIME','Au-delà de 4 heures d''attente au chargement ou au déchargement, des frais d''immobilisation s''appliquent.','Beyond 4 hours of waiting at loading or offloading, demurrage charges apply.',true),
    ('INLAND_TRANSPORTATION',3,'CHECKPOINTS','Les formalités aux postes de contrôle routiers sont intégrées au planning de façon forfaitaire.','Roadside checkpoint formalities are included in the schedule as a flat allowance.',true),
    ('INLAND_TRANSPORTATION',4,'FORCE_MAJEURE','Exclus : coupure de route, insécurité, intempéries exceptionnelles, panne mécanique majeure.','Excluded: road cuts, insecurity, exceptional weather, major mechanical breakdown.',true),
    -- Warehousing
    ('WAREHOUSING',1,'RECEIVING_HOURS','Les réceptions et expéditions se font du lundi au samedi, 07h30–17h00, sur créneau réservé.','Receiving and dispatch run Mon–Sat, 07:30–17:00, by booked slot.',true),
    ('WAREHOUSING',2,'SLOT_BOOKING','Un créneau non confirmé 24 heures à l''avance est replanifié au premier créneau disponible.','A slot not confirmed 24 hours ahead is rescheduled to the next available one.',true),
    ('WAREHOUSING',3,'STORAGE_PERIOD','Le stockage est facturé par période entamée — la phase de stockage n''a pas d''échéance et n''est jamais comptée en retard.','Storage is billed per commenced period — the storage phase has no due date and is never counted as late.',true),
    ('WAREHOUSING',4,'STOCK_ACCURACY','Les écarts d''inventaire sont traités sur le cycle de comptage convenu, non à l''unité.','Inventory discrepancies are handled on the agreed count cycle, not per unit.',true),
    ('WAREHOUSING',5,'FORCE_MAJEURE','Exclus : sinistre, coupure prolongée d''énergie, restriction d''accès au site.','Excluded: casualty loss, prolonged power outage, site access restriction.',true),
    -- End-to-end air
    ('END_TO_END_AIR_FREIGHT',1,'ORIGIN_AGENT','Les délais à l''origine dépendent de notre agent local et de ses heures ouvrables.','Origin timings depend on our local agent and their working hours.',true),
    ('END_TO_END_AIR_FREIGHT',2,'CUSTOMS_HOURS','Les douanes d''origine et de destination traitent en heures ouvrables locales.','Origin and destination customs process during local working hours.',true),
    ('END_TO_END_AIR_FREIGHT',3,'CAPACITY','La capacité aérienne est confirmée vol par vol — un report est possible en haute saison.','Air capacity is confirmed flight by flight — roll-over is possible in peak season.',true),
    ('END_TO_END_AIR_FREIGHT',4,'FORCE_MAJEURE','Exclus : annulation de vol, offload, panne système douanier, fermeture d''aéroport.','Excluded: flight cancellation, offload, customs system outage, airport closure.',true),
    -- End-to-end sea
    ('END_TO_END_SEA_FREIGHT',1,'TRANSIT_TIME','Le temps de transit maritime est celui annoncé par la compagnie et reste indicatif.','Ocean transit time is the carrier''s published figure and remains indicative.',true),
    ('END_TO_END_SEA_FREIGHT',2,'TRANSHIPMENT','Les escales de transbordement peuvent ajouter 5 à 10 jours selon la rotation.','Transhipment calls can add 5 to 10 days depending on the rotation.',true),
    ('END_TO_END_SEA_FREIGHT',3,'CUSTOMS_HOURS','Les douanes d''origine et de destination traitent en heures ouvrables locales.','Origin and destination customs process during local working hours.',true),
    ('END_TO_END_SEA_FREIGHT',4,'FORCE_MAJEURE','Exclus : omission ou report d''escale, congestion portuaire, grève, intempéries exceptionnelles.','Excluded: vessel omission or roll-over, port congestion, strike, exceptional weather.',true),
    -- Business representation
    ('BUSINESS_REPRESENTATION',1,'AUTHORITY_LEADTIME','Les délais d''immatriculation et d''agrément dépendent de l''administration concernée et ne sont pas maîtrisés.','Registration and accreditation lead times depend on the relevant authority and are outside our control.',true),
    ('BUSINESS_REPRESENTATION',2,'REPORTING_CYCLE','Le reporting est mensuel et la revue client mensuelle — ces étapes suivent un rythme, non une échéance de projet.','Reporting is monthly and the client review monthly — these stages run on a cadence, not a project deadline.',true),
    ('BUSINESS_REPRESENTATION',3,'RENEWAL_WINDOW','La décision de renouvellement est prise dans la fenêtre précédant la date anniversaire du contrat.','The renewal decision is taken in the window preceding the contract anniversary.',true),
    ('BUSINESS_REPRESENTATION',4,'PERFORMANCE_BASIS','La performance est appréciée sur le taux de réalisation et la réactivité, selon les KPI validés au lancement.','Performance is assessed on delivery rate and responsiveness, against the KPIs agreed at kick-off.',true),
    -- Customs brokerage
    ('CUSTOMS_BROKERAGE',1,'CUSTOMS_HOURS','La douane (CAMCIS / GUCE) traite du lundi au vendredi, 07h30–15h30.','Customs (CAMCIS / GUCE) processes Mon–Fri, 07:30–15:30.',true),
    ('CUSTOMS_BROKERAGE',2,'DOC_COMPLETENESS','Le délai court à compter de la réception d''un dossier documentaire complet et conforme.','The clock starts when a complete and compliant document set is received.',true),
    ('CUSTOMS_BROKERAGE',3,'DUTY_FUNDING','La mainlevée dépend du règlement effectif des droits et taxes — les fonds doivent être disponibles avant liquidation.','Release depends on duties and taxes actually being paid — funds must be available before assessment.',true),
    ('CUSTOMS_BROKERAGE',4,'INSPECTION_CHANNEL','Le circuit d''orientation est décidé par la douane et conditionne le délai.','The inspection channel is decided by customs and drives the lead time.',true),
    ('CUSTOMS_BROKERAGE',5,'FORCE_MAJEURE','Exclus : panne du système douanier, contentieux, changement de réglementation, grève administrative.','Excluded: customs system outage, disputes, regulatory change, administrative strike.',true),
    -- Project cargo
    ('PROJECT_CARGO',1,'PERMIT_LEADTIME','Les autorisations de convoi exceptionnel dépendent des autorités routières et ne peuvent être comprimées.','Abnormal-load permits depend on the road authorities and cannot be compressed.',true),
    ('PROJECT_CARGO',2,'SURVEY_BASIS','Le planning repose sur la reconnaissance d''itinéraire validée — toute modification de tracé le remet en cause.','The schedule rests on the approved route survey — any change of route re-opens it.',true),
    ('PROJECT_CARGO',3,'EQUIPMENT','La disponibilité des grues et porte-chars est confirmée à la réservation et reste soumise au planning du prestataire.','Crane and lowbed availability is confirmed at booking and remains subject to the provider''s schedule.',true),
    ('PROJECT_CARGO',4,'SITE_READINESS','La livraison suppose un site prêt : accès, aire de déchargement et moyens de levage disponibles.','Delivery assumes a ready site: access, offloading area and lifting means available.',true),
    ('PROJECT_CARGO',5,'FORCE_MAJEURE','Exclus : retrait d''autorisation, intempéries exceptionnelles, indisponibilité de moyens de levage, site non prêt.','Excluded: permit withdrawal, exceptional weather, unavailable lifting equipment, site not ready.',true),
    -- Rail transport
    ('RAIL_TRANSPORTATION',1,'RAILWAY_SCHEDULE','Les circulations ferroviaires dépendent du plan de transport et des sillons alloués par la régie ferroviaire.','Train movements depend on the operational timetable and track slots allocated by the rail authority.',true),
    ('RAIL_TRANSPORTATION',2,'WAGON_AVAILABILITY','La mise à disposition des wagons est sujette au parc effectif du transporteur ferroviaire.','Wagon availability is subject to the railway operator''s active fleet.',true),
    ('RAIL_TRANSPORTATION',3,'SIDING_ACCESS','Les manœuvres sur embranchement particulier nécessitent l''accord préalable du gestionnaire d''infrastructure.','Shunting on private sidings requires prior approval from the infrastructure manager.',true),
    ('RAIL_TRANSPORTATION',4,'FORCE_MAJEURE','Exclus : déraillement, avarie de voie, rupture caténaire, grève des cheminots, intempéries exceptionnelles.','Excluded: derailment, track damage, overhead line failure, railway worker strike, exceptional weather.',true),
    -- Rail hinterland transit
    ('RAIL_HINTERLAND_TRANSIT',1,'BORDER_RAIL','Les contrôles transfrontaliers en gare frontière s''effectuent selon les horaires d''ouverture des deux administrations.','Cross-border rail inspections at border stations run on opening hours of both authorities.',true),
    ('RAIL_HINTERLAND_TRANSIT',2,'RAIL_CONVOY','Les trains de transit circulent en convoi cadencé selon les créneaux douaniers.','Transit trains operate in scheduled convoys on customs-allocated slots.',true),
    ('RAIL_HINTERLAND_TRANSIT',3,'FORCE_MAJEURE','Exclus : coupure de voie ferrée, fermeture de frontière, insécurité du corridor, panne locomotive, grève.','Excluded: rail cut, border closure, corridor insecurity, locomotive failure, strike.',true),
    -- End-to-end rail freight
    ('END_TO_END_RAIL_FREIGHT',1,'ORIGIN_PICKUP','Les délais d''enlèvement supposent un accès carrossable au site de chargement et la mise à disposition effective de la marchandise.','Pickup lead times assume vehicle access to loading site and goods ready for handover.',true),
    ('END_TO_END_RAIL_FREIGHT',2,'RAILWAY_TIMETABLE','Le transit ferroviaire s''exécute selon les sillons programmés de l''opérateur et les formalités aux gares de triage.','Rail transit runs on published operator train slots and yard marshalling schedules.',true),
    ('END_TO_END_RAIL_FREIGHT',3,'CROSS_BORDER','Les délais de passage frontière et de dédouanement à destination dépendent des services douaniers des pays traversés.','Cross-border and destination clearance timings depend on customs authorities in transit countries.',true),
    ('END_TO_END_RAIL_FREIGHT',4,'FORCE_MAJEURE','Exclus : coupure de voie ferrée, fermeture de frontière, intempéries exceptionnelles, insécurité du corridor, grève.','Excluded: rail cuts, border closures, extreme weather, corridor insecurity, strikes.',true)
  ) AS a(key, seq, code, fr, en, vis) ON a.key = st.key
ON CONFLICT (service_type_id, code) DO NOTHING;

-- DOWN
-- DELETE FROM service_type_assumption WHERE is_system;
-- DELETE FROM milestone_template_stage WHERE is_system AND source_version = 1;
-- DELETE FROM milestone_template WHERE is_system AND source_version = 1;
-- UPDATE service_type SET default_duration_days = NULL, is_open_ended = false;
