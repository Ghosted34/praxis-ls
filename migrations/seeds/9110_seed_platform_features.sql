-- ============================================================================
-- SEED (PLATFORM DB) — feature catalogue + plans + plan_feature mapping.
-- Runs after 9100 (module_catalogue). Split from 9100 to stay small.
-- Idempotent: safe to re-run (upserts on conflict).
-- ============================================================================

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
ON CONFLICT (feature_key) DO UPDATE SET
  module_key    = EXCLUDED.module_key,
  name          = EXCLUDED.name,
  default_state = EXCLUDED.default_state,
  depends_on    = EXCLUDED.depends_on;

INSERT INTO platform.plan (plan_id, code, name, price_setup_xaf, price_yearly_xaf) VALUES
 ('22222222-2222-2222-2222-222222222221','starter','Starter (accounting + ops)',0,0),
 ('22222222-2222-2222-2222-222222222222','full','Full suite',3000000,500000),
 ('22222222-2222-2222-2222-222222222223','enterprise','Enterprise (own DB access)',3000000,500000)
ON CONFLICT (plan_id) DO UPDATE SET
  code             = EXCLUDED.code,
  name             = EXCLUDED.name,
  price_setup_xaf  = EXCLUDED.price_setup_xaf,
  price_yearly_xaf = EXCLUDED.price_yearly_xaf;

INSERT INTO platform.plan_feature (plan_id, feature_key, included)
SELECT '22222222-2222-2222-2222-222222222222', feature_key, true FROM platform.feature_catalogue
ON CONFLICT (plan_id, feature_key) DO UPDATE SET included = EXCLUDED.included;

INSERT INTO platform.plan_feature (plan_id, feature_key, included)
SELECT '22222222-2222-2222-2222-222222222223', feature_key, true FROM platform.feature_catalogue
ON CONFLICT (plan_id, feature_key) DO UPDATE SET included = EXCLUDED.included;

INSERT INTO platform.plan_feature (plan_id, feature_key, included)
SELECT '22222222-2222-2222-2222-222222222221', feature_key, true FROM platform.feature_catalogue
 WHERE feature_key IN ('accounting.core','accounting.statements','accounting.tax','finance.fx',
                       'operations','costing','commercial.simulators','commercial.quotation',
                       'procurement','hr.payroll','comms','signatures','reporting')
ON CONFLICT (plan_id, feature_key) DO UPDATE SET included = EXCLUDED.included;