-- ============================================================================
-- SEED (PLATFORM DB) — 9113 register MOD-05B, the financial dictionary's
-- recycle bin, in the module catalogue.
--
-- The tenant-side grant is 9083; this is the other half — without a catalogue
-- row the capability exists and is enforced, but the company dashboard has no
-- name to show for it and the Super Admin's permission screen renders a bare
-- key. Kept in the 91xx series because module_catalogue lives in the PLATFORM
-- database, not in any tenant schema.
--
-- is_core = false: a tenant that never removes a dictionary line never needs
-- the screen, so this is not part of the mandatory core set.
--
-- sort_order 14 is already taken by MOD-05 itself, and the column is not
-- unique, so 14 places the bin directly beside the dictionary it belongs to
-- rather than orphaning it at the end of the "configure" group.
-- ============================================================================

INSERT INTO platform.module_catalogue (module_key, group_key, name, sort_order, is_core) VALUES
 ('MOD-05B','configure','Financial Dictionary — Recycle Bin',14,false)
ON CONFLICT (module_key) DO NOTHING;

-- DOWN
-- DELETE FROM platform.module_catalogue WHERE module_key = 'MOD-05B';
