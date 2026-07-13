-- ============================================================================
-- SEED (per tenant schema) — reference data added with the gap-fill migrations:
-- currencies (MOD-08), default sales pipeline stages (MOD-24), and event types
-- for every newly added module so the workflow/notification designer sees them.
-- ============================================================================

-- Currencies (XAF base; add more from the platform console as needed) ---------
INSERT INTO currency (code, name, symbol, is_base, decimals) VALUES
 ('XAF','CFA Franc BEAC','FCFA',true,0),
 ('USD','US Dollar','$',false,2),
 ('EUR','Euro','€',false,2),
 ('NGN','Nigerian Naira','₦',false,2),
 ('CNY','Chinese Yuan','¥',false,2)
ON CONFLICT DO NOTHING;

-- Default sales pipeline stages (tenant-tunable) -----------------------------
INSERT INTO pipeline_stage (code, name, sort_order, is_won, is_lost) VALUES
 ('NEW','New',0,false,false),
 ('QUALIFIED','Qualified',1,false,false),
 ('PROPOSAL','Proposal sent',2,false,false),
 ('NEGOTIATION','Negotiation',3,false,false),
 ('WON','Won',4,true,false),
 ('LOST','Lost',5,false,true)
ON CONFLICT DO NOTHING;

-- Event types for the newly added modules (workflow/notification config) ------
INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
 ('fx.rate.synced','MOD-08','FX rates synced',false,false),
 ('supplier_invoice.posted','MOD-61','Supplier invoice posted',false,true),
 ('cash_request.submitted','MOD-49','Cash request submitted',false,true),
 ('cash_request.disbursed','MOD-49','Cash request disbursed',false,false),
 ('debt.engaged','MOD-53','Project financing engaged',false,true),
 ('tax_declaration.filed','MOD-07','Tax declaration filed',false,true),
 ('statement.generated','MOD-59','Financial statement generated',false,false),
 ('quotation.sent','MOD-27','Quotation sent',false,false),
 ('quotation.accepted','MOD-27','Quotation accepted',false,false),
 ('pricing_variance.computed','MOD-27','Pricing variance computed',false,false),
 ('lead.created','MOD-20','Lead created',false,false),
 ('opportunity.won','MOD-24','Opportunity won',false,false),
 ('proposal.sent','MOD-23','Proposal sent',false,true),
 ('vacancy.posted','MOD-11','Vacancy posted',false,false),
 ('applicant.applied','MOD-11','Job application received',false,false),
 ('contract.issued','MOD-12','HR contract issued',false,true),
 ('appraisal.recorded','MOD-13','Appraisal recorded',false,false),
 ('inventory.moved','MOD-35','Stock movement',false,false),
 ('outbound.dispatched','MOD-36','Outbound dispatched',false,false),
 ('work_order.opened','MOD-41','Work order opened',false,false),
 ('vehicle.dispatched','MOD-42','Vehicle dispatched',false,false),
 ('driver.license.expiring','MOD-44','Driver licence expiring',false,false),
 ('incident.reported','MOD-45','Fleet incident reported',false,false),
 ('email.bounced','MOD-70','Email bounced',false,false),
 ('document.signed','MOD-64','Document signed',false,false),
 ('reminder.fired','MOD-65','Reminder fired',false,false)
ON CONFLICT DO NOTHING;
