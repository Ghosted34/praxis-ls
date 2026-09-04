-- ============================================================================
-- TENANT — 12773 Images inside an article.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
--
-- 12757 gave an article a COVER and nothing else, so a published piece is one
-- photograph and then text to the bottom of the page. That is enough for a
-- short note and not enough for the articles a forwarder actually writes: a
-- corridor explainer wants the map, a customs piece wants the form, a yard
-- report wants the yard.
--
-- The body cannot carry them. `public-web`'s markdown renderer supports
-- headings, emphasis, lists and http(s)/mailto links, and its header names
-- images as deliberately unsupported — it builds React nodes directly with no
-- `dangerouslySetInnerHTML`, which is exactly what makes tenant-authored text
-- safe on a page a stranger loads. Adding image syntax there would mean parsing
-- a URL out of tenant input and putting it in a `src`, on the one surface in
-- this product where that is least acceptable.
--
-- So the images are DOCUMENTS, like the cover: uploaded to the vault, sniffed,
-- scoped for public serving, and referenced by id. The renderer draws a fixed
-- gallery below the body rather than placing them mid-text, because placement
-- inside prose needs a marker in the prose, and that is the markup this design
-- exists to avoid.
--
-- ── SHAPE ──────────────────────────────────────────────────────────────────
--
-- `uuid[]`, not a child table, matching `service_type_web_profile.
-- gallery_vault_ids` exactly. The order in the array IS the display order, the
-- list is short by nature, and it is read and written whole every time — the
-- three properties that make a child table cost a join and buy nothing.
--
-- The vault CHECK already admits 'INSIGHT' (12757). The ROLE is what
-- distinguishes these from the cover, and 'GALLERY' is already in use for
-- service media, so no constraint changes here at all.
-- ============================================================================

ALTER TABLE insight_article
  ADD COLUMN IF NOT EXISTS gallery_vault_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

COMMENT ON COLUMN insight_article.gallery_vault_ids IS
  'Vault document ids, in display order, scoped INSIGHT/GALLERY. Drawn below the body — never placed inside it, because in-prose placement would require image markup the renderer refuses.';

-- ============================================================================
-- VERIFY
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'insight_article' AND column_name = 'gallery_vault_ids';
--     -- expect one row, ARRAY
--
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'ck_vault_public_media_scope';   -- unchanged, INSIGHT present
--
-- DOWN
--   ALTER TABLE insight_article DROP COLUMN IF EXISTS gallery_vault_ids;
--   -- The vault rows survive with an INSIGHT/GALLERY scope and nothing
--   -- pointing at them. `publicGalleryForServe` joins the array, so they stop
--   -- being servable the moment the column goes — no orphaned public bytes.
-- ============================================================================
