-- ============================================================================
-- SEED (PLATFORM DB) — COMPLETE module & feature catalogue (all 70 modules) +
-- default plans. This is what the company dashboard flips per tenant.
-- ============================================================================

INSERT INTO platform.module_catalogue (module_key, group_key, name, sort_order, is_core) VALUES
 ('MOD-00A','monitor','Dashboard & My Workspace',0,true),
 ('MOD-00B','configure','God Mode (CEO purge console)',1,false),
 ('MOD-01','configure','Corporate Entities',10,true),
 ('MOD-02','configure','Human Capital (Employees)',11,true),
 ('MOD-03','configure','Client Master',12,true),
 ('MOD-04','configure','Supplier / Partner Master',13,true),
 ('MOD-05','configure','Financial Dictionary',14,true),
 ('MOD-06','configure','Chart of Accounts',15,true),
 ('MOD-07','configure','Tax Jurisdiction',16,true),
 ('MOD-08','configure','Currency & Live FX',17,true),
 ('MOD-09','configure','Treasury Accounts',18,true),
 ('MOD-10','configure','Expense Rates',19,true),
 ('MOD-11','empower','Vacancies',20,false),
 ('MOD-12','empower','Legal Contracts',21,false),
 ('MOD-13','empower','KPI Appraisals',22,false),
 ('MOD-14','empower','Attendance',23,false),
 ('MOD-15','empower','Leave & Allowances',24,false),
 ('MOD-16','empower','SOPs & Onboarding',25,false),
 ('MOD-17','empower','Pay Slips / Payroll',26,false),
 ('MOD-18','empower','Trainings',27,false),
 ('MOD-19','empower','Talent Pool / Succession',28,false),
 ('MOD-20','engage','Leads',30,false),
 ('MOD-21','engage','Meeting Management',31,false),
 ('MOD-22','engage','Marketing Campaign Register',32,false),
 ('MOD-23','engage','Proposal Generator',33,false),
 ('MOD-24','engage','Sales Pipeline',34,false),
 ('MOD-25','engage','Inbound Intake',35,false),
 ('MOD-26','engage','Project Portfolio Builder',36,false),
 ('MOD-27','engage','Margin Simulator',40,false),
 ('MOD-28','engage','Extra-Charges Engine Simulator',41,false),
 ('MOD-29','fulfill','Operations File Registry (dossier)',50,false),
 ('MOD-30','fulfill','Transit Order',51,false),
 ('MOD-31','fulfill','Operational Milestone Tracking',52,false),
 ('MOD-32','fulfill','Delivery Note',53,false),
 ('MOD-33','fulfill','Inbound Operations',60,false),
 ('MOD-34','fulfill','Space & Location Management',61,false),
 ('MOD-35','fulfill','Inventory Control & Tracking',62,false),
 ('MOD-36','fulfill','Outbound Operations',63,false),
 ('MOD-37','fulfill','Equipment Handling',64,false),
 ('MOD-38','fulfill','Audit & Cycle Counting',65,false),
 ('MOD-39','fulfill','Vehicle / Asset Registry',70,false),
 ('MOD-40','fulfill','Compliance & Periodic Expenses',71,false),
 ('MOD-41','fulfill','Maintenance & Work Orders',72,false),
 ('MOD-42','fulfill','Dispatch & Allocation',73,false),
 ('MOD-43','fulfill','Fuel & Usage Tracking',74,false),
 ('MOD-44','fulfill','Driver Management',75,false),
 ('MOD-45','fulfill','Incident & Claim Management',76,false),
 ('MOD-46','transact','Project Costing',80,false),
 ('MOD-47','transact','Cost Tracking',81,false),
 ('MOD-48','transact','Project Cost Reconciliation',82,false),
 ('MOD-49','transact','Project Disbursal',83,false),
 ('MOD-50','transact','Proforma & Advance Invoices',90,false),
 ('MOD-51','transact','Final Invoice',91,false),
 ('MOD-52','transact','Smart Receivables Ledger',92,false),
 ('MOD-53','transact','Project Financing',93,false),
 ('MOD-54','transact','Asset Management',94,false),
 ('MOD-55','transact','Journal Entries (OHADA)',95,true),
 ('MOD-56','transact','General Ledger',96,true),
 ('MOD-57','transact','Income Statement',97,true),
 ('MOD-58','transact','Profit and Loss',98,true),
 ('MOD-59','transact','Cash-Flow Statement (TAFIRE)',99,true),
 ('MOD-60','engage','Purchase Orders',100,false),
 ('MOD-61','engage','Goods Received',101,false),
 ('MOD-62','engage','Purchase Requests',102,false),
 ('MOD-63','configure','Reporting & Insights',110,false),
 ('MOD-64','monitor','Smart Comms & Signatures',111,true),
 ('MOD-65','configure','Compliance Checker',112,false),
 ('MOD-66','configure','Document Verification (QR)',113,false),
 ('MOD-67','configure','IAM / RBAC engine',120,true),
 ('MOD-68','configure','Session Management',121,true),
 ('MOD-69','configure','Immutable Ledger',122,true),
 ('MOD-73','configure','File Repository (Vault)',73,false),
 ('MOD-74','monitor','Support & Feedback',74,true),
 ('MOD-75','configure','Governance & Approvals',75,true),
 ('MOD-70','configure','Settings',123,true)
-- Idempotent: migration 0070_module_taxonomy.sql already inserts MOD-73/74/75
-- (with ON CONFLICT DO UPDATE), and migrations run BEFORE seeds. On a fresh
-- database those three rows therefore exist before this seed runs, so a plain
-- INSERT here trips module_catalogue_module_key_key. It didn't reproduce on
-- dev machines because their long-lived DB applied this seed (tracked once)
-- before 0070 existed. Guard it so the order can't matter.
ON CONFLICT (module_key) DO NOTHING;

-- Features & plans are seeded in 9110_seed_platform_features.sql (split to keep files small). depends_on gates dependencies.
--
-- ⚠️ THIS BLOCK IS NOT AUTHORITATIVE (noted 2026-07-20). 9110 seeds the *same*
-- feature_catalogue rows, runs after this file, and does so with
-- `ON CONFLICT (feature_key) DO UPDATE SET default_state = EXCLUDED.default_state`
-- — so 9110's values overwrite whatever is set here. Editing default_state in
-- this file has no effect on the resulting catalogue. Change it in 9110.
INSERT INTO platform.feature_catalogue (feature_key, module_key, name, default_state, depends_on) VALUES
 ('accounting.core','MOD-55','OHADA accounting core','on','{}'),
 ('accounting.statements','MOD-59','Statutory statements & close','on','{accounting.core}'),
 ('accounting.tax','MOD-07','Tax center (TVA/IS/DSF/CNPS)','on','{accounting.core}'),
 ('finance.fx','MOD-08','Live FX & multi-currency','on','{}'),
 ('finance.debt','MOD-53','Project financing (debt)','off','{accounting.core}'),
 ('operations','MOD-29','Logistics operations','on','{}'),
 ('costing','MOD-46','Costing & margin','on','{operations}'),
 ('commercial.simulators','MOD-27','Margin & extra-charge simulators','on','{costing}'),
 ('commercial.quotation','MOD-27','Quotation (devis)','on','{costing}'),
 ('commercial.pricing_variance','MOD-27','Pricing Variance Index','off','{commercial.simulators}'),
 ('sales.crm','MOD-20','Sales & CRM','off','{}'),
 ('sales.proposals','MOD-23','AI proposal generator','off','{sales.crm}'),
 ('sales.marketing','MOD-22','Marketing & newsletters','off','{sales.crm}'),
 ('procurement','MOD-60','Procurement','on','{}'),
 ('hr.payroll','MOD-17','HR & payroll','on','{}'),
 ('hr.recruitment','MOD-11','Recruitment (vacancies/applicants)','off','{hr.payroll}'),
 ('hr.appraisals','MOD-13','KPI appraisals','off','{hr.payroll}'),
 ('hr.training','MOD-18','Trainings & succession','off','{hr.payroll}'),
 ('fleet','MOD-39','Fleet management','off','{}'),
 ('fleet.maintenance','MOD-41','Fleet maintenance & work orders','off','{fleet}'),
 ('wms','MOD-33','Warehouse management','off','{}'),
 ('wms.inventory','MOD-35','WMS inventory & outbound','off','{wms}'),
 ('wms.cycle_count','MOD-38','WMS cycle counting','off','{wms}'),
 ('ai.assistant','MOD-67','AI assistant (front-end UI)','off','{}'),
 ('ai.assistant.backend','MOD-67','AI agentic actions (server)','off','{ai.assistant}'),
 ('ai.vectorization','MOD-67','AI semantic recall (vectors)','off','{ai.assistant}'),
 ('comms','MOD-64','Smart Comms portal','on','{}'),
 ('signatures','MOD-64','Document e-signature','on','{}'),
 ('reporting','MOD-63','Reporting & insights','on','{}'),
 ('portal.client','MOD-29','Client portal','off','{operations}'),
 ('portal.investor','MOD-56','Investor / board terminal','off','{accounting.core}'),
 ('portal.audit','MOD-69','Audit terminal','off','{}')
-- Non-authoritative (9110 upserts these same rows to their final values right
-- after). Guarded so a re-run can't trip feature_catalogue_feature_key_key.
ON CONFLICT (feature_key) DO NOTHING;

INSERT INTO platform.plan (plan_id, code, name, price_setup_xaf, price_yearly_xaf) VALUES
 ('22222222-2222-2222-2222-222222222221','starter','Starter (accounting + ops)',0,0),
 ('22222222-2222-2222-2222-222222222222','full','Full suite',3000000,500000),
 ('22222222-2222-2222-2222-222222222223','enterprise','Enterprise (own DB access)',3000000,500000)
ON CONFLICT (plan_id) DO NOTHING;

INSERT INTO platform.plan_feature (plan_id, feature_key, included)
SELECT '22222222-2222-2222-2222-222222222222', feature_key, true FROM platform.feature_catalogue
ON CONFLICT (plan_id, feature_key) DO NOTHING;
INSERT INTO platform.plan_feature (plan_id, feature_key, included)
SELECT '22222222-2222-2222-2222-222222222223', feature_key, true FROM platform.feature_catalogue
ON CONFLICT (plan_id, feature_key) DO NOTHING;
INSERT INTO platform.plan_feature (plan_id, feature_key, included)
SELECT '22222222-2222-2222-2222-222222222221', feature_key, true FROM platform.feature_catalogue
 WHERE feature_key IN ('accounting.core','accounting.statements','accounting.tax','finance.fx',
                       'operations','costing','commercial.simulators','commercial.quotation',
                       'procurement','hr.payroll','comms','signatures','reporting')
ON CONFLICT (plan_id, feature_key) DO NOTHING;
