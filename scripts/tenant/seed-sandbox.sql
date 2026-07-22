-- ============================================================================
-- SANDBOX TEST-DATA SEED  (Praxis LS / SmartLS)
-- ----------------------------------------------------------------------------
-- Populates a tenant's *sandbox* schema with a realistic Cameroon freight-
-- forwarder dataset so every built screen has something to show and the flows
-- can be clicked end-to-end.
--
-- SAFETY
--   * Targets the `sandbox` schema ONLY (SET search_path below). It never
--     touches `live`. Re-runnable: it no-ops if the marker entity already
--     exists (delete it, or run `npm run db:sandbox:wipe -- --slug=<slug>`,
--     to reseed).
--   * Config seeds (COA 9000, tax 9010, RBAC, settings) are assumed already
--     applied by provisioning — this file references them, doesn't recreate them.
--
-- WHAT IT DOES NOT DO (by design — direct SQL bypasses the service layer)
--   * It does NOT write journal_entry / journal_line rows, so it never trips
--     the ledger invariant triggers (balanced / gap-free entry_no / source_doc).
--   * Finance documents (invoices, receipts, advances, depreciation) are seeded
--     in PRE-POSTING states with entry_id = NULL. Trial balance, statements and
--     true receivables ageing come from POSTED entries, so exercise the money
--     path through the app/API after seeding (see doc/SANDBOX_TESTING.md).
--   * User FKs (owner_user_id, organiser_id, …) are left NULL: sandbox has no
--     app_user rows (auth runs off the live/identity schema). Employee FKs are
--     real (employees are seeded here).
--
-- RUN
--   psql "<tenant-db-conn>" -v ON_ERROR_STOP=1 -f scripts/tenant/seed-sandbox.sql
--   or:  node scripts/tenant/seed-sandbox.js --slug=smartls
-- ============================================================================

SET search_path = sandbox, public;

-- Mirror identity users into the sandbox schema. Business tables carry per-schema
-- FKs to app_user (invoice.issued_by, receipt.created_by, the audit ledger's
-- actor, …), but users live in the LIVE/identity schema and sandbox.app_user is
-- otherwise empty — so any TEST-mode write that stamps the acting user would hit a
-- foreign-key violation. Copy the same rows (same user_ids) so those FKs resolve.
-- Runs every time (outside the idempotency guard) and is safe to repeat.
INSERT INTO app_user SELECT * FROM live.app_user ON CONFLICT DO NOTHING;

DO $seed$
DECLARE
  -- entities
  v_ent1 uuid; v_ent2 uuid;
  -- clients
  v_cl1 uuid; v_cl2 uuid; v_cl3 uuid; v_cl4 uuid; v_cl5 uuid; v_cl6 uuid;
  -- suppliers
  v_sup1 uuid; v_sup2 uuid; v_sup3 uuid; v_sup4 uuid; v_sup5 uuid;
  -- employees
  v_emp1 uuid; v_emp2 uuid; v_emp3 uuid; v_emp4 uuid; v_emp5 uuid;
  v_emp6 uuid; v_emp7 uuid; v_emp8 uuid;
  -- dictionary items
  v_di_freight uuid; v_di_transit uuid; v_di_doc uuid; v_di_handling uuid;
  v_di_customs uuid; v_di_thc uuid; v_di_fuel uuid; v_di_ins uuid;
  -- tax codes (looked up from the 9010 seed)
  v_tc_std uuid; v_tc_zero uuid;
  -- treasury
  v_tr_bank uuid; v_tr_cash uuid; v_tr_momo uuid;
  -- service types + milestone template
  v_st_sea uuid; v_st_air uuid; v_st_transit uuid;
  v_mt uuid;
  -- pipeline stages (looked up from 9030)
  v_ps_new uuid; v_ps_qual uuid; v_ps_prop uuid; v_ps_neg uuid; v_ps_won uuid; v_ps_lost uuid;
  -- dossiers
  v_do1 uuid; v_do2 uuid; v_do3 uuid; v_do4 uuid; v_do5 uuid;
  -- leads
  v_ld1 uuid; v_ld2 uuid; v_ld3 uuid; v_ld4 uuid;
  -- opportunities
  v_op1 uuid; v_op2 uuid; v_op3 uuid; v_op4 uuid;
  -- proposals
  v_pp1 uuid; v_pp2 uuid;
  -- meetings
  v_mtg1 uuid;
  -- campaigns
  v_cmp1 uuid; v_cmp2 uuid;
  -- quotations / costings
  v_q1 uuid; v_q2 uuid; v_co1 uuid; v_co2 uuid; v_ms1 uuid;
  -- invoices
  v_inv1 uuid; v_inv2 uuid; v_inv3 uuid; v_inv4 uuid;
  -- procurement
  v_pr1 uuid; v_po1 uuid;
  -- assets / fleet
  v_as_truck uuid; v_as_truck2 uuid; v_as_soft uuid;
  v_veh1 uuid; v_veh2 uuid; v_veh3 uuid;
  -- wms
  v_loc1 uuid; v_loc2 uuid; v_loc3 uuid;
  v_it1 uuid; v_it2 uuid; v_eq1 uuid; v_ob1 uuid;
  v_wo1 uuid;
  -- hr
  v_run1 uuid; v_vac1 uuid; v_app1 uuid; v_kpi1 uuid; v_onb1 uuid; v_trn1 uuid;
BEGIN
  -- Idempotency guard --------------------------------------------------------
  IF EXISTS (SELECT 1 FROM corporate_entity WHERE code = 'SBX') THEN
    RAISE NOTICE 'sandbox already seeded (entity SBX exists) — skipping';
    RETURN;
  END IF;

  -- Lookups into the config seeds -------------------------------------------
  SELECT tax_code_id INTO v_tc_std  FROM tax_code WHERE code='TVA_STD'    ORDER BY effective_from DESC LIMIT 1;
  SELECT tax_code_id INTO v_tc_zero FROM tax_code WHERE code='TVA_EXPORT' ORDER BY effective_from DESC LIMIT 1;
  SELECT pipeline_stage_id INTO v_ps_new  FROM pipeline_stage WHERE code='NEW';
  SELECT pipeline_stage_id INTO v_ps_qual FROM pipeline_stage WHERE code='QUALIFIED';
  SELECT pipeline_stage_id INTO v_ps_prop FROM pipeline_stage WHERE code='PROPOSAL';
  SELECT pipeline_stage_id INTO v_ps_neg  FROM pipeline_stage WHERE code='NEGOTIATION';
  SELECT pipeline_stage_id INTO v_ps_won  FROM pipeline_stage WHERE code='WON';
  SELECT pipeline_stage_id INTO v_ps_lost FROM pipeline_stage WHERE code='LOST';

  -- ==========================================================================
  -- 1. MASTER DATA
  -- ==========================================================================
  INSERT INTO corporate_entity (code, legal_name, niu, rccm, address, doc_prefix, default_language)
    VALUES ('SBX','Smart Logistics Sandbox SARL','M0209SBX0001','RC/DLA/2019/B/1234','Bonabéri, Douala, Cameroun','SBX','fr')
    RETURNING entity_id INTO v_ent1;
  INSERT INTO corporate_entity (code, legal_name, niu, rccm, address, doc_prefix, default_language)
    VALUES ('SBX2','Smart Freight Yaoundé SARL','M0209SBX0002','RC/YAO/2021/B/5678','Centre-ville, Yaoundé, Cameroun','SBY','fr')
    RETURNING entity_id INTO v_ent2;

  INSERT INTO client_master (ref,entity_id,name,niu,payment_terms_days,credit_limit,cached_receivables,cached_overdue,is_withholding_agent)
    VALUES ('SBX-CL-0001',v_ent1,'Brasseries du Cameroun SA','M0100CL0001',30,50000000,7200000,1200000,true)  RETURNING client_id INTO v_cl1;
  INSERT INTO client_master (ref,entity_id,name,niu,payment_terms_days,credit_limit,cached_receivables,cached_overdue)
    VALUES ('SBX-CL-0002',v_ent1,'Dangote Cement Cameroon','M0100CL0002',45,80000000,15400000,0)              RETURNING client_id INTO v_cl2;
  INSERT INTO client_master (ref,entity_id,name,niu,payment_terms_days,credit_limit,cached_receivables,cached_overdue)
    VALUES ('SBX-CL-0003',v_ent1,'Total Energies Marketing CM','M0100CL0003',30,60000000,3100000,3100000)     RETURNING client_id INTO v_cl3;
  INSERT INTO client_master (ref,entity_id,name,niu,payment_terms_days,credit_limit)
    VALUES ('SBX-CL-0004',v_ent1,'CIMENCAM','M0100CL0004',60,40000000)                                        RETURNING client_id INTO v_cl4;
  INSERT INTO client_master (ref,entity_id,name,niu,payment_terms_days,credit_limit)
    VALUES ('SBX-CL-0005',v_ent2,'Guinness Cameroun SA','M0100CL0005',30,25000000)                            RETURNING client_id INTO v_cl5;
  INSERT INTO client_master (ref,entity_id,name,niu,payment_terms_days,credit_limit)
    VALUES ('SBX-CL-0006',v_ent2,'SODECOTON','M0100CL0006',90,30000000)                                       RETURNING client_id INTO v_cl6;

  INSERT INTO supplier_master (ref,entity_id,name,supplier_type,payment_method,momo_network,momo_number,rating)
    VALUES ('SBX-SS-0001',v_ent1,'Maersk Cameroun','SHIPPING_LINE','BANK',NULL,NULL,5)              RETURNING supplier_id INTO v_sup1;
  INSERT INTO supplier_master (ref,entity_id,name,supplier_type,payment_method,rating)
    VALUES ('SBX-SS-0002',v_ent1,'MSC Cameroun','SHIPPING_LINE','BANK',4)                           RETURNING supplier_id INTO v_sup2;
  INSERT INTO supplier_master (ref,entity_id,name,supplier_type,payment_method,momo_network,momo_number,rating)
    VALUES ('SBX-SS-0003',v_ent1,'Transit Express Douala','SUBCONTRACTOR','MOBILE_MONEY','MTN','677889900',4) RETURNING supplier_id INTO v_sup3;
  INSERT INTO supplier_master (ref,entity_id,name,supplier_type,payment_method,is_non_resident,rating)
    VALUES ('SBX-SS-0004',v_ent1,'Bolloré Logistics France','FREIGHT_AGENT','BANK',true,5)          RETURNING supplier_id INTO v_sup4;
  INSERT INTO supplier_master (ref,entity_id,name,supplier_type,payment_method,rating)
    VALUES ('SBX-SS-0005',v_ent2,'Total Carburants CM','FUEL','BANK',3)                             RETURNING supplier_id INTO v_sup5;

  INSERT INTO employee (entity_id,full_name,department,job_title,employment_type,cnps_number,base_salary,risk_class_rate,signatory_name,is_driver)
    VALUES (v_ent1,'Amara Nkeng','Management','Directeur Général','PERMANENT','CN-000001',2500000,0.0175,'Amara Nkeng',false) RETURNING employee_id INTO v_emp1;
  INSERT INTO employee (entity_id,full_name,department,job_title,employment_type,cnps_number,base_salary,risk_class_rate)
    VALUES (v_ent1,'Brigitte Fotso','Finance','Chef Comptable','PERMANENT','CN-000002',1200000,0.0175)         RETURNING employee_id INTO v_emp2;
  INSERT INTO employee (entity_id,full_name,department,job_title,employment_type,cnps_number,base_salary,risk_class_rate)
    VALUES (v_ent1,'Cédric Mballa','Operations','Responsable Opérations','PERMANENT','CN-000003',950000,0.025)  RETURNING employee_id INTO v_emp3;
  INSERT INTO employee (entity_id,full_name,department,job_title,employment_type,cnps_number,base_salary,risk_class_rate)
    VALUES (v_ent1,'Diane Ngo','Sales','Commerciale Senior','PERMANENT','CN-000004',780000,0.0175)             RETURNING employee_id INTO v_emp4;
  INSERT INTO employee (entity_id,full_name,department,job_title,employment_type,cnps_number,base_salary,risk_class_rate,is_driver)
    VALUES (v_ent1,'Emmanuel Tchoua','Fleet','Chauffeur Poids Lourd','PERMANENT','CN-000005',420000,0.05,true) RETURNING employee_id INTO v_emp5;
  INSERT INTO employee (entity_id,full_name,department,job_title,employment_type,cnps_number,base_salary,risk_class_rate,is_driver)
    VALUES (v_ent1,'Francis Ekwalla','Fleet','Chauffeur','PERMANENT','CN-000006',400000,0.05,true)            RETURNING employee_id INTO v_emp6;
  INSERT INTO employee (entity_id,full_name,department,job_title,employment_type,cnps_number,base_salary,risk_class_rate)
    VALUES (v_ent1,'Grace Abena','Warehouse','Magasinière','PERMANENT','CN-000007',450000,0.025)               RETURNING employee_id INTO v_emp7;
  INSERT INTO employee (entity_id,full_name,department,job_title,employment_type,cnps_number,base_salary,risk_class_rate)
    VALUES (v_ent2,'Henri Sadi','HR','Responsable RH','PERMANENT','CN-000008',900000,0.0175)                   RETURNING employee_id INTO v_emp8;

  -- Dictionary items (each needs a posting_rule — same txn satisfies the
  -- deferrable KB §23.14 constraint) --------------------------------------
  INSERT INTO dictionary_item (code,label_fr,label_en,category,is_debours,default_price,service_type_key)
    VALUES ('FRET-MER','Fret maritime','Sea freight','service',false,1800000,'SEA_FREIGHT_IMPORT') RETURNING dictionary_item_id INTO v_di_freight;
  INSERT INTO posting_rule (dictionary_item_id,applies_context,debit_account,credit_account,tax_code_id)
    VALUES (v_di_freight,'sale','4111','7061',v_tc_std);
  INSERT INTO dictionary_item (code,label_fr,label_en,category,is_debours,default_price)
    VALUES ('COM-TRANSIT','Commission de transit','Transit commission','service',false,350000) RETURNING dictionary_item_id INTO v_di_transit;
  INSERT INTO posting_rule (dictionary_item_id,applies_context,debit_account,credit_account,tax_code_id)
    VALUES (v_di_transit,'sale','4111','7062',v_tc_std);
  INSERT INTO dictionary_item (code,label_fr,label_en,category,is_debours,default_price)
    VALUES ('FRAIS-DOC','Frais de documentation','Documentation fees','service',false,75000) RETURNING dictionary_item_id INTO v_di_doc;
  INSERT INTO posting_rule (dictionary_item_id,applies_context,debit_account,credit_account,tax_code_id)
    VALUES (v_di_doc,'sale','4111','7063',v_tc_std);
  INSERT INTO dictionary_item (code,label_fr,label_en,category,is_debours,default_price)
    VALUES ('MANUT','Manutention','Handling','service',false,220000) RETURNING dictionary_item_id INTO v_di_handling;
  INSERT INTO posting_rule (dictionary_item_id,applies_context,debit_account,credit_account,tax_code_id)
    VALUES (v_di_handling,'sale','4111','7064',v_tc_std);
  INSERT INTO dictionary_item (code,label_fr,label_en,category,is_debours,is_billable,default_price)
    VALUES ('DROITS-DOUANE','Droits de douane (débours)','Customs duties (disbursement)','debours',true,true,0) RETURNING dictionary_item_id INTO v_di_customs;
  INSERT INTO posting_rule (dictionary_item_id,applies_context,debit_account,credit_account,is_debours)
    VALUES (v_di_customs,'disbursement','4731','4731',true);
  INSERT INTO dictionary_item (code,label_fr,label_en,category,is_debours,default_price)
    VALUES ('THC','Terminal handling (débours)','Terminal handling charge','debours',true,0) RETURNING dictionary_item_id INTO v_di_thc;
  INSERT INTO posting_rule (dictionary_item_id,applies_context,debit_account,credit_account,is_debours)
    VALUES (v_di_thc,'disbursement','4731','4731',true);
  INSERT INTO dictionary_item (code,label_fr,label_en,category,is_debours,default_price,shipping_line)
    VALUES ('CARBURANT','Carburant flotte','Fleet fuel','overhead',false,0,NULL) RETURNING dictionary_item_id INTO v_di_fuel;
  INSERT INTO posting_rule (dictionary_item_id,applies_context,debit_account,credit_account)
    VALUES (v_di_fuel,'purchase','6053','4011');
  INSERT INTO dictionary_item (code,label_fr,label_en,category,is_debours,default_price)
    VALUES ('ASSURANCE','Assurance marchandise','Cargo insurance','service',false,120000) RETURNING dictionary_item_id INTO v_di_ins;
  INSERT INTO posting_rule (dictionary_item_id,applies_context,debit_account,credit_account,tax_code_id)
    VALUES (v_di_ins,'sale','4111','7064',v_tc_std);

  -- Expense rates (feeds costing simulators)
  INSERT INTO expense_rate (dictionary_item_id,shipping_line,variant,rate) VALUES
    (v_di_freight,'Maersk','20ft',1650000),
    (v_di_freight,'Maersk','40ft',2400000),
    (v_di_freight,'MSC','40ft',2300000);

  -- Treasury accounts
  INSERT INTO treasury_account (entity_id,kind,label,coa_code,currency)
    VALUES (v_ent1,'BANK','Afriland First Bank 521-1','5211','XAF') RETURNING treasury_account_id INTO v_tr_bank;
  INSERT INTO treasury_account (entity_id,kind,label,coa_code,currency)
    VALUES (v_ent1,'CASH','Caisse siège Douala','571','XAF') RETURNING treasury_account_id INTO v_tr_cash;
  INSERT INTO treasury_account (entity_id,kind,label,coa_code,momo_network,momo_fee_account,currency)
    VALUES (v_ent1,'MOMO','MTN Mobile Money','5381','MTN','631','XAF') RETURNING treasury_account_id INTO v_tr_momo;

  -- Accounting journals (VT/AC/BQ/PAIE/OD) + an OPEN period per entity — required
  -- before anything can post to the ledger (journal_entry.buildAndInsert looks both
  -- up by entity). Without these the money-path seeder 422s "No journal for BQ".
  INSERT INTO journal (code,name,entity_id) VALUES
    ('VT','Ventes',v_ent1),('AC','Achats',v_ent1),('BQ','Banque',v_ent1),('PAIE','Paie',v_ent1),('OD','Opérations diverses',v_ent1),
    ('VT','Ventes',v_ent2),('AC','Achats',v_ent2),('BQ','Banque',v_ent2),('PAIE','Paie',v_ent2),('OD','Opérations diverses',v_ent2)
    ON CONFLICT (entity_id,code) DO NOTHING;
  INSERT INTO accounting_period (entity_id,code,starts_on,ends_on,status) VALUES
    (v_ent1, to_char(CURRENT_DATE,'YYYY'), date_trunc('year',CURRENT_DATE)::date, (date_trunc('year',CURRENT_DATE)+interval '1 year - 1 day')::date, 'OPEN'),
    (v_ent2, to_char(CURRENT_DATE,'YYYY'), date_trunc('year',CURRENT_DATE)::date, (date_trunc('year',CURRENT_DATE)+interval '1 year - 1 day')::date, 'OPEN')
    ON CONFLICT (entity_id,code) DO NOTHING;

  -- ==========================================================================
  -- 2. OPERATIONS — service taxonomy, dossiers, milestones
  -- ==========================================================================
  INSERT INTO service_type (key,name_fr,name_en,territory,is_system)
    VALUES ('SEA_FREIGHT_IMPORT','Fret maritime import','Sea freight import','INTERNATIONAL_IMPORT',true) RETURNING service_type_id INTO v_st_sea;
  INSERT INTO service_type (key,name_fr,name_en,territory)
    VALUES ('AIR_FREIGHT_IMPORT','Fret aérien import','Air freight import','INTERNATIONAL_IMPORT') RETURNING service_type_id INTO v_st_air;
  INSERT INTO service_type (key,name_fr,name_en,territory)
    VALUES ('HINTERLAND_TRANSIT','Transit hinterland','Hinterland transit','DOMESTIC_INLAND') RETURNING service_type_id INTO v_st_transit;

  INSERT INTO milestone_template (service_type_id,version) VALUES (v_st_sea,1) RETURNING milestone_template_id INTO v_mt;
  INSERT INTO milestone_template_stage (milestone_template_id,stage_seq,code,label_fr,label_en,default_offset_days) VALUES
    (v_mt,1,'BOOKING','Réservation','Booking',0),
    (v_mt,2,'DEPARTURE','Départ navire','Vessel departure',5),
    (v_mt,3,'ARRIVAL','Arrivée port','Port arrival',30),
    (v_mt,4,'CUSTOMS','Dédouanement','Customs clearance',33),
    (v_mt,5,'DELIVERY','Livraison finale','Final delivery',37);

  INSERT INTO dossier (ref,entity_id,client_id,service_type_id,status,incoterm,bl_mawb,vessel_flight,pol,pod,customs_regime,eta,ata)
    VALUES ('SBX-2026-0001',v_ent1,v_cl1,v_st_sea,'IN_PROGRESS','CIF','MAEU12345678','MSC LUCIA','Antwerp','Douala','IM4',CURRENT_DATE-5,NULL) RETURNING dossier_id INTO v_do1;
  INSERT INTO dossier (ref,entity_id,client_id,service_type_id,status,incoterm,bl_mawb,vessel_flight,pol,pod,customs_regime,eta,ata)
    VALUES ('SBX-2026-0002',v_ent1,v_cl2,v_st_sea,'COMPLETED','FOB','MSCU87654321','MAERSK SELAH','Shanghai','Douala','IM4',CURRENT_DATE-20,CURRENT_DATE-18) RETURNING dossier_id INTO v_do2;
  INSERT INTO dossier (ref,entity_id,client_id,service_type_id,status,incoterm,pol,pod,customs_regime,eta)
    VALUES ('SBX-2026-0003',v_ent1,v_cl3,v_st_transit,'OPEN','DAP','Douala','Ndjamena','IM8',CURRENT_DATE+3) RETURNING dossier_id INTO v_do3;
  INSERT INTO dossier (ref,entity_id,client_id,service_type_id,status,incoterm,bl_mawb,vessel_flight,pol,pod,eta)
    VALUES ('SBX-2026-0004',v_ent1,v_cl4,v_st_air,'IN_PROGRESS','CIP','ET-0982341','ET901','Paris CDG','Douala',CURRENT_DATE-2) RETURNING dossier_id INTO v_do4;
  INSERT INTO dossier (ref,entity_id,client_id,service_type_id,status,incoterm,pol,pod)
    VALUES ('SBX-2026-0005',v_ent2,v_cl5,v_st_sea,'OPEN','CFR','Tema','Douala') RETURNING dossier_id INTO v_do5;

  INSERT INTO milestone_instance (dossier_id,stage_seq,code,label,due_date,status) VALUES
    (v_do1,1,'BOOKING','Réservation',CURRENT_DATE-10,'DONE'),
    (v_do1,2,'DEPARTURE','Départ navire',CURRENT_DATE-5,'DONE'),
    (v_do1,3,'ARRIVAL','Arrivée port',CURRENT_DATE+2,'IN_PROGRESS'),
    (v_do1,4,'CUSTOMS','Dédouanement',CURRENT_DATE+5,'PENDING'),
    (v_do1,5,'DELIVERY','Livraison finale',CURRENT_DATE+9,'PENDING');
  INSERT INTO q_ticket (dossier_id,raised_by,subject,body,status)
    VALUES (v_do1,'Brasseries — M. Eyoum','ETA update?','Please confirm the revised arrival date.','OPEN');

  INSERT INTO transit_order (dossier_id,ot_number,customs_regime,service_direction,declared_value,submitted_docs)
    VALUES (v_do3,'OT-2026-0031','IM8','IMPORT',45000000,'["BL","Facture","Packing list"]');
  INSERT INTO delivery_note (dossier_id,doc_number,consignee,city_zone,contact_person)
    VALUES (v_do2,'BL-2026-0009','Dangote Cement','Douala — Bonabéri','M. Njoya');

  -- ==========================================================================
  -- 3. SALES & CRM
  -- ==========================================================================
  INSERT INTO lead (company_name,contact_name,email,phone,source,service_interest,status,client_id)
    VALUES ('SABC Boissons','Paul Etoa','p.etoa@sabc.cm','+237677001122','WEBSITE','Sea freight import','QUALIFIED',v_cl1) RETURNING lead_id INTO v_ld1;
  INSERT INTO lead (company_name,contact_name,email,phone,source,service_interest,status)
    VALUES ('Chococam SA','Marie Bilong','m.bilong@chococam.cm','+237699223344','REFERRAL','Customs clearance','CONTACTED') RETURNING lead_id INTO v_ld2;
  INSERT INTO lead (company_name,contact_name,email,source,service_interest,status)
    VALUES ('Nestlé Cameroun','Jean Kamga','j.kamga@nestle.cm','CAMPAIGN','Hinterland transit','NEW') RETURNING lead_id INTO v_ld3;
  INSERT INTO lead (company_name,contact_name,email,source,service_interest,status)
    VALUES ('Prometal','Alice Fon','a.fon@prometal.cm','MANUAL','Air freight','LOST') RETURNING lead_id INTO v_ld4;

  INSERT INTO meeting (subject,lead_id,scheduled_at) VALUES ('Découverte besoins fret — SABC',v_ld1,now()+interval '2 days') RETURNING meeting_id INTO v_mtg1;
  INSERT INTO meeting_note (meeting_id,body,is_minutes) VALUES (v_mtg1,'Client importe ~40 conteneurs/an depuis Anvers. Sensible aux délais de dédouanement.',true);

  INSERT INTO marketing_campaign (name,channel,status,starts_on,ends_on)
    VALUES ('Newsletter Q1 2026','email','ACTIVE',CURRENT_DATE-15,CURRENT_DATE+15) RETURNING campaign_id INTO v_cmp1;
  INSERT INTO marketing_campaign (name,channel,status)
    VALUES ('Salon Transport & Logistique Douala','event','DRAFT') RETURNING campaign_id INTO v_cmp2;
  INSERT INTO newsletter_subscriber (email,name,source) VALUES
    ('contact@sabc.cm','SABC',' website'),
    ('logistics@chococam.cm','Chococam','website'),
    ('info@prometal.cm','Prometal','manual')
    ON CONFLICT DO NOTHING;

  INSERT INTO opportunity (name,lead_id,client_id,dossier_id,pipeline_stage_id,estimated_value,probability,status)
    VALUES ('SABC — contrat cadre fret maritime',v_ld1,v_cl1,v_do1,v_ps_neg,72000000,60,'OPEN') RETURNING opportunity_id INTO v_op1;
  INSERT INTO opportunity (name,client_id,pipeline_stage_id,estimated_value,probability,status)
    VALUES ('Dangote — transit ciment',v_cl2,v_ps_prop,45000000,45,'OPEN') RETURNING opportunity_id INTO v_op2;
  INSERT INTO opportunity (name,lead_id,pipeline_stage_id,estimated_value,probability,status)
    VALUES ('Chococam — dédouanement récurrent',v_ld2,v_ps_qual,18000000,30,'OPEN') RETURNING opportunity_id INTO v_op3;
  INSERT INTO opportunity (name,client_id,dossier_id,pipeline_stage_id,estimated_value,status)
    VALUES ('CIMENCAM — fret aérien pièces',v_cl4,v_do4,v_ps_won,12000000,'WON') RETURNING opportunity_id INTO v_op4;

  INSERT INTO proposal (doc_number,lead_id,client_id,opportunity_id,title,status,ai_generated)
    VALUES ('SBX-PRP-0001',v_ld1,v_cl1,v_op1,'Proposition cadre fret maritime — SABC','SENT',true) RETURNING proposal_id INTO v_pp1;
  INSERT INTO proposal_line (proposal_id,dictionary_item_id,label,qty,unit_price) VALUES
    (v_pp1,v_di_freight,'Fret maritime 40ft x 40',40,2400000),
    (v_pp1,v_di_transit,'Commission de transit',40,350000);
  INSERT INTO proposal_narrative (proposal_id,section,body,sort_order) VALUES
    (v_pp1,'executive_summary','SmartLS propose une solution intégrée de fret maritime et dédouanement pour SABC.',0),
    (v_pp1,'scope','Enlèvement Anvers, transport maritime, dédouanement IM4, livraison Douala.',1);
  INSERT INTO proposal (doc_number,client_id,opportunity_id,title,status)
    VALUES ('SBX-PRP-0002',v_cl2,v_op2,'Transit ciment Dangote — offre','IN_REVIEW') RETURNING proposal_id INTO v_pp2;

  INSERT INTO success_story (title,dossier_id,summary,is_published,ai_generated)
    VALUES ('Dédouanement express pour Dangote',v_do2,'Réduction du délai de dédouanement de 30%.',true,true);
  INSERT INTO contact_enquiry (name,email,subject,message,status)
    VALUES ('Visiteur Web','prospect@example.cm','Demande de devis','Nous cherchons un transitaire pour import Chine.','NEW');
  INSERT INTO partnership_request (company_name,contact_name,email,proposal_text,status)
    VALUES ('AGL Cameroun','Direction','partenariat@agl.cm','Proposition de sous-traitance transport hinterland.','NEW');

  -- ==========================================================================
  -- 4. COMMERCIAL — costing, quotations, simulators
  -- ==========================================================================
  INSERT INTO costing (dossier_id,doc_number,margin_percent,status)
    VALUES (v_do1,'SBX-CST-0001',18.5,'APPROVED_LOCKED') RETURNING costing_id INTO v_co1;
  INSERT INTO costing_line (costing_id,dictionary_item_id,label,qty,unit_cost,is_debours) VALUES
    (v_co1,v_di_freight,'Fret maritime 40ft',40,2000000,false),
    (v_co1,v_di_customs,'Droits de douane',1,8500000,true),
    (v_co1,v_di_thc,'THC',40,180000,true);
  INSERT INTO costing (dossier_id,doc_number,margin_percent,status)
    VALUES (v_do3,'SBX-CST-0002',22.0,'SUBMITTED_FOR_VALIDATION') RETURNING costing_id INTO v_co2;
  INSERT INTO cost_entry (dossier_id,dictionary_item_id,category,amount) VALUES
    (v_do1,v_di_customs,'Débours douane',8500000),
    (v_do1,v_di_freight,'Fret',80000000);

  INSERT INTO quotation (doc_number,entity_id,client_id,dossier_id,costing_id,opportunity_id,margin_percent,total_ht,total_ttc,status,valid_until)
    VALUES ('SBX-QUO-0001',v_ent1,v_cl1,v_do1,v_co1,v_op1,18.5,94800000,112318500,'SENT',CURRENT_DATE+20) RETURNING quotation_id INTO v_q1;
  INSERT INTO quotation_line (quotation_id,dictionary_item_id,label,qty,unit_price,is_debours,tax_code_id,line_no) VALUES
    (v_q1,v_di_freight,'Fret maritime 40ft',40,2400000,false,v_tc_std,1),
    (v_q1,v_di_transit,'Commission de transit',40,350000,false,v_tc_std,2),
    (v_q1,v_di_customs,'Droits de douane (débours)',1,8500000,true,NULL,3);
  INSERT INTO quotation (doc_number,entity_id,client_id,dossier_id,margin_percent,total_ht,total_ttc,status,valid_until)
    VALUES ('SBX-QUO-0002',v_ent1,v_cl3,v_do3,22.0,26000000,30810000,'DRAFT',CURRENT_DATE+30) RETURNING quotation_id INTO v_q2;

  INSERT INTO margin_simulation (dossier_id,service_type_id,margin_percent,total_cost,total_price,currency)
    VALUES (v_do5,v_st_sea,20.0,15000000,18000000,'XAF') RETURNING margin_simulation_id INTO v_ms1;
  INSERT INTO margin_simulation_line (margin_simulation_id,dictionary_item_id,label,qty,unit_cost,unit_price) VALUES
    (v_ms1,v_di_freight,'Fret maritime',5,2000000,2400000),
    (v_ms1,v_di_handling,'Manutention',5,180000,220000);
  INSERT INTO extra_charge_simulation (dossier_id,shipping_line,container_variant,free_days,out_of_port_on,total_amount)
    VALUES (v_do1,'Maersk','40ft',7,CURRENT_DATE-2,450000);
  INSERT INTO pricing_variance (dossier_id,quotation_id,costing_id,quoted_price,actual_cost,variance_percent,flag)
    VALUES (v_do1,v_q1,v_co1,94800000,80000000,18.5,'GREEN');

  -- ==========================================================================
  -- 5. FINANCE (documents in pre-posting states; entry_id NULL — see header)
  -- ==========================================================================
  INSERT INTO invoice (entity_id,client_id,dossier_id,type,doc_number,service_ht,vat_total,total_ttc,status,payment_due_on,issued_by)
    VALUES (v_ent1,v_cl1,v_do1,'PROFORMA','SBX-PRO-0001',35000000,6737500,41737500,'ISSUED_LOCKED',CURRENT_DATE+15,NULL) RETURNING invoice_id INTO v_inv1;
  INSERT INTO invoice_line (invoice_id,dictionary_item_id,label,qty,unit_price,is_debours,tax_code_id,line_ht,line_no) VALUES
    (v_inv1,v_di_freight,'Fret maritime (acompte 50%)',1,35000000,false,v_tc_std,35000000,1);

  INSERT INTO invoice (entity_id,client_id,dossier_id,type,doc_number,service_ht,debours_total,vat_total,total_ttc,status,payment_due_on)
    VALUES (v_ent1,v_cl2,v_do2,'FINAL','SBX-INV-0001',12000000,8500000,2310000,22810000,'APPROVED_LOCKED',CURRENT_DATE-5) RETURNING invoice_id INTO v_inv2;
  INSERT INTO invoice_line (invoice_id,dictionary_item_id,label,qty,unit_price,is_debours,tax_code_id,line_ht,line_no) VALUES
    (v_inv2,v_di_transit,'Commission de transit',1,7000000,false,v_tc_std,7000000,1),
    (v_inv2,v_di_handling,'Manutention',1,5000000,false,v_tc_std,5000000,2),
    (v_inv2,v_di_customs,'Droits de douane (débours)',1,8500000,true,NULL,8500000,3);

  INSERT INTO invoice (entity_id,client_id,dossier_id,type,doc_number,service_ht,vat_total,total_ttc,status,payment_due_on)
    VALUES (v_ent1,v_cl3,v_do3,'FINAL','SBX-INV-0002',26000000,5005000,31005000,'DRAFT',CURRENT_DATE+30) RETURNING invoice_id INTO v_inv3;
  INSERT INTO invoice (entity_id,client_id,dossier_id,type,doc_number,service_ht,vat_total,total_ttc,status,payment_due_on)
    VALUES (v_ent1,v_cl1,v_do1,'FINAL','SBX-INV-0003',3000000,577500,3577500,'DRAFT',CURRENT_DATE-20) RETURNING invoice_id INTO v_inv4;

  INSERT INTO advance (client_id,dossier_id,amount,received_on,applied_amount)
    VALUES (v_cl1,v_do1,20000000,CURRENT_DATE-10,0);
  INSERT INTO payment_receipt (client_id,method,treasury_account_id,amount,received_on,status)
    VALUES (v_cl2,'BANK',v_tr_bank,15000000,CURRENT_DATE-3,'DRAFT') RETURNING receipt_id INTO v_inv1; -- reuse var slot
  INSERT INTO payment_allocation (receipt_id,invoice_id,amount) VALUES (v_inv1,v_inv2,15000000);

  INSERT INTO regie_advance (holder_user_id,amount,justified_amount,issued_on,policy_window_days,state)
    VALUES (NULL,2000000,500000,CURRENT_DATE-10,7,'PARTIALLY_JUSTIFIED');

  -- Fixed assets (feed fleet + depreciation)
  INSERT INTO asset (entity_id,tag,label,coa_asset_code,coa_depr_code,acquisition_cost,useful_life_months,acquired_on)
    VALUES (v_ent1,'SBX-AST-0001','Camion Renault Kerax (LT-4471)','245','2845',65000000,120,CURRENT_DATE-400) RETURNING asset_id INTO v_as_truck;
  INSERT INTO asset (entity_id,tag,label,coa_asset_code,coa_depr_code,acquisition_cost,useful_life_months,acquired_on)
    VALUES (v_ent1,'SBX-AST-0002','Camion Sinotruk (LT-5588)','245','2845',48000000,120,CURRENT_DATE-200) RETURNING asset_id INTO v_as_truck2;
  INSERT INTO asset (entity_id,tag,label,coa_asset_code,coa_depr_code,acquisition_cost,useful_life_months,acquired_on)
    VALUES (v_ent1,'SBX-AST-0003','Licence logiciel ERP','213',NULL,9000000,36,CURRENT_DATE-90) RETURNING asset_id INTO v_as_soft;
  INSERT INTO depreciation_schedule (asset_id,period_code,amount,posted) VALUES
    (v_as_truck,'2026-01',541666,false),
    (v_as_truck,'2026-02',541666,false);

  -- ==========================================================================
  -- 6. FLEET
  -- ==========================================================================
  INSERT INTO vehicle (entity_id,asset_id,registration,category,status)
    VALUES (v_ent1,v_as_truck,'LT-4471','truck','ACTIVE') RETURNING vehicle_id INTO v_veh1;
  INSERT INTO vehicle (entity_id,asset_id,registration,category,status)
    VALUES (v_ent1,v_as_truck2,'LT-5588','truck','ACTIVE') RETURNING vehicle_id INTO v_veh2;
  INSERT INTO vehicle (entity_id,registration,category,status)
    VALUES (v_ent1,'CE-2290','company_car','ACTIVE') RETURNING vehicle_id INTO v_veh3;
  INSERT INTO vehicle_compliance (vehicle_id,kind,expires_on) VALUES
    (v_veh1,'insurance',CURRENT_DATE+40),
    (v_veh1,'visite_technique',CURRENT_DATE+12),
    (v_veh2,'insurance',CURRENT_DATE-5);
  INSERT INTO fuel_log (vehicle_id,odometer,litres,cost,dossier_id) VALUES
    (v_veh1,124500,320,224000,v_do3),
    (v_veh1,125100,300,210000,v_do3),
    (v_veh2,88000,280,196000,NULL);
  INSERT INTO driver_license (employee_id,license_class,license_number,issued_on,expires_on)
    VALUES (v_emp5,'Poids lourd C/E','CM-DL-778812',CURRENT_DATE-800,CURRENT_DATE+25);
  INSERT INTO driver_license (employee_id,license_class,license_number,issued_on,expires_on)
    VALUES (v_emp6,'Poids lourd C','CM-DL-993410',CURRENT_DATE-500,CURRENT_DATE-10);
  INSERT INTO fleet_dispatch (vehicle_id,driver_employee_id,dossier_id,check_out_at,odometer_out,status)
    VALUES (v_veh1,v_emp5,v_do3,now()-interval '6 hours',124500,'OUT');
  INSERT INTO work_order (vehicle_id,kind,description,status,cost,opened_on)
    VALUES (v_veh2,'CORRECTIVE','Remplacement plaquettes de frein','IN_PROGRESS',350000,CURRENT_DATE-1) RETURNING work_order_id INTO v_wo1;
  INSERT INTO work_order_part (work_order_id,label,qty,unit_cost) VALUES (v_wo1,'Plaquettes de frein',4,45000);
  INSERT INTO fleet_incident (vehicle_id,driver_employee_id,occurred_at,description,severity,status)
    VALUES (v_veh1,v_emp5,now()-interval '20 days','Éraflure latérale au port','MINOR','UNDER_REVIEW');

  -- ==========================================================================
  -- 7. WAREHOUSE (WMS)
  -- ==========================================================================
  INSERT INTO warehouse_location (zone,aisle,rack,bin,capacity_units) VALUES ('A','01','R1','B1',100) RETURNING location_id INTO v_loc1;
  INSERT INTO warehouse_location (zone,aisle,rack,bin,capacity_units) VALUES ('A','01','R1','B2',100) RETURNING location_id INTO v_loc2;
  INSERT INTO warehouse_location (zone,yard,capacity_units) VALUES ('YARD','Y1',500) RETURNING location_id INTO v_loc3;
  INSERT INTO grn_inbound (dossier_id,qa_status,putaway_location) VALUES (v_do2,'PASSED',v_loc1);
  INSERT INTO inventory_item (sku,description,owner_client_id,dossier_id,location_id,qty_on_hand,uom,state)
    VALUES ('CLI-BRAS-001','Palettes malt (client)',v_cl1,v_do1,v_loc1,120,'pallet','AVAILABLE') RETURNING inventory_item_id INTO v_it1;
  INSERT INTO inventory_item (sku,description,owner_client_id,dossier_id,location_id,qty_on_hand,uom,state)
    VALUES ('CLI-DANG-001','Sacs ciment (client)',v_cl2,v_do2,v_loc3,4000,'bag','DISPATCHED') RETURNING inventory_item_id INTO v_it2;
  INSERT INTO stock_movement (inventory_item_id,movement_kind,qty,to_location) VALUES
    (v_it1,'INBOUND',120,v_loc1),
    (v_it2,'DISPATCH',4000,NULL);
  INSERT INTO outbound_order (dossier_id,client_id,status,dispatched_at)
    VALUES (v_do2,v_cl2,'DISPATCHED',now()-interval '2 days') RETURNING outbound_order_id INTO v_ob1;
  INSERT INTO outbound_line (outbound_order_id,inventory_item_id,qty,picked,packed) VALUES (v_ob1,v_it2,4000,true,true);
  INSERT INTO wms_equipment (label,status,location_id) VALUES ('Chariot élévateur 3T','IN_USE',v_loc1) RETURNING wms_equipment_id INTO v_eq1;
  INSERT INTO cycle_count (location_id,counted_by,discrepancy) VALUES (v_loc1,NULL,'{"expected":120,"counted":118}');

  -- ==========================================================================
  -- 8. PROCUREMENT
  -- ==========================================================================
  INSERT INTO purchase_request (doc_number,department,justification,status)
    VALUES ('SBX-PR-0001','Fleet','Achat pneus poids lourd','APPROVED') RETURNING pr_id INTO v_pr1;
  INSERT INTO purchase_order (pr_id,supplier_id,dossier_id,doc_number,expense_category,total_ttc,status)
    VALUES (v_pr1,v_sup3,NULL,'SBX-PO-0001','OVERHEAD',2400000,'ISSUED_LOCKED') RETURNING po_id INTO v_po1;
  INSERT INTO purchase_order_item (po_id,label,qty,unit_price) VALUES
    (v_po1,'Pneus 315/80 R22.5',6,400000);
  INSERT INTO goods_received_note (po_id,supplier_invoice_ref,three_way_matched)
    VALUES (v_po1,'FAC-TED-2026-114',true);

  -- ==========================================================================
  -- 9. HR
  -- ==========================================================================
  INSERT INTO payroll_component (code,name,kind,is_taxable,coa_code,is_system) VALUES
    ('BASE','Salaire de base','EARNING',true,'661',true),
    ('TRANSPORT_ALLOW','Prime de transport','EARNING',false,'661',false),
    ('CNPS_EE','CNPS retraite (salarié)','DEDUCTION',false,'4313',true),
    ('IRPP','IRPP + CAC','DEDUCTION',false,'4471',true)
    ON CONFLICT DO NOTHING;
  INSERT INTO payroll_run (entity_id,period_code,status)
    VALUES (v_ent1,'2026-06','COMPUTED') RETURNING payroll_run_id INTO v_run1;
  INSERT INTO payroll_run_item (payroll_run_id,employee_id,gross,net_pay,breakdown) VALUES
    (v_run1,v_emp1,2500000,1875000,'{"base":2500000,"cnps_ee":105000,"irpp":420000}'),
    (v_run1,v_emp2,1200000,948000,'{"base":1200000,"cnps_ee":50400,"irpp":150000}'),
    (v_run1,v_emp5,420000,378000,'{"base":420000,"cnps_ee":17640,"irpp":12000}');
  INSERT INTO leave_request (employee_id,kind,starts_on,ends_on,amount,status) VALUES
    (v_emp4,'leave',CURRENT_DATE+7,CURRENT_DATE+14,NULL,'REQUESTED'),
    (v_emp3,'salary_advance',CURRENT_DATE,CURRENT_DATE,300000,'APPROVED');
  INSERT INTO attendance_log (employee_id,clock_in_at,clock_out_at) VALUES
    (v_emp3,now()-interval '9 hours',now()-interval '1 hour'),
    (v_emp7,now()-interval '8 hours',now()-interval '30 minutes');
  INSERT INTO vacancy (title,department,description,status,posted_to_website)
    VALUES ('Déclarant en douane','Operations','Poste basé à Douala, 3+ ans d''expérience.','OPEN',true) RETURNING vacancy_id INTO v_vac1;
  INSERT INTO job_applicant (vacancy_id,full_name,email,status)
    VALUES (v_vac1,'Sandrine Manga','s.manga@example.cm','SHORTLISTED') RETURNING applicant_id INTO v_app1;
  INSERT INTO hr_contract (employee_id,kind,effective_on,status)
    VALUES (v_emp4,'EMPLOYMENT',CURRENT_DATE-365,'SIGNED');
  INSERT INTO kpi_target (employee_id,set_by,period_code,metric,target_value,weight)
    VALUES (v_emp4,NULL,'2026-06','Chiffre d''affaires signé',50000000,40) RETURNING kpi_target_id INTO v_kpi1;
  INSERT INTO appraisal (kpi_target_id,employee_id,period_code,actual_value,rating,comments)
    VALUES (v_kpi1,v_emp4,'2026-06',42000000,3.8,'Bon trimestre, pipeline solide.');
  INSERT INTO sop_document (title,category,version_no) VALUES ('Procédure dédouanement IM4','Operations',2);
  INSERT INTO onboarding_checklist (employee_id,status) VALUES (v_emp8,'OPEN') RETURNING onboarding_checklist_id INTO v_onb1;
  INSERT INTO onboarding_item (onboarding_checklist_id,label,is_done) VALUES
    (v_onb1,'Signature du contrat',true),
    (v_onb1,'Compte email créé',true),
    (v_onb1,'Formation SIRH',false);
  INSERT INTO training (title,scheduled_on,facilitator,status)
    VALUES ('Sécurité en entrepôt',CURRENT_DATE+10,'HSE Cameroun','SCHEDULED') RETURNING training_id INTO v_trn1;
  INSERT INTO training_attendance (training_id,employee_id,attended) VALUES (v_trn1,v_emp7,false);
  INSERT INTO talent_pool (applicant_id,full_name,skills,notes)
    VALUES (v_app1,'Sandrine Manga','Douane, SYDONIA, anglais','Bon profil, à recontacter.');
  INSERT INTO succession_plan (role_title,incumbent_id,successor_id,readiness)
    VALUES ('Responsable Opérations',v_emp3,v_emp4,'1_2_years');

  RAISE NOTICE 'Sandbox seed complete: entity SBX + full business dataset.';
END
$seed$;
