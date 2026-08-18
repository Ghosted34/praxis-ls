-- ============================================================================
-- SEED (per tenant schema) — the three costing unlock event types (MOD-46).
--
-- WHY THIS IS NOT OPTIONAL. `workflow` binds to an `event_type_id`
-- (0120_events_workflow.sql:22), and `emitEvent` resolves an event by key. An
-- event key that is not in this catalogue cannot carry an approval chain and
-- has nowhere to route — which is exactly defect (2) that Landing A had to fix
-- for `regie.issued`, where the service emitted a key nobody had seeded and the
-- whole module was therefore unroutable. Adding the service without the seed
-- would reproduce that in MOD-46.
--
-- WHY ONLY `costing.unlocked` IS APPROVABLE
--
-- `is_approvable` means "a tenant MAY bind a validate/approve workflow here",
-- not "one is bound". The grant is the act that reopens a locked, already
-- invoiced document, so it is the one worth routing through a chain. The
-- request is an author asking, and the denial is the chain's own negative
-- outcome — putting either behind another approval would mean approving a
-- refusal to approve.
--
-- As with 9094, NO CHAIN IS SEEDED. The event is merely made bindable; the
-- routes' `approve` + APPROVER capability are the shipped gate, and a tenant
-- that wants a second signature adds a workflow against this key.
--
-- NUMBERED 90xx DELIBERATELY. `migrator.files` partitions this directory by
-- prefix (tenantSeeds /^90/, platformSeeds /^91/). `event_type` is a TENANT
-- table, so a 91xx number would run this against the platform DB and fail.
-- ============================================================================

INSERT INTO event_type (key, module_key, name, description, is_security_critical, is_approvable) VALUES
 ('costing.unlock_requested', 'MOD-46', 'Costing unlock requested', 'Someone asked to reopen an APPROVED_LOCKED costing (10718).',                     false, false),
 ('costing.unlocked',         'MOD-46', 'Costing unlocked',         'An approved costing was reopened and returned to DRAFT for correction.',          false, true),
 ('costing.unlock_denied',    'MOD-46', 'Costing unlock denied',    'A request to reopen an approved costing was refused. It stays APPROVED_LOCKED.',  false, false)
ON CONFLICT (key) DO NOTHING;

-- DOWN
-- Reference data. Deleting these orphans any workflow bound to them, so the
-- keys are left in place; they are inert unless a chain is bound.
--
--   DELETE FROM event_type WHERE key IN
--     ('costing.unlock_requested','costing.unlocked','costing.unlock_denied');
