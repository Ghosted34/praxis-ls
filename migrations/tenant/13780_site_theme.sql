-- ============================================================================
-- TENANT — 13780 The website's theme: the tenant's colours and faces.
--
-- ── WHY THIS STORES THE INPUT AND NOT THE OUTPUT ───────────────────────────
--
-- Three hex values and three font ids. NOT the seventy-odd CSS custom
-- properties they produce.
--
-- `packages/shared/design/palette.js` turns the input into a complete,
-- accessible, two-theme token set: surfaces tinted toward the brand hue, an
-- accent stepped down until it clears 4.5:1 as type, a label on the accent fill
-- that is carbon or white depending on which one actually passes, harmonised
-- transport-mode colours. Every one of those is DERIVED, and derived values do
-- not belong in a table:
--
--   · A tenant who saved a palette in September would be frozen against every
--     later improvement to the derivation. The engine gets better; their site
--     would not.
--   · Two sources of truth for one fact. The engine would say one thing and the
--     row another, and the row would win on the page while the settings preview
--     showed the engine's answer. That is precisely the "preview lies to the
--     tenant" failure the shared package exists to prevent.
--
-- So: input here, derivation at read time, and the public endpoint serves the
-- computed tokens so a cold phone never runs the maths.
--
-- ── WHY A SINGLETON AND NOT A SETTINGS ROW ─────────────────────────────────
--
-- Same shape as `company_profile` (0691): `singleton boolean UNIQUE CHECK`,
-- seeded once, updated in place. A tenant has exactly one website theme, and
-- the alternative — six rows in `setting` keyed by string — loses the column
-- types, the CHECK constraints below, and any hope of a foreign key on the
-- person who last changed it.
--
-- ── THE HEX CHECK IS NOT DECORATION ────────────────────────────────────────
--
-- The engine falls back to the brand orange on anything it cannot parse, which
-- is the right runtime behaviour and the wrong storage behaviour: a tenant who
-- pastes `FF5A00` without the hash would see the default and have no idea why.
-- Rejecting at the column means the API says so.
-- ============================================================================

CREATE TABLE IF NOT EXISTS site_theme (
  site_theme_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton      boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),

  -- The palette engine's input. `primary_hex` is required; the other two are
  -- optional and the engine derives analogous stand-ins when they are absent,
  -- which is what keeps a one-colour tenant looking deliberate.
  primary_hex    text NOT NULL DEFAULT '#ff5a00',
  secondary_hex  text,
  tertiary_hex   text,

  -- Font IDS, not stacks. The id resolves through client/src/lib/fonts.ts,
  -- which is the closed library the root scripts/check-fonts.mjs enforces.
  -- Storing the stack string would let a hand-edited row name a family this
  -- product does not self-host, and the failure is silent on every machine
  -- that happens to have it installed.
  font_display   text NOT NULL DEFAULT 'archivo',
  font_body      text NOT NULL DEFAULT 'inter',
  font_mono      text NOT NULL DEFAULT 'jetbrains-mono',

  radius_px      integer NOT NULL DEFAULT 10,
  -- Which theme a first-time visitor gets. Two states, not three: a tenant
  -- picks the impression their front door makes, and the visitor's own toggle
  -- overrides it from then on.
  default_mode   text NOT NULL DEFAULT 'light',

  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES app_user(user_id),

  CONSTRAINT ck_site_theme_primary_hex   CHECK (primary_hex ~* '^#[0-9a-f]{6}$'),
  CONSTRAINT ck_site_theme_secondary_hex CHECK (secondary_hex IS NULL OR secondary_hex ~* '^#[0-9a-f]{6}$'),
  CONSTRAINT ck_site_theme_tertiary_hex  CHECK (tertiary_hex  IS NULL OR tertiary_hex  ~* '^#[0-9a-f]{6}$'),
  CONSTRAINT ck_site_theme_mode          CHECK (default_mode IN ('light', 'dark')),
  CONSTRAINT ck_site_theme_radius        CHECK (radius_px BETWEEN 0 AND 32)
);

COMMENT ON TABLE site_theme IS
  'The public website theme: the palette engine INPUT (up to three brand colours) plus font ids and radius. Never the derived tokens — those come from packages/shared/design/palette.js at read time so a tenant is not frozen against later improvements.';
COMMENT ON COLUMN site_theme.primary_hex IS
  'The tenant accent. Chosen to look right as a button fill, which is usually illegible as text — the engine derives an AA-corrected ink from it rather than expecting the tenant to.';
COMMENT ON COLUMN site_theme.font_display IS
  'A font id from client/src/lib/fonts.ts, not a CSS stack. The library is closed and scripts/check-fonts.mjs enforces it.';

INSERT INTO site_theme (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

-- ============================================================================
-- VERIFY
--   SELECT count(*) FROM site_theme;                    -- expect exactly 1
--   INSERT INTO site_theme (singleton) VALUES (true);   -- expect 23505
--   UPDATE site_theme SET primary_hex = 'FF5A00';       -- expect 23514
--
-- DOWN
--   DROP TABLE IF EXISTS site_theme;
--   -- Safe: nothing references it, and a tenant without a row renders the
--   -- brand default, which is what they had before this migration.
-- ============================================================================
