-- ============================================================================
-- SEED (per tenant schema) — MOD-05 dictionary: findability, provenance, and
-- the direction corrections. Amends what 9080 seeded.
--
-- ── WHY THIS IS A SECOND FILE AND NOT AN EDIT TO 9080 ───────────────────────
--
-- 9080 has already run. It reached production on the deploy that followed its
-- merge, so it is applied against live tenant databases and its ledger row
-- exists. Editing it now would change what a FRESH database gets and NOT what
-- an existing one has — the exact silent divergence check-migration-idempotency
-- exists to stop (audit DATA 3.3). Corrections to applied reference data go in
-- a new file that amends in place, which is what this is.
--
-- Everything here is an UPDATE keyed on the code 9080 minted, guarded so it
-- only touches rows still carrying the seeded value. A tenant who has already
-- renamed a line or rewritten its description keeps their edit.
--
-- ── 1. THE DESCRIPTION WAS DOING THE WRONG JOB ──────────────────────────────
--
-- 9080 put the legacy provenance in `description`: every line read "Ancienne
-- ligne #-1094. Legacy row #-1094." That is the right information in the wrong
-- column — it is an audit trail, and `description` is what a picker shows to a
-- costing clerk under the line's name, and what a fuzzy search matches against.
-- The two cannot share one field.
--
-- So: provenance moves to `legacy_ref` (0633), and all 177 descriptions are
-- rewritten as the sentence that says what the charge IS, in both languages —
-- "Surestaries : immobilisation du conteneur au terminal au-delà de la
-- franchise. Demurrage for holding the box at the terminal past free time."
--
-- ── 2. KEYWORDS — WHAT PEOPLE ACTUALLY TYPE ─────────────────────────────────
--
-- `keywords` (0632) lands populated: the other language, the abbreviation, the
-- common misspelling ("demurage"), the trade slang ("BAD", "THC", "PK26"), and
-- the superseded legacy code, so an old #-1119 written on a filed document
-- still resolves. This is what makes the shared finder work from any screen.
--
-- ── 3. LABELS AND SUBCATEGORIES ─────────────────────────────────────────────
--
-- French labels came across in the legacy Title Case ("Caution Bancaire") and
-- several English ones were opaque ("Formula 1", "SMADE", "Additional Code /
-- END"). Labels are normalised to sentence case and the opaque ones now say
-- what they are, with the original kept as a keyword so nothing stops resolving.
--
-- 9080 derived subcategory from the legacy `category` enum when the legacy
-- `subcategory` was the literal string "Other" — 108 of 184 rows. That fallback
-- is coarse and put a dozen lines in the wrong bucket (Import Formalities under
-- HANDLING, Local Insurance under DECLARATION, Goods Import Taxes under
-- OCEAN_FREIGHT). Those are corrected here.
--
-- ── 4. THE DIRECTION CORRECTIONS — READ THIS ONE ────────────────────────────
--
-- Eight lines were classified wrongly by 9080, and this is the change with real
-- accounting consequences.
--
-- Seven are the forwarder's OWN professional fee that 9080 posted as débours.
-- The legacy table recorded all seven as CHARGEABLE_SERVICE — the company's own
-- answer — and "Frais de Dédouanement" is, in Cameroon practice, the broker's
-- fee and not the sum advanced to customs. Posted as débours they credit the
-- client clearing account 4731 instead of 7061, which understates turnover and
-- output VAT by the whole clearance-fee line. They become REVENUE: sale rule
-- Dr 4111 / Cr 7061 with TVA_STD.
--
--   #D028 Customs Clearance          #D033 Customs Formalities
--   #D035 Customs Liquidation        #D029 Declaration Processing
--   #D072 Import Formalities         #D097 Port Exit Formalities
--   #D056 Final Destination Clearance
--
-- The eighth, #D045 Embassy Caution, is a caution — refundable, so a class-2
-- deposit on 275, exactly like Bank Caution and the Permanent Deposit Fees that
-- 9080 already treats as ASSET. It was left as a débours by oversight.
--
-- Direction drives the code letter, so these are re-minted (#R014…#R020, #A003)
-- and their old #D code is preserved in `keywords` so any reference still
-- resolves. Their débours posting rules are replaced.
--
-- WHAT IS DELIBERATELY NOT CHANGED. Around eighteen other CHARGEABLE_SERVICE
-- lines are arguable either way — CAR/Chad declarations, Transit Title T1,
-- Customs Evaluation, the stuffing requests and reports, PoA and guarantee
-- letter authentication, Transshipment, Origin Charges, Stamp. Each is a fee
-- that MIGHT be the forwarder's or MIGHT be a third-party charge advanced, and
-- getting it wrong in either direction misstates turnover. They stay DEBOURS
-- until someone who knows the commercial terms says otherwise; the list is in
-- the pull request for exactly that.
--
-- ── 5. A DUPLICATE 9080 MISSED ──────────────────────────────────────────────
--
-- #-1085 "Pénalité Pont Bascule" and #-1156 "Pénalités Pont Bascule" are the
-- same weighbridge overweight fine written twice. 9080's header claimed 27
-- collapses and shipped 26 — this is the missing one. #D123 is DEACTIVATED
-- rather than deleted (something may already reference it), its legacy code is
-- folded into #D086's keywords, and the survivor is renamed to cover both.
-- After this the catalogue is 176 ACTIVE lines, which is the number 9080's
-- header, its commit message and the pull-request title all claimed.
-- ============================================================================

-- ── Staging ─────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _fd_amend (
  code       text PRIMARY KEY,
  old_fr     text,
  new_fr     text,
  old_en     text,
  new_en     text,
  old_sub    text,
  new_sub    text,
  descr      text NOT NULL,
  keywords   text[] NOT NULL,
  legacy_ref text
) ON COMMIT DROP;

CREATE TEMP TABLE _fd_reclass (
  old_code  text PRIMARY KEY,
  new_code  text NOT NULL,
  direction text NOT NULL,
  account   text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE _fd_tax (
  name        text PRIMARY KEY,
  tax_code_id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO _fd_tax (name, tax_code_id)
SELECT DISTINCT ON (tc.code::text) tc.code::text, tc.tax_code_id
  FROM tax_code tc
  JOIN tax_jurisdiction tj ON tj.jurisdiction_id = tc.jurisdiction_id
 WHERE tj.country_code = 'CM' AND tc.code = 'TVA_STD'
 ORDER BY tc.code::text, tc.effective_from DESC
ON CONFLICT (name) DO NOTHING;

-- ── The rewrite set ─────────────────────────────────────────────────────────
-- old_* columns are the values 9080 seeded. A field is only overwritten when it
-- still holds that value, so a tenant edit is never clobbered.
INSERT INTO _fd_amend (code,old_fr,new_fr,old_en,new_en,old_sub,new_sub,descr,keywords,legacy_ref) VALUES
 ('#A001','Caution Bancaire','Caution bancaire','Bank Caution',NULL,'BANK_FINANCE',NULL,'Caution déposée auprès de la banque, remboursable — portée en dépôt, pas en charge. Refundable bank guarantee, carried as a deposit and not a cost.',ARRAY['#-1090','bancaire','bank caution','caution','deposit','garantie','remboursable']::text[],'#-1090'),
 ('#A002','Frais sur Caution Permanente','Frais sur caution permanente (PDF)','Permanent Deposit Fees (PDF)',NULL,'BANK_FINANCE',NULL,'Caution permanente déposée auprès de la compagnie ou du port, remboursable. Standing refundable deposit lodged with the carrier or port.',ARRAY['#-1033','caution','caution permanente','pdf','permanent deposit','remboursable']::text[],'#-1033'),
 ('#D001','Code additionnel / APEC','Code additionnel / APEC','Additional Code / APEC',NULL,'DECLARATION',NULL,'Code additionnel APEC exigé sur certaines positions tarifaires. Additional APEC tariff code required on some HS lines.',ARRAY['#-1161','additional code','apec','code additionnel','tarif']::text[],'#-1161'),
 ('#D002','Code additionnel / END','Code additionnel / END','Additional Code / END',NULL,'DECLARATION',NULL,'Code additionnel END exigé sur certaines positions tarifaires. Additional END tariff code required on some HS lines.',ARRAY['#-1162','additional code','code additionnel','end','tarif']::text[],'#-1162'),
 ('#D003','Frais d''agence et de documentation',NULL,'Agency & Documentation Fee',NULL,'DOCUMENTATION',NULL,'Frais d''agence et de documentation facturés par la compagnie maritime. Carrier''s agency and documentation fee.',ARRAY['#-1024','agence','agency','documentation','frais de ligne','ligne maritime']::text[],'#-1024'),
 ('#D004','Frais de lettre de transport aérien (LTA)',NULL,'Air Waybill (AWB) Fee',NULL,'AIR_FREIGHT',NULL,'Frais d''émission de la lettre de transport aérien. Air waybill issuance fee charged by the airline.',ARRAY['#-1026','aerien','air waybill','awb','lettre de transport aerien','lta']::text[],'#-1026'),
 ('#D005','Frais Supplémentaires','Frais supplémentaires','Ancillary Charges',NULL,'HANDLING','OTHER','Frais annexes non couverts par une autre ligne du dossier. Ancillary charges not covered by another line on the file.',ARRAY['#-1170','ancillary','annexe','autres frais','divers','supplementaire']::text[],'#-1170'),
 ('#D006','Demande d''Evaluation Manuelle','Demande d''évaluation manuelle','Application for Manual Evaluation',NULL,'DECLARATION',NULL,'Demande d''évaluation manuelle en douane lorsque la valeur déclarée est contestée. Request for a manual customs valuation.',ARRAY['#-1036','demande','douane','evaluation','manuelle','valuation']::text[],'#-1036'),
 ('#D007','Demande d''Empotage','Demande d''empotage','Application for Stuffing',NULL,'DECLARATION',NULL,'Demande d''autorisation d''empotage auprès de la douane ou du terminal. Application for stuffing authorisation.',ARRAY['#-1037','autorisation','demande','empotage','stuffing']::text[],'#-1037'),
 ('#D008','Autorisation de Circuler','Autorisation de circuler sur corridor','Authorisation on corridor','Corridor Circulation Authorisation','TRUCKING',NULL,'Autorisation de circulation sur le corridor de transit. Authorisation to run the transit corridor.',ARRAY['#-1168','autorisation','circuler','corridor','permit','transit']::text[],'#-1168'),
 ('#D009','Dérogation BARC','Dérogation BARC','BARC Exemption',NULL,'HANDLING','DECLARATION','Dérogation BARC sur une expédition non conforme au régime standard. BARC waiver on a shipment outside the standard regime.',ARRAY['#-1157','barc','derogation','exemption','waiver']::text[],'#-1157'),
 ('#D010','Formalités à la Frontière','Formalités de passage à la frontière','Border Crossing Formalities',NULL,'DECLARATION',NULL,'Formalités douanières au poste frontière sur un transit hinterland. Border-post customs formalities on a hinterland transit.',ARRAY['#-1076','border','formalites','frontiere','passage','transit']::text[],'#-1076'),
 ('#D011','Déclaration Centrafricaine','Déclaration en douane centrafricaine','CAR Customs Declaration',NULL,'DECLARATION',NULL,'Déclaration en douane établie pour la République Centrafricaine. Customs declaration lodged for the Central African Republic.',ARRAY['#-1038','bangui','car','centrafricaine','centrafrique','declaration','rca']::text[],'#-1038'),
 ('#D012','Déclaration Tchadienne','Déclaration en douane tchadienne','CHAD Customs Declaration',NULL,'DECLARATION',NULL,'Déclaration en douane établie pour le Tchad. Customs declaration lodged for Chad.',ARRAY['#-1039','chad','declaration','ndjamena','tchad','tchadienne']::text[],'#-1039'),
 ('#D013','Quittance Douane Camerounaise','Quittance douane camerounaise','CMR Customs Tax',NULL,'CUSTOMS_DUTIES',NULL,'Quittance des droits acquittés auprès de la douane camerounaise. Receipt for duties paid to Cameroon customs.',ARRAY['#-1041','cameroun','cmr','douane','quittance','receipt','taxe']::text[],'#-1041'),
 ('#D014','Formalités Douane Cameroun','Formalités douane Cameroun','Cameroon Customs Formalities',NULL,'DECLARATION',NULL,'Formalités douanières camerounaises acquittées pour le compte du client. Cameroon customs formalities advanced for the client.',ARRAY['#-1152','cameroun','cmr','douane','formalites']::text[],'#-1152'),
 ('#D015','Frais d''enlèvement','Frais d''enlèvement','Cargo Pick-Up',NULL,'TRUCKING',NULL,'Enlèvement de la marchandise chez l''expéditeur ou au terminal. Collection of the cargo from shipper or terminal.',ARRAY['#-1105','collecte','enlevement','pick up','pickup','ramassage']::text[],'#-1105'),
 ('#D016','Inspection Cargaison','Inspection de la cargaison','Cargo Survey',NULL,'SURVEY',NULL,'Inspection ou expertise de la marchandise par un tiers. Third-party cargo survey or inspection.',ARRAY['#-1169','cargaison','controle','expertise','inspection','survey']::text[],'#-1169'),
 ('#D017','Certificat de Conformité','Certificat de conformité (CoC)','Certificate of Conformity',NULL,'CUSTOMS_INSPECTION','DOCUMENTATION','Certificat de conformité exigé à l''importation (programme PECAE/CoC). Certificate of conformity required at import.',ARRAY['#-1040','#-1172','certificat','certificate','coc','conformite','conformity','pecae']::text[],'#-1040,#-1172'),
 ('#D018','Déclaration d''importation commerciale (DIC)',NULL,'Commercial Import Declaration (DIC)',NULL,'CUSTOMS_DUTIES',NULL,'Déclaration d''importation commerciale (DIC) déposée au guichet. Commercial import declaration (DIC) lodged at the single window.',ARRAY['#-1145','commercial import','commerciale','declaration','dic','importation']::text[],'#-1145'),
 ('#D019','Taxe Informatique','Taxe informatique','Computer Tax',NULL,'CUSTOMS_DUTIES',NULL,'Redevance informatique douanière sur la déclaration. Customs IT levy charged on the declaration.',ARRAY['#-1042','computer tax','informatique','redevance','taxe informatique']::text[],'#-1042'),
 ('#D020','Certification CSC du Conteneur','Certification CSC du conteneur','Container CSC Certification',NULL,'CUSTOMS_INSPECTION',NULL,'Certification CSC attestant l''aptitude du conteneur au transport. CSC plate certification of the container.',ARRAY['#-1043','certification','container','conteneur','csc','plaque']::text[],'#-1043'),
 ('#D021','Nettoyage du Conteneur','Nettoyage du conteneur','Container Cleaning',NULL,'THC',NULL,'Nettoyage du conteneur exigé avant restitution ou après dépotage. Container cleaning required before return or after unstuffing.',ARRAY['#-1016','cleaning','container','conteneur','lavage','nettoyage']::text[],'#-1016'),
 ('#D022','Détention Conteneur','Détention de conteneur','Container Detention',NULL,'DEMURRAGE',NULL,'Détention : immobilisation du conteneur hors du terminal au-delà de la franchise. Detention for holding the box outside the terminal past free time.',ARRAY['#-1134','container','conteneur','detention','franchise','free time','immobilisation']::text[],'#-1134'),
 ('#D023','Double Relevage','Double relevage','Container Double Handling',NULL,'HANDLING',NULL,'Second relevage du conteneur imposé par le terminal. Second lift of the container imposed by the terminal.',ARRAY['#-1044','double handling','double relevage','manutention','relevage']::text[],'#-1044'),
 ('#D024','Endossement de Conteneur','Endossement de conteneur','Container Endorsement',NULL,'THC',NULL,'Endossement du conteneur au profit d''un tiers. Endorsement of the container to a third party.',ARRAY['#-1017','cession','conteneur','endorsement','endossement']::text[],'#-1017'),
 ('#D025','Maintenance de conteneur',NULL,'Container Maintenance',NULL,'THC',NULL,'Maintenance et réparation du conteneur facturées par la compagnie. Container maintenance and repair billed by the carrier.',ARRAY['#-1018','#-1019','container','conteneur','entretien','maintenance','repair','reparation']::text[],'#-1018,#-1019'),
 ('#D026','Enregistrement Conteneur','Enregistrement du conteneur','Container Registration',NULL,'THC',NULL,'Enregistrement administratif du conteneur auprès de l''autorité. Administrative registration of the container.',ARRAY['#-1160','container','conteneur','enregistrement','registration']::text[],'#-1160'),
 ('#D027','Autorisation d''Embarquement des Douanes - ECOR','Autorisation d''embarquement des douanes (ECOR)','Customs Boarding Authorization - ECOR',NULL,'CUSTOMS_INSPECTION',NULL,'Autorisation douanière d''embarquement (ECOR) à l''export. Customs boarding authorisation (ECOR) at export.',ARRAY['#-1045','autorisation','boarding','ecor','embarquement','export']::text[],'#-1045'),
 ('#D028','Frais de Dédouanement',NULL,'Customs Clearance',NULL,'DECLARATION',NULL,'Notre honoraire de dédouanement : conduite complète des opérations en douane. Our customs clearance fee for running the customs operation end to end.',ARRAY['#-1046','clearance','customs','dedouanement','douane','frais de dedouanement','transitaire']::text[],'#-1046'),
 ('#D029','Validation Déclaration','Validation de la déclaration','Customs Declaration Processing',NULL,'TRUCKING','DECLARATION','Notre honoraire pour l''établissement et la validation de la déclaration. Our fee for preparing and validating the customs declaration.',ARRAY['#-1083','declaration','depot','processing','traitement','validation']::text[],'#-1083'),
 ('#D030','Droits et Taxes Douanières','Droits et taxes douaniers','Customs Duties & Taxes',NULL,'CUSTOMS_DUTIES',NULL,'Droits de douane et taxes dus par le client, avancés puis refacturés à l''identique. Client''s customs duties and taxes, advanced and re-billed at cost.',ARRAY['#-1047','customs duties','ddt','douane','droits','duties','liquidation','taxes']::text[],'#-1047'),
 ('#D031','Droits de Douane à Destination','Droits de douane à destination','Customs Duties at Destination',NULL,'CUSTOMS_DUTIES',NULL,'Droits de douane exigibles au pays de destination finale. Customs duties due in the final destination country.',ARRAY['#-1080','destination','douane','droits','duties','final']::text[],'#-1080'),
 ('#D032','Evaluation Manuelle','Évaluation manuelle en douane','Customs Evaluation',NULL,'CUSTOMS_INSPECTION',NULL,'Évaluation manuelle de la valeur en douane par le service des douanes. Manual customs valuation carried out by customs.',ARRAY['#-1048','douane','evaluation','manuelle','valeur','valuation']::text[],'#-1048'),
 ('#D033','Formalités Douanières',NULL,'Customs Formalities',NULL,'DECLARATION',NULL,'Notre honoraire pour l''accomplissement des formalités douanières du dossier. Our fee for completing the file''s customs formalities.',ARRAY['#-1049','customs','dedouanement','douane','formalites','formalities']::text[],'#-1049'),
 ('#D034','Frais d''inspection douanière',NULL,'Customs Inspection',NULL,'CUSTOMS_INSPECTION',NULL,'Frais d''inspection physique du conteneur par la douane (visite). Customs physical inspection of the container.',ARRAY['#-1113','#-1114','controle','customs inspection','douane','inspection','visite']::text[],'#-1113,#-1114'),
 ('#D035','Liquidation Douanière','Liquidation douanière','Customs Liquidation',NULL,'CUSTOMS_DUTIES',NULL,'Notre honoraire pour la liquidation et l''apurement du dossier douanier. Our fee for the customs liquidation and clearing of the file.',ARRAY['#-1050','apurement','customs liquidation','douane','liquidation']::text[],'#-1050'),
 ('#D036','Correction/Modification du Manifeste','Correction du manifeste','Customs Manifest Amendment',NULL,'DECLARATION',NULL,'Correction ou modification du manifeste après dépôt. Amendment of the cargo manifest after lodging.',ARRAY['#-1051','amendment','correction','manifest','manifeste','modification']::text[],'#-1051'),
 ('#D037','Réactivation du Manifeste','Réactivation du manifeste','Customs Manifest Reactivation',NULL,'DECLARATION',NULL,'Réactivation d''un manifeste clôturé pour reprise du dossier. Reactivation of a closed manifest to reopen the file.',ARRAY['#-1052','manifest','manifeste','reactivation','reouverture']::text[],'#-1052'),
 ('#D038','Pénalités Douanières','Pénalités douanières','Customs Penalty',NULL,'CUSTOMS_DUTIES',NULL,'Pénalité infligée par la douane sur le dossier. Penalty levied by customs on the file.',ARRAY['#-1053','amende','douane','fine','penalite','penalty']::text[],'#-1053'),
 ('#D039','TEL douanes','TEL douanes','Customs TEL',NULL,'DECLARATION',NULL,'Titre d''échange local (TEL) délivré par la douane. Local exchange title (TEL) issued by customs.',ARRAY['#-1066','douane','echange local','tel','titre']::text[],'#-1066'),
 ('#D040','Livraison à Destination','Livraison à destination','Delivery at Destination',NULL,'TRUCKING',NULL,'Livraison finale de la marchandise chez le destinataire. Final delivery of the cargo to the consignee.',ARRAY['#-1093','delivery','destination','distribution','final','livraison']::text[],'#-1093'),
 ('#D041','Surestaries','Surestaries','Demurrage',NULL,'DEMURRAGE',NULL,'Surestaries : immobilisation du conteneur au terminal au-delà de la franchise. Demurrage for holding the box at the terminal past free time.',ARRAY['#-1021','demurage','demurrage','detention','franchise','free time','surestarie','surestaries']::text[],'#-1021'),
 ('#D042','Légalisation Document','Légalisation de document','Document Authentication',NULL,'DOCUMENTATION',NULL,'Légalisation ou authentification d''un document officiel. Legalisation or authentication of an official document.',ARRAY['#-1164','authentication','authentification','document','legalisation','legalise']::text[],'#-1164'),
 ('#D043','Frais de restitution (drop-off)','Frais de restitution (drop-off)','Drop-Off Fee',NULL,'OCEAN_FREIGHT',NULL,'Frais de restitution du conteneur dans un dépôt différent de l''origine. Drop-off fee for returning the box to a different depot.',ARRAY['#-1025','depot','drop off','dropoff','restitution','retour']::text[],'#-1025'),
 ('#D044','Frais de création du BESC / ECTN',NULL,'ECTN/BESC Processing Fee',NULL,'HANDLING','DECLARATION','Frais de création du bordereau électronique de suivi de cargaison (BESC/ECTN). Fee for creating the electronic cargo tracking note.',ARRAY['#-1096','besc','bietc','bordereau','ectn','suivi cargaison','tracking note']::text[],'#-1096'),
 ('#D045','Caution Ambassade','Caution ambassade','Embassy Caution',NULL,'BANK_FINANCE',NULL,'Caution déposée auprès d''une ambassade, remboursable en fin d''opération. Refundable deposit lodged with an embassy.',ARRAY['#-1131','ambassade','caution','deposit','embassy','garantie','remboursable']::text[],'#-1131'),
 ('#D046','Retour de conteneur vide','Retour de conteneur vide','Empty Container Handling',NULL,'HANDLING',NULL,'Manutention et retour du conteneur vide au dépôt. Handling and return of the empty container to the depot.',ARRAY['#-1022','#-1023','container','conteneur','empty','restitution','retour','vide']::text[],'#-1022,#-1023'),
 ('#D047','Relevage Conteneur Vide','Relevage de conteneur vide','Empty Container Pick-up',NULL,'HANDLING',NULL,'Relevage d''un conteneur vide au dépôt pour empotage. Pick-up of an empty container from the depot for stuffing.',ARRAY['#-1142','depot','empty','pickup','relevage','vide']::text[],'#-1142'),
 ('#D048','Transfert du Vide vers Site d''Empotage','Transfert du vide vers le site d''empotage','Empty Transfer to Stuffing Site',NULL,'TRUCKING',NULL,'Acheminement du conteneur vide vers le site d''empotage. Moving the empty box to the stuffing site.',ARRAY['#-1112','empotage','empty','stuffing','transfer','transfert','vide']::text[],'#-1112'),
 ('#D049','Manutention (équipement / marchandise)','Manutention (équipement / marchandise)','Equipment & Cargo Handling',NULL,'HANDLING',NULL,'Manutention de la marchandise ou de l''équipement au terminal. Handling of cargo or equipment at the terminal.',ARRAY['#-1115','cargo handling','equipement','handling','manutention','marchandise']::text[],'#-1115'),
 ('#D050','Escorte','Escorte','Escort',NULL,'ESCORT',NULL,'Escorte de la marchandise imposée sur le trajet. Escort accompanying the cargo in transit.',ARRAY['#-1067','accompagnement','convoi','escort','escorte']::text[],'#-1067'),
 ('#D051','Certificat d''exonération','Certificat d''exonération','Exemption Certificate',NULL,'HANDLING','DOCUMENTATION','Certificat d''exonération de droits et taxes. Certificate exempting the shipment from duties and taxes.',ARRAY['#-1097','certificat','exemption','exoneration','exonere','franchise']::text[],'#-1097'),
 ('#D052','Traitement Exonération','Traitement de l''exonération','Exoneration Processing',NULL,'CUSTOMS_DUTIES',NULL,'Traitement du dossier d''exonération auprès de l''administration. Processing of the duty-exemption application.',ARRAY['#-1148','exemption','exoneration','processing','traitement']::text[],'#-1148'),
 ('#D053','Déclaration Export','Déclaration d''exportation','Export Declaration',NULL,'DECLARATION',NULL,'Déclaration en douane à l''exportation. Customs declaration lodged at export.',ARRAY['#-1138','declaration','export','exportation','sortie']::text[],'#-1138'),
 ('#D054','Formalités Export','Formalités d''exportation','Export Formalities',NULL,'DECLARATION',NULL,'Formalités douanières à l''exportation. Customs formalities at export.',ARRAY['#-1179','export','exportation','formalites','formalities']::text[],'#-1179'),
 ('#D055','Frais à destination finale',NULL,'Final Destination Charges',NULL,'OCEAN_FREIGHT',NULL,'Frais engagés au port ou à l''aéroport de destination finale. Charges incurred at the final destination port or airport.',ARRAY['arrivee','destination','destination charges','final','frais destination']::text[],NULL),
 ('#D056','Formalités Douanes à Destination','Formalités douanières à destination','Final Destination Clearance',NULL,'DECLARATION',NULL,'Notre honoraire de dédouanement au point de destination finale. Our clearance fee at the final destination.',ARRAY['#-1054','clearance','dedouanement','destination','final','formalites']::text[],'#-1054'),
 ('#D057','Formalités au Tchad','Formalités au Tchad','Formalities in Chad',NULL,'HANDLING','DECLARATION','Formalités administratives et douanières accomplies au Tchad. Administrative and customs formalities carried out in Chad.',ARRAY['#-1178','chad','formalites','ndjamena','tchad']::text[],'#-1178'),
 ('#D058','Formule 1 (déclaration de change)',NULL,'Formula 1 (exchange declaration)',NULL,'DECLARATION',NULL,'Formule 1 : déclaration de change exigée à l''import. Formula 1 exchange-control declaration required at import.',ARRAY['#-1058','change','declaration de change','devise','formula 1','formule 1']::text[],'#-1058'),
 ('#D059','Manutention de conteneur plein','Manutention de conteneur plein','Full Container Handling',NULL,'HANDLING',NULL,'Manutention du conteneur plein au terminal. Handling of the full container at the terminal.',ARRAY['#-1116','#-1117','container','conteneur','full','handling','manutention','plein']::text[],'#-1116,#-1117'),
 ('#D060','Frais GPS + Installation','Frais GPS et installation','GPS Fees + Installation',NULL,'ESCORT',NULL,'Balise GPS et pose, exigées sur un transit sous douane. GPS tracker and fitting required on a bonded transit.',ARRAY['#-1059','balise','gps','installation','suivi','tracker','transit']::text[],'#-1059'),
 ('#D061','Frais GUCE (guichet unique)',NULL,'GUCE Single-Window Fees',NULL,'DECLARATION',NULL,'Redevance du guichet unique (GUCE) sur le dossier. Single-window (GUCE) fee on the file.',ARRAY['#-1055','guce','guichet unique','redevance','single window']::text[],'#-1055'),
 ('#D062','Droit de Sortie Marchandise','Droit de sortie marchandise','Goods Exit Fees',NULL,'DECLARATION',NULL,'Droit de sortie acquitté pour la marchandise. Goods exit duty paid on the cargo.',ARRAY['#-1180','droit','exit','goods exit','sortie']::text[],'#-1180'),
 ('#D063','Redevance Marchandise Import','Redevance marchandise import','Goods Import Taxes',NULL,'OCEAN_FREIGHT','CUSTOMS_DUTIES','Redevance perçue sur la marchandise à l''importation. Levy charged on imported goods.',ARRAY['#-1149','goods import','import','marchandise','redevance','taxe']::text[],'#-1149'),
 ('#D064','Frais Compte Garant','Frais de compte garant','Guarantee Account Fees',NULL,'BANK_FINANCE',NULL,'Frais du compte de garantie douanier utilisé pour le dossier. Fees on the customs guarantee account used for the file.',ARRAY['#-1174','caution','compte','garant','garantie','guarantee account']::text[],'#-1174'),
 ('#D065','Lettre de Garantie Authentification','Authentification de la lettre de garantie','Guarantee Letter Authentification',NULL,'HANDLING','DOCUMENTATION','Authentification de la lettre de garantie exigée pour l''enlèvement. Authentication of the guarantee letter required for release.',ARRAY['#-1099','authentication','authentification','guarantee letter','lettre de garantie','lg']::text[],'#-1099'),
 ('#D066','Transport Abéché – Al Geneina',NULL,'Haulage Abéché – Al Geneina',NULL,'TRUCKING',NULL,'Transport routier entre Abéché et Al Geneina. Road haulage between Abéché and Al Geneina.',ARRAY['#-1177','abeche','al geneina','corridor','soudan','sudan','transport']::text[],'#-1177'),
 ('#D067','Transport Douala – Abéché',NULL,'Haulage Douala – Abéché',NULL,'TRUCKING',NULL,'Transport routier entre Douala et Abéché. Road haulage between Douala and Abéché.',ARRAY['#-1176','abeche','chad','corridor','douala','tchad','transport']::text[],'#-1176'),
 ('#D068','Documents de Transport Hinterland','Documents de transport hinterland','Hinterland Transportation Documents',NULL,'TRUCKING',NULL,'Documents de transport exigés sur le corridor hinterland. Transport documents required on the hinterland corridor.',ARRAY['#-1086','corridor','documents','hinterland','transit','transport']::text[],'#-1086'),
 ('#D069','Formalités Sortie Port Sec','Formalités de sortie du port sec','ICD Exit Formalities',NULL,'DECLARATION',NULL,'Formalités de sortie du port sec (ICD). Exit formalities at the inland container depot.',ARRAY['#-1078','dry port','formalites','icd','port sec','sortie']::text[],'#-1078'),
 ('#D070','Renouvellement Licence d''Emportation / Exportation','Renouvellement de licence d''importation / exportation','Import / Export License Renewal','Import / Export Licence Renewal','DECLARATION',NULL,'Renouvellement de la licence d''importation ou d''exportation. Renewal of the import or export licence.',ARRAY['#-1061','export','import','licence','license','renewal','renouvellement']::text[],'#-1061'),
 ('#D071','Déclaration d''Importation','Déclaration d''importation (DI)','Import Declaration',NULL,'DECLARATION',NULL,'Déclaration d''importation déposée auprès de la douane. Import declaration lodged with customs.',ARRAY['#-1060','declaration','di','import declaration','importation']::text[],'#-1060'),
 ('#D072','Formalites Import','Formalités d''importation','Import Formalities',NULL,'HANDLING','DECLARATION','Notre honoraire pour les formalités d''importation du dossier. Our fee for the file''s import formalities.',ARRAY['#-1100','formalites','formalities','import','importation']::text[],'#-1100'),
 ('#D073','Transport terrestre',NULL,'Inland Freight',NULL,'TRUCKING',NULL,'Transport terrestre de la marchandise, y compris le pré-acheminement à l''origine. Inland haulage of the cargo, including origin pre-carriage.',ARRAY['#-1139','#-1140','#-1141','camionnage','freight','inland','origine','transport terrestre','trucking']::text[],'#-1139,#-1140,#-1141'),
 ('#D074','Frais de Visite','Frais de visite','Inspection Fees',NULL,'CUSTOMS_INSPECTION',NULL,'Frais de visite physique de la marchandise par l''administration. Physical inspection fee charged by the authority.',ARRAY['#-1171','controle','inspection','physique','visit','visite']::text[],'#-1171'),
 ('#D075','Retrait Tardif du BAD','Retrait tardif du BAD','Late Delivery Order Release',NULL,'OCEAN_FREIGHT',NULL,'Pénalité pour retrait tardif du bon à délivrer. Penalty for late collection of the delivery order.',ARRAY['#-1028','bad','bon a delivrer','delivery order','late','retard','tardif']::text[],'#-1028'),
 ('#D076','Demande de Chargement','Demande de chargement','Loading Authorization',NULL,'DECLARATION',NULL,'Demande d''autorisation de chargement auprès du terminal. Application for a loading authorisation from the terminal.',ARRAY['#-1175','autorisation','chargement','demande','loading']::text[],'#-1175'),
 ('#D077','Chargement sur Camion','Chargement sur camion','Loading on truck',NULL,'HANDLING',NULL,'Chargement de la marchandise sur le camion. Loading the cargo onto the truck.',ARRAY['#-1155','camion','chargement','empotage','loading','truck']::text[],'#-1155'),
 ('#D078','Assurance','Assurance locale','Local Insurance',NULL,'DECLARATION','OTHER','Assurance souscrite localement sur la marchandise, refacturée au client. Locally-placed cargo insurance re-billed to the client.',ARRAY['#-1062','assurance','cargo','insurance','locale','marchandise']::text[],'#-1062'),
 ('#D079','Frais d''Expertise Maritime','Frais d''expertise maritime','Maritime Expert Fees',NULL,'SURVEY',NULL,'Expertise maritime de la marchandise ou du navire. Marine survey of the cargo or the vessel.',ARRAY['#-1101','commissaire avaries','expert','expertise','marine','maritime','survey']::text[],'#-1101'),
 ('#D080','Frais NEXUS','Frais NEXUS','NEXUS Fees',NULL,'DECLARATION',NULL,'Redevance NEXUS sur le traitement du dossier. NEXUS levy on the processing of the file.',ARRAY['#-1074','frais','nexus','redevance']::text[],'#-1074'),
 ('#D081','Fret maritime','Fret maritime','Ocean Freight',NULL,'OCEAN_FREIGHT',NULL,'Fret maritime facturé par la compagnie, du port de chargement au port de déchargement. Ocean freight charged by the carrier, load port to discharge port.',ARRAY['#-1027','#-1182','#-1183','freight','fret','maritime','mer','navire','ocean','ocean freight']::text[],'#-1027,#-1182,#-1183'),
 ('#D082','Déchargement','Déchargement','Offloading',NULL,'TRUCKING',NULL,'Déchargement de la marchandise du camion ou du conteneur. Offloading the cargo from truck or container.',ARRAY['#-1081','decharge','dechargement','depotage','offloading','unloading']::text[],'#-1081'),
 ('#D083','Déchargement à Destination','Déchargement à destination','Offloading at Destination',NULL,'HANDLING',NULL,'Déchargement de la marchandise au point de destination. Offloading the cargo at destination.',ARRAY['#-1095','dechargement','destination','livraison','offloading']::text[],'#-1095'),
 ('#D084','Charges à l''origine','Charges à l''origine','Origin Charges',NULL,'HANDLING','OCEAN_FREIGHT','Frais engagés au port ou à l''aéroport d''origine avant l''expédition. Charges incurred at the origin port or airport before shipment.',ARRAY['#-1104','#-1184','depart','local charges','origin','origin charges','origine']::text[],'#-1104,#-1184'),
 ('#D085','Autres Frais Douaniers','Autres frais douaniers','Other Customs Charges',NULL,'DECLARATION',NULL,'Frais douaniers divers non couverts par une autre ligne. Sundry customs charges not covered by another line.',ARRAY['#-1063','autres','divers','frais douaniers','other customs','sundry']::text[],'#-1063'),
 ('#D086','Pénalité Pont Bascule','Pénalité de pont-bascule','Overweight Penalty','Overweight / Weighbridge Penalty','TRUCKING',NULL,'Pénalité de surcharge relevée au pont-bascule. Overweight penalty raised at the weighbridge.',ARRAY['#-1085','#-1156','amende','overweight','penalite','pesage','pont bascule','surcharge','weighbridge','weighbridge fine']::text[],'#-1085'),
 ('#D087','Transport sur roues','Transport sur roues','Own Wheel Transportation',NULL,'TRUCKING',NULL,'Acheminement d''un engin par ses propres moyens (roulage). Moving a unit under its own wheels.',ARRAY['#-1087','#-1154','engin','grue','own wheel','roulage','self propelled','xcmg']::text[],'#-1087,#-1154'),
 ('#D088','Frais PAD (Port Autonome de Douala)',NULL,'PAD Fees (Douala Port Authority)',NULL,'THC',NULL,'Redevances du Port Autonome de Douala sur l''escale du conteneur. Douala Port Authority dues on the container''s call.',ARRAY['#-1029','#-1030','douala','pad','port autonome','port dues','redevance']::text[],'#-1029,#-1030'),
 ('#D089','Frais PAK (Port Autonome de Kribi)',NULL,'PAK Fees (Kribi Port Authority)',NULL,'THC',NULL,'Redevances du Port Autonome de Kribi sur l''escale du conteneur. Kribi Port Authority dues on the container''s call.',ARRAY['#-1031','#-1032','kribi','pak','port autonome','port dues','redevance']::text[],'#-1031,#-1032'),
 ('#D090','Passage Port Sec PK26','Passage au port sec PK26','PK 26 Dry Port Fees',NULL,'THC',NULL,'Frais de passage du conteneur au port sec de PK26. Transit fee through the PK26 dry port.',ARRAY['#-1144','dry port','icd','passage','pk 26','pk26','port sec']::text[],'#-1144'),
 ('#D091','Frais Port Sec PK26','Frais du port sec PK26','PK 26 Terminal Fees',NULL,'THC',NULL,'Frais de terminal au port sec de PK26. Terminal charges at the PK26 dry port.',ARRAY['#-1181','dry port','icd','pk 26','pk26','port sec','terminal']::text[],'#-1181'),
 ('#D092','Pénalité Défaut Certificat de Conformité','Pénalité défaut de certificat de conformité','Penalty for Missing COC',NULL,'CUSTOMS_DUTIES',NULL,'Pénalité pour absence du certificat de conformité à l''importation. Penalty for a missing certificate of conformity at import.',ARRAY['#-1064','coc','conformite','defaut','missing','penalite','penalty']::text[],'#-1064'),
 ('#D093','Pénalité défaut de RVC','Pénalité défaut de RVC','Penalty for Missing RVC',NULL,'CUSTOMS_DUTIES',NULL,'Pénalité pour absence du rapport de vérification de conformité. Penalty for a missing verification-of-conformity report.',ARRAY['#-1071','conformite','defaut','penalite','penalty','rcv','rvc']::text[],'#-1071'),
 ('#D094','Inspection Phytosanitaire','Inspection phytosanitaire','Phyto-sanitary Inspection',NULL,'CUSTOMS_INSPECTION',NULL,'Inspection phytosanitaire des marchandises végétales. Phytosanitary inspection of plant products.',ARRAY['#-1065','inspection','phyto','phytosanitaire','phytosanitary','sanitaire','vegetal']::text[],'#-1065'),
 ('#D095','Accès portuaire','Accès portuaire','Port Access',NULL,'THC',NULL,'Droit d''accès au domaine portuaire. Port access charge.',ARRAY['#-1118','acces','access','badge','port','portuaire']::text[],'#-1118'),
 ('#D096','Charges portuaires','Charges portuaires','Port Charges',NULL,'THC',NULL,'Charges du port sur l''escale et le passage du conteneur. Port charges on the call and the box''s passage.',ARRAY['#-1119','#-1120','charges portuaires','frais de port','port','port charges','portuaire']::text[],'#-1119,#-1120'),
 ('#D097','Formalités de Sortie Portuaires','Formalités de sortie portuaire','Port Exit Formalities',NULL,'HANDLING','DECLARATION','Notre honoraire pour les formalités de sortie du domaine portuaire. Our fee for the port-exit formalities.',ARRAY['#-1098','exit','formalites','port exit','portuaire','sortie']::text[],'#-1098'),
 ('#D098','Stationnement (magasinage portuaire)','Stationnement (magasinage portuaire)','Port Storage',NULL,'STORAGE',NULL,'Magasinage du conteneur ou de la marchandise sur le domaine portuaire. Storage of the box or cargo in the port area.',ARRAY['#-1121','entreposage','magasinage','port','stationnement','storage']::text[],'#-1121'),
 ('#D099','Authentification Procuration','Authentification de la procuration','Power of Attorney Authentification',NULL,'HANDLING','DOCUMENTATION','Authentification de la procuration donnée au transitaire. Authentication of the power of attorney given to the forwarder.',ARRAY['#-1106','authentification','mandat','poa','power of attorney','procuration']::text[],'#-1106'),
 ('#D100','Déclaration préalable d''importation de valeurs (DPIV)',NULL,'Prior Import Value Declaration (DPIV)',NULL,'CUSTOMS_DUTIES',NULL,'Déclaration préalable d''importation de valeurs (DPIV). Prior import value declaration (DPIV).',ARRAY['#-1146','declaration prealable','dpiv','prior import','valeur','valeurs']::text[],'#-1146'),
 ('#D101','Réception, Manutention et Transfert au Terminal','Réception, manutention et transfert au terminal','Reception, Handling & Transfer to Terminal',NULL,'HANDLING',NULL,'Réception de la marchandise, manutention et transfert vers le terminal. Receipt, handling and transfer of cargo to the terminal.',ARRAY['#-1107','handling','manutention','reception','terminal','transfer','transfert']::text[],'#-1107'),
 ('#D102','Redevance SMADE','Redevance SMADE','SMADE Levy',NULL,'DECLARATION',NULL,'Redevance SMADE perçue sur le dossier. SMADE levy charged on the file.',ARRAY['#-1163','levy','redevance','smade']::text[],'#-1163'),
 ('#D103','Frais de scanner','Frais de scanner','Scanning Fees',NULL,'SCANNING',NULL,'Passage du conteneur au scanner douanier. Customs scanner pass for the container.',ARRAY['#-1072','#-1135','#-1136','controle','rayons x','scan','scanner','scanning','x-ray']::text[],'#-1072,#-1135,#-1136'),
 ('#D104','Frais de sécurité','Frais de sécurité','Security Fees',NULL,'THC',NULL,'Redevance de sûreté portuaire (ISPS) sur le conteneur. Port security (ISPS) charge on the container.',ARRAY['#-1128','#-1129','isps','safety','securite','security','surete']::text[],'#-1128,#-1129'),
 ('#D105','Frais de la ligne maritime','Frais de la ligne maritime','Shipping Line Charges',NULL,'OCEAN_FREIGHT',NULL,'Frais divers facturés par la compagnie maritime sur le conteneur. Sundry charges billed by the shipping line on the box.',ARRAY['#-1034','#-1035','#-1150','carrier','compagnie','frais de ligne','ligne maritime','shipping line']::text[],'#-1034,#-1035,#-1150'),
 ('#D106','Timbre','Timbre fiscal','Stamp','Stamp Duty','OTHER',NULL,'Timbre fiscal apposé sur les documents du dossier. Stamp duty on the file''s documents.',ARRAY['#-1166','duty','fiscal','stamp','timbre','timbre fiscal']::text[],'#-1166'),
 ('#D107','Manutention portuaire (acconage)','Manutention portuaire (acconage)','Stevedoring',NULL,'HANDLING',NULL,'Acconage : manutention à quai entre le navire et le terre-plein. Stevedoring between vessel and quay.',ARRAY['#-1079','#-1126','#-1127','acconage','manutention','portuaire','quai','stevedoring']::text[],'#-1126,#-1127,#-1079'),
 ('#D108','Certificat d''Empotage','Certificat d''empotage','Stuffing Certificate',NULL,'CUSTOMS_INSPECTION',NULL,'Certificat attestant l''empotage du conteneur. Certificate attesting the container was stuffed.',ARRAY['#-1068','certificat','certificate','empotage','stuffing']::text[],'#-1068'),
 ('#D109','Opérations d''Empotage','Opérations d''empotage','Stuffing Operations',NULL,'HANDLING',NULL,'Empotage de la marchandise dans le conteneur. Stuffing the cargo into the container.',ARRAY['#-1069','chargement','empotage','operations','stuffing']::text[],'#-1069'),
 ('#D110','Rapport d''empotage','Rapport d''empotage','Stuffing Report',NULL,'CUSTOMS_INSPECTION',NULL,'Rapport d''empotage établi après chargement du conteneur. Stuffing report issued after the box is loaded.',ARRAY['#-1056','empotage','rapport','report','stuffing']::text[],'#-1056'),
 ('#D111','Titre TEL de transit','Titre TEL de transit','TEL Transit',NULL,'DECLARATION',NULL,'Titre TEL couvrant le transit sous douane vers l''hinterland. TEL title covering the bonded hinterland transit.',ARRAY['#-1073','douane','hinterland','tel','titre','transit']::text[],'#-1073'),
 ('#D112','Visa Technique','Visa technique','Technical Visa',NULL,'HANDLING','DECLARATION','Visa technique délivré par l''administration compétente. Technical visa issued by the competent authority.',ARRAY['#-1070','autorisation','technical','technique','visa']::text[],'#-1070'),
 ('#D113','Admission Temporaire','Admission temporaire','Temporal Admission',NULL,'CUSTOMS_DUTIES',NULL,'Régime d''admission temporaire de la marchandise. Temporary admission regime for the goods.',ARRAY['#-1147','admission temporaire','at','regime','temporaire','temporary']::text[],'#-1147'),
 ('#D114','Charges terminal à conteneur (THC)','Charges terminal à conteneur (THC)','Terminal Handling Charges (THC)',NULL,'THC',NULL,'Manutention du terminal pour charger ou décharger le conteneur du navire. Terminal handling to lift the box on or off the vessel.',ARRAY['#-1122','#-1123','charges terminal','manutention','terminal','terminal handling','thc']::text[],'#-1122,#-1123'),
 ('#D115','Transport terrestre (tiers)','Transport terrestre (tiers)','Third-party Trucking',NULL,'TRUCKING',NULL,'Transport routier sous-traité à un transporteur tiers. Road haulage subcontracted to a third-party carrier.',ARRAY['#-1082','camionnage','haulage','routier','tiers','transport','trucking']::text[],'#-1082'),
 ('#D116','Transfert Port Sec','Transfert au port sec','Transfer to ICD',NULL,'TRUCKING',NULL,'Acheminement du conteneur vers le port sec. Moving the container to the inland container depot.',ARRAY['#-1077','dry port','icd','port sec','transfer','transfert']::text[],'#-1077'),
 ('#D117','Transfert au Port','Transfert au port','Transfer to Port',NULL,'TRUCKING',NULL,'Acheminement de la marchandise vers le port. Moving the cargo to the port.',ARRAY['#-1111','acheminement','port','transfer','transfert']::text[],'#-1111'),
 ('#D118','Titre de Transit (T1)','Titre de transit (T1)','Transit Title (T1)',NULL,'DECLARATION',NULL,'Titre de transit T1 couvrant la marchandise sous douane. T1 transit document covering bonded cargo.',ARRAY['#-1075','bonded','douane','t1','titre','transit']::text[],'#-1075'),
 ('#D119','Autorisation de Transport (Ministère de Transport)','Autorisation de transport (Ministère des Transports)','Transport Authorisation (Ministry of Transport)','Transport Authorisation (Ministry of Transport)','TRUCKING','ESCORT','Autorisation exceptionnelle de transport pour charge hors gabarit. Special transport permit for out-of-gauge loads.',ARRAY['#-1158','autorisation','exceptionnel','hors gabarit','ministere','permit','route','transport']::text[],'#-1158'),
 ('#D120','Tranfert vers le site d''empotage','Transfert vers le site d''empotage','Transport to Stuffing Site',NULL,'TRUCKING',NULL,'Acheminement de la marchandise vers le site d''empotage. Moving the cargo to the stuffing site.',ARRAY['#-1109','empotage','site','stuffing','transfer','transfert']::text[],'#-1109'),
 ('#D121','Transbordement','Transbordement','Transshipment',NULL,'HANDLING','DECLARATION','Transbordement de la marchandise d''un moyen de transport à un autre. Transshipment of the cargo between conveyances.',ARRAY['#-1143','transbordement','transfert','transhipment','transshipment']::text[],'#-1143'),
 ('#D122','Immobilisation Camion','Immobilisation de camion','Truck Immobilisation',NULL,'TRUCKING',NULL,'Immobilisation du camion en attente de chargement ou de formalités. Truck standing time waiting on loading or formalities.',ARRAY['#-1173','attente','camion','immobilisation','standing','truck','waiting']::text[],'#-1173'),
 ('#D123','Pénalités Pont Bascule','Pénalités de pont-bascule (doublon)','Weighbridge Fine','Weighbridge Fine (superseded)','HANDLING',NULL,'Doublon de la pénalité de pont-bascule — utiliser la ligne Pénalité de pont-bascule. Superseded duplicate, use the Overweight / Weighbridge Penalty line.',ARRAY['#-1156','doublon','duplicate','pont bascule','superseded','weighbridge']::text[],'#-1156'),
 ('#D124','Station de Pesage','Station de pesage','Weighing Charges',NULL,'TRUCKING',NULL,'Pesage de la marchandise ou du camion à la station. Weighing of the cargo or truck at the station.',ARRAY['#-1084','bascule','pesage','poids','pont bascule','vgm','weighing']::text[],'#-1084'),
 ('#D125','Prestation Gestion du Parc','Prestation de gestion du parc','Yard Management Fee',NULL,'STORAGE',NULL,'Gestion du parc à conteneurs facturée par le dépôt. Yard management billed by the depot.',ARRAY['#-1151','depot','gestion','management','parc','yard']::text[],'#-1151'),
 ('#D126','Encombrement (occupation de terre-plein)','Encombrement (occupation de terre-plein)','Yard Occupancy',NULL,'STORAGE',NULL,'Occupation du terre-plein par le conteneur au-delà de la franchise. Yard occupancy beyond the free period.',ARRAY['#-1124','#-1125','encombrement','occupancy','occupation','stationnement','terre plein','yard']::text[],'#-1124,#-1125'),
 ('#E001','Ouverture de Compte','Ouverture de compte','Account Opening',NULL,'BANK_FINANCE',NULL,'Frais d''ouverture d''un compte bancaire. Bank account opening charges.',ARRAY['#-1091','account opening','bank','banque','compte','ouverture']::text[],'#-1091'),
 ('#E002','Frais de Banque','Frais bancaires','Bank Charges',NULL,'BANK_FINANCE',NULL,'Commissions et frais prélevés par la banque. Commissions and fees charged by the bank.',ARRAY['#-1089','agios','bank','banque','commission','frais bancaires']::text[],'#-1089'),
 ('#E003','Agent d''entretien','Agent d''entretien','Cleaning Services',NULL,'OTHER',NULL,'Prestation de nettoyage et d''entretien des locaux. Office cleaning and upkeep services.',ARRAY['#-1015','cleaning','entretien','menage','nettoyage','proprete']::text[],'#-1015'),
 ('#E004','Ordinateurs','Ordinateurs','Computers',NULL,'OTHER',NULL,'Achat de matériel informatique. Purchase of computer equipment.',ARRAY['#-1009','computer','informatique','materiel','ordinateur','pc']::text[],'#-1009'),
 ('#E005','Sécurité du convoi','Sécurité du convoi','Convoy Security',NULL,'ESCORT',NULL,'Sécurisation du convoi sur cargaison spéciale ou corridor sensible. Convoy security on project cargo or a sensitive corridor.',ARRAY['convoi','convoy','escorte','protection','securite','security']::text[],NULL),
 ('#E006','Grutage et levage','Grutage et levage','Crane and Lifting',NULL,'HANDLING',NULL,'Location de grue et opérations de levage sur colis lourds. Crane hire and lifting operations for heavy lifts.',ARRAY['colis lourd','crane','grue','grutage','levage','lifting']::text[],NULL),
 ('#E007','Indemnité de route chauffeur','Indemnité de route chauffeur','Driver Allowance',NULL,'TRUCKING',NULL,'Indemnité versée au chauffeur pour la mission de transport. Allowance paid to the driver for the trip.',ARRAY['allowance','chauffeur','driver','indemnite','perdiem','route']::text[],NULL),
 ('#E008','Facture Electricité','Facture électricité','Electricity',NULL,'UTILITIES',NULL,'Consommation électrique des locaux. Electricity consumption for the premises.',ARRAY['#-1002','courant','electricite','electricity','eneo','energie']::text[],'#-1002'),
 ('#E009','Négociation Douane','Négociation douane (facilitation)','Facility Payment (Customs)','Facility Payment (customs negotiation)','CUSTOMS_DUTIES',NULL,'Paiement de facilitation lors d''une négociation douanière — charge interne, jamais refacturée. Facilitation payment during a customs negotiation, never re-billed.',ARRAY['#-1110','arrangement','douane','facilitation','facility','negociation']::text[],'#-1110'),
 ('#E010','Consultant Financier','Consultant financier','Financial Consultant',NULL,'OTHER',NULL,'Honoraires du consultant financier externe. External financial consultant''s fees.',ARRAY['#-1011','conseil','consultant','financial','financier','honoraires']::text[],'#-1011'),
 ('#E011','Carburant','Carburant','Fuel',NULL,'TRUCKING',NULL,'Carburant consommé par la flotte. Fuel consumed by the fleet.',ARRAY['carburant','diesel','essence','fuel','gasoil','gazole']::text[],NULL),
 ('#E012','Suivi GPS et télématique','Suivi GPS et télématique','GPS and Tracking',NULL,'TRUCKING',NULL,'Abonnement de géolocalisation et télématique de la flotte. Fleet GPS tracking and telematics subscription.',ARRAY['flotte','geolocalisation','gps','suivi','telematique','tracking']::text[],NULL),
 ('#E013','Saisie du ticket de livraison','Saisie du ticket de livraison','Gate-Pass Fee',NULL,'OTHER','OTHER','Frais de saisie du ticket de livraison (gate pass). Gate-pass entry fee.',ARRAY['#-1165','gate pass','livraison','portail','saisie','ticket']::text[],'#-1165'),
 ('#E014','Escorte de colis lourds','Escorte de colis lourds','Heavy-lift Escort',NULL,'ESCORT',NULL,'Escorte technique accompagnant un colis lourd ou hors gabarit. Technical escort for a heavy or out-of-gauge lift.',ARRAY['colis lourd','convoi','escort','escorte','heavy lift','hors gabarit']::text[],NULL),
 ('#E015','Achat d''encre','Achat d''encre','Ink',NULL,'OTHER',NULL,'Consommables d''impression. Printer consumables.',ARRAY['#-1006','cartouche','encre','impression','ink','toner']::text[],'#-1006'),
 ('#E016','Facture internet','Facture internet','Internet',NULL,'UTILITIES',NULL,'Abonnement internet des locaux. Internet subscription for the premises.',ARRAY['#-1004','abonnement','connexion','fibre','internet','wifi']::text[],'#-1004'),
 ('#E017','Campagnes Marketing / Frais de Publicité','Campagnes marketing et publicité','Marketing Campaign / Promotional Expenses','Marketing & Advertising','OTHER',NULL,'Campagnes marketing, publicité et frais promotionnels. Marketing campaigns, advertising and promotional spend.',ARRAY['#-1133','advertising','campagne','communication','marketing','promotion','publicite']::text[],'#-1133'),
 ('#E018','Autres Dépenses','Autres dépenses','Miscellaneous Expenses',NULL,'HANDLING','OTHER','Dépenses diverses non couvertes par une autre ligne. Sundry expenses not covered by another line.',ARRAY['#-1102','autres','depenses','divers','miscellaneous','sundry']::text[],'#-1102'),
 ('#E019','Frais de mission','Frais de mission','Mission Allowance',NULL,'OTHER',NULL,'Frais de déplacement et de mission du personnel. Staff travel and mission expenses.',ARRAY['#-1132','#-1159','deplacement','frais de mission','mission','perdiem','travel','voyage']::text[],'#-1132,#-1159'),
 ('#E020','Réparation des appareils de bureau','Réparation des appareils de bureau','Office Equipment Maintenance',NULL,'OTHER',NULL,'Réparation et entretien du matériel de bureau. Repair and upkeep of office equipment.',ARRAY['#-1013','appareil','bureau','entretien','maintenance','reparation']::text[],'#-1013'),
 ('#E021','Travaux de maintenance des bureaux','Travaux de maintenance des bureaux','Office Maintenance',NULL,'OTHER',NULL,'Travaux d''entretien et d''aménagement des bureaux. Office maintenance and fit-out works.',ARRAY['#-1014','amenagement','bureau','entretien','maintenance','travaux']::text[],'#-1014'),
 ('#E022','Fournitures Matériel de Bureau','Fournitures et matériel de bureau','Office Supplies and Furniture','Office Supplies & Furniture','HANDLING','OTHER','Fournitures, mobilier et petit matériel de bureau. Office supplies, furniture and small equipment.',ARRAY['#-1103','bureau','fournitures','furniture','mobilier','papeterie','supplies']::text[],'#-1103'),
 ('#E023','Surcharge hors gabarit (OOG)','Surcharge hors gabarit (OOG)','Out-of-Gauge (OOG) Surcharge',NULL,'OCEAN_FREIGHT',NULL,'Surcharge de la compagnie pour une marchandise hors gabarit. Carrier surcharge for out-of-gauge cargo.',ARRAY['hors gabarit','oog','out of gauge','surcharge','surdimensionne']::text[],NULL),
 ('#E024','Achat de papier','Achat de papier','Paper',NULL,'OTHER',NULL,'Papier et consommables d''impression. Paper and printing consumables.',ARRAY['#-1005','consommable','impression','paper','papier','rame']::text[],'#-1005'),
 ('#E025','Transport routier au kilomètre','Transport routier au kilomètre','Per-km Haulage',NULL,'TRUCKING',NULL,'Transport routier de notre flotte, facturé au kilomètre. Own-fleet road haulage charged per kilometre.',ARRAY['flotte','haulage','kilometre','km','routier','transport']::text[],NULL),
 ('#E026','Imprimantes','Imprimantes','Printers',NULL,'OTHER',NULL,'Achat de matériel d''impression. Purchase of printing equipment.',ARRAY['#-1012','impression','imprimante','materiel','printer']::text[],'#-1012'),
 ('#E027','Loyer','Loyer','Rent',NULL,'RENT',NULL,'Loyer des bureaux et entrepôts. Rent for offices and warehouses.',ARRAY['#-1008','bail','immobilier','location','loyer','rent']::text[],'#-1008'),
 ('#E028','Salaires','Salaires','Salaries',NULL,'SALARIES',NULL,'Rémunération du personnel. Staff remuneration.',ARRAY['#-1007','paie','payroll','remuneration','salaire','salary','wages']::text[],'#-1007'),
 ('#E029','Dépenses sur personnel','Dépenses sur personnel','Staff Expenses',NULL,'SALARIES',NULL,'Dépenses diverses engagées pour le personnel. Sundry staff-related expenses.',ARRAY['#-1001','depenses','employes','personnel','staff']::text[],'#-1001'),
 ('#E030','Transport Employés','Transport des employés','Staff Transportation',NULL,'HANDLING','OTHER','Transport du personnel entre le domicile et le lieu de travail. Staff transport to and from work.',ARRAY['#-1092','employes','navette','personnel','ramassage','staff','transport']::text[],'#-1092'),
 ('#E031','Assurance des stocks','Assurance des stocks','Stock Insurance',NULL,'OTHER',NULL,'Assurance couvrant les marchandises stockées en entrepôt. Insurance covering goods held in the warehouse.',ARRAY['assurance','entrepot','insurance','marchandise','stock']::text[],NULL),
 ('#E032','Téléphonie','Téléphonie','Telephony',NULL,'UTILITIES',NULL,'Abonnements et communications téléphoniques. Telephone subscriptions and calls.',ARRAY['#-1010','communication','mobile','phone','telephone','telephonie']::text[],'#-1010'),
 ('#E033','Péages et taxes routières','Péages et taxes routières','Tolls and Road Fees',NULL,'TRUCKING',NULL,'Péages et taxes acquittés sur le trajet routier. Tolls and road taxes paid en route.',ARRAY['autoroute','peage','route','taxe routiere','toll']::text[],NULL),
 ('#E034','Location de camion','Location de camion','Truck Rental',NULL,'TRUCKING',NULL,'Location d''un camion auprès d''un tiers. Hire of a truck from a third party.',ARRAY['affretement','camion','hire','location','rental','truck']::text[],NULL),
 ('#E035','Entretien des véhicules','Entretien des véhicules','Vehicle Maintenance',NULL,'TRUCKING',NULL,'Entretien et réparation des véhicules de la flotte. Maintenance and repair of fleet vehicles.',ARRAY['entretien','flotte','garage','maintenance','reparation','vehicule']::text[],NULL),
 ('#E036','Facture Eau','Facture eau','Water',NULL,'UTILITIES',NULL,'Consommation d''eau des locaux. Water consumption for the premises.',ARRAY['#-1003','camwater','consommation','eau','water']::text[],'#-1003'),
 ('#R001','Commissions sur Débours',NULL,'Commissions on Disbursement','Commission on Disbursements','AGENCY_FEE',NULL,'Notre marge sur les débours avancés pour le client. Our margin on the disbursements advanced on the client''s behalf.',ARRAY['#-1094','commission','commissions sur debours','debours','disbursement','marge','margin']::text[],'#-1094'),
 ('#R002','Frais de dossier',NULL,'Documentation Fee',NULL,'DOCUMENTATION',NULL,'Notre honoraire d''ouverture et de traitement documentaire du dossier (BL, timbre). Our documentation fee covering the file''s paperwork (BL, stamp).',ARRAY['#-1020','#-1153','bl fees','doc fee','documentation','dossier','frais de dossier','paperwork']::text[],'#-1153,#-1020'),
 ('#R003','Travail Extra-Légal','Travail juridique supplémentaire','Extra Legal Work',NULL,'AGENCY_FEE',NULL,'Prestation juridique hors forfait sur un dossier (contentieux, rédaction). Legal work on a file beyond the standard scope.',ARRAY['#-1057','contentieux','extra legal','juridique','legal','travail extra']::text[],'#-1057'),
 ('#R004','Ouverture de dossier',NULL,'File Opening',NULL,'AGENCY_FEE',NULL,'Notre honoraire d''ouverture de dossier, facturé une fois par opération. Our file-opening fee, charged once per operation.',ARRAY['#-1088','file opening','nouveau dossier','opening','ouverture','ouverture de dossier']::text[],'#-1088'),
 ('#R005','Frais de DI','Frais de déclaration d''importation (DI)','Import Declaration Fee',NULL,'AGENCY_FEE',NULL,'Notre honoraire pour l''établissement de la déclaration d''importation. Our fee for preparing the import declaration.',ARRAY['#-1167','declaration importation','di','frais de di','import declaration fee']::text[],'#-1167'),
 ('#R006','Gestion des stocks',NULL,'Inventory Management',NULL,'STORAGE',NULL,'Gestion et suivi des stocks en entrepôt, facturé au dossier. Warehouse inventory management and stock tracking.',ARRAY['gestion des stocks','inventaire','inventory','stock','wms']::text[],NULL),
 ('#R007','Arrimage','Arrimage et saisissage','Lashing',NULL,'HANDLING',NULL,'Arrimage et calage de la marchandise dans le conteneur ou sur le véhicule. Lashing and securing cargo in the box or on the vehicle.',ARRAY['#-1130','arrimage','calage','lashing','saisissage','securing']::text[],'#-1130'),
 ('#R008','Préparation de commandes',NULL,'Order Picking',NULL,'HANDLING',NULL,'Préparation et prélèvement des commandes en entrepôt. Order picking and preparation in the warehouse.',ARRAY['commande','order picking','picking','prelevement','preparation']::text[],NULL),
 ('#R009','Reconditionnement',NULL,'Repackaging',NULL,'HANDLING',NULL,'Reconditionnement, palettisation ou remballage de la marchandise. Repackaging, palletising or re-wrapping goods.',ARRAY['emballage','palettisation','reconditionnement','remballage','repackaging']::text[],NULL),
 ('#R010','Frais de service',NULL,'Service Charges',NULL,'AGENCY_FEE',NULL,'Frais de service refacturés au client sur le dossier. Service charges re-billed to the client on the file.',ARRAY['#-1108','frais de service','prestation','service charge']::text[],'#-1108'),
 ('#R011','Magasinage par jour','Magasinage (par jour)','Storage per Day','Storage per Day','STORAGE',NULL,'Entreposage dans notre magasin, facturé par jour de stockage. Storage in our own warehouse, billed per day.',ARRAY['entreposage','magasinage','par jour','stockage','storage','warehouse']::text[],NULL),
 ('#R012','Manutention entrée entrepôt',NULL,'Warehouse Handling In',NULL,'HANDLING',NULL,'Manutention à la réception en entrepôt. Handling on goods receipt into the warehouse.',ARRAY['entree','entrepot','handling in','manutention','reception']::text[],NULL),
 ('#R013','Manutention sortie entrepôt',NULL,'Warehouse Handling Out',NULL,'HANDLING',NULL,'Manutention à la sortie d''entrepôt pour expédition. Handling on dispatch out of the warehouse.',ARRAY['entrepot','expedition','handling out','manutention','sortie']::text[],NULL)
ON CONFLICT (code) DO NOTHING;

-- ── 1/2/3. Provenance out of description, real descriptions and keywords in ─
-- The WHERE clause is the tenant-edit guard: only rows whose description is
-- still one of 9080's four provenance sentences are touched.
UPDATE dictionary_item di
   SET legacy_ref  = COALESCE(di.legacy_ref, a.legacy_ref),
       description = a.descr,
       keywords    = a.keywords,
       label_fr    = CASE WHEN a.new_fr  IS NOT NULL AND di.label_fr    = a.old_fr  THEN a.new_fr  ELSE di.label_fr    END,
       label_en    = CASE WHEN a.new_en  IS NOT NULL AND di.label_en    = a.old_en  THEN a.new_en  ELSE di.label_en    END,
       subcategory = CASE WHEN a.new_sub IS NOT NULL AND di.subcategory = a.old_sub THEN a.new_sub ELSE di.subcategory END
  FROM _fd_amend a
 WHERE di.code = a.code
   AND (di.description IS NULL
        OR di.description LIKE 'Ancienne ligne #-%'
        OR di.description LIKE 'Fusion des anciennes lignes %'
        OR di.description LIKE 'Nouvelle ligne, famille absente%'
        OR di.description LIKE 'Ligne à variantes%');

-- ── 4. Direction corrections ────────────────────────────────────────────────
INSERT INTO _fd_reclass (old_code, new_code, direction, account) VALUES
 ('#D028','#R014','REVENUE','7061'),
 ('#D033','#R015','REVENUE','7061'),
 ('#D035','#R016','REVENUE','7061'),
 ('#D029','#R017','REVENUE','7061'),
 ('#D072','#R018','REVENUE','7061'),
 ('#D097','#R019','REVENUE','7061'),
 ('#D056','#R020','REVENUE','7061'),
 ('#D045','#A003','ASSET','275')
ON CONFLICT (old_code) DO NOTHING;

-- Keep the superseded code findable before the code itself changes: a costing
-- sheet printed yesterday says "#D028", and the person holding it must land on
-- the same line tomorrow.
UPDATE dictionary_item di
   SET keywords = (SELECT ARRAY(SELECT DISTINCT unnest(di.keywords || ARRAY[lower(r.old_code)])))
  FROM _fd_reclass r
 WHERE di.code = r.old_code
   AND NOT (lower(r.old_code) = ANY (di.keywords));

-- The item itself. category, is_debours and debours_vat_transparent all follow
-- direction — a revenue line is not a débours and does not carry the "VAT paid
-- on your behalf" flag. proof_source becomes INTERNAL_SERVICE for the same
-- reason 9080 applied it to the other revenue lines: your own fee is proven by
-- your own invoice, not the carrier's.
UPDATE dictionary_item di
   SET code                    = r.new_code,
       direction               = r.direction,
       category                = CASE r.direction WHEN 'REVENUE' THEN 'service' ELSE 'asset' END,
       is_debours              = false,
       debours_vat_transparent = false,
       proof_source            = CASE r.direction WHEN 'REVENUE' THEN 'INTERNAL_SERVICE' ELSE di.proof_source END,
       provider_kind           = CASE r.direction WHEN 'REVENUE' THEN 'OTHER' ELSE di.provider_kind END,
       is_billable             = CASE r.direction WHEN 'REVENUE' THEN true ELSE di.is_billable END
  FROM _fd_reclass r
 WHERE di.code = r.old_code;

-- Replace the posting rules. The §23.14 invariant is DEFERRABLE, so deleting
-- the débours pair and inserting the new rule inside this one transaction is
-- legitimate — the check runs at COMMIT, by which time the new rule exists.
-- No journal line is touched by this: posting_rule is the template a future
-- entry is built from, not the history of entries already made.
-- DESTRUCTIVE: drops the débours purchase/sale rules on the eight reclassified lines — that is the point of the change, since those rules post a fee the company earns into client clearing 4731 instead of into revenue.
DELETE FROM posting_rule pr
 USING dictionary_item di, _fd_reclass r
 WHERE pr.dictionary_item_id = di.dictionary_item_id
   AND di.code = r.new_code
   AND pr.is_debours = true;

INSERT INTO posting_rule (dictionary_item_id, applies_context, debit_account, credit_account, tax_code_id, is_debours)
SELECT di.dictionary_item_id, 'sale', '4111', r.account, t.tax_code_id, false
  FROM _fd_reclass r
  JOIN dictionary_item di ON di.code = r.new_code
  LEFT JOIN _fd_tax t ON t.name = 'TVA_STD'
 WHERE r.direction = 'REVENUE'
   AND NOT EXISTS (SELECT 1 FROM posting_rule pr
                    WHERE pr.dictionary_item_id = di.dictionary_item_id
                      AND pr.applies_context = 'sale')
ON CONFLICT DO NOTHING;

INSERT INTO posting_rule (dictionary_item_id, applies_context, debit_account, credit_account, tax_code_id, is_debours)
SELECT di.dictionary_item_id, 'purchase', r.account, '4011', NULL, false
  FROM _fd_reclass r
  JOIN dictionary_item di ON di.code = r.new_code
 WHERE r.direction = 'ASSET'
   AND NOT EXISTS (SELECT 1 FROM posting_rule pr
                    WHERE pr.dictionary_item_id = di.dictionary_item_id
                      AND pr.applies_context = 'purchase')
ON CONFLICT DO NOTHING;

-- ── 5. The weighbridge duplicate ────────────────────────────────────────────
-- Deactivated, not deleted: a costing line or cash request may already point at
-- it, and is_active=false takes it out of every picker while leaving history
-- readable. Its description says which line to use instead.
UPDATE dictionary_item
   SET is_active = false
 WHERE code = '#D123' AND is_active = true;

-- ── 6. Container-type aliases ───────────────────────────────────────────────
-- The registry seeded friendly names ("40' HC"). The market says 40HQ, 40HC,
-- 40GP, DC, RF, TK — so the finder has to match those too. Stored in `extra`
-- rather than in the display name, which stays readable.
UPDATE dictionary_ref SET extra = extra || '{"aliases":["20gp","20dc","20dv","20ft","20 pieds","dry 20"]}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'FT20' AND NOT (extra ? 'aliases');
UPDATE dictionary_ref SET extra = extra || '{"aliases":["40gp","40dc","40dv","40ft","40 pieds","dry 40"]}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'FT40' AND NOT (extra ? 'aliases');
UPDATE dictionary_ref SET extra = extra || '{"aliases":["40hc","40hq","40 high cube","high cube"]}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'FT40HC' AND NOT (extra ? 'aliases');
UPDATE dictionary_ref SET extra = extra || '{"aliases":["45hc","45hq","45ft","45 high cube"]}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'FT45HC' AND NOT (extra ? 'aliases');
UPDATE dictionary_ref SET extra = extra || '{"aliases":["fr","flatrack","flat-rack","plateau"]}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'FLATRACK' AND NOT (extra ? 'aliases');
UPDATE dictionary_ref SET extra = extra || '{"aliases":["ot","opentop","open-top","toit ouvert"]}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'OPENTOP' AND NOT (extra ? 'aliases');
UPDATE dictionary_ref SET extra = extra || '{"aliases":["rf","reefer","frigo","frigorifique","refrigere"]}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'REEFER' AND NOT (extra ? 'aliases');
UPDATE dictionary_ref SET extra = extra || '{"aliases":["tk","isotank","citerne","tank"]}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'ISOTANK' AND NOT (extra ? 'aliases');
UPDATE dictionary_ref SET extra = extra || '{"aliases":["vt","ventile","ventilated","aere"]}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'VENTILATED' AND NOT (extra ? 'aliases');
UPDATE dictionary_ref SET extra = extra || '{"aliases":["bu","bulk","vrac","grain"]}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'BULK' AND NOT (extra ? 'aliases');

-- ── Guard rails ─────────────────────────────────────────────────────────────
DO $$
DECLARE bad text;
BEGIN
  -- Nothing may be left carrying provenance in the field a picker reads.
  SELECT string_agg(code::text, ', ' ORDER BY code::text) INTO bad
    FROM dictionary_item
   WHERE code::text ~ '^#[RDEA][0-9]+$'
     AND (description IS NULL OR description LIKE 'Ancienne ligne #-%'
          OR description LIKE 'Fusion des anciennes lignes %');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'seed 9081: lines still carry provenance in description: %', bad;
  END IF;

  -- Every seeded line must be searchable.
  SELECT string_agg(code::text, ', ' ORDER BY code::text) INTO bad
    FROM dictionary_item
   WHERE code::text ~ '^#[RDEA][0-9]+$' AND cardinality(keywords) = 0;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'seed 9081: lines with no search keywords: %', bad;
  END IF;

  -- The code letter must still agree with the direction after the re-mint.
  SELECT string_agg(code::text || ' is ' || direction, ', ' ORDER BY code::text) INTO bad
    FROM dictionary_item
   WHERE code::text ~ '^#[RDEA][0-9]+$'
     AND left(right(code::text, -1), 1) <> CASE direction
           WHEN 'REVENUE' THEN 'R' WHEN 'EXPENSE' THEN 'E'
           WHEN 'DEBOURS' THEN 'D' ELSE 'A' END;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'seed 9081: code letter disagrees with direction: %', bad;
  END IF;

  -- A reclassified line must have exactly the rules its new direction implies,
  -- and no débours rule may survive on it.
  SELECT string_agg(di.code::text, ', ' ORDER BY di.code::text) INTO bad
    FROM dictionary_item di
    JOIN _fd_reclass r ON r.new_code = di.code
   WHERE EXISTS (SELECT 1 FROM posting_rule pr WHERE pr.dictionary_item_id = di.dictionary_item_id AND pr.is_debours)
      OR NOT EXISTS (SELECT 1 FROM posting_rule pr
                      WHERE pr.dictionary_item_id = di.dictionary_item_id
                        AND pr.debit_account IS NOT NULL AND pr.credit_account IS NOT NULL);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'seed 9081: reclassified lines with wrong posting rules: %', bad;
  END IF;
END $$;

-- DOWN
-- Reference-data corrections applied as guarded UPDATEs. Undoing them means
-- putting back values that were wrong on purpose, so this is documentation of
-- intent rather than a path anyone should take. The direction corrections are
-- the only part with accounting consequence: reversing them puts the
-- forwarder's own clearance fee back into the client clearing account.
--
--   -- Restore the eight lines to débours (and re-mint their #D codes by hand —
--   -- the originals are listed in the header):
--   UPDATE dictionary_item SET direction='DEBOURS', category='debours',
--          is_debours=true, debours_vat_transparent=true
--    WHERE code IN ('#R014','#R015','#R016','#R017','#R018','#R019','#R020');
--   UPDATE dictionary_item SET direction='DEBOURS', category='debours',
--          is_debours=true, debours_vat_transparent=true WHERE code = '#A003';
--   DELETE FROM posting_rule WHERE dictionary_item_id IN
--     (SELECT dictionary_item_id FROM dictionary_item
--       WHERE code IN ('#R014','#R015','#R016','#R017','#R018','#R019','#R020','#A003'));
--   -- then re-insert the débours pair (Dr 4731/Cr 4011, Dr 4111/Cr 4731).
--
--   UPDATE dictionary_item SET is_active = true WHERE code = '#D123';
--   UPDATE dictionary_item SET keywords = '{}'::text[], legacy_ref = NULL
--    WHERE code ~ '^#[RDEA][0-9]+$';
--   -- Descriptions would have to be restored from a pre-9081 dump: the
--   -- provenance sentences they replaced are reconstructible from legacy_ref,
--   -- but the rewritten text is not recoverable from the database alone.
