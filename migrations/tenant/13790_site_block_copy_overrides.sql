-- ============================================================================
-- TENANT — 13790 The block library learns `copy_overrides`.
--
-- ── THE GAP THIS CLOSES ────────────────────────────────────────────────────
--
-- 12753 built a website whose CONTENT a tenant owns — their hero, their
-- figures, their case notes. What it could not reach is the ~465 sentences the
-- app itself puts on those pages: the section headings, the empty states, the
-- form labels, the legal line in the footer. "Success stories / Operations we
-- have run, in our own words" is a claim about the TENANT'S business, written
-- into a frontend bundle in words we chose, on a WHITE-LABEL product. A tenant
-- who sells project cargo and calls the same page "Reference projects" had no
-- way to say so, and no way to find out that they could not.
--
-- ── WHY A BLOCK AND NOT A `site_copy` TABLE ────────────────────────────────
--
-- Because everything a new table would need already exists on this one, and
-- getting any of it subtly different is worse than the join it saves:
--
--   · PUBLISHING. `site_page.is_published` already means "a stranger may read
--     this". Copy is content, and half-rewritten headings must not reach a
--     client's customers any more than a half-written hero does. A separate
--     table would have needed its own publish flag, its own stamp, and its own
--     answer to "published by whom" — three chances to disagree with the one
--     15 lines up.
--   · VISIBILITY. `is_visible` already means "keep this but stop showing it",
--     which for copy is exactly "go back to the words Praxis shipped" — a
--     tenant trying a rewrite for a season can put it away without retyping it.
--   · VALIDATION. `content` is already checked against a per-type Zod schema on
--     write (site_content.schema.js). The override map is a bilingual record
--     like every other block's fields, and the key list it is checked against
--     is generated from the dictionary itself.
--
-- ── WHAT THE SHAPE IS, AND WHY IT IS KEYED ────────────────────────────────
--
--   { "items": [ { "key": "site.portfolioPage.titleAccent",
--                  "value": { "fr": "projets", "en": "projects" } }, ... ] }
--
-- Keyed by the dictionary path, not by position, because the target is a
-- string that already exists and already has a name. A positional list would
-- silently re-point every override the day a string is inserted above it —
-- which on this table means a tenant's footer disclaimer appearing as a button
-- label on a live public site.
--
-- An unknown key is REFUSED on write (`isSiteCopyKey`), so a key deleted from
-- the dictionary cannot linger as an override nobody can see and nobody can
-- remove. Stored rows are re-checked on read for the same reason: a key
-- retired between one deploy and the next simply stops overriding, and the
-- shipped sentence comes back.
--
-- No new column, no new index: this is one more value in an existing CHECK.
-- ============================================================================

-- ── THE GUARD IS SCHEMA-QUALIFIED, AND 12753'S WAS NOT ────────────────────
--
-- `pg_constraint` is DATABASE-wide. `conname` is unique per table, not per
-- database, so `WHERE conname = 'site_block_type_chk'` matches the constraint
-- on ANY schema's `site_block` — and a tenant database has two, `live` and
-- `sandbox`, migrated one after the other by provision-tenant.
--
-- 12753 guarded on the bare `conname`. So on every tenant ever provisioned,
-- `live` got the CHECK and then `sandbox` found live's row, took the
-- `IF NOT EXISTS` branch as false, and silently skipped its own ADD. Every
-- sandbox `site_block` in existence has NO type constraint on it: a block type
-- the registry has never heard of is accepted there and renders as nothing,
-- which is the exact failure 12753's own comment says the CHECK exists to
-- prevent.
--
-- It was silent for two reasons — a skipped ADD raises nothing, and the type is
-- also validated in `site_content.schema.js` on the write path, so no request
-- ever reached the missing constraint. The `COMMENT ON CONSTRAINT` below is
-- what finally made it speak: it runs against `current_schema()` and cannot
-- find a constraint the guard decided not to create.
--
-- Qualifying by relation AND namespace fixes both. The DROP + ADD then runs
-- per schema, so applying this migration REPAIRS the sandbox schemas 12753
-- left unconstrained rather than only widening the live ones.
ALTER TABLE site_block DROP CONSTRAINT IF EXISTS site_block_type_chk;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE c.conname = 'site_block_type_chk'
       AND t.relname = 'site_block'
       AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE site_block ADD CONSTRAINT site_block_type_chk CHECK (type IN (
      'hero',
      'stat_chips',
      'stat_counters',
      'logo_strip',
      'feature_list',
      'card_grid',
      'text_image',
      'two_column_values',
      'leader_message',
      'pillar_framework',
      'testimonials',
      'form_block',
      'contact_block',
      'cta_band',
      'policies',
      'copy_overrides'
    ));
  END IF;
END $$;

COMMENT ON CONSTRAINT site_block_type_chk ON site_block IS
  'The block library. Must equal BLOCK_TYPES in site_content.schema.js — a type Postgres accepts but the registry does not know renders as nothing at all.';

-- ============================================================================
-- VERIFY
--   -- BOTH schemas, not just live — this is the 12753 repair:
--   SELECT n.nspname, pg_get_constraintdef(c.oid)
--     FROM pg_constraint c
--     JOIN pg_class t ON t.oid = c.conrelid
--     JOIN pg_namespace n ON n.oid = t.relnamespace
--    WHERE c.conname = 'site_block_type_chk' AND t.relname = 'site_block';
--     -- expect two rows (live, sandbox), sixteen types each
--   INSERT INTO site_block (page_id, type, content)
--        VALUES ((SELECT page_id FROM site_page LIMIT 1), 'copy_overrides',
--                '{"items":[]}'::jsonb);            -- expect: accepted
--   INSERT INTO site_block (page_id, type)
--        VALUES ((SELECT page_id FROM site_page LIMIT 1), 'carousel_of_doom');
--     -- expect: violates site_block_type_chk
--
-- DOWN
--   -- Delete the blocks first: the narrowed CHECK cannot be added back while a
--   -- row holds the type, and a tenant's overrides have no meaning without a
--   -- renderer that reads them.
--   DELETE FROM site_block WHERE type = 'copy_overrides';
--   ALTER TABLE site_block DROP CONSTRAINT IF EXISTS site_block_type_chk;
--   ALTER TABLE site_block ADD CONSTRAINT site_block_type_chk CHECK (type IN (
--     'hero', 'stat_chips', 'stat_counters', 'logo_strip', 'feature_list',
--     'card_grid', 'text_image', 'two_column_values', 'leader_message',
--     'pillar_framework', 'testimonials', 'form_block', 'contact_block',
--     'cta_band', 'policies'
--   ));
-- ============================================================================
