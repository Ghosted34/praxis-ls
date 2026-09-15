-- ============================================================================
-- TENANT — 13789 Provenance and derivatives for website media.
--
-- 13788 taught the vault that a document can belong to the website. This one
-- teaches it the two things the website needs to know about that document
-- before it will put it on a page: WHERE THE IMAGE CAME FROM, and WHICH SIZES
-- of it exist.
--
-- ── WHY PROVENANCE IS A COLUMN AND A CHECK, NOT A CONVENTION ───────────────
--
-- `doc/PUBLIC_WEB_EXPERIENCE_GUIDE.md` §1.3 is a rule about a reader's
-- inference:
--
--   "A photoreal generated asset may never be captioned, captioned-adjacent, or
--    positioned such that a reasonable visitor concludes it is a photograph of
--    the tenant's own operations."
--
-- Concretely forbidden: a leadership block, an entity profile, a case note, a
-- proof band, anything under a place name. Permitted: full-bleed atmosphere.
--
-- That is exactly the kind of rule that erodes without enforcement, because the
-- reasoning behind it lives in a document nobody has open at the moment it
-- matters — six months from now somebody needs a portrait for a leadership card
-- and the only image to hand is generated. `public-web/src/assets/manifest.ts`
-- states the slot rule and `check:assets` enforces it for assets declared in
-- the register; this constraint enforces it for the bytes themselves, which is
-- the half a build gate cannot reach.
--
-- 13782 already made this argument for `permission_note`, and the same sentence
-- applies here: a validator can be bypassed by a repair script at 2am; a CHECK
-- cannot.
--
-- ── THE RULE, STATED AS STRICTLY AS THE GUIDE ALLOWS ───────────────────────
--
-- `generated` may occupy ATMOSPHERE and nothing else.
--
-- §1.3's forbidden LIST is leadership portraits, entity covers and service
-- covers; this constraint additionally refuses PARTNER, CREDENTIAL, GALLERY and
-- ICON. That is deliberate and it is not over-reach: a partner's mark and a
-- certifier's mark are other organisations' trademarks, and a *generated*
-- version of somebody else's logo is a worse failure than a generated portrait,
-- not a lesser one. ATMOSPHERE is the one role the guide names as legitimately
-- generated, so it is the one role named here.
--
-- ── AND WHY 'SITE' MEDIA MUST DECLARE IT ───────────────────────────────────
--
-- A NULL provenance is not "unknown, probably fine" — it is an unanswered
-- question on a public page. §6.3 makes provenance a required field on upload;
-- `ck_vault_site_media_needs_provenance` is what makes that true of the row
-- rather than of the form. Documents outside the SITE scope are untouched:
-- they are not published as imagery and have no such question to answer.
--
-- ── DERIVATIVES ────────────────────────────────────────────────────────────
--
-- §6.3: "Server-side derivatives on upload: AVIF + WebP, at 3 widths, srcset
-- emitted by the renderer. This is where the page budget is won or lost."
--
-- `public_media_variants` records WHICH of those exist, as
-- `{"widths":[480,960,1600],"formats":["avif","webp"]}`. Not the storage keys:
-- those are derived from the original's own key by `site_media.service.js`, so
-- there is exactly one function that knows how a variant is named and no way
-- for a caller's string to become part of a path. A width is only listed when
-- it was actually written, because sharp never upscales — a 700px logo yields
-- 480 only, and a srcset advertising 1600 would be three 404s per visitor.
--
-- NULL means "no derivatives", which is the correct reading for every document
-- uploaded before this migration and for an SVG (which needs none — it is
-- resolution-independent, and that is the format O-3 asks partners for).
-- ============================================================================

ALTER TABLE document_vault
  ADD COLUMN IF NOT EXISTS public_media_provenance text,
  ADD COLUMN IF NOT EXISTS public_media_variants   jsonb;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_vault_public_media_provenance'
       AND conrelid = 'document_vault'::regclass
  ) THEN
    ALTER TABLE document_vault ADD CONSTRAINT ck_vault_public_media_provenance
      CHECK (public_media_provenance IS NULL
             OR public_media_provenance IN ('owned', 'licensed', 'generated'));
  END IF;

  -- §1.3, as a constraint. See the header for why the list is shorter than the
  -- role list rather than longer.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_vault_generated_is_atmosphere_only'
       AND conrelid = 'document_vault'::regclass
  ) THEN
    ALTER TABLE document_vault ADD CONSTRAINT ck_vault_generated_is_atmosphere_only
      CHECK (public_media_provenance IS DISTINCT FROM 'generated'
             OR public_media_role = 'ATMOSPHERE');
  END IF;

  -- A website image with no recorded provenance is an unanswered question on a
  -- public page. Other scopes are not imagery and are left alone.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_vault_site_media_needs_provenance'
       AND conrelid = 'document_vault'::regclass
  ) THEN
    ALTER TABLE document_vault ADD CONSTRAINT ck_vault_site_media_needs_provenance
      CHECK (public_media_scope IS DISTINCT FROM 'SITE'
             OR public_media_provenance IS NOT NULL);
  END IF;
END $$;

COMMENT ON COLUMN document_vault.public_media_provenance IS
  'owned | licensed | generated — guide §1.3. A generated image may occupy ATMOSPHERE and no other role: the rule is about what a visitor infers from placement, and it is a CHECK because the reasoning behind it lives in a document nobody has open at the moment it matters.';
COMMENT ON COLUMN document_vault.public_media_variants IS
  'Which derivatives exist: {"widths":[…],"formats":["avif","webp"]}. Storage keys are derived from the original''s key by site_media.service.js, so one function knows how a variant is named and no caller string reaches a path. A width appears only when it was written — sharp never upscales.';

-- ============================================================================
-- VERIFY
--   -- A generated atmosphere image is accepted:
--   UPDATE document_vault
--      SET public_media_scope='SITE', public_media_role='ATMOSPHERE',
--          public_media_entity_ref='site:atmosphere-01',
--          public_media_content_type='image/webp',
--          public_media_provenance='generated'
--    WHERE doc_id = '…';                                  -- expect UPDATE 1
--
--   -- The same bytes in a leadership slot are not:
--   UPDATE document_vault SET public_media_role='LEADER' WHERE doc_id = '…';
--     -- expect 23514 ck_vault_generated_is_atmosphere_only
--
--   -- Nor is a SITE document that declares nothing:
--   UPDATE document_vault
--      SET public_media_scope='SITE', public_media_role='PARTNER',
--          public_media_entity_ref='site_partner:…',
--          public_media_content_type='image/png',
--          public_media_provenance=NULL
--    WHERE doc_id = '…';
--     -- expect 23514 ck_vault_site_media_needs_provenance
--
-- DOWN
--   ALTER TABLE document_vault
--     DROP CONSTRAINT IF EXISTS ck_vault_site_media_needs_provenance;
--   ALTER TABLE document_vault
--     DROP CONSTRAINT IF EXISTS ck_vault_generated_is_atmosphere_only;
--   ALTER TABLE document_vault
--     DROP CONSTRAINT IF EXISTS ck_vault_public_media_provenance;
--   -- The columns are dropped LAST and the data goes with them: provenance is
--   -- the record of whether an image may legally be on a page, so a down that
--   -- keeps the column without its constraints is worse than one that removes
--   -- both. Re-uploading is the recovery path.
--   ALTER TABLE document_vault DROP COLUMN IF EXISTS public_media_variants;
--   ALTER TABLE document_vault DROP COLUMN IF EXISTS public_media_provenance;
-- ============================================================================
