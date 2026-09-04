-- ============================================================================
-- SEED (per tenant schema) — the third approval leg (MOD-49, owner Q14).
--
-- Submitting a cash request opens `disbursal.requested` (finance validates) and
-- validating opens `disbursal.validated` (management approves). Handing the
-- cash over had no bindable chain at all — it was a permission and a capability
-- and nothing else.
--
-- `disbursal.approved` is APPROVABLE, so a tenant that wants one can bind a
-- treasury chain to it: "over 5 000 000 needs the finance director" is then a
-- workflow row rather than a number in code, and `user_capability`'s
-- min/max_amount_xaf bands do the routing.
--
-- NOTHING IS BOUND BY DEFAULT. No workflow row is created here, so
-- `executor.start` finds none, reports autoApproved, and the manual path stays
-- exactly as it is (the W8 pattern). This adds a place to hang a control, not
-- a control — a tenant that does not want one sees no change whatsoever.
--
-- NUMBERED 9089 DELIBERATELY, AND THE RANGE IS NEARLY FULL.
--
-- `migrator.files` partitions this directory by PREFIX, not by value:
-- tenantSeeds is /^90/ and platformSeeds is /^91/. So the tenant range is
-- literally 9000-9099 and 9100+ are PLATFORM seeds — `event_type` is a tenant
-- table, so a 91xx number would run this against the platform database and
-- fail the migrations job.
--
-- 9090-9099 are now all taken (9099 landed with 12771), so this takes the
-- highest free slot below them. The next person adding a tenant seed has
-- 9084-9088 and a handful of low gaps left, and after that the partitioning
-- itself needs widening — /^90/ cannot express a 9100th tenant seed.
-- ============================================================================

INSERT INTO event_type (key, module_key, name, description, is_security_critical, is_approvable) VALUES
 ('disbursal.approved', 'MOD-49', 'Cash request approved for disbursement', 'An approved cash request is ready for the treasury to pay out. Bind a workflow here to require a further authorisation before cash leaves.', false, true)
ON CONFLICT (key) DO NOTHING;

-- DOWN
-- Reference data. Deleting the key orphans any workflow a tenant has bound to
-- it, so it is left in place; it is inert until something binds.
--
--   DELETE FROM event_type WHERE key = 'disbursal.approved';
