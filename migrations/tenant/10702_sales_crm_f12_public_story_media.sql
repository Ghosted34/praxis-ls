-- F12: publication is explicit vault metadata, never inferred from an arbitrary
-- document id appearing in success_story.
ALTER TABLE document_vault
  ADD COLUMN IF NOT EXISTS public_media_scope text,
  ADD COLUMN IF NOT EXISTS public_media_entity_ref text,
  ADD COLUMN IF NOT EXISTS public_media_role text,
  ADD COLUMN IF NOT EXISTS public_media_content_type text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_vault_public_media_scope'
       AND conrelid = 'document_vault'::regclass
  ) THEN
    ALTER TABLE document_vault ADD CONSTRAINT ck_vault_public_media_scope
      CHECK (public_media_scope IS NULL OR public_media_scope IN ('SUCCESS_STORY'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_vault_public_media_role'
       AND conrelid = 'document_vault'::regclass
  ) THEN
    ALTER TABLE document_vault ADD CONSTRAINT ck_vault_public_media_role
      CHECK (public_media_role IS NULL OR public_media_role IN ('COVER','CLIENT_LOGO','GALLERY'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_vault_public_media_content_type'
       AND conrelid = 'document_vault'::regclass
  ) THEN
    ALTER TABLE document_vault ADD CONSTRAINT ck_vault_public_media_content_type
      CHECK (public_media_content_type IS NULL OR public_media_content_type IN ('image/png','image/jpeg','image/webp'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_vault_public_media_complete'
       AND conrelid = 'document_vault'::regclass
  ) THEN
    ALTER TABLE document_vault ADD CONSTRAINT ck_vault_public_media_complete CHECK (
      (public_media_scope IS NULL AND public_media_entity_ref IS NULL AND public_media_role IS NULL AND public_media_content_type IS NULL)
      OR
      (public_media_scope IS NOT NULL AND public_media_entity_ref IS NOT NULL AND public_media_role IS NOT NULL AND public_media_content_type IS NOT NULL)
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_vault_public_media_binding
  ON document_vault(public_media_scope, public_media_entity_ref, public_media_role)
  WHERE public_media_scope IS NOT NULL;
