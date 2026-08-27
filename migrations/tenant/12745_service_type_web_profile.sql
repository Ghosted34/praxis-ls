-- 12745 Service type web profiles (PR1 of SERVICE_TYPE_WEB_PROFILE_ENGINEERING_GUIDE).
--
-- ── DEPENDENCIES ─────────────────────────────────────────────────────────────
-- 0310  service_type                (FK target; the master table)
-- 0340  document_vault              (CHECK extension; the media allowlist)
-- 0340  set_updated_at()            (the BEFORE UPDATE trigger function)
-- All three exist on every tenant the migrations job provisions — this file
-- only runs after 0310 and 0340. The reversibility + idempotency gate reads
-- this file, the migrations job applies the whole tenant set TWICE, so every
-- statement is idempotent.
--
-- ── SCOPE ───────────────────────────────────────────────────────────────────
-- One tenant migration covers three tables: profile (1:1 on service_type),
-- FAQ (bilingual rows), related (manual picks). Partial unique indexes on
-- slug_fr / slug_en (WHERE NOT NULL) match the success_story precedent from
-- 0694 — drafts included, because two services must never discover at
-- publish time that they both wanted /fr/fret-maritime. Slugs are `text`, not
-- citext, because the regex forces lowercase ASCII — case-insensitivity is
-- a property of the regex, not the column type.
--
-- `document_vault` gains 'SERVICE_TYPE' on its public_media_scope CHECK and
-- 'ICON' on public_media_role. Content type stays images-only (video is an
-- external embed URL per guide §11 decision 3, not a vault row). The drop /
-- re-add is IF NOT EXISTS-guarded exactly like 10702.
--
-- ── NOT IN THIS FILE ────────────────────────────────────────────────────────
-- No seed rows. A profile row means "this service goes on the website", which
-- is the tenant's decision in the tenant's voice (guide §4.1 notes). The
-- fifteen system service types get no pre-created profiles, no pre-filled
-- slugs.

CREATE TABLE IF NOT EXISTS service_type_web_profile (
  service_type_id        uuid PRIMARY KEY REFERENCES service_type(service_type_id) ON DELETE CASCADE,
  short_description_fr   text,
  short_description_en   text,
  long_description_fr    text,
  long_description_en    text,
  highlights_fr          jsonb NOT NULL DEFAULT '[]'::jsonb,
  highlights_en          jsonb NOT NULL DEFAULT '[]'::jsonb,
  coverage_fr            text,
  coverage_en            text,
  slug_fr                text,
  slug_en                text,
  meta_title_fr          text,
  meta_title_en          text,
  meta_description_fr    text,
  meta_description_en    text,
  cover_vault_id         uuid REFERENCES document_vault(doc_id),
  icon_vault_id          uuid REFERENCES document_vault(doc_id),
  gallery_vault_ids      uuid[] NOT NULL DEFAULT '{}'::uuid[],
  video_url              text,
  is_published           boolean NOT NULL DEFAULT false,
  published_at           timestamptz,
  published_by           uuid REFERENCES app_user(user_id),
  sort_order             integer NOT NULL DEFAULT 100,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_stwp_slug_fr
  ON service_type_web_profile(slug_fr) WHERE slug_fr IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_stwp_slug_en
  ON service_type_web_profile(slug_en) WHERE slug_en IS NOT NULL;

CREATE OR REPLACE TRIGGER trg_stwp_updated
  BEFORE UPDATE ON service_type_web_profile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS service_type_web_faq (
  faq_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type_id  uuid NOT NULL REFERENCES service_type(service_type_id) ON DELETE CASCADE,
  question_fr      text NOT NULL,
  question_en      text NOT NULL,
  answer_fr        text NOT NULL,
  answer_en        text NOT NULL,
  sort_order       integer NOT NULL DEFAULT 100,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_stwp_faq
  ON service_type_web_faq(service_type_id, sort_order);

CREATE OR REPLACE TRIGGER trg_stwfaq_updated
  BEFORE UPDATE ON service_type_web_faq
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS service_type_web_related (
  service_type_id          uuid NOT NULL REFERENCES service_type(service_type_id) ON DELETE CASCADE,
  related_service_type_id  uuid NOT NULL REFERENCES service_type(service_type_id) ON DELETE CASCADE,
  PRIMARY KEY (service_type_id, related_service_type_id),
  CONSTRAINT ck_stwp_related_not_self CHECK (service_type_id <> related_service_type_id)
);

-- Public list sort + name_fr ordering (guide §4.6). The partial index is on
-- published-and-active only, because those are the rows the anonymous list
-- ever returns; an index over every row would be larger and never read.
-- Drafts are excluded; the admin GET uses a different path.
CREATE INDEX IF NOT EXISTS ix_stwp_public_list
  ON service_type_web_profile(sort_order, service_type_id)
  WHERE is_published = true;

-- ── document_vault public-media allowlist extension (guide §4.3) ────────────
-- 10702 introduced the four public_media_* CHECKs. We extend scope and role
-- with IF NOT EXISTS-guarded drop / re-add, content type stays images-only
-- (video is an embed URL, not a vault row, per decision 3).
DO $$
BEGIN
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
      CHECK (public_media_scope IS NULL OR public_media_scope IN ('SUCCESS_STORY', 'SERVICE_TYPE'));
  END IF;

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
      CHECK (public_media_role IS NULL OR public_media_role IN ('COVER', 'CLIENT_LOGO', 'GALLERY', 'ICON'));
  END IF;
END $$;

-- DOWN
-- Order matters: tables first (so FKs from the indexes/triggers drop with them),
-- then the constraint re-tightening, then the indexes.
--
--   DROP TRIGGER IF EXISTS trg_stwp_updated ON service_type_web_profile;
--   DROP TRIGGER IF EXISTS trg_stwfaq_updated ON service_type_web_faq;
--   DROP INDEX IF EXISTS ix_stwp_public_list;
--   DROP INDEX IF EXISTS ix_stwp_faq;
--   DROP INDEX IF EXISTS ux_stwp_slug_en;
--   DROP INDEX IF EXISTS ux_stwp_slug_fr;
--   DROP TABLE IF EXISTS service_type_web_related;
--   DROP TABLE IF EXISTS service_type_web_faq;
--   DROP TABLE IF EXISTS service_type_web_profile;
--
--   ALTER TABLE document_vault DROP CONSTRAINT ck_vault_public_media_scope;
--   ALTER TABLE document_vault DROP CONSTRAINT ck_vault_public_media_role;
--   ALTER TABLE document_vault ADD CONSTRAINT ck_vault_public_media_scope
--     CHECK (public_media_scope IS NULL OR public_media_scope IN ('SUCCESS_STORY'));
--   ALTER TABLE document_vault ADD CONSTRAINT ck_vault_public_media_role
--     CHECK (public_media_role IS NULL OR public_media_role IN ('COVER','CLIENT_LOGO','GALLERY'));
