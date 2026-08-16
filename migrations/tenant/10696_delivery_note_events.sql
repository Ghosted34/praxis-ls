-- ============================================================================
-- 10696 — the delivery-note lifecycle events.
--
-- `delivery_note.created` already exists (0120's seed) and the milestone engine
-- already listens for it. The states added in 10695 need their own keys so the
-- orchestration layer can react to a delivery being CONFIRMED rather than to a
-- note being drafted — the same correction 10693 made for the transit order,
-- where a DRAFT was ticking a client-visible milestone.
--
-- Deliberately NOT re-pointing any milestone stage here. The transit-order case
-- had a seeded stage (T1_LODGED) that was demonstrably wired to the wrong
-- event; the delivery-note chains vary per tenant, so the right key is now
-- available to configure (`operations.milestone_map`, or the stage's own
-- `auto_advance_on_event`) without this migration guessing at intent.
-- ============================================================================

INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
 ('delivery_note.issued',    'MOD-32', 'Delivery note issued',                 false, false),
 ('delivery_note.delivered', 'MOD-32', 'Delivery confirmed received by client', false, false),
 ('delivery_note.cancelled', 'MOD-32', 'Delivery note cancelled',              false, false)
ON CONFLICT (key) DO NOTHING;

-- `created` and `updated` are referenced by delivery_note.events.js; seed them
-- defensively in case a tenant predates the 0120 seed.
INSERT INTO event_type (key, module_key, name, is_security_critical, is_approvable) VALUES
 ('delivery_note.created', 'MOD-32', 'Delivery note drafted', false, false),
 ('delivery_note.updated', 'MOD-32', 'Delivery note updated', false, false)
ON CONFLICT (key) DO NOTHING;

-- DOWN
-- DELETE FROM event_type WHERE key IN
--   ('delivery_note.issued','delivery_note.delivered','delivery_note.cancelled');
