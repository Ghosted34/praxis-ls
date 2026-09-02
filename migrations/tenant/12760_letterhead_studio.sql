-- ============================================================================
-- TENANT DB — the letterhead becomes the one shell every document prints.
--
-- WHAT WAS WRONG. `entity_letterhead` has existed since 0516 and has never
-- reached a printed page. The designer wrote it; `corporate_entity.service`
-- read it back to draw its own preview; and the renderer
-- (`documents/template/template.service.resolveCfg`) took a completely
-- different road — the settings store, section `document_template_config`,
-- keyed `docType:entityId`. A tenant could switch the share capital off, watch
-- the preview obey, and keep printing it on every invoice.
--
-- Meanwhile the kit carried TWO letterheads: `instrumentHead`/`instrumentFoot`
-- for the transit order and delivery note, and `letterhead`/`footer` — a
-- comma-joined identity line and two HARDCODED identifier labels, RCCM and
-- NIU — for the other twenty-odd documents. Two hardcoded labels are correct in
-- exactly one country, and this product is not sold in exactly one country.
--
-- This migration is the storage half of collapsing all of that into one shell,
-- driven by one row, edited in one place.
--
-- ── 1. `layout` — where the blocks go ──────────────────────────────────────
-- A twelve-column grid, as jsonb: [{ id, row, col, span, align, size, weight,
-- tone, transform, visible }]. jsonb and not columns, because the SHAPE is a
-- tenant's arrangement of an open set of blocks — the moment a block is added
-- to the catalogue, a column-per-knob schema needs a migration to carry it, and
-- the whole point of the exercise is that a new field is accommodated without
-- one.
--
-- NULL means "the default arrangement", which is the transit order's, to the
-- point: mark left, identity right, one accent rule under both. A tenant who
-- never opens the editor keeps printing exactly what they print today. That is
-- deliberate — an empty layout must never mean an empty letterhead.
--
-- The renderer MERGES a saved layout over the default rather than replacing it
-- (`letterhead-blocks.mergeLayout`), so a block added next year still appears,
-- at its default place, on a letterhead somebody arranged last year.
--
-- ── 2. `logo_height_mm` — the one measurement that is not derivable ────────
-- The mark carries an EXPLICIT height, never a max-height: an <img> constrained
-- only by max-height contributes zero width to a flex/grid item in Chrome, and
-- the whole letterhead once rendered 0×0 — loaded, decoded and invisible. A
-- definite height is also what makes the header's height predictable, which the
-- one-page fit model depends on.
--
-- ── 3. `entity_letterhead_line` — the tenant's own lines ───────────────────
-- Everything a letterhead carries today is DERIVED, and that is the property
-- worth protecting: nobody retypes a share capital, so nobody prints a stale
-- one. But some lines will never be derivable — a strapline, a customs-agent
-- licence, a trade-body membership, a freight-association number — and a tenant
-- who cannot add one will put it in the footer note as free text, where it is
-- unstructured, unpositionable and identical in both languages.
--
-- So: custom lines, per language, ordered, placed by the same layout, and
-- allowed to carry TOKENS. `{{entity.rccm}}` inside "Agréé en douane
-- n° {{entity.rccm}}" keeps the sentence theirs and the FACT ours, which is the
-- whole argument for derivation applied to the one case derivation cannot
-- reach. A line whose every token resolves empty is dropped rather than printed
-- as dangling scaffolding.
-- ============================================================================

ALTER TABLE entity_letterhead
  ADD COLUMN IF NOT EXISTS layout          jsonb,
  ADD COLUMN IF NOT EXISTS logo_height_mm  numeric(5,2);

COMMENT ON COLUMN entity_letterhead.layout IS
  'Block arrangement for the header and footer: {header:[{id,row,col,span,align,size,weight,tone,transform,visible}],footer:[…]}. NULL = the default (transit-order) arrangement. Merged over the default, never replacing it, so a newly catalogued block still appears.';
COMMENT ON COLUMN entity_letterhead.logo_height_mm IS
  'Printed height of the letterhead mark, in millimetres. Explicit and not a max-height: an <img> sized only by max-height contributes no width to a flex item in Chrome. Feeds the one-page fit model as FIXED height (it does not scale with --k).';

CREATE TABLE IF NOT EXISTS entity_letterhead_line (
  line_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES corporate_entity(entity_id) ON DELETE CASCADE,

  -- Which half of the sheet. Constrained rather than free text: the renderer
  -- composes exactly two zones and a third value would be a line that is stored,
  -- editable, and never printed anywhere.
  zone        text NOT NULL DEFAULT 'footer' CHECK (zone IN ('header', 'footer')),

  -- Per language, like every other authored letterhead string in 0516, so a
  -- French document never falls back to English small print. Either may be
  -- null; the renderer picks the document's language and falls back to the
  -- other, because one translation is better than a blank line.
  text_fr     text,
  text_en     text,

  -- Ordering WITHIN the zone, for a tenant who has never opened the editor.
  -- Once they arrange the layout, `entity_letterhead.layout` places the line by
  -- its id and this is only the tiebreak.
  sort_order  smallint NOT NULL DEFAULT 0,

  is_active   boolean NOT NULL DEFAULT true,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES app_user(user_id),

  -- A line with no text in either language prints nothing and cannot be
  -- distinguished from a mistake. Rejected at the boundary rather than filtered
  -- at every read.
  CONSTRAINT entity_letterhead_line_has_text
    CHECK (COALESCE(NULLIF(btrim(text_fr), ''), NULLIF(btrim(text_en), '')) IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_entity_letterhead_line_entity
  ON entity_letterhead_line (entity_id, zone, sort_order);

COMMENT ON TABLE entity_letterhead_line IS
  'Tenant-authored letterhead lines — what derivation cannot reach (a strapline, a licence number, a trade-body membership). Per language, placed by entity_letterhead.layout, and may carry {{entity.*}} / {{doc.*}} tokens resolved at render so the sentence is the tenant''s and the fact stays ours.';

DROP TRIGGER IF EXISTS trg_entity_letterhead_line_updated ON entity_letterhead_line;
CREATE OR REPLACE TRIGGER trg_entity_letterhead_line_updated BEFORE UPDATE ON entity_letterhead_line
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── DOWN ────────────────────────────────────────────────────────────────────
-- DOWN
-- Additive; reverse by dropping what it added. Commented so nothing runs by
-- accident, present so there is a starting point at 3am.
--
-- Dropping `layout` returns every entity to the default (transit-order)
-- arrangement, which is what they printed before this shipped — so the undo is
-- visually clean. Dropping `entity_letterhead_line` DESTROYS authored content
-- that has no other home: dump it first if any row exists.
--
--   DROP TRIGGER IF EXISTS trg_entity_letterhead_line_updated ON entity_letterhead_line;
--   DROP TABLE IF EXISTS entity_letterhead_line;
--   ALTER TABLE entity_letterhead
--     DROP COLUMN IF EXISTS layout,
--     DROP COLUMN IF EXISTS logo_height_mm;
