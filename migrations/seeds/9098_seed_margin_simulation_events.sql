-- ============================================================================
-- SEED (per tenant schema) — margin-simulation workflow event types (MOD-27,
-- §3.1).
--
-- 10743 gave margin_simulation the workflow the legacy screen has (submit /
-- approve / reject / quote); these are the catalogue rows those emissions
-- resolve against. Same reasoning as 9096: an event key that is not in the
-- catalogue cannot carry an approval chain and has nowhere to route.
--
-- `margin_simulation.submitted` is approvable: it is the natural place for a
-- tenant that wants a sales-manager signature before a price leaves the
-- building to bind a chain. Approve/reject/quoted are outcomes, not requests
-- — routing an outcome through another approval would approve an approval.
-- As with 9094/9096, NO CHAIN IS SEEDED; the keys are merely made bindable.
--
-- NUMBERED 90xx DELIBERATELY. `migrator.files` partitions this directory by
-- prefix (tenantSeeds /^90/, platformSeeds /^91/). `event_type` is a TENANT
-- table, so a 91xx number would run this against the platform DB and fail.
-- ============================================================================

INSERT INTO event_type (key, module_key, name, description, is_security_critical, is_approvable) VALUES
 ('margin_simulation.submitted', 'MOD-27', 'Margin simulation submitted', 'A priced simulation was submitted for review (DRAFT -> SUBMITTED).',            false, true),
 ('margin_simulation.approved',  'MOD-27', 'Margin simulation approved',  'A submitted simulation was approved (maker-checker: never the submitter).',    false, false),
 ('margin_simulation.rejected',  'MOD-27', 'Margin simulation rejected',  'A submitted simulation was rejected, with a reason.',                          false, false),
 ('margin_simulation.quoted',    'MOD-27', 'Margin simulation quoted',    'An approved simulation was turned into a DRAFT quotation (legacy quote action).', false, false)
ON CONFLICT (key) DO NOTHING;

-- DOWN
-- Reference data. Deleting these orphans any workflow bound to them, so the
-- keys are left in place; they are inert unless a chain is bound.
--
--   DELETE FROM event_type WHERE key IN
--     ('margin_simulation.submitted','margin_simulation.approved',
--      'margin_simulation.rejected','margin_simulation.quoted');
