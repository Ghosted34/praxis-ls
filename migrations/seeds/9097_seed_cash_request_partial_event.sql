-- ============================================================================
-- SEED (per tenant schema) — the partial-disbursement event type (MOD-49).
--
-- `disburse` now emits `cash_request.partially_disbursed` when an instalment
-- leaves a balance outstanding (10719). An event key that is not in this
-- catalogue has nowhere to route and cannot carry an approval chain — the
-- defect Landing A had to fix for `regie.issued`, where the service emitted a
-- key nobody had seeded. Seeding it with the emitter, not after it.
--
-- NOT APPROVABLE. `cash_request.disbursed` (9030:31) is not either, and for the
-- same reason: by the time this fires the cash has already left the treasury
-- and the régie advance is posted. An approval gate belongs BEFORE the money
-- moves — that is `disbursal.requested`, which the submit step opens and which
-- is where a tenant binds its chain. Making this approvable would invite a
-- workflow that "approves" a fait accompli.
--
-- NUMBERED 90xx DELIBERATELY. `migrator.files` partitions this directory by
-- prefix (tenantSeeds /^90/, platformSeeds /^91/). `event_type` is a TENANT
-- table, so a 91xx number would run this against the platform DB and fail.
-- ============================================================================

INSERT INTO event_type (key, module_key, name, description, is_security_critical, is_approvable) VALUES
 ('cash_request.partially_disbursed', 'MOD-49', 'Cash request partially disbursed', 'An instalment was paid against a cash request and a balance is still outstanding (10719).', false, false)
ON CONFLICT (key) DO NOTHING;

-- DOWN
-- Reference data. Deleting the key orphans any workflow bound to it, so it is
-- left in place; it is inert unless something binds to it.
--
--   DELETE FROM event_type WHERE key = 'cash_request.partially_disbursed';
