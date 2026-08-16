-- ============================================================================
-- 10693 — the transit-order lifecycle events, and the milestone it really closes.
--
-- ── PART 1: THE EVENT TYPES ─────────────────────────────────────────────────
--
-- `emit.lookupEventType()` reads `event_type` to decide whether an event is
-- security-critical or approvable, and an unmapped key is CACHED as null. An
-- emitted event with no row still lands in `event_log` — nothing breaks — but it
-- can never be made approvable, and it is invisible to anyone reading the
-- catalogue to find out what this system emits. The four new states get rows.
--
-- None is `is_approvable`. Approval on a transit order would mean a second
-- person authorising the issue, and no one asked for that — the client's
-- signature IS the authorisation here, which is a different control. Left false
-- so a tenant can bind a workflow later without a migration.
--
-- ── PART 2: THE MILESTONE THAT WAS WIRED TO THE WRONG EVENT ─────────────────
--
-- 9091 seeds the Hinterland chain with:
--
--   ('HINTERLAND_TRANSIT', 3, 'T1_LODGED', 'Transit declaration lodged',
--    …, auto_event = 'transit_order.created')
--
-- The stage means "the transit declaration has been LODGED with customs". The
-- event it fires on means "somebody opened a transit order". Before 10692 those
-- were arguably the same moment, because creating the row was the only thing the
-- module could do. They are now four states apart: a DRAFT order — not numbered,
-- not printed, not signed, nothing filed — would tick "Transit declaration
-- lodged" on the client-visible timeline.
--
-- That is not a cosmetic mis-wiring. `T1_LODGED` is `is_client_visible = true`,
-- so the client portal would show a declaration as filed on the strength of an
-- internal draft, and the SLA clock for the stage would stop at a moment nothing
-- had happened. The stage is re-pointed at `transit_order.lodged`, which is the
-- event that carries the declaration reference.
--
-- BOTH the template stage and the ALREADY-INSTANTIATED milestone rows are moved.
-- Fixing only the template would leave every open file still wired to the old
-- event, and those are exactly the files this is wrong on today.
--
-- Instances that are already DONE are left alone: whatever moved them is
-- history, and rewriting the trigger on a completed stage would not un-complete
-- it — it would only make the record disagree with itself.
-- ============================================================================

-- ── 1. Catalogue the new events ─────────────────────────────────────────────
INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
 ('transit_order.issued',    'MOD-30', 'Transit order issued to client',       false, false),
 ('transit_order.signed',    'MOD-30', 'Transit order signed by client',       false, false),
 ('transit_order.lodged',    'MOD-30', 'Customs declaration lodged',           false, false),
 ('transit_order.cancelled', 'MOD-30', 'Transit order cancelled',              false, false)
ON CONFLICT (key) DO NOTHING;

-- `transit_order.created` and `.updated` have been emitted since 0310 and may
-- never have been catalogued either.
INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
 ('transit_order.created', 'MOD-30', 'Transit order drafted', false, false),
 ('transit_order.updated', 'MOD-30', 'Transit order updated', false, false)
ON CONFLICT (key) DO NOTHING;

-- ── 2. Re-point the template stage ──────────────────────────────────────────
UPDATE milestone_template_stage
   SET auto_advance_on_event = 'transit_order.lodged'
 WHERE code = 'T1_LODGED'
   AND auto_advance_on_event = 'transit_order.created';

-- ── 3. Re-point the live instances that have not already fired ──────────────
UPDATE milestone_instance
   SET auto_advance_on_event = 'transit_order.lodged'
 WHERE code = 'T1_LODGED'
   AND auto_advance_on_event = 'transit_order.created'
   AND status <> 'DONE';

-- DOWN
-- Reverting re-arms the defect: a DRAFT transit order will again tick a
-- client-visible "declaration lodged" milestone.
--
-- UPDATE milestone_instance SET auto_advance_on_event = 'transit_order.created'
--  WHERE code = 'T1_LODGED' AND auto_advance_on_event = 'transit_order.lodged';
-- UPDATE milestone_template_stage SET auto_advance_on_event = 'transit_order.created'
--  WHERE code = 'T1_LODGED' AND auto_advance_on_event = 'transit_order.lodged';
-- DELETE FROM event_type WHERE key IN
--   ('transit_order.issued','transit_order.signed','transit_order.lodged','transit_order.cancelled');
