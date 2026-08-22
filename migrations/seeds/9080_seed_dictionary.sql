-- ============================================================================
-- SEED (per tenant schema) — MOD-05 FINANCIAL DICTIONARY: service types, the
-- equipment/load registries, and the company's curated catalogue of operational
-- lines with their OHADA posting rules and Basic/Advanced/Full service tiers.
--
-- ── WHY A SEED AND NOT A MIGRATION ──────────────────────────────────────────
--
-- Every row here points at reference data that TENANT MIGRATIONS DO NOT
-- CONTAIN. `posting_rule.debit_account` is an FK to chart_of_accounts, which is
-- populated by 9000/9001; `posting_rule.tax_code_id` is an FK to tax_code,
-- populated by 9010. Seeds run AFTER the whole tenant migration set
-- (migrator.js: tenantSchema, then tenantSeeds), so a dictionary written as a
-- migration would resolve every one of those lookups against an empty table and
-- either abort on the FK or silently seed NULL accounts. The `9080` prefix puts
-- this file after 9001 (accounts) and 9010 (tax) in the same /^90/ tenant-seed
-- glob, which is the ordering the FKs need.
--
-- ── PROVENANCE ──────────────────────────────────────────────────────────────
--
-- The source is the live legacy MariaDB `financial_dictionary` table: 184 rows,
-- all ACTIVE, codes #-1001 to #-1184. Every line below carries its originating
-- legacy code(s) in `description`, so any row can be traced back to what the
-- company was actually using. 27 legacy rows are collapsed or merged away and
-- one is deleted outright, leaving 157; 19 lines are added for the families the
-- legacy set never had (warehousing, own-fleet inland, project cargo). 176
-- lines land.
--
-- ── THE TRANSFORMATION THIS ENCODES ─────────────────────────────────────────
--
-- BILLABLE IS NOT REVENUE. The legacy `cost_nature` enum called anything the
-- client pays for a CHARGEABLE_SERVICE, and the old UI read that as income.
-- It is not: a customs duty you advance and re-bill at cost is a DÉBOURS —
-- money through the business, never yours, and never in class 7. Of the 36
-- CHARGEABLE_SERVICE rows only seven are your own fee or commission (file
-- opening, documentation, commission on disbursements, import declaration fee,
-- extra legal work, service charges, lashing); the other 29 — customs
-- clearance, formalities, liquidation, evaluation, transit title T1, import and
-- export formalities, origin charges — become DISBURSEMENT. Dr 4731 / Cr 4011 on
-- the way in, Dr 4111 / Cr 4731 on the way out, no VAT on either leg.
--
-- DÉBOURS CARRY NO TAX CODE. Not "usually" — the ledger rejects it (§23.5,
-- assert_line_valid) and so does invoice_line (chk_disbursement_no_tax). The client
-- is shown the upstream supplier VAT as paid on their behalf, which is what
-- `disbursement_vat_transparent` records, and the forwarder retains none of it.
--
-- EQUIPMENT IS A RATE DIMENSION, NOT A LINE. Twelve legacy families were the
-- same charge duplicated per box size — Port Charges 20 and 40, THC,
-- Stevedoring, Yard Occupancy, Security Fees, Full and Empty Container
-- Handling, Container Maintenance, Customs Inspection, PAD, PAK, Scanning —
-- plus Ocean Freight, which was split three ways (base, Open Top, Flat Rack).
-- Each collapses to ONE line flagged `varies_by_equipment` (0632) and priced
-- per variant against the CONTAINER_TYPE registry seeded below. Rates
-- themselves are NOT seeded here — that is the Expense-Rate build.
--
-- WHAT IS PORTED VERSUS DERIVED. `is_billable`, `receipt_required`,
-- `receipt_source`, `justification_required` and `vat_treatment` are the
-- company's own answers and are carried across as written. `category`,
-- `is_disbursement`, `provider_kind`, `disbursement_vat_transparent` and the code are
-- derived, so they cannot drift from the direction a line was authored with.
-- `service_applicability` and `territory` are NOT ported as columns:
-- applicability now lives in service_type_dictionary_item, and the legacy JSON
-- is used to derive WHICH services each line belongs to, which is the only
-- record of that fact that exists. `is_negotiable` is dropped — negotiation
-- belongs to the Expense-Rate tab.
--
-- Three answers are deliberately NOT ported on the lines whose direction became
-- REVENUE: proof_source (your own fee is proven by your own invoice, not the
-- carrier's), is_billable, and an exempt/out-of-scope vat_treatment. Those were
-- recorded when the line was considered a pass-through and do not survive the
-- reclassification.
--
-- ── A NOTE ON POSTABILITY (why this file adds accounts) ─────────────────────
--
-- §23.3 is enforced in the database: `assert_line_valid` refuses a journal line
-- on an account whose `is_postable` is false, and the dictionary's own account
-- picker only lists postable leaves. 9001 seeds 605, 622, 628 and 638 as
-- non-postable GROUPINGS, so a posting rule naming one of them would pass its
-- FK, sit in the catalogue looking correct, and fail at the moment someone
-- posted against it — in a different module, much later. The postable children
-- added below (6051, 6221/6222, 6281/6282, 6381/6382/6383) are those families'
-- real leaves, following the 9001 house style. 624, 625, 661, 6053 and 6311 are
-- already postable and are used as-is.
--
-- ── IDEMPOTENCY ─────────────────────────────────────────────────────────────
--
-- Every INSERT is conflict-guarded. posting_rule has no unique key, so its
-- inserts also carry a NOT EXISTS guard on (item, context) — the bare
-- ON CONFLICT DO NOTHING alongside it is a no-op that keeps the static check
-- honest about intent. The staging tables are ON COMMIT DROP, so a re-run in
-- the same session starts clean. Re-running this file inserts nothing.
-- ============================================================================

-- ── 1. Chart-of-accounts leaves this catalogue binds to ─────────────────────
-- 275 "Dépôts et cautionnements versés" is a class-2 DEBIT account: a bank
-- caution or a permanent deposit is money you will get back, not a cost of the
-- period. Its 2-digit heading 27 is absent from 9000/9001, so both are added.
INSERT INTO chart_of_accounts (code,parent_code,label_fr,label_en,class,normal_balance,is_postable,requires_analytic) VALUES
  ('27',NULL,'Autres immobilisations financières','Other financial assets',2,'D',false,false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO chart_of_accounts (code,parent_code,label_fr,label_en,class,normal_balance,is_postable,requires_analytic) VALUES
  ('275','27','Dépôts et cautionnements versés','Deposits and guarantees paid',2,'D',true,false),
  ('6051','605','Fournitures de bureau et consommables','Office supplies and consumables',6,'D',true,false),
  ('6221','622','Loyers et charges locatives','Rent and rental charges',6,'D',true,false),
  ('6222','622','Locations de matériel et de véhicules','Equipment and vehicle hire',6,'D',true,true),
  ('6281','628','Télécommunications, internet et télématique','Telecom, internet and telematics',6,'D',true,false),
  ('6282','628','Eau, électricité et autres fluides','Water, electricity and utilities',6,'D',true,false),
  ('6381','638','Frais de mission et de déplacement','Travel and mission expenses',6,'D',true,false),
  ('6382','638','Publicité, marketing et relations publiques','Advertising, marketing and PR',6,'D',true,false),
  ('6383','638','Autres charges externes diverses','Sundry other external charges',6,'D',true,false)
ON CONFLICT (code) DO NOTHING;

-- ── 2. Equipment and load-mode registries (dictionary_ref) ──────────────────
-- Feet, not "GP". The people typing these say "un 40 pieds" and "un 40 HC" —
-- naming the registry after the carrier's own jargon is how a dropdown stops
-- being read twice. `extra` carries the machine-readable size so a future rate
-- import can match "40HC" without parsing a display label. Open Top and Flat
-- Rack are here because the legacy Ocean Freight (OT) and (FR) rows were
-- exactly that: an equipment variant smuggled into a line name.
INSERT INTO dictionary_ref (kind, code, name_fr, name_en, extra, sort_order, is_system) VALUES
  ('CONTAINER_TYPE','FT20','20''','20''','{"teu":1,"size":"20"}'::jsonb,10,true),
  ('CONTAINER_TYPE','FT40','40''','40''','{"teu":2,"size":"40"}'::jsonb,20,true),
  ('CONTAINER_TYPE','FT40HC','40'' HC','40'' HC','{"teu":2,"size":"40HC"}'::jsonb,30,true),
  ('CONTAINER_TYPE','FT45HC','45'' HC','45'' HC','{"teu":2.25,"size":"45HC"}'::jsonb,40,true),
  ('CONTAINER_TYPE','FLATRACK','Flat Rack','Flat Rack','{"special":true}'::jsonb,50,true),
  ('CONTAINER_TYPE','OPENTOP','Open Top','Open Top','{"special":true}'::jsonb,60,true),
  ('CONTAINER_TYPE','REEFER','Reefer (Frigo)','Reefer','{"special":true,"powered":true}'::jsonb,70,true),
  ('CONTAINER_TYPE','ISOTANK','ISO Tank','ISO Tank','{"special":true}'::jsonb,80,true),
  ('CONTAINER_TYPE','VENTILATED','Ventilé','Ventilated','{"special":true}'::jsonb,90,true),
  ('CONTAINER_TYPE','BULK','Vrac','Bulk','{"special":true}'::jsonb,100,true),
  ('LOAD_MODE','FCL','Conteneur complet (FCL)','Full container load (FCL)','{}'::jsonb,10,true),
  ('LOAD_MODE','LCL','Groupage (LCL)','Less than container load (LCL)','{}'::jsonb,20,true),
  ('LOAD_MODE','RORO','Roulier (RoRo)','Roll-on roll-off (RoRo)','{}'::jsonb,30,true),
  ('LOAD_MODE','BREAKBULK','Conventionnel (break-bulk)','Break-bulk','{}'::jsonb,40,true),
  ('LOAD_MODE','CHARTER','Affrètement','Charter','{}'::jsonb,50,true)
ON CONFLICT (kind, code) DO NOTHING;

-- Two subcategories the curated set needs and 0630 did not seed.
INSERT INTO dictionary_ref (kind, code, name_fr, name_en, sort_order, is_system) VALUES
  ('SUBCATEGORY','BANK_FINANCE','Banque et finance','Bank and finance',195,true),
  ('SUBCATEGORY','DOCUMENTATION','Documentation et titres','Documentation and titles',105,true)
ON CONFLICT (kind, code) DO NOTHING;

-- ── 3. Service types (MOD-29 taxonomy) ──────────────────────────────────────
-- `territory` is where the service happens, which is why it lives here and not
-- on the dictionary line: the same THC charge is import territory on Monday and
-- export territory on Tuesday, and only the SERVICE knows which. The values are
-- the legacy `territory` enum, which is why TRANSIT_HINTERLAND and
-- PORT_AIRPORT_ZONE appear — they came from the company's own data.
INSERT INTO service_type (key, name_fr, name_en, territory, is_system) VALUES
  ('SEA_FREIGHT_IMPORT','Fret Maritime Import','Sea Freight Import','INTERNATIONAL_IMPORT',true),
  ('SEA_FREIGHT_EXPORT','Fret Maritime Export','Sea Freight Export','INTERNATIONAL_EXPORT',true),
  ('AIR_FREIGHT_IMPORT','Fret Aérien Import','Air Freight Import','INTERNATIONAL_IMPORT',true),
  ('AIR_FREIGHT_EXPORT','Fret Aérien Export','Air Freight Export','INTERNATIONAL_EXPORT',true),
  ('HINTERLAND_TRANSIT','Transit Hinterland','Hinterland Transit','TRANSIT_HINTERLAND',true),
  ('INLAND_TRANSPORTATION','Transport Terrestre','Inland Transportation','DOMESTIC_INLAND',true),
  ('WAREHOUSING','Entreposage','Warehousing','DOMESTIC_INLAND',true),
  ('END_TO_END_AIR_FREIGHT','Fret Aérien Porte-à-Porte','End-to-End Air Freight','END_TO_END_INTERNATIONAL',true),
  ('END_TO_END_SEA_FREIGHT','Fret Maritime Porte-à-Porte','End-to-End Sea Freight','END_TO_END_INTERNATIONAL',true),
  ('BUSINESS_REPRESENTATION','Représentation Commerciale','Business Representation','DOMESTIC_INLAND',true),
  ('CUSTOMS_BROKERAGE','Dédouanement','Customs Brokerage','PORT_AIRPORT_ZONE',true),
  ('PROJECT_CARGO','Cargaison Spéciale','Project & Break-bulk','END_TO_END_INTERNATIONAL',true),
  ('RAIL_TRANSPORTATION','Transport Ferroviaire','Rail Transportation','DOMESTIC_INLAND',true),
  ('RAIL_HINTERLAND_TRANSIT','Transit Ferroviaire Hinterland','Rail Hinterland Transit','TRANSIT_HINTERLAND',true),
  ('END_TO_END_RAIL_FREIGHT','Fret Ferroviaire Porte-à-Porte','End-to-End Rail Freight','END_TO_END_INTERNATIONAL',true)
ON CONFLICT (key) DO NOTHING;

-- ── 4. Staging ──────────────────────────────────────────────────────────────
-- The catalogue is authored ONCE into a staging table and everything else is
-- derived from it: the code, the category, the posting rules, the tiers. That is
-- what keeps 176 lines reviewable — a reviewer reads one row per charge and
-- checks a handful of set-based rules, instead of 176 hand-written triples.
--
-- ON COMMIT DROP because the migrator runs each seed file inside one explicit
-- transaction (migrator.js applyTracked) and reuses the connection for the next
-- file. The whole file therefore commits atomically, which is also what lets the
-- DEFERRABLE `trg_dict_needs_rule` see the rules: items are inserted first and
-- rules second, and the check that every item has at least one rule runs at
-- COMMIT.
CREATE TEMP TABLE _tax_ref (
  name        text PRIMARY KEY,
  tax_code_id uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE _dict_seed (
  key                    text PRIMARY KEY,
  label_fr               text NOT NULL,
  label_en               text NOT NULL,
  direction              text NOT NULL,   -- REVENUE | EXPENSE | DISBURSEMENT | ASSET
  subcategory            text NOT NULL,   -- dictionary_ref kind SUBCATEGORY
  applicability_mode     text NOT NULL,   -- SERVICE_SCOPED | ANY_OPERATIONS | NON_OPERATIONAL
  unit_of_measure        text,            -- dictionary_ref kind UNIT (NULL when the variant carries it)
  is_billable            boolean NOT NULL,
  proof_source           text,            -- dictionary_ref kind PROOF_SOURCE
  receipt_requirement    text NOT NULL,
  requires_justification boolean NOT NULL,
  vat                    text NOT NULL,   -- STD | STD_T (transport input) | ZERO (export) | NONE
  account                text,            -- debit for EXPENSE/ASSET, credit for REVENUE, NULL for DISBURSEMENT
  svc                    text[] NOT NULL, -- service_type.key list this line applies to
  tier_default           text NOT NULL,   -- tier when the line is not in a BASIC set
  legacy_codes           text,            -- originating legacy row(s), NULL for a new line
  varies                 boolean NOT NULL DEFAULT false,
  description            text,
  code                   text
) ON COMMIT DROP;

CREATE TEMP TABLE _dict_basic (
  service_key text NOT NULL,
  item_key    text NOT NULL,
  PRIMARY KEY (service_key, item_key)
) ON COMMIT DROP;

-- Tax codes are REFERENCED, never seeded here (9010 owns them, effective-dated).
-- DISTINCT ON takes the current version per code, which is what a posting rule
-- written today should bind to.
INSERT INTO _tax_ref (name, tax_code_id)
SELECT DISTINCT ON (tc.code::text) tc.code::text, tc.tax_code_id
  FROM tax_code tc
  JOIN tax_jurisdiction tj ON tj.jurisdiction_id = tc.jurisdiction_id
 WHERE tj.country_code = 'CM'
   AND tc.code IN ('TVA_STD','TVA_EXPORT','TVA_INPUT_PURCH','TVA_INPUT_TRANSPORT')
 ORDER BY tc.code::text, tc.effective_from DESC
ON CONFLICT (name) DO NOTHING;

-- ── 5. The catalogue ────────────────────────────────────────────────────────
-- One row per charge, grouped by direction. `legacy_codes` is the audit trail:
-- one code is a straight carry-across, several codes mean that many legacy rows
-- collapsed into this one, and NULL marks a line the legacy set never had.

INSERT INTO _dict_seed (direction,key,label_fr,label_en,subcategory,applicability_mode,unit_of_measure,is_billable,proof_source,receipt_requirement,requires_justification,vat,account,svc,tier_default,legacy_codes) SELECT 'REVENUE', * FROM (VALUES
 ('DISBURSEMENT_COMMISSION','Commissions sur Débours','Commissions on Disbursement','AGENCY_FEE','ANY_OPERATIONS','DOSSIER',true,'INTERNAL_SERVICE','ALWAYS_REQUIRED',true,'STD','7061','{SEA_FREIGHT_IMPORT,SEA_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,AIR_FREIGHT_EXPORT,HINTERLAND_TRANSIT,INLAND_TRANSPORTATION,WAREHOUSING,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,BUSINESS_REPRESENTATION,CUSTOMS_BROKERAGE,PROJECT_CARGO,RAIL_TRANSPORTATION,RAIL_HINTERLAND_TRANSIT,END_TO_END_RAIL_FREIGHT}'::text[],'ADVANCED','#-1094'),
 ('DOCUMENTATION_FEE','Frais de dossier','Documentation Fee','DOCUMENTATION','ANY_OPERATIONS','DOSSIER',true,'INTERNAL_SERVICE','ALWAYS_REQUIRED',true,'STD','7061','{SEA_FREIGHT_IMPORT,SEA_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,AIR_FREIGHT_EXPORT,HINTERLAND_TRANSIT,INLAND_TRANSPORTATION,WAREHOUSING,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,BUSINESS_REPRESENTATION,CUSTOMS_BROKERAGE,PROJECT_CARGO,RAIL_TRANSPORTATION,RAIL_HINTERLAND_TRANSIT,END_TO_END_RAIL_FREIGHT}'::text[],'ADVANCED','#-1153,#-1020'),
 ('EXTRA_LEGAL_WORK','Travail Extra-Légal','Extra Legal Work','AGENCY_FEE','ANY_OPERATIONS','DOSSIER',true,'INTERNAL_SERVICE','ALWAYS_REQUIRED',true,'STD','7061','{SEA_FREIGHT_IMPORT,SEA_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,AIR_FREIGHT_EXPORT,HINTERLAND_TRANSIT,INLAND_TRANSPORTATION,WAREHOUSING,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,BUSINESS_REPRESENTATION,CUSTOMS_BROKERAGE,PROJECT_CARGO,RAIL_TRANSPORTATION,RAIL_HINTERLAND_TRANSIT,END_TO_END_RAIL_FREIGHT}'::text[],'ADVANCED','#-1057'),
 ('FILE_OPENING','Ouverture de dossier','File Opening','AGENCY_FEE','ANY_OPERATIONS','DOSSIER',true,'INTERNAL_SERVICE','CONDITIONALLY_REQUIRED',true,'STD','7061','{SEA_FREIGHT_IMPORT,SEA_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,AIR_FREIGHT_EXPORT,HINTERLAND_TRANSIT,INLAND_TRANSPORTATION,WAREHOUSING,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,BUSINESS_REPRESENTATION,CUSTOMS_BROKERAGE,PROJECT_CARGO,RAIL_TRANSPORTATION,RAIL_HINTERLAND_TRANSIT,END_TO_END_RAIL_FREIGHT}'::text[],'ADVANCED','#-1088'),
 ('IMPORT_DECLARATION_FEE','Frais de DI','Import Declaration Fee','AGENCY_FEE','ANY_OPERATIONS','DOSSIER',true,'INTERNAL_SERVICE','CONDITIONALLY_REQUIRED',false,'STD','7061','{SEA_FREIGHT_IMPORT,SEA_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,AIR_FREIGHT_EXPORT,HINTERLAND_TRANSIT,INLAND_TRANSPORTATION,WAREHOUSING,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,BUSINESS_REPRESENTATION,CUSTOMS_BROKERAGE,PROJECT_CARGO,RAIL_TRANSPORTATION,RAIL_HINTERLAND_TRANSIT,END_TO_END_RAIL_FREIGHT}'::text[],'ADVANCED','#-1167'),
 ('INVENTORY_MANAGEMENT','Gestion des stocks','Inventory Management','STORAGE','SERVICE_SCOPED','DOSSIER',true,'INTERNAL_SERVICE','NOT_REQUIRED',false,'STD','7063','{WAREHOUSING}'::text[],'ADVANCED',NULL),
 ('LASHING','Arrimage','Lashing','HANDLING','SERVICE_SCOPED',NULL,true,'INTERNAL_SERVICE','CONDITIONALLY_REQUIRED',false,'STD','7063','{BUSINESS_REPRESENTATION,INLAND_TRANSPORTATION,WAREHOUSING}'::text[],'ADVANCED','#-1130'),
 ('ORDER_PICKING','Préparation de commandes','Order Picking','HANDLING','SERVICE_SCOPED','UNIT',true,'INTERNAL_SERVICE','NOT_REQUIRED',false,'STD','7063','{WAREHOUSING}'::text[],'FULL',NULL),
 ('RAIL_FREIGHT','Fret ferroviaire','Rail Freight','RAIL','SERVICE_SCOPED',NULL,true,'INTERNAL_SERVICE','ALWAYS_REQUIRED',true,'STD','7061','{RAIL_TRANSPORTATION,RAIL_HINTERLAND_TRANSIT,END_TO_END_RAIL_FREIGHT}'::text[],'BASIC',NULL),
 ('RAIL_SHUNTING_FEE','Frais de manœuvre et gare','Rail Shunting & Station Fee','HANDLING','SERVICE_SCOPED',NULL,true,'INTERNAL_SERVICE','ALWAYS_REQUIRED',true,'STD','7061','{RAIL_TRANSPORTATION,RAIL_HINTERLAND_TRANSIT,END_TO_END_RAIL_FREIGHT}'::text[],'ADVANCED',NULL),
 ('RAIL_TERMINAL_HANDLING','Manutention terminal ferroviaire','Railhead Terminal Handling','HANDLING','SERVICE_SCOPED',NULL,true,'INTERNAL_SERVICE','ALWAYS_REQUIRED',true,'STD','7061','{RAIL_TRANSPORTATION,RAIL_HINTERLAND_TRANSIT,END_TO_END_RAIL_FREIGHT}'::text[],'BASIC',NULL),
 ('REPACKAGING','Reconditionnement','Repackaging','HANDLING','SERVICE_SCOPED','UNIT',true,'INTERNAL_SERVICE','NOT_REQUIRED',false,'STD','7063','{WAREHOUSING}'::text[],'FULL',NULL),
 ('SERVICE_CHARGES','Frais de service','Service Charges','AGENCY_FEE','ANY_OPERATIONS','DOSSIER',true,'INTERNAL_SERVICE','ALWAYS_REQUIRED',true,'STD','7071','{SEA_FREIGHT_IMPORT,SEA_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,AIR_FREIGHT_EXPORT,HINTERLAND_TRANSIT,INLAND_TRANSPORTATION,WAREHOUSING,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,BUSINESS_REPRESENTATION,CUSTOMS_BROKERAGE,PROJECT_CARGO,RAIL_TRANSPORTATION,RAIL_HINTERLAND_TRANSIT,END_TO_END_RAIL_FREIGHT}'::text[],'ADVANCED','#-1108'),
 ('WAREHOUSE_STORAGE_DAY','Magasinage par jour','Storage per Day','STORAGE','SERVICE_SCOPED','DAY',true,'INTERNAL_SERVICE','CONDITIONALLY_REQUIRED',false,'STD','7063','{WAREHOUSING}'::text[],'ADVANCED',NULL),
 ('WAREHOUSE_HANDLING_IN','Manutention entrée entrepôt','Warehouse Handling In','HANDLING','SERVICE_SCOPED','TON',true,'INTERNAL_SERVICE','CONDITIONALLY_REQUIRED',false,'STD','7063','{WAREHOUSING}'::text[],'ADVANCED',NULL),
 ('WAREHOUSE_HANDLING_OUT','Manutention sortie entrepôt','Warehouse Handling Out','HANDLING','SERVICE_SCOPED','TON',true,'INTERNAL_SERVICE','CONDITIONALLY_REQUIRED',false,'STD','7063','{WAREHOUSING}'::text[],'ADVANCED',NULL)
) AS v(key,label_fr,label_en,subcategory,applicability_mode,unit_of_measure,is_billable,proof_source,receipt_requirement,requires_justification,vat,account,svc,tier_default,legacy_codes)
ON CONFLICT (key) DO NOTHING;

INSERT INTO _dict_seed (direction,key,label_fr,label_en,subcategory,applicability_mode,unit_of_measure,is_billable,proof_source,receipt_requirement,requires_justification,vat,account,svc,tier_default,legacy_codes) SELECT 'ASSET', * FROM (VALUES
 ('BANK_CAUTION','Caution Bancaire','Bank Caution','BANK_FINANCE','ANY_OPERATIONS',NULL,false,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'NONE','275','{SEA_FREIGHT_IMPORT,SEA_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,AIR_FREIGHT_EXPORT,HINTERLAND_TRANSIT,INLAND_TRANSPORTATION,WAREHOUSING,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,BUSINESS_REPRESENTATION,CUSTOMS_BROKERAGE,PROJECT_CARGO,RAIL_TRANSPORTATION,RAIL_HINTERLAND_TRANSIT,END_TO_END_RAIL_FREIGHT}'::text[],'ADVANCED','#-1090'),
 ('PERMANENT_DEPOSIT_FEES','Frais sur Caution Permanente','Permanent Deposit Fees (PDF)','BANK_FINANCE','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','ALWAYS_REQUIRED',true,'NONE','275','{END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1033')
) AS v(key,label_fr,label_en,subcategory,applicability_mode,unit_of_measure,is_billable,proof_source,receipt_requirement,requires_justification,vat,account,svc,tier_default,legacy_codes)
ON CONFLICT (key) DO NOTHING;

INSERT INTO _dict_seed (direction,key,label_fr,label_en,subcategory,applicability_mode,unit_of_measure,is_billable,proof_source,receipt_requirement,requires_justification,vat,account,svc,tier_default,legacy_codes) SELECT 'EXPENSE', * FROM (VALUES
 ('ACCOUNT_OPENING','Ouverture de Compte','Account Opening','BANK_FINANCE','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'NONE','6311','{HINTERLAND_TRANSIT}'::text[],'FULL','#-1091'),
 ('BANK_CHARGES','Frais de Banque','Bank Charges','BANK_FINANCE','ANY_OPERATIONS',NULL,true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD','6311','{SEA_FREIGHT_IMPORT,SEA_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,AIR_FREIGHT_EXPORT,HINTERLAND_TRANSIT,INLAND_TRANSPORTATION,WAREHOUSING,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,BUSINESS_REPRESENTATION,CUSTOMS_BROKERAGE,PROJECT_CARGO,RAIL_TRANSPORTATION,RAIL_HINTERLAND_TRANSIT,END_TO_END_RAIL_FREIGHT}'::text[],'ADVANCED','#-1089'),
 ('CLEANING_AGENT','Agent d''entretien','Cleaning Services','OTHER','NON_OPERATIONAL',NULL,false,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'STD','6383','{}'::text[],'ADVANCED','#-1015'),
 ('COMPUTER','Ordinateurs','Computers','OTHER','NON_OPERATIONAL',NULL,false,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD','6051','{}'::text[],'ADVANCED','#-1009'),
 ('CONVOY_SECURITY','Sécurité du convoi','Convoy Security','ESCORT','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD','6271','{PROJECT_CARGO,HINTERLAND_TRANSIT,RAIL_HINTERLAND_TRANSIT}'::text[],'ADVANCED',NULL),
 ('CRANE_LIFTING','Grutage et levage','Crane and Lifting','HANDLING','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD','6211','{PROJECT_CARGO}'::text[],'ADVANCED',NULL),
 ('DRIVER_ALLOWANCE','Indemnité de route chauffeur','Driver Allowance','TRUCKING','SERVICE_SCOPED','UNIT',false,'INTERNAL_SERVICE','ALWAYS_REQUIRED',true,'NONE','6381','{INLAND_TRANSPORTATION,HINTERLAND_TRANSIT}'::text[],'ADVANCED',NULL),
 ('ELECTRICITY','Facture Electricité','Electricity','UTILITIES','NON_OPERATIONAL',NULL,false,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD','6282','{}'::text[],'ADVANCED','#-1002'),
 ('FACILITY_PAYMENT','Négociation Douane','Facility Payment (Customs)','CUSTOMS_DUTIES','ANY_OPERATIONS','DOSSIER',false,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD','6383','{SEA_FREIGHT_IMPORT,SEA_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,AIR_FREIGHT_EXPORT,HINTERLAND_TRANSIT,INLAND_TRANSPORTATION,WAREHOUSING,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,BUSINESS_REPRESENTATION,CUSTOMS_BROKERAGE,PROJECT_CARGO,RAIL_TRANSPORTATION,RAIL_HINTERLAND_TRANSIT,END_TO_END_RAIL_FREIGHT}'::text[],'ADVANCED','#-1110'),
 ('FINANCIAL_CONSULTANT','Consultant Financier','Financial Consultant','OTHER','NON_OPERATIONAL',NULL,false,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD','6321','{}'::text[],'ADVANCED','#-1011'),
 ('FUEL','Carburant','Fuel','TRUCKING','SERVICE_SCOPED','UNIT',false,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD','6053','{INLAND_TRANSPORTATION,HINTERLAND_TRANSIT}'::text[],'ADVANCED',NULL),
 ('GPS_TRACKING','Suivi GPS et télématique','GPS and Tracking','TRUCKING','SERVICE_SCOPED','UNIT',false,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',false,'STD','6281','{INLAND_TRANSPORTATION,HINTERLAND_TRANSIT}'::text[],'ADVANCED',NULL),
 ('GATE_PASS_FEE','Saisie du ticket de livraison','Gate-Pass Fee','OTHER','SERVICE_SCOPED',NULL,false,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',false,'STD','6383','{END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1165'),
 ('HEAVY_LIFT_ESCORT','Escorte de colis lourds','Heavy-lift Escort','ESCORT','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD','6271','{PROJECT_CARGO}'::text[],'ADVANCED',NULL),
 ('INK','Achat d''encre','Ink','OTHER','NON_OPERATIONAL',NULL,false,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD','6051','{}'::text[],'ADVANCED','#-1006'),
 ('INTERNET','Facture internet','Internet','UTILITIES','NON_OPERATIONAL',NULL,false,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD','6281','{}'::text[],'ADVANCED','#-1004'),
 ('MARKETING','Campagnes Marketing / Frais de Publicité','Marketing Campaign / Promotional Expenses','OTHER','NON_OPERATIONAL',NULL,false,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD','6382','{}'::text[],'ADVANCED','#-1133'),
 ('MISCELLANEOUS_EXPENSES','Autres Dépenses','Miscellaneous Expenses','HANDLING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'STD','6383','{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1102'),
 ('MISSION_ALLOWANCE','Frais de mission','Mission Allowance','OTHER','NON_OPERATIONAL',NULL,false,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'STD','6381','{}'::text[],'ADVANCED','#-1132,#-1159'),
 ('OFFICE_EQUIPMENT_MAINTENANCE','Réparation des appareils de bureau','Office Equipment Maintenance','OTHER','NON_OPERATIONAL',NULL,false,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD','624','{}'::text[],'ADVANCED','#-1013'),
 ('OFFICE_MAINTENANCE','Travaux de maintenance des bureaux','Office Maintenance','OTHER','NON_OPERATIONAL',NULL,false,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'STD','624','{}'::text[],'ADVANCED','#-1014'),
 ('OFFICE_SUPPLIES','Fournitures Matériel de Bureau','Office Supplies and Furniture','HANDLING','NON_OPERATIONAL',NULL,true,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'STD','6051','{}'::text[],'ADVANCED','#-1103'),
 ('OOG_SURCHARGE','Surcharge hors gabarit (OOG)','Out-of-Gauge (OOG) Surcharge','OCEAN_FREIGHT','SERVICE_SCOPED','UNIT',true,'CARRIER_AIRLINE','ALWAYS_REQUIRED',true,'STD_T','6111','{PROJECT_CARGO,SEA_FREIGHT_IMPORT,SEA_FREIGHT_EXPORT,END_TO_END_SEA_FREIGHT}'::text[],'ADVANCED',NULL),
 ('PAPER','Achat de papier','Paper','OTHER','NON_OPERATIONAL',NULL,false,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD','6051','{}'::text[],'ADVANCED','#-1005'),
 ('HAULAGE_PER_KM','Transport routier au kilomètre','Per-km Haulage','TRUCKING','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD_T','6131','{INLAND_TRANSPORTATION,HINTERLAND_TRANSIT}'::text[],'ADVANCED',NULL),
 ('PRINTER','Imprimantes','Printers','OTHER','NON_OPERATIONAL',NULL,false,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'STD','6051','{}'::text[],'ADVANCED','#-1012'),
 ('OFFICE_RENT','Loyer','Rent','RENT','NON_OPERATIONAL',NULL,false,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'NONE','6221','{}'::text[],'ADVANCED','#-1008'),
 ('SALARIES','Salaires','Salaries','SALARIES','NON_OPERATIONAL',NULL,false,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD','661','{}'::text[],'ADVANCED','#-1007'),
 ('STAFF_EXPENSES','Dépenses sur personnel','Staff Expenses','SALARIES','NON_OPERATIONAL',NULL,false,'THIRD_PARTY_VENDOR','NOT_REQUIRED',false,'STD','661','{}'::text[],'ADVANCED','#-1001'),
 ('STAFF_TRANSPORTATION','Transport Employés','Staff Transportation','HANDLING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'STD','6383','{BUSINESS_REPRESENTATION,INLAND_TRANSPORTATION,WAREHOUSING}'::text[],'ADVANCED','#-1092'),
 ('STOCK_INSURANCE','Assurance des stocks','Stock Insurance','OTHER','SERVICE_SCOPED','DAY',true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'NONE','625','{WAREHOUSING}'::text[],'ADVANCED',NULL),
 ('PHONE','Téléphonie','Telephony','UTILITIES','NON_OPERATIONAL',NULL,false,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD','6281','{}'::text[],'ADVANCED','#-1010'),
 ('TOLLS_ROAD_FEES','Péages et taxes routières','Tolls and Road Fees','TRUCKING','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'NONE','6131','{INLAND_TRANSPORTATION,HINTERLAND_TRANSIT}'::text[],'ADVANCED',NULL),
 ('TRUCK_RENTAL','Location de camion','Truck Rental','TRUCKING','SERVICE_SCOPED','DAY',true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD','6222','{INLAND_TRANSPORTATION,HINTERLAND_TRANSIT,PROJECT_CARGO}'::text[],'ADVANCED',NULL),
 ('WAGON_DEMURRAGE','Immobilisation / Surestaries wagon','Wagon Demurrage','DEMURRAGE','SERVICE_SCOPED','DAY',true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD','6222','{RAIL_TRANSPORTATION,RAIL_HINTERLAND_TRANSIT,END_TO_END_RAIL_FREIGHT}'::text[],'ADVANCED',NULL),
 ('RAIL_ESCORT_FEE','Escorte et sécurité ferroviaire','Rail Escort & Security Fee','ESCORT','SERVICE_SCOPED','UNIT',true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD','6271','{RAIL_TRANSPORTATION,RAIL_HINTERLAND_TRANSIT,END_TO_END_RAIL_FREIGHT}'::text[],'ADVANCED',NULL),
 ('VEHICLE_MAINTENANCE','Entretien des véhicules','Vehicle Maintenance','TRUCKING','NON_OPERATIONAL','UNIT',false,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD','624','{}'::text[],'ADVANCED',NULL),
 ('WATER','Facture Eau','Water','UTILITIES','NON_OPERATIONAL',NULL,false,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD','6282','{}'::text[],'ADVANCED','#-1003')
) AS v(key,label_fr,label_en,subcategory,applicability_mode,unit_of_measure,is_billable,proof_source,receipt_requirement,requires_justification,vat,account,svc,tier_default,legacy_codes)
ON CONFLICT (key) DO NOTHING;

INSERT INTO _dict_seed (direction,key,label_fr,label_en,subcategory,applicability_mode,unit_of_measure,is_billable,proof_source,receipt_requirement,requires_justification,vat,account,svc,tier_default,legacy_codes) SELECT 'DISBURSEMENT', * FROM (VALUES
 ('ADDITIONAL_CODE_APEC','Code additionnel / APEC','Additional Code / APEC','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',false,'STD',NULL,'{BUSINESS_REPRESENTATION,INLAND_TRANSPORTATION,WAREHOUSING}'::text[],'FULL','#-1161'),
 ('ADDITIONAL_CODE_END','Code additionnel / END','Additional Code / END','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',false,'STD',NULL,'{AIR_FREIGHT_IMPORT,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1162'),
 ('AGENCY_DOCS_FEE','Frais d''agence et de documentation','Agency & Documentation Fee','DOCUMENTATION','SERVICE_SCOPED','BL',true,'CARRIER_AIRLINE','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT}'::text[],'ADVANCED','#-1024'),
 ('AWB_FEE','Frais de lettre de transport aérien (LTA)','Air Waybill (AWB) Fee','AIR_FREIGHT','SERVICE_SCOPED','BL',true,'CARRIER_AIRLINE','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,END_TO_END_AIR_FREIGHT}'::text[],'ADVANCED','#-1026'),
 ('ANCILLARY_CHARGES','Frais Supplémentaires','Ancillary Charges','HANDLING','ANY_OPERATIONS',NULL,true,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{SEA_FREIGHT_IMPORT,SEA_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,AIR_FREIGHT_EXPORT,HINTERLAND_TRANSIT,INLAND_TRANSPORTATION,WAREHOUSING,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,BUSINESS_REPRESENTATION,CUSTOMS_BROKERAGE,PROJECT_CARGO,RAIL_TRANSPORTATION,RAIL_HINTERLAND_TRANSIT,END_TO_END_RAIL_FREIGHT}'::text[],'FULL','#-1170'),
 ('MANUAL_EVALUATION_REQUEST','Demande d''Evaluation Manuelle','Application for Manual Evaluation','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'CARRIER_AIRLINE','ALWAYS_REQUIRED',true,'STD',NULL,'{END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT}'::text[],'FULL','#-1036'),
 ('STUFFING_REQUEST','Demande d''Empotage','Application for Stuffing','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT}'::text[],'FULL','#-1037'),
 ('CORRIDOR_AUTHORISATION','Autorisation de Circuler','Authorisation on corridor','TRUCKING','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',false,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1168'),
 ('BARC_EXEMPTION','Dérogation BARC','BARC Exemption','HANDLING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'NONE',NULL,'{HINTERLAND_TRANSIT}'::text[],'FULL','#-1157'),
 ('BORDER_CROSSING_FORMALITIES','Formalités à la Frontière','Border Crossing Formalities','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{CUSTOMS_BROKERAGE,HINTERLAND_TRANSIT,RAIL_HINTERLAND_TRANSIT,END_TO_END_RAIL_FREIGHT}'::text[],'ADVANCED','#-1076'),
 ('CAR_CUSTOMS_DECLARATION','Déclaration Centrafricaine','CAR Customs Declaration','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1038'),
 ('CHAD_CUSTOMS_DECLARATION','Déclaration Tchadienne','CHAD Customs Declaration','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{HINTERLAND_TRANSIT}'::text[],'ADVANCED','#-1039'),
 ('CMR_CUSTOMS_TAX','Quittance Douane Camerounaise','CMR Customs Tax','CUSTOMS_DUTIES','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1041'),
 ('CAMEROON_CUSTOMS_FORMALITIES','Formalités Douane Cameroun','Cameroon Customs Formalities','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{HINTERLAND_TRANSIT}'::text[],'ADVANCED','#-1152'),
 ('CARGO_PICKUP','Frais d''enlèvement','Cargo Pick-Up','TRUCKING','SERVICE_SCOPED',NULL,true,'CARRIER_AIRLINE','ALWAYS_REQUIRED',true,'NONE',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_IMPORT,END_TO_END_RAIL_FREIGHT}'::text[],'ADVANCED','#-1105'),
 ('CARGO_SURVEY','Inspection Cargaison','Cargo Survey','SURVEY','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1169'),
 ('CERTIFICATE_OF_CONFORMITY','Certificat de Conformité','Certificate of Conformity','CUSTOMS_INSPECTION','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{CUSTOMS_BROKERAGE,HINTERLAND_TRANSIT}'::text[],'ADVANCED','#-1040,#-1172'),
 ('COMMERCIAL_IMPORT_DECLARATION','Déclaration d''importation commerciale (DIC)','Commercial Import Declaration (DIC)','CUSTOMS_DUTIES','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{HINTERLAND_TRANSIT}'::text[],'ADVANCED','#-1145'),
 ('COMPUTER_TAX','Taxe Informatique','Computer Tax','CUSTOMS_DUTIES','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1042'),
 ('CONTAINER_CSC_CERTIFICATION','Certification CSC du Conteneur','Container CSC Certification','CUSTOMS_INSPECTION','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1043'),
 ('CONTAINER_CLEANING','Nettoyage du Conteneur','Container Cleaning','THC','SERVICE_SCOPED',NULL,false,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD',NULL,'{BUSINESS_REPRESENTATION,INLAND_TRANSPORTATION,WAREHOUSING}'::text[],'FULL','#-1016'),
 ('CONTAINER_DETENTION','Détention Conteneur','Container Detention','DEMURRAGE','SERVICE_SCOPED','DAY',true,'CARRIER_AIRLINE','ALWAYS_REQUIRED',true,'STD',NULL,'{END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1134'),
 ('CONTAINER_DOUBLE_HANDLING','Double Relevage','Container Double Handling','HANDLING','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1044'),
 ('CONTAINER_ENDORSEMENT','Endossement de Conteneur','Container Endorsement','THC','SERVICE_SCOPED',NULL,true,'CARRIER_AIRLINE','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1017'),
 ('CONTAINER_MAINTENANCE','Maintenance de conteneur','Container Maintenance','THC','SERVICE_SCOPED',NULL,true,'CARRIER_AIRLINE','ALWAYS_REQUIRED',true,'STD',NULL,'{END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1018,#-1019'),
 ('CONTAINER_REGISTRATION','Enregistrement Conteneur','Container Registration','THC','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',false,'NONE',NULL,'{END_TO_END_SEA_FREIGHT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1160'),
 ('CUSTOMS_BOARDING_ECOR','Autorisation d''Embarquement des Douanes - ECOR','Customs Boarding Authorization - ECOR','CUSTOMS_INSPECTION','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1045'),
 ('CUSTOMS_CLEARANCE','Frais de Dédouanement','Customs Clearance','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1046'),
 ('DECLARATION_PROCESSING','Validation Déclaration','Customs Declaration Processing','TRUCKING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD',NULL,'{BUSINESS_REPRESENTATION,INLAND_TRANSPORTATION,WAREHOUSING}'::text[],'ADVANCED','#-1083'),
 ('CUSTOMS_DUTIES_TAXES','Droits et Taxes Douanières','Customs Duties & Taxes','CUSTOMS_DUTIES','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1047'),
 ('CUSTOMS_DUTIES_AT_DESTINATION','Droits de Douane à Destination','Customs Duties at Destination','CUSTOMS_DUTIES','SERVICE_SCOPED','DOSSIER',true,'PORT_TERMINAL','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1080'),
 ('CUSTOMS_EVALUATION','Evaluation Manuelle','Customs Evaluation','CUSTOMS_INSPECTION','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1048'),
 ('CUSTOMS_FORMALITIES','Formalités Douanières','Customs Formalities','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1049'),
 ('CUSTOMS_INSPECTION','Frais d''inspection douanière','Customs Inspection','CUSTOMS_INSPECTION','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1113,#-1114'),
 ('CUSTOMS_LIQUIDATION','Liquidation Douanière','Customs Liquidation','CUSTOMS_DUTIES','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_IMPORT,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1050'),
 ('MANIFEST_AMENDMENT','Correction/Modification du Manifeste','Customs Manifest Amendment','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1051'),
 ('MANIFEST_REACTIVATION','Réactivation du Manifeste','Customs Manifest Reactivation','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1052'),
 ('CUSTOMS_PENALTY','Pénalités Douanières','Customs Penalty','CUSTOMS_DUTIES','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1053'),
 ('CUSTOMS_TEL','TEL douanes','Customs TEL','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1066'),
 ('DELIVERY_AT_DESTINATION','Livraison à Destination','Delivery at Destination','TRUCKING','SERVICE_SCOPED',NULL,false,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_IMPORT,BUSINESS_REPRESENTATION,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,INLAND_TRANSPORTATION,WAREHOUSING,RAIL_TRANSPORTATION,END_TO_END_RAIL_FREIGHT}'::text[],'ADVANCED','#-1093'),
 ('DEMURRAGE','Surestaries','Demurrage','DEMURRAGE','SERVICE_SCOPED',NULL,true,'CARRIER_AIRLINE','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1021'),
 ('DOCUMENT_AUTHENTICATION','Légalisation Document','Document Authentication','DOCUMENTATION','ANY_OPERATIONS','DOSSIER',true,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',true,'NONE',NULL,'{SEA_FREIGHT_IMPORT,SEA_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,AIR_FREIGHT_EXPORT,HINTERLAND_TRANSIT,INLAND_TRANSPORTATION,WAREHOUSING,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,BUSINESS_REPRESENTATION,CUSTOMS_BROKERAGE,PROJECT_CARGO,RAIL_TRANSPORTATION,RAIL_HINTERLAND_TRANSIT,END_TO_END_RAIL_FREIGHT}'::text[],'FULL','#-1164'),
 ('DROP_OFF_SESSION','Frais de restitution (drop-off)','Drop-Off Fee','OCEAN_FREIGHT','SERVICE_SCOPED',NULL,true,'CARRIER_AIRLINE','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1025'),
 ('ECTN_BESC','Frais de création du BESC / ECTN','ECTN/BESC Processing Fee','HANDLING','SERVICE_SCOPED','BL',true,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'NONE',NULL,'{BUSINESS_REPRESENTATION,CUSTOMS_BROKERAGE,INLAND_TRANSPORTATION,WAREHOUSING}'::text[],'ADVANCED','#-1096'),
 ('EMBASSY_CAUTION','Caution Ambassade','Embassy Caution','BANK_FINANCE','SERVICE_SCOPED',NULL,false,NULL,'NOT_REQUIRED',false,'NONE',NULL,'{HINTERLAND_TRANSIT}'::text[],'FULL','#-1131'),
 ('EMPTY_CONTAINER_HANDLING','Retour de conteneur vide','Empty Container Handling','HANDLING','SERVICE_SCOPED',NULL,true,'CARRIER_AIRLINE','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1022,#-1023'),
 ('EMPTY_CONTAINER_PICKUP','Relevage Conteneur Vide','Empty Container Pick-up','HANDLING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT}'::text[],'ADVANCED','#-1142'),
 ('EMPTY_TRANSFER_TO_STUFFING','Transfert du Vide vers Site d''Empotage','Empty Transfer to Stuffing Site','TRUCKING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT}'::text[],'FULL','#-1112'),
 ('CARGO_HANDLING','Manutention (équipement / marchandise)','Equipment & Cargo Handling','HANDLING','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,END_TO_END_AIR_FREIGHT}'::text[],'ADVANCED','#-1115'),
 ('ESCORT','Escorte','Escort','ESCORT','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD',NULL,'{BUSINESS_REPRESENTATION,INLAND_TRANSPORTATION,WAREHOUSING}'::text[],'ADVANCED','#-1067'),
 ('EXONERATION_CERTIFICATE','Certificat d''exonération','Exemption Certificate','HANDLING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'NONE',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1097'),
 ('EXONERATION_PROCESSING','Traitement Exonération','Exoneration Processing','CUSTOMS_DUTIES','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{HINTERLAND_TRANSIT}'::text[],'FULL','#-1148'),
 ('EXPORT_DECLARATION','Déclaration Export','Export Declaration','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT}'::text[],'ADVANCED','#-1138'),
 ('EXPORT_FORMALITIES','Formalités Export','Export Formalities','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{AIR_FREIGHT_EXPORT,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_EXPORT}'::text[],'ADVANCED','#-1179'),
 ('FINAL_DESTINATION_CHARGES','Frais à destination finale','Final Destination Charges','OCEAN_FREIGHT','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'NONE',NULL,'{SEA_FREIGHT_IMPORT,AIR_FREIGHT_IMPORT,END_TO_END_SEA_FREIGHT,END_TO_END_AIR_FREIGHT,HINTERLAND_TRANSIT,PROJECT_CARGO}'::text[],'ADVANCED',NULL),
 ('FINAL_DESTINATION_CLEARANCE','Formalités Douanes à Destination','Final Destination Clearance','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',true,'NONE',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1054'),
 ('FORMALITIES_IN_CHAD','Formalités au Tchad','Formalities in Chad','HANDLING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'NONE',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1178'),
 ('FORMULA_1','Formule 1 (déclaration de change)','Formula 1 (exchange declaration)','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT}'::text[],'FULL','#-1058'),
 ('FULL_CONTAINER_HANDLING','Manutention de conteneur plein','Full Container Handling','HANDLING','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1116,#-1117'),
 ('GPS_FEES_INSTALLATION','Frais GPS + Installation','GPS Fees + Installation','ESCORT','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{HINTERLAND_TRANSIT}'::text[],'ADVANCED','#-1059'),
 ('GUCE_FEES','Frais GUCE (guichet unique)','GUCE Single-Window Fees','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{CUSTOMS_BROKERAGE,HINTERLAND_TRANSIT}'::text[],'ADVANCED','#-1055'),
 ('GOODS_EXIT_FEES','Droit de Sortie Marchandise','Goods Exit Fees','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'NONE',NULL,'{END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_EXPORT}'::text[],'FULL','#-1180'),
 ('GOODS_IMPORT_TAXES','Redevance Marchandise Import','Goods Import Taxes','OCEAN_FREIGHT','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{HINTERLAND_TRANSIT}'::text[],'FULL','#-1149'),
 ('GUARANTEE_ACCOUNT_FEES','Frais Compte Garant','Guarantee Account Fees','BANK_FINANCE','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'STD',NULL,'{END_TO_END_SEA_FREIGHT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1174'),
 ('GUARANTEE_LETTER_AUTH','Lettre de Garantie Authentification','Guarantee Letter Authentification','HANDLING','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1099'),
 ('TRANSPORT_ABECHE_ALGENEINA','Transport Abéché – Al Geneina','Haulage Abéché – Al Geneina','TRUCKING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'NONE',NULL,'{AIR_FREIGHT_IMPORT,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1177'),
 ('TRANSPORT_DOUALA_ABECHE','Transport Douala – Abéché','Haulage Douala – Abéché','TRUCKING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'NONE',NULL,'{AIR_FREIGHT_IMPORT,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1176'),
 ('HINTERLAND_TRANSPORT_DOCS','Documents de Transport Hinterland','Hinterland Transportation Documents','TRUCKING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'NONE',NULL,'{BUSINESS_REPRESENTATION,INLAND_TRANSPORTATION,WAREHOUSING}'::text[],'ADVANCED','#-1086'),
 ('ICD_EXIT_FORMALITIES','Formalités Sortie Port Sec','ICD Exit Formalities','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'STD',NULL,'{CUSTOMS_BROKERAGE,HINTERLAND_TRANSIT}'::text[],'FULL','#-1078'),
 ('LICENCE_RENEWAL','Renouvellement Licence d''Emportation / Exportation','Import / Export License Renewal','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1061'),
 ('IMPORT_DECLARATION','Déclaration d''Importation','Import Declaration','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'STD',NULL,'{CUSTOMS_BROKERAGE,HINTERLAND_TRANSIT}'::text[],'ADVANCED','#-1060'),
 ('IMPORT_FORMALITIES','Formalites Import','Import Formalities','HANDLING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1100'),
 ('INLAND_FREIGHT','Transport terrestre','Inland Freight','TRUCKING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1139,#-1140,#-1141'),
 ('INSPECTION_FEES','Frais de Visite','Inspection Fees','CUSTOMS_INSPECTION','SERVICE_SCOPED',NULL,true,NULL,'NOT_REQUIRED',false,'STD',NULL,'{END_TO_END_SEA_FREIGHT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1171'),
 ('LATE_DO_RELEASE','Retrait Tardif du BAD','Late Delivery Order Release','OCEAN_FREIGHT','SERVICE_SCOPED',NULL,true,'CARRIER_AIRLINE','ALWAYS_REQUIRED',true,'NONE',NULL,'{AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1028'),
 ('LOADING_AUTHORIZATION','Demande de Chargement','Loading Authorization','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',true,'NONE',NULL,'{HINTERLAND_TRANSIT}'::text[],'FULL','#-1175'),
 ('LOADING_ON_TRUCK','Chargement sur Camion','Loading on truck','HANDLING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,INLAND_TRANSPORTATION,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1155'),
 ('LOCAL_INSURANCE','Assurance','Local Insurance','DECLARATION','ANY_OPERATIONS','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{SEA_FREIGHT_IMPORT,SEA_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,AIR_FREIGHT_EXPORT,HINTERLAND_TRANSIT,INLAND_TRANSPORTATION,WAREHOUSING,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,BUSINESS_REPRESENTATION,CUSTOMS_BROKERAGE,PROJECT_CARGO,RAIL_TRANSPORTATION,RAIL_HINTERLAND_TRANSIT,END_TO_END_RAIL_FREIGHT}'::text[],'ADVANCED','#-1062'),
 ('MARITIME_EXPERT_FEES','Frais d''Expertise Maritime','Maritime Expert Fees','SURVEY','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,PROJECT_CARGO,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1101'),
 ('NEXUS_FEES','Frais NEXUS','NEXUS Fees','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{CUSTOMS_BROKERAGE,HINTERLAND_TRANSIT}'::text[],'FULL','#-1074'),
 ('OCEAN_FREIGHT','Fret maritime','Ocean Freight','OCEAN_FREIGHT','SERVICE_SCOPED',NULL,true,'CARRIER_AIRLINE','ALWAYS_REQUIRED',true,'STD',NULL,'{END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1027,#-1182,#-1183'),
 ('OFFLOADING','Déchargement','Offloading','TRUCKING','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{CUSTOMS_BROKERAGE,HINTERLAND_TRANSIT,INLAND_TRANSPORTATION}'::text[],'ADVANCED','#-1081'),
 ('OFFLOADING_AT_DESTINATION','Déchargement à Destination','Offloading at Destination','HANDLING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{BUSINESS_REPRESENTATION,INLAND_TRANSPORTATION,WAREHOUSING}'::text[],'FULL','#-1095'),
 ('ORIGIN_CHARGES','Charges à l''origine','Origin Charges','HANDLING','SERVICE_SCOPED',NULL,false,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD',NULL,'{BUSINESS_REPRESENTATION,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,INLAND_TRANSPORTATION,WAREHOUSING,END_TO_END_RAIL_FREIGHT}'::text[],'ADVANCED','#-1104,#-1184'),
 ('OTHER_CUSTOMS_CHARGES','Autres Frais Douaniers','Other Customs Charges','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'NONE',NULL,'{BUSINESS_REPRESENTATION,INLAND_TRANSPORTATION,WAREHOUSING}'::text[],'FULL','#-1063'),
 ('OVERWEIGHT_PENALTY','Pénalité Pont Bascule','Overweight Penalty','TRUCKING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1085'),
 ('OWN_WHEEL_TRANSPORT','Transport sur roues','Own Wheel Transportation','TRUCKING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'NONE',NULL,'{HINTERLAND_TRANSIT,PROJECT_CARGO}'::text[],'ADVANCED','#-1087,#-1154'),
 -- proof_source PORT_TERMINAL (not CARRIER_AIRLINE): PAD is the Douala port
 -- authority, not a shipping line — provider_kind is derived from this column
 -- below (step 8), and the two must agree with PAK_FEES' classification.
 ('PAD_FEES','Frais PAD (Port Autonome de Douala)','PAD Fees (Douala Port Authority)','THC','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1029,#-1030'),
 ('PAK_FEES','Frais PAK (Port Autonome de Kribi)','PAK Fees (Kribi Port Authority)','THC','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1031,#-1032'),
 ('PK26_DRY_PORT_FEES','Passage Port Sec PK26','PK 26 Dry Port Fees','THC','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','ALWAYS_REQUIRED',true,'NONE',NULL,'{HINTERLAND_TRANSIT}'::text[],'FULL','#-1144'),
 ('PK26_TERMINAL_FEES','Frais Port Sec PK26','PK 26 Terminal Fees','THC','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'NONE',NULL,'{AIR_FREIGHT_IMPORT,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1181'),
 ('PENALTY_MISSING_COC','Pénalité Défaut Certificat de Conformité','Penalty for Missing COC','CUSTOMS_DUTIES','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1064'),
 ('PENALTY_MISSING_RVC','Pénalité défaut de RVC','Penalty for Missing RVC','CUSTOMS_DUTIES','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1071'),
 ('PHYTOSANITARY_INSPECTION','Inspection Phytosanitaire','Phyto-sanitary Inspection','CUSTOMS_INSPECTION','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',true,'NONE',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1065'),
 ('PORT_ACCESS','Accès portuaire','Port Access','THC','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1118'),
 ('PORT_CHARGES','Charges portuaires','Port Charges','THC','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1119,#-1120'),
 ('PORT_EXIT_FORMALITIES','Formalités de Sortie Portuaires','Port Exit Formalities','HANDLING','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',true,'NONE',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1098'),
 ('PORT_STORAGE','Stationnement (magasinage portuaire)','Port Storage','STORAGE','SERVICE_SCOPED','DAY',true,'PORT_TERMINAL','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1121'),
 ('POA_AUTHENTICATION','Authentification Procuration','Power of Attorney Authentification','HANDLING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'NONE',NULL,'{BUSINESS_REPRESENTATION,INLAND_TRANSPORTATION,WAREHOUSING}'::text[],'ADVANCED','#-1106'),
 ('DPIV_DECLARATION','Déclaration préalable d''importation de valeurs (DPIV)','Prior Import Value Declaration (DPIV)','CUSTOMS_DUTIES','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{HINTERLAND_TRANSIT}'::text[],'FULL','#-1146'),
 ('RAIL_CORRIDOR_LEVY','Redevance corridor ferroviaire','Rail Corridor Levy','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',false,'STD',NULL,'{RAIL_HINTERLAND_TRANSIT}'::text[],'ADVANCED',NULL),
 ('RECEPTION_HANDLING_TRANSFER','Réception, Manutention et Transfert au Terminal','Reception, Handling & Transfer to Terminal','HANDLING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT}'::text[],'ADVANCED','#-1107'),
 ('SMADE_LEVY','Redevance SMADE','SMADE Levy','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',false,'STD',NULL,'{AIR_FREIGHT_IMPORT,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1163'),
 ('SCANNING_FEES','Frais de scanner','Scanning Fees','SCANNING','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'STD',NULL,'{END_TO_END_SEA_FREIGHT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1072,#-1135,#-1136'),
 ('SECURITY_FEES','Frais de sécurité','Security Fees','THC','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1128,#-1129'),
 ('SHIPPING_LINE_CHARGES','Frais de la ligne maritime','Shipping Line Charges','OCEAN_FREIGHT','SERVICE_SCOPED',NULL,true,'CARRIER_AIRLINE','ALWAYS_REQUIRED',true,'NONE',NULL,'{END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1034,#-1035,#-1150'),
 ('STAMP','Timbre','Stamp','OTHER','ANY_OPERATIONS',NULL,false,'GOVERNMENT_AUTHORITY','CONDITIONALLY_REQUIRED',false,'STD',NULL,'{SEA_FREIGHT_IMPORT,SEA_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,AIR_FREIGHT_EXPORT,HINTERLAND_TRANSIT,INLAND_TRANSPORTATION,WAREHOUSING,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,BUSINESS_REPRESENTATION,CUSTOMS_BROKERAGE,PROJECT_CARGO,RAIL_TRANSPORTATION,RAIL_HINTERLAND_TRANSIT,END_TO_END_RAIL_FREIGHT}'::text[],'ADVANCED','#-1166'),
 ('STEVEDORING','Manutention portuaire (acconage)','Stevedoring','HANDLING','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1126,#-1127,#-1079'),
 ('STUFFING_CERTIFICATE','Certificat d''Empotage','Stuffing Certificate','CUSTOMS_INSPECTION','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'NONE',NULL,'{CUSTOMS_BROKERAGE,HINTERLAND_TRANSIT}'::text[],'FULL','#-1068'),
 ('STUFFING_OPERATIONS','Opérations d''Empotage','Stuffing Operations','HANDLING','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1069'),
 ('STUFFING_REPORT','Rapport d''empotage','Stuffing Report','CUSTOMS_INSPECTION','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'STD',NULL,'{END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT}'::text[],'FULL','#-1056'),
 ('TEL_TRANSIT','Titre TEL de transit','TEL Transit','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'STD',NULL,'{HINTERLAND_TRANSIT}'::text[],'ADVANCED','#-1073'),
 ('TECHNICAL_VISA','Visa Technique','Technical Visa','HANDLING','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1070'),
 ('TEMPORAL_ADMISSION','Admission Temporaire','Temporal Admission','CUSTOMS_DUTIES','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{HINTERLAND_TRANSIT}'::text[],'FULL','#-1147'),
 ('THC','Charges terminal à conteneur (THC)','Terminal Handling Charges (THC)','THC','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1122,#-1123'),
 ('TRANSPORTATION','Transport terrestre (tiers)','Third-party Trucking','TRUCKING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1082'),
 ('TRANSFER_TO_ICD','Transfert Port Sec','Transfer to ICD','TRUCKING','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{CUSTOMS_BROKERAGE,HINTERLAND_TRANSIT}'::text[],'FULL','#-1077'),
 ('TRANSFER_TO_PORT','Transfert au Port','Transfer to Port','TRUCKING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD',NULL,'{BUSINESS_REPRESENTATION,INLAND_TRANSPORTATION,WAREHOUSING}'::text[],'ADVANCED','#-1111'),
 ('TRANSIT_TITLE_T1','Titre de Transit (T1)','Transit Title (T1)','DECLARATION','SERVICE_SCOPED','DOSSIER',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'STD',NULL,'{CUSTOMS_BROKERAGE,HINTERLAND_TRANSIT}'::text[],'ADVANCED','#-1075'),
 ('TRANSPORT_AUTHORISATION','Autorisation de Transport (Ministère de Transport)','Transport Authorisation (Ministry of Transport)','TRUCKING','SERVICE_SCOPED',NULL,true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,PROJECT_CARGO,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT,RAIL_TRANSPORTATION,RAIL_HINTERLAND_TRANSIT,END_TO_END_RAIL_FREIGHT}'::text[],'ADVANCED','#-1158'),
 ('TRANSPORT_TO_STUFFING_SITE','Tranfert vers le site d''empotage','Transport to Stuffing Site','TRUCKING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD',NULL,'{BUSINESS_REPRESENTATION,INLAND_TRANSPORTATION,WAREHOUSING}'::text[],'FULL','#-1109'),
 ('TRANSSHIPMENT','Transbordement','Transshipment','HANDLING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',true,'STD',NULL,'{BUSINESS_REPRESENTATION,INLAND_TRANSPORTATION,WAREHOUSING}'::text[],'ADVANCED','#-1143'),
 ('TRUCK_IMMOBILISATION','Immobilisation Camion','Truck Immobilisation','TRUCKING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','CONDITIONALLY_REQUIRED',false,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1173'),
 ('WEIGHBRIDGE_FINE','Pénalités Pont Bascule','Weighbridge Fine','HANDLING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD',NULL,'{END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1156'),
 ('WEIGHING_CHARGES','Station de Pesage','Weighing Charges','TRUCKING','SERVICE_SCOPED',NULL,true,'THIRD_PARTY_VENDOR','ALWAYS_REQUIRED',true,'STD',NULL,'{END_TO_END_SEA_FREIGHT,INLAND_TRANSPORTATION,SEA_FREIGHT_EXPORT}'::text[],'ADVANCED','#-1084'),
 ('YARD_MANAGEMENT_FEE','Prestation Gestion du Parc','Yard Management Fee','STORAGE','SERVICE_SCOPED','DAY',true,'GOVERNMENT_AUTHORITY','ALWAYS_REQUIRED',true,'NONE',NULL,'{END_TO_END_SEA_FREIGHT,HINTERLAND_TRANSIT,SEA_FREIGHT_IMPORT}'::text[],'FULL','#-1151'),
 ('YARD_OCCUPANCY','Encombrement (occupation de terre-plein)','Yard Occupancy','STORAGE','SERVICE_SCOPED',NULL,true,'PORT_TERMINAL','ALWAYS_REQUIRED',true,'STD',NULL,'{AIR_FREIGHT_EXPORT,AIR_FREIGHT_IMPORT,CUSTOMS_BROKERAGE,END_TO_END_AIR_FREIGHT,END_TO_END_SEA_FREIGHT,SEA_FREIGHT_EXPORT,SEA_FREIGHT_IMPORT}'::text[],'ADVANCED','#-1124,#-1125')
) AS v(key,label_fr,label_en,subcategory,applicability_mode,unit_of_measure,is_billable,proof_source,receipt_requirement,requires_justification,vat,account,svc,tier_default,legacy_codes)
ON CONFLICT (key) DO NOTHING;


-- ── 6. Derived attributes on the staging set ────────────────────────────────

-- The families the legacy catalogue duplicated per box size, plus the
-- three-way Ocean Freight split. One line each, priced per CONTAINER_TYPE.
UPDATE _dict_seed SET varies = true WHERE key IN (
  'PORT_CHARGES','THC','STEVEDORING','DEMURRAGE','YARD_OCCUPANCY','SECURITY_FEES',
  'CONTAINER_MAINTENANCE','EMPTY_CONTAINER_HANDLING','FULL_CONTAINER_HANDLING',
  'PAD_FEES','PAK_FEES','SCANNING_FEES','CUSTOMS_INSPECTION','SHIPPING_LINE_CHARGES',
  'OCEAN_FREIGHT','ORIGIN_CHARGES','FINAL_DESTINATION_CHARGES');

-- Provenance, recorded where the next person will look for it: the legacy code
-- or name they remember has to lead them to the surviving line.
UPDATE _dict_seed SET description = concat_ws(' ',
  CASE WHEN varies THEN
    'Ligne à variantes : le tarif dépend du type équipement (registre CONTAINER_TYPE). '
    || 'Variant-bearing line, priced per equipment variant on the Expense-Rate tab.'
  END,
  CASE
    WHEN legacy_codes IS NULL THEN
      'Nouvelle ligne, famille absente du dictionnaire hérité. New line, family absent from the legacy catalogue.'
    WHEN strpos(legacy_codes, ',') > 0 THEN
      'Fusion des anciennes lignes ' || legacy_codes || '. Merged from legacy rows ' || legacy_codes || '.'
    ELSE 'Ancienne ligne ' || legacy_codes || '. Legacy row ' || legacy_codes || '.'
  END);

-- ── 7. Mint the codes ───────────────────────────────────────────────────────
-- "#<L><NNN>", L from direction, serial per letter — the same format
-- financial_dictionary.rules.formatCode mints at runtime, so the service layer
-- carries on numbering after the seed instead of colliding with it. The legacy
-- #-#### codes are dropped: they encoded nothing and ran across all four
-- natures in one sequence.
UPDATE _dict_seed s SET code = m.new_code
  FROM (
    SELECT key,
           '#' || CASE direction
                    WHEN 'REVENUE' THEN 'R' WHEN 'EXPENSE' THEN 'E'
                    WHEN 'DISBURSEMENT' THEN 'D' ELSE 'A' END
               || lpad((row_number() OVER (PARTITION BY direction ORDER BY label_en))::text, 3, '0') AS new_code
      FROM _dict_seed
  ) m
 WHERE m.key = s.key;

-- ── 8. The catalogue rows ───────────────────────────────────────────────────
-- category, is_disbursement, provider_kind and disbursement_vat_transparent are DERIVED
-- from direction and proof_source, so they cannot drift from the nature the
-- line was authored with. The compliance answers (receipt_requirement,
-- requires_justification) and is_billable are the company's own and are carried
-- across as written.
INSERT INTO dictionary_item (
  code, label_fr, label_en, description, category, direction, subcategory,
  unit_of_measure, applicability_mode, is_disbursement, is_billable, currency,
  provider_kind, proof_source, requires_justification, receipt_requirement,
  disbursement_vat_transparent, varies_by_equipment, is_active)
SELECT
  s.code, s.label_fr, s.label_en, s.description,
  CASE s.direction WHEN 'DISBURSEMENT' THEN 'disbursement' WHEN 'REVENUE' THEN 'service'
                   WHEN 'ASSET' THEN 'asset' ELSE 'overhead' END,
  s.direction, s.subcategory, s.unit_of_measure, s.applicability_mode,
  s.direction = 'DISBURSEMENT', s.is_billable, 'XAF',
  CASE s.proof_source
    WHEN 'CARRIER_AIRLINE' THEN 'SHIPPING_LINE'
    WHEN 'PORT_TERMINAL' THEN 'PORT_TERMINAL'
    WHEN 'GOVERNMENT_AUTHORITY' THEN 'CUSTOMS_AUTHORITY'
    ELSE 'OTHER' END,
  s.proof_source, s.requires_justification, s.receipt_requirement,
  s.direction = 'DISBURSEMENT', s.varies, true
  FROM _dict_seed s
ON CONFLICT (code) DO NOTHING;

-- ── 9. Posting rules, generated by direction ────────────────────────────────
-- The NOT EXISTS guard is the idempotency key posting_rule does not have: the
-- table has no natural unique constraint (an item legitimately carries a sale
-- AND a purchase rule), so "already has a rule in this context" is the test.

-- DISBURSEMENT, purchase leg: the supplier invoice lands in the client's clearing
-- account, never in a class-6 charge. No tax code — §23.5.
INSERT INTO posting_rule (dictionary_item_id, applies_context, debit_account, credit_account, tax_code_id, is_disbursement)
SELECT di.dictionary_item_id, 'purchase', '4731', '4011', NULL, true
  FROM _dict_seed s
  JOIN dictionary_item di ON di.code = s.code
 WHERE s.direction = 'DISBURSEMENT'
   AND NOT EXISTS (SELECT 1 FROM posting_rule pr
                    WHERE pr.dictionary_item_id = di.dictionary_item_id
                      AND pr.applies_context = 'purchase')
ON CONFLICT DO NOTHING;

-- DISBURSEMENT, sale leg: re-billed at cost, clearing 4731 back out against the
-- client. Nothing touches class 7, because none of it is revenue.
INSERT INTO posting_rule (dictionary_item_id, applies_context, debit_account, credit_account, tax_code_id, is_disbursement)
SELECT di.dictionary_item_id, 'sale', '4111', '4731', NULL, true
  FROM _dict_seed s
  JOIN dictionary_item di ON di.code = s.code
 WHERE s.direction = 'DISBURSEMENT'
   AND NOT EXISTS (SELECT 1 FROM posting_rule pr
                    WHERE pr.dictionary_item_id = di.dictionary_item_id
                      AND pr.applies_context = 'sale')
ON CONFLICT DO NOTHING;

-- REVENUE: your fee, invoiced with output VAT (or zero-rated on an export of
-- services). The credit account comes from the staging row — 7061 commission,
-- 7071 re-billed ancillaries, 7063 logistics services sold.
INSERT INTO posting_rule (dictionary_item_id, applies_context, debit_account, credit_account, tax_code_id, is_disbursement)
SELECT di.dictionary_item_id, 'sale', '4111', s.account, t.tax_code_id, false
  FROM _dict_seed s
  JOIN dictionary_item di ON di.code = s.code
  LEFT JOIN _tax_ref t ON t.name = CASE s.vat WHEN 'ZERO' THEN 'TVA_EXPORT' WHEN 'STD' THEN 'TVA_STD' ELSE NULL END
 WHERE s.direction = 'REVENUE'
   AND NOT EXISTS (SELECT 1 FROM posting_rule pr
                    WHERE pr.dictionary_item_id = di.dictionary_item_id
                      AND pr.applies_context = 'sale')
ON CONFLICT DO NOTHING;

-- EXPENSE: your own cost against the supplier, with recoverable input VAT where
-- the charge carries it. Transport inputs use TVA_INPUT_TRANSPORT so the
-- recoverable side lands on 4453 rather than 4452.
INSERT INTO posting_rule (dictionary_item_id, applies_context, debit_account, credit_account, tax_code_id, is_disbursement)
SELECT di.dictionary_item_id, 'purchase', s.account, '4011', t.tax_code_id, false
  FROM _dict_seed s
  JOIN dictionary_item di ON di.code = s.code
  LEFT JOIN _tax_ref t ON t.name = CASE s.vat WHEN 'STD' THEN 'TVA_INPUT_PURCH' WHEN 'STD_T' THEN 'TVA_INPUT_TRANSPORT' ELSE NULL END
 WHERE s.direction = 'EXPENSE'
   AND NOT EXISTS (SELECT 1 FROM posting_rule pr
                    WHERE pr.dictionary_item_id = di.dictionary_item_id
                      AND pr.applies_context = 'purchase')
ON CONFLICT DO NOTHING;

-- ASSET: a refundable deposit is a class-2 balance, no VAT to recover on it.
INSERT INTO posting_rule (dictionary_item_id, applies_context, debit_account, credit_account, tax_code_id, is_disbursement)
SELECT di.dictionary_item_id, 'purchase', s.account, '4011', NULL, false
  FROM _dict_seed s
  JOIN dictionary_item di ON di.code = s.code
 WHERE s.direction = 'ASSET'
   AND NOT EXISTS (SELECT 1 FROM posting_rule pr
                    WHERE pr.dictionary_item_id = di.dictionary_item_id
                      AND pr.applies_context = 'purchase')
ON CONFLICT DO NOTHING;

-- ── 10. Service tiers ───────────────────────────────────────────────────────
-- BASIC is the everyday file: the lines that appear on almost every dossier of
-- that service, so a quote built at BASIC is already a usable quote. ADVANCED
-- adds what the same service needs when the file is not routine, FULL is the
-- long tail — penalties, manifest amendments and reactivations, one-off
-- certificates. The sets NEST (0630): pulling ADVANCED yields BASIC + ADVANCED.
--
-- Which services a line applies to comes from the legacy `service_applicability`
-- JSON where the company filled it in, and from the legacy `territory` where it
-- did not (104 of 184 rows left it empty). Those are the only two records of
-- that fact that exist.
INSERT INTO _dict_basic (service_key, item_key) VALUES
 ('AIR_FREIGHT_EXPORT','AWB_FEE'),('AIR_FREIGHT_EXPORT','CARGO_HANDLING'),('AIR_FREIGHT_EXPORT','CUSTOMS_FORMALITIES'),('AIR_FREIGHT_EXPORT','DOCUMENTATION_FEE'),('AIR_FREIGHT_EXPORT','CARGO_PICKUP'),('AIR_FREIGHT_EXPORT','FILE_OPENING'),
 ('AIR_FREIGHT_IMPORT','AWB_FEE'),('AIR_FREIGHT_IMPORT','CARGO_HANDLING'),('AIR_FREIGHT_IMPORT','CUSTOMS_DUTIES_TAXES'),('AIR_FREIGHT_IMPORT','CUSTOMS_CLEARANCE'),('AIR_FREIGHT_IMPORT','DELIVERY_AT_DESTINATION'),('AIR_FREIGHT_IMPORT','FILE_OPENING'),
 ('BUSINESS_REPRESENTATION','FILE_OPENING'),('BUSINESS_REPRESENTATION','SERVICE_CHARGES'),('BUSINESS_REPRESENTATION','DOCUMENTATION_FEE'),('BUSINESS_REPRESENTATION','EXTRA_LEGAL_WORK'),('BUSINESS_REPRESENTATION','DISBURSEMENT_COMMISSION'),
 ('CUSTOMS_BROKERAGE','CUSTOMS_CLEARANCE'),('CUSTOMS_BROKERAGE','CUSTOMS_FORMALITIES'),('CUSTOMS_BROKERAGE','CUSTOMS_DUTIES_TAXES'),('CUSTOMS_BROKERAGE','GUCE_FEES'),('CUSTOMS_BROKERAGE','ECTN_BESC'),('CUSTOMS_BROKERAGE','IMPORT_DECLARATION'),
 ('END_TO_END_AIR_FREIGHT','ORIGIN_CHARGES'),('END_TO_END_AIR_FREIGHT','AWB_FEE'),('END_TO_END_AIR_FREIGHT','CARGO_HANDLING'),('END_TO_END_AIR_FREIGHT','CUSTOMS_DUTIES_TAXES'),('END_TO_END_AIR_FREIGHT','CUSTOMS_CLEARANCE'),('END_TO_END_AIR_FREIGHT','FINAL_DESTINATION_CHARGES'),('END_TO_END_AIR_FREIGHT','DELIVERY_AT_DESTINATION'),('END_TO_END_AIR_FREIGHT','DOCUMENTATION_FEE'),('END_TO_END_AIR_FREIGHT','FILE_OPENING'),
 ('END_TO_END_SEA_FREIGHT','ORIGIN_CHARGES'),('END_TO_END_SEA_FREIGHT','OCEAN_FREIGHT'),('END_TO_END_SEA_FREIGHT','THC'),('END_TO_END_SEA_FREIGHT','PORT_CHARGES'),('END_TO_END_SEA_FREIGHT','CUSTOMS_DUTIES_TAXES'),('END_TO_END_SEA_FREIGHT','CUSTOMS_CLEARANCE'),('END_TO_END_SEA_FREIGHT','FINAL_DESTINATION_CHARGES'),('END_TO_END_SEA_FREIGHT','FINAL_DESTINATION_CLEARANCE'),('END_TO_END_SEA_FREIGHT','INLAND_FREIGHT'),('END_TO_END_SEA_FREIGHT','DELIVERY_AT_DESTINATION'),('END_TO_END_SEA_FREIGHT','DOCUMENTATION_FEE'),('END_TO_END_SEA_FREIGHT','FILE_OPENING'),
 ('HINTERLAND_TRANSIT','TRANSIT_TITLE_T1'),('HINTERLAND_TRANSIT','TEL_TRANSIT'),('HINTERLAND_TRANSIT','GPS_FEES_INSTALLATION'),('HINTERLAND_TRANSIT','BORDER_CROSSING_FORMALITIES'),('HINTERLAND_TRANSIT','TRANSPORTATION'),('HINTERLAND_TRANSIT','CUSTOMS_FORMALITIES'),
 ('INLAND_TRANSPORTATION','HAULAGE_PER_KM'),('INLAND_TRANSPORTATION','LOADING_ON_TRUCK'),('INLAND_TRANSPORTATION','OFFLOADING'),('INLAND_TRANSPORTATION','TOLLS_ROAD_FEES'),('INLAND_TRANSPORTATION','WEIGHING_CHARGES'),
 ('PROJECT_CARGO','CRANE_LIFTING'),('PROJECT_CARGO','HEAVY_LIFT_ESCORT'),('PROJECT_CARGO','MARITIME_EXPERT_FEES'),('PROJECT_CARGO','TRANSPORT_AUTHORISATION'),('PROJECT_CARGO','OOG_SURCHARGE'),('PROJECT_CARGO','OWN_WHEEL_TRANSPORT'),
 ('RAIL_TRANSPORTATION','RAIL_FREIGHT'),('RAIL_TRANSPORTATION','RAIL_TERMINAL_HANDLING'),('RAIL_TRANSPORTATION','DOCUMENTATION_FEE'),('RAIL_TRANSPORTATION','FILE_OPENING'),('RAIL_TRANSPORTATION','DELIVERY_AT_DESTINATION'),
 ('RAIL_HINTERLAND_TRANSIT','RAIL_FREIGHT'),('RAIL_HINTERLAND_TRANSIT','RAIL_TERMINAL_HANDLING'),('RAIL_HINTERLAND_TRANSIT','TRANSIT_TITLE_T1'),('RAIL_HINTERLAND_TRANSIT','BORDER_CROSSING_FORMALITIES'),('RAIL_HINTERLAND_TRANSIT','CUSTOMS_FORMALITIES'),('RAIL_HINTERLAND_TRANSIT','DOCUMENTATION_FEE'),
 ('END_TO_END_RAIL_FREIGHT','ORIGIN_CHARGES'),('END_TO_END_RAIL_FREIGHT','CARGO_PICKUP'),('END_TO_END_RAIL_FREIGHT','RAIL_FREIGHT'),('END_TO_END_RAIL_FREIGHT','RAIL_TERMINAL_HANDLING'),('END_TO_END_RAIL_FREIGHT','FINAL_DESTINATION_CHARGES'),('END_TO_END_RAIL_FREIGHT','DELIVERY_AT_DESTINATION'),('END_TO_END_RAIL_FREIGHT','DOCUMENTATION_FEE'),('END_TO_END_RAIL_FREIGHT','FILE_OPENING'),
 ('SEA_FREIGHT_EXPORT','OCEAN_FREIGHT'),('SEA_FREIGHT_EXPORT','THC'),('SEA_FREIGHT_EXPORT','PORT_CHARGES'),('SEA_FREIGHT_EXPORT','STUFFING_OPERATIONS'),('SEA_FREIGHT_EXPORT','WEIGHING_CHARGES'),('SEA_FREIGHT_EXPORT','CUSTOMS_FORMALITIES'),('SEA_FREIGHT_EXPORT','DOCUMENTATION_FEE'),('SEA_FREIGHT_EXPORT','FILE_OPENING'),
 ('SEA_FREIGHT_IMPORT','OCEAN_FREIGHT'),('SEA_FREIGHT_IMPORT','THC'),('SEA_FREIGHT_IMPORT','PORT_CHARGES'),('SEA_FREIGHT_IMPORT','CUSTOMS_DUTIES_TAXES'),('SEA_FREIGHT_IMPORT','CUSTOMS_CLEARANCE'),('SEA_FREIGHT_IMPORT','DOCUMENTATION_FEE'),('SEA_FREIGHT_IMPORT','INLAND_FREIGHT'),('SEA_FREIGHT_IMPORT','FILE_OPENING'),
 ('WAREHOUSING','WAREHOUSE_STORAGE_DAY'),('WAREHOUSING','WAREHOUSE_HANDLING_IN'),('WAREHOUSING','WAREHOUSE_HANDLING_OUT'),('WAREHOUSING','INVENTORY_MANAGEMENT'),('WAREHOUSING','STOCK_INSURANCE')

ON CONFLICT (service_key, item_key) DO NOTHING;

INSERT INTO service_type_dictionary_item (service_type_id, dictionary_item_id, tier, sort_order)
SELECT st.service_type_id, di.dictionary_item_id, x.tier,
       CASE x.tier WHEN 'BASIC' THEN 100 WHEN 'ADVANCED' THEN 300 ELSE 500 END
         + row_number() OVER (PARTITION BY x.service_key, x.tier ORDER BY x.label_en)
  FROM (
    SELECT g.service_key, s.key AS item_key, s.label_en, s.code,
           CASE WHEN b.item_key IS NOT NULL THEN 'BASIC' ELSE s.tier_default END AS tier
      FROM _dict_seed s
      CROSS JOIN LATERAL unnest(s.svc) AS g(service_key)
      LEFT JOIN _dict_basic b ON b.service_key = g.service_key AND b.item_key = s.key
  ) x
  JOIN service_type st ON st.key = x.service_key
  JOIN dictionary_item di ON di.code = x.code
ON CONFLICT (service_type_id, dictionary_item_id) DO NOTHING;

-- service_type_key is the denormalised single-value hint 0630 kept alive for the
-- Service-Type 360 until PR2 finishes cutting it over to the join. Keep it in
-- step with the tiers rather than leaving it null: the first BASIC service of a
-- line is the one that answers "which service is this mainly for?", which is
-- exactly what financial_dictionary.rules.primaryServiceKey computes at runtime.
UPDATE dictionary_item di SET service_type_key = p.service_key
  FROM (
    SELECT DISTINCT ON (stdi.dictionary_item_id)
           stdi.dictionary_item_id, st.key AS service_key
      FROM service_type_dictionary_item stdi
      JOIN service_type st ON st.service_type_id = stdi.service_type_id
     ORDER BY stdi.dictionary_item_id,
              CASE stdi.tier WHEN 'BASIC' THEN 1 WHEN 'ADVANCED' THEN 2 ELSE 3 END,
              st.key
  ) p
 WHERE p.dictionary_item_id = di.dictionary_item_id
   AND di.service_type_key IS NULL
   AND di.code IN (SELECT code FROM _dict_seed);

-- ── 11. Guard rails ─────────────────────────────────────────────────────────
-- The §23.14 invariant is a DEFERRABLE trigger that fires at COMMIT, which is
-- correct but reports one item at a time and only once the whole file has run.
-- These say the same thing immediately, naming the line, so a mis-typed account
-- family in a future edit fails here with something a reader can act on.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(s.code || ' ' || s.label_en, ', ' ORDER BY s.code) INTO bad
    FROM _dict_seed s
    JOIN dictionary_item di ON di.code = s.code
   WHERE NOT EXISTS (SELECT 1 FROM posting_rule pr
                      WHERE pr.dictionary_item_id = di.dictionary_item_id
                        AND pr.debit_account IS NOT NULL
                        AND pr.credit_account IS NOT NULL);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'seed 9080: dictionary lines left without a complete posting rule: %', bad;
  END IF;

  -- §23.3: an account that is not postable makes every rule naming it a
  -- time-bomb that only goes off when someone posts. Fail here instead.
  SELECT string_agg(DISTINCT a.code, ', ') INTO bad
    FROM posting_rule pr
    JOIN dictionary_item di ON di.dictionary_item_id = pr.dictionary_item_id
    JOIN chart_of_accounts a ON a.code IN (pr.debit_account, pr.credit_account)
   WHERE di.code IN (SELECT code FROM _dict_seed) AND NOT a.is_postable;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'seed 9080: posting rules reference non-postable accounts: %', bad;
  END IF;
END $$;

-- DOWN
-- Reference data, every insert conflict-guarded, nothing overwritten. Undoing
-- it means deleting rows that operational documents may already point at, so
-- there is no safe automation here — the order below is the dependency order a
-- human would follow, and each step must be checked for references first.
--
--   DELETE FROM service_type_dictionary_item WHERE dictionary_item_id IN
--     (SELECT dictionary_item_id FROM dictionary_item WHERE code ~ '^#[RDEA][0-9]+$');
--   DELETE FROM posting_rule WHERE dictionary_item_id IN
--     (SELECT dictionary_item_id FROM dictionary_item WHERE code ~ '^#[RDEA][0-9]+$');
--   DELETE FROM dictionary_item WHERE code ~ '^#[RDEA][0-9]+$'
--     AND NOT EXISTS (SELECT 1 FROM journal_line jl WHERE jl.dictionary_item_id = dictionary_item.dictionary_item_id)
--     AND NOT EXISTS (SELECT 1 FROM costing_line cl WHERE cl.dictionary_item_id = dictionary_item.dictionary_item_id);
--   DELETE FROM service_type WHERE is_system AND key IN
--     ('SEA_FREIGHT_IMPORT','SEA_FREIGHT_EXPORT','AIR_FREIGHT_IMPORT','AIR_FREIGHT_EXPORT',
--      'HINTERLAND_TRANSIT','INLAND_TRANSPORTATION','WAREHOUSING','END_TO_END_AIR_FREIGHT',
--      'END_TO_END_SEA_FREIGHT','BUSINESS_REPRESENTATION','CUSTOMS_BROKERAGE','PROJECT_CARGO')
--     AND NOT EXISTS (SELECT 1 FROM dossier d WHERE d.service_type_id = service_type.service_type_id);
--   DELETE FROM dictionary_ref WHERE kind IN ('CONTAINER_TYPE','LOAD_MODE');
--   DELETE FROM dictionary_ref WHERE kind = 'SUBCATEGORY' AND code IN ('BANK_FINANCE','DOCUMENTATION');
--   -- The chart-of-accounts leaves are left in place: an account referenced by
--   -- any posting rule or journal line must never be deleted, and an unused one
--   -- costs nothing. Deactivate rather than delete if they must go.
