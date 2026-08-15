-- ============================================================================
-- 0680 — the shipped 14-stage chain reaches tenants that got the demo one.
--
-- ── WHAT WENT WRONG ─────────────────────────────────────────────────────────
--
-- 9091 seeds a real 14-stage chain for all twelve service types, and it is
-- deliberately NON-DESTRUCTIVE: "a service type that ALREADY has any template is
-- skipped entirely — a re-run never overwrites a tenant's own chain." That rule is
-- right, and on one class of tenant it backfired.
--
-- `scripts/tenant/seed-sandbox.sql` creates a FIVE-stage demo chain for three
-- service types — sea import, air import and hinterland transit — as part of the
-- sample data. It runs before 9091. So on any sandbox-seeded tenant the demo chain
-- was already there, 9091 declined to touch it, and those three services have been
-- running on five placeholder stages (Réservation → Départ navire → Arrivée port →
-- Dédouanement → Livraison finale) ever since. The other nine got their fourteen.
--
-- ── AND THE PART THAT WAS INVISIBLE ─────────────────────────────────────────
--
-- The sandbox inserts its template with `is_system` left at its default of FALSE.
-- `milestone.listSystemDefault` — the "compare against the shipped default and
-- restore it" affordance — reads `WHERE t.is_system AND s.is_system`. With no
-- system template on the tenant it returns an empty list, so the drift comparison
-- silently had nothing to compare against and the restore had nothing to restore.
-- The escape hatch was there and disconnected.
--
-- ── WHAT THIS DOES, AND WHAT IT REFUSES TO DO ───────────────────────────────
--
-- For those three service types only, and only where the demo chain is still
-- exactly as the sandbox left it, this publishes the shipped fourteen as a NEW
-- VERSION and makes it active. It does NOT touch a single open file: milestone
-- INSTANCES are copies taken at instantiation, so every dossier already open keeps
-- the chain it was created against, exactly as a republished detail form leaves
-- open files alone. New files get the fourteen.
--
-- The new version is `is_system`, so the drift-and-restore affordance has a
-- baseline for the first time.
--
-- ── THE SIGNATURE, AND WHY IT IS NOT JUST "is_system = false" ───────────────
--
-- A tenant who authored their own eight-stage chain also has a non-system
-- template, and replacing THAT would be exactly the destruction 9091 was careful
-- to avoid. So the match is on the demo chain's own fingerprint: five stages whose
-- codes are precisely the sandbox's. Anything else — one renamed stage, one added,
-- one deleted — means a human has been in there, and it is left alone.
--
-- The stage rows below are copied verbatim from 9091 for the three service types
-- involved; `tests/unit/milestone-seed-parity.test.js` reads both files and fails
-- if they ever stop agreeing.
--
-- Idempotent: the second run finds a system template and matches nothing.
-- ============================================================================

CREATE TEMP TABLE _ms14 (
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
  PRIMARY KEY (svc, seq)
) ON COMMIT DROP;

INSERT INTO _ms14 (svc,seq,code,label_en,label_fr,weight,min_h,owner,anchor,lock,visible,evidence,segment,cadence,auto_event) VALUES
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
 ('SEA_FREIGHT_IMPORT',14,'FILE_CLOSED','Final invoice & file closed','Facture finale et dossier clos',6,8,'INTERNAL',false,false,false,NULL,'MAIN',NULL,'invoice.issued'),
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
 ('AIR_FREIGHT_IMPORT',14,'FILE_CLOSED','Final invoice & file closed','Facture finale et dossier clos',4,8,'INTERNAL',false,false,false,NULL,'MAIN',NULL,'invoice.issued'),
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
 ('HINTERLAND_TRANSIT',14,'FILE_CLOSED','Final invoice & file closed','Facture finale et dossier clos',4,8,'INTERNAL',false,false,false,NULL,'MAIN',NULL,'invoice.issued');

-- The horizon each chain's offsets are derived against — the same figures 9091
-- wrote onto `service_type`, read back rather than restated so there is one copy.
CREATE TEMP TABLE _ms14_days ON COMMIT DROP AS
SELECT s.svc, COALESCE(st.default_duration_days, 0) AS days
  FROM (SELECT DISTINCT svc FROM _ms14) s
  JOIN service_type st ON st.key = s.svc;

/*
 * Which service types qualify: the sandbox's demo chain, untouched, and no system
 * template anywhere on that service type.
 */
CREATE TEMP TABLE _ms14_target ON COMMIT DROP AS
SELECT st.service_type_id, st.key AS svc, MAX(mt.version) AS max_version
  FROM service_type st
  JOIN milestone_template mt ON mt.service_type_id = st.service_type_id
 WHERE st.key IN (SELECT DISTINCT svc FROM _ms14)
   -- Nothing shipped has ever landed here.
   AND NOT EXISTS (
     SELECT 1 FROM milestone_template x
      WHERE x.service_type_id = st.service_type_id AND x.is_system
   )
   -- …and what IS here is the demo chain, to the letter.
   AND EXISTS (
     SELECT 1
       FROM milestone_template d
      WHERE d.service_type_id = st.service_type_id
        AND (
          SELECT array_agg(s.code ORDER BY s.code)
            FROM milestone_template_stage s
           WHERE s.milestone_template_id = d.milestone_template_id
        ) = CASE st.key
              WHEN 'HINTERLAND_TRANSIT'
                THEN ARRAY['ARRIVAL','BORDER','DISCHARGE','ESCORT','T1_LODGED']
              ELSE ARRAY['ARRIVAL','BOOKING','CUSTOMS','DELIVERY','DEPARTURE']
            END
   )
 GROUP BY st.service_type_id, st.key;

-- ── The new version ─────────────────────────────────────────────────────────
INSERT INTO milestone_template (service_type_id, version, is_active, name, is_system, system_code, source_version)
SELECT t.service_type_id, t.max_version + 1, true,
       'Chaîne standard — ' || st.name_fr, true, t.svc, 1
  FROM _ms14_target t
  JOIN service_type st ON st.service_type_id = t.service_type_id
ON CONFLICT (service_type_id, version) DO NOTHING;

-- The demo version stands down. Kept, not deleted: it is the version the files
-- already open were created against, and their 360 reads its name.
UPDATE milestone_template mt
   SET is_active = false
  FROM _ms14_target t
 WHERE mt.service_type_id = t.service_type_id
   AND mt.version <= t.max_version;

-- ── The fourteen stages ─────────────────────────────────────────────────────
-- Offsets derived from the cumulative weight share of the service's horizon, the
-- same way 9091 derives them, so the weight model and the fallback dates agree.
INSERT INTO milestone_template_stage (
  milestone_template_id, stage_seq, code, label_fr, label_en, default_offset_days,
  weight, min_duration_hours, owner_tier, is_anchor, is_target_lock, is_client_visible,
  required_evidence_doc_type, auto_advance_on_event, chain_segment, cadence,
  is_system, system_code, source_version)
SELECT
  mt.milestone_template_id,
  s.seq, s.code, s.label_fr, s.label_en,
  -- Fallback only: used when a dossier has no target date of any kind. Ceiling so
  -- a stage never lands on day 0 alongside the file's opening.
  CASE WHEN s.weight = 0 THEN 0
       ELSE CEIL(cum.cum_weight / 100.0 * COALESCE(d.days, 0))::integer END,
  s.weight, s.min_h, s.owner, s.anchor, s.lock, s.visible,
  s.evidence, s.auto_event, s.segment, s.cadence,
  true, s.code, 1
FROM _ms14 s
JOIN _ms14_target t ON t.svc = s.svc
JOIN milestone_template mt
  ON mt.service_type_id = t.service_type_id
 AND mt.version = t.max_version + 1
LEFT JOIN _ms14_days d ON d.svc = s.svc
JOIN LATERAL (
  SELECT SUM(x.weight) AS cum_weight
    FROM _ms14 x
   WHERE x.svc = s.svc AND x.segment = s.segment AND x.seq <= s.seq
) cum ON true
ON CONFLICT (milestone_template_id, code) DO NOTHING;

-- ── Sanity: publish fourteen or publish nothing ─────────────────────────────
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(svc || ' (' || n || ')', ', ') INTO bad FROM (
    SELECT st.key AS svc, COUNT(s.stage_id) AS n
      FROM milestone_template mt
      JOIN service_type st ON st.service_type_id = mt.service_type_id
      LEFT JOIN milestone_template_stage s ON s.milestone_template_id = mt.milestone_template_id
     WHERE mt.is_system AND mt.system_code IS NOT NULL
     GROUP BY st.key, mt.milestone_template_id
    HAVING COUNT(s.stage_id) <> 14
  ) q;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'milestone republish: a system chain is not 14 stages — %', bad;
  END IF;

  -- Exactly one active template per service type. Two would make `activeTemplate`
  -- depend on version ordering alone, which is how a file silently instantiates
  -- from the wrong chain.
  SELECT string_agg(key, ', ') INTO bad FROM (
    SELECT st.key
      FROM service_type st
      JOIN milestone_template mt ON mt.service_type_id = st.service_type_id AND mt.is_active
     GROUP BY st.key HAVING COUNT(*) > 1
  ) q;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'milestone republish: more than one active template on — %', bad;
  END IF;
END $$;

-- DOWN
-- The demo chain comes back and the published one goes, which is safe ONLY while
-- no file has been created against the new version. Check first:
--   SELECT COUNT(*) FROM milestone_instance mi
--     JOIN milestone_template mt ON mt.milestone_template_id = mi.milestone_template_id
--    WHERE mt.is_system AND mt.version > 1;
--
-- UPDATE milestone_template SET is_active = true
--  WHERE version = 1 AND service_type_id IN (
--    SELECT service_type_id FROM milestone_template WHERE is_system AND version > 1);
-- DELETE FROM milestone_template WHERE is_system AND version > 1;
--   (stages cascade)
