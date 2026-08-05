-- ============================================================================
-- TENANT DB — 0509 record the `shell` preference section
--
-- 0507 built `user_preference` as (user_id, section, key) → jsonb precisely so
-- that the next per-user preference would be "a new key, not a new migration".
-- That held: the ribbon and the icon rail store under section='shell' and the
-- table needed no change at all.
--
-- What DID go stale is the table's own COMMENT, which still claimed appearance
-- was the only section. That comment is what someone reads when they open the
-- schema in six months and try to work out what these rows are; leaving it
-- describing half the table is how a generic design gets mistaken for a
-- single-purpose one and re-solved with a second table.
--
-- Data-free and idempotent.
-- ============================================================================

COMMENT ON TABLE user_preference IS
  'Per-user overrides of tenant-wide settings, keyed (user_id, section, key) to mirror the `setting` table (0507). section=''appearance'' holds font_display/font_body/font_mono; section=''shell'' holds ribbon_pinned/rail_pins/rail_hint_seen (the user''s chrome arrangement). A NULL/absent row means "no choice made" — inherit the tenant value for appearance, use the client''s starter set for the rail.';

-- DOWN
-- Restores 0507's wording. Nothing but the comment changes either way, so this
-- is safe to run at any point and in any order relative to a code deploy.
--
-- COMMENT ON TABLE user_preference IS
--   'Per-user overrides of tenant-wide settings, keyed (user_id, section, key) to mirror the `setting` table (0507). section=''appearance'' holds font_display/font_body/font_mono; a NULL/absent row means "inherit the tenant value".';
