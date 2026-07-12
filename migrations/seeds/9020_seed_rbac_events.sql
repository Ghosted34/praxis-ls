-- ============================================================================
-- SEED (per tenant schema) — default RBAC (roles, capabilities) + the event-type
-- catalogue. The Tenant Super Admin tunes these from the Settings UI afterwards.
-- ============================================================================

INSERT INTO capability (code, name) VALUES
 ('ISSUER','Issuer — creates the document'),
 ('VALIDATOR','Validator — checks the document'),
 ('APPROVER','Approver — authorises the document'),
 ('LINE_MANAGER','Line Manager — approves for own team');

INSERT INTO role (code, name, is_system, is_line_manager) VALUES
 ('SUPER_ADMIN','Tenant Super Admin',true,false),
 ('CEO','CEO / Executive',true,false),
 ('MANAGEMENT','Management',true,false),
 ('FINANCE','Finance / Treasury',true,false),
 ('ACCOUNTANT','Accountant',true,false),
 ('SALES','Sales / CRM',true,false),
 ('OPERATIONS','Operations',true,false),
 ('WAREHOUSE','Warehouse (WMS)',true,false),
 ('FLEET','Fleet',true,false),
 ('PROCUREMENT','Procurement',true,false),
 ('HR','Human Resources',true,false);

-- Baseline field-confidentiality defaults (PRD §7.3): mask sensitive fields from
-- roles that must not see them. (Only the "masked" rows are seeded; absence = visible.)
INSERT INTO field_visibility (role_id, field_key, visibility)
SELECT role_id, v.field_key, 'masked'
FROM role r
JOIN (VALUES
  ('SALES','dossier.margin'),('OPERATIONS','dossier.margin'),('WAREHOUSE','dossier.margin'),
  ('FLEET','dossier.margin'),('PROCUREMENT','dossier.margin'),
  ('SALES','supplier.cost_rate'),('OPERATIONS','supplier.cost_rate'),
  ('MANAGEMENT','employee.salary'),('FINANCE','employee.salary'),
  ('SALES','gl.account'),('OPERATIONS','gl.account'),('WAREHOUSE','gl.account'),
  ('FLEET','gl.account'),('PROCUREMENT','gl.account'),('HR','gl.account')
) AS v(role_code, field_key) ON v.role_code = r.code;

-- Universal event catalogue (modules register events; security-critical ones
-- notify CEO/Management — Watch-the-Watcher, PRD §5.7).
INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
 ('costing.submitted','MOD-46','Costing submitted for validation',false,true),
 ('costing.approved','MOD-46','Costing approved',false,true),
 ('invoice.issued','MOD-51','Invoice issued',false,true),
 ('invoice.posted','MOD-51','Invoice posted to ledger',false,false),
 ('proforma.paid','MOD-50','Proforma advance received',false,false),
 ('payment.received','MOD-52','Client payment received',false,true),
 ('disbursal.requested','MOD-49','Disbursal / cash request',false,true),
 ('po.issued','MOD-60','Purchase order issued',false,true),
 ('grn.received','MOD-61','Goods received (3-way match)',false,false),
 ('supplier_invoice.matched','MOD-61','Supplier invoice three-way matched',false,true),
 ('journal.posted','MOD-55','Journal entry posted',false,false),
 ('journal.reversed','MOD-55','Journal entry reversed',false,false),
 ('employee.created','MOD-02','Employee registered',false,false),
 ('employee.updated','MOD-02','Employee updated',false,false),
 ('employee.deactivated','MOD-02','Employee deactivated',false,false),
 ('employee.reactivated','MOD-02','Employee reactivated',false,false),
 ('employee.archived','MOD-02','Employee deleted/archived',false,false),
 ('payroll.run_created','MOD-17','Payroll run opened',false,false),
 ('payroll.computed','MOD-17','Payroll run computed',false,true),
 ('payroll.status_changed','MOD-17','Payroll run status changed',false,true),
 ('payroll.posted','MOD-17','Payroll journal posted',false,false),
 ('asset.depreciated','MOD-54','Asset depreciation posted',false,false),
 ('asset.disposed','MOD-54','Asset disposed',false,true),
 ('vehicle.status_changed','MOD-39','Vehicle status changed',false,false),
 ('vehicle.insurance.expiring','MOD-40','Vehicle insurance expiring',false,false),
 ('vehicle.visite_technique.expiring','MOD-40','Visite technique expiring',false,false),
 ('driver.license.expiring','MOD-44','Driver licence expiring',false,false),
 ('advance.aged_unjustified','MOD-49','Cash advance aged & unjustified',false,false),
 ('milestone.updated','MOD-31','Operation milestone updated',false,false),
 ('cycle_count.discrepancy_found','MOD-38','Cycle count discrepancy found',false,false),
 ('permission.changed','MOD-67','User permission/role changed',true,false),
 ('role.changed','MOD-67','Role or capability edited',true,false),
 ('field_visibility.changed','MOD-67','Field visibility changed',true,false),
 ('godmode.purge','MOD-00B','God-Mode purge executed',true,false),
 ('period.closed','MOD-59','Accounting period frozen/closed (guided close)',false,false),
 ('ai.action.executed','MOD-67','AI agentic action executed',false,false);
