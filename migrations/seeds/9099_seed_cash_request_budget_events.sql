-- ============================================================================
-- SEED (per tenant schema) — the event types 12771 emits (MOD-49).
--
-- `closeBalance` emits `cash_request.closed_short` and the reopen path emits
-- `cash_request.draft`. An event key that is not in this catalogue has nowhere
-- to route and cannot carry a workflow — the same reasoning as 9097, which
-- seeded `cash_request.partially_disbursed` alongside its emitter rather than
-- after it.
--
-- NEITHER IS APPROVABLE.
--
--   `closed_short` settles a request at cash that has ALREADY left the
--   treasury. An approval gate belongs before money moves, and the gate that
--   guards this one is the `approve` grant on the route itself.
--
--   `draft` is a rejected request going back to its author to be fixed. Asking
--   for an approval to let someone edit their own draft is a chain that exists
--   only to be clicked through.
--
-- NUMBERED 90xx DELIBERATELY. `migrator.files` partitions this directory by
-- prefix (tenantSeeds /^90/, platformSeeds /^91/). `event_type` is a TENANT
-- table, so a 91xx number would run this against the platform DB and fail.
-- ============================================================================

INSERT INTO event_type (key, module_key, name, description, is_security_critical, is_approvable) VALUES
 ('cash_request.closed_short', 'MOD-49', 'Cash request settled short', 'A partly-disbursed request was closed at what was actually paid, returning the unpaid commitment to the file''s budget (12771).', false, false),
 ('cash_request.draft', 'MOD-49', 'Cash request reopened', 'A rejected request was reopened for its author to correct and re-submit, keeping its reference (12771).', false, false)
ON CONFLICT (key) DO NOTHING;

-- DOWN
-- Reference data. Deleting a key orphans any workflow bound to it, so it is
-- left in place; both are inert unless something binds to them.
--
--   DELETE FROM event_type WHERE key IN ('cash_request.closed_short', 'cash_request.draft');
