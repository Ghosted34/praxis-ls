-- ============================================================================
-- SEED (PLATFORM DB) — 9136 register MOD-64C, Smart Comms' Client inbox, in the
-- module catalogue (client portal redesign, PR 3).
--
-- The tenant-side grant is 90997; this is the other half, for the reason 9113
-- gives for MOD-05B: without a catalogue row the permission exists and is
-- enforced, but the Super Admin's permission screen renders a bare key and the
-- company dashboard has no name for it.
--
-- 'monitor', beside MOD-64 (Smart Comms & Signatures, sort 111) — the inbox is
-- a Smart Comms screen. is_core = false: a tenant that never opens the client
-- portal never needs it.
-- ============================================================================

INSERT INTO platform.module_catalogue (module_key, group_key, name, sort_order, is_core) VALUES
 ('MOD-64C','monitor','Smart Comms — Client inbox',111,false)
ON CONFLICT (module_key) DO NOTHING;

-- DOWN
-- DELETE FROM platform.module_catalogue WHERE module_key = 'MOD-64C';
