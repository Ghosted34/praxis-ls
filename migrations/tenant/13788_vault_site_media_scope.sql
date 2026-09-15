-- ============================================================================
-- TENANT — 13788 The vault learns about website media.
--
-- ── WHY THE SITE'S IMAGES ARE VAULT DOCUMENTS AND NOT A NEW TABLE ──────────
--
-- A `site_asset` table was the obvious design and it is the wrong one. Every
-- capability it would need already exists here and is already correct:
--
--   · bytes stored through storage.service (S3 or local), never in the row
--   · content type SNIFFED rather than trusted from the caller's data URL
--   · a size cap and an allowed-type list per upload
--   · `public_media_scope` / `_role` / `_entity_ref`, which is what makes a
--     document servable to a stranger AT ALL — an un-scoped vault row is
--     private, and a scoped one stops being servable the moment the scope is
--     cleared
--   · archival that clears the scope, so replaced media stops being a public
--     URL nobody remembers owning
--
-- A second store would have re-implemented five of those and got at least one
-- wrong. SUCCESS_STORY, SERVICE_TYPE and INSIGHT already ride this; SITE is the
-- fourth, and it needs no new column at all — only permission to use the ones
-- that exist.
--
-- ── THE ROLES, AND WHY ONLY THREE ARE NEW ──────────────────────────────────
--
-- `ck_vault_public_media_role` already admits COVER, CLIENT_LOGO, GALLERY and
-- ICON. Two of those already mean what the website needs:
--
--   COVER        reused for an entity's cover image      (13787)
--   GALLERY      reused where a set of images is shown
--
-- and three are genuinely new, because nothing existing means them:
--
--   PARTNER      a carrier, client or network mark       (13782)
--   CREDENTIAL   a certification or licence mark         (13783)
--   LEADER       a leadership portrait                   (13786)
--   ATMOSPHERE   a full-bleed band image with no subject
--
-- CLIENT_LOGO is deliberately NOT reused for PARTNER. It exists for success
-- stories and means "a customer of ours"; a carrier's mark is a capability
-- claim and a network's is a membership. Collapsing three claims into the role
-- that means one of them is the same mistake `site_partner.kind` exists to
-- prevent (N11: no logo wall).
--
-- ── ROLE IS NOT DECORATION ─────────────────────────────────────────────────
--
-- `doc/PUBLIC_WEB_EXPERIENCE_GUIDE.md` §1.3 forbids a GENERATED image in a slot
-- a visitor reads as documentary — a leadership portrait, an entity cover,
-- anything inside a case note. ATMOSPHERE is the one slot where generated
-- imagery is legitimate. The role recorded here is what lets that rule be
-- CHECKED rather than remembered.
--
-- ── BOTH CONSTRAINTS MOVE, AND THAT IS THE POINT OF TESTING MIGRATIONS ─────
--
-- The first draft of this migration widened the SCOPE alone. Replayed against a
-- real Postgres, every SITE upload was still rejected — by the ROLE constraint,
-- which no part of the diff mentioned. A scope nothing can be uploaded under is
-- a migration that applies cleanly and delivers nothing.
-- ============================================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_vault_public_media_scope'
       AND conrelid = 'document_vault'::regclass
  ) THEN
    ALTER TABLE document_vault DROP CONSTRAINT ck_vault_public_media_scope;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_vault_public_media_scope'
       AND conrelid = 'document_vault'::regclass
  ) THEN
    ALTER TABLE document_vault ADD CONSTRAINT ck_vault_public_media_scope
      CHECK (public_media_scope IS NULL
             OR public_media_scope IN ('SUCCESS_STORY', 'SERVICE_TYPE', 'INSIGHT', 'SITE'));
  END IF;

  -- The role constraint has to move with the scope, or nothing can be uploaded
  -- under it. See the header.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_vault_public_media_role'
       AND conrelid = 'document_vault'::regclass
  ) THEN
    ALTER TABLE document_vault DROP CONSTRAINT ck_vault_public_media_role;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_vault_public_media_role'
       AND conrelid = 'document_vault'::regclass
  ) THEN
    ALTER TABLE document_vault ADD CONSTRAINT ck_vault_public_media_role
      CHECK (public_media_role IS NULL
             OR public_media_role IN ('COVER', 'CLIENT_LOGO', 'GALLERY', 'ICON',
                                      'PARTNER', 'CREDENTIAL', 'LEADER', 'ATMOSPHERE'));
  END IF;
END $$;

-- ============================================================================
-- VERIFY
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'ck_vault_public_media_scope';   -- expect four scopes
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'ck_vault_public_media_role';    -- expect eight roles
--   -- A complete SITE row must be accepted (all four public_media_* columns
--   -- move together — ck_vault_public_media_complete):
--   UPDATE document_vault SET public_media_scope='SITE', public_media_role='PARTNER',
--          public_media_entity_ref='site_partner:1', public_media_content_type='image/png';
--
-- DOWN
--   -- Clear the scope first, or the narrowed CHECK cannot be added back and
--   -- SITE-scoped bytes would keep being servable with no constraint covering
--   -- them:
--   UPDATE document_vault
--      SET public_media_scope = NULL, public_media_role = NULL,
--          public_media_entity_ref = NULL, public_media_content_type = NULL
--    WHERE public_media_scope = 'SITE';
--   ALTER TABLE document_vault DROP CONSTRAINT IF EXISTS ck_vault_public_media_scope;
--   ALTER TABLE document_vault ADD CONSTRAINT ck_vault_public_media_scope
--     CHECK (public_media_scope IS NULL
--            OR public_media_scope IN ('SUCCESS_STORY', 'SERVICE_TYPE', 'INSIGHT'));
--   ALTER TABLE document_vault DROP CONSTRAINT IF EXISTS ck_vault_public_media_role;
--   ALTER TABLE document_vault ADD CONSTRAINT ck_vault_public_media_role
--     CHECK (public_media_role IS NULL
--            OR public_media_role IN ('COVER', 'CLIENT_LOGO', 'GALLERY', 'ICON'));
-- ============================================================================
