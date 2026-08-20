-- ============================================================================
-- TENANT DB — 10740 Signature engine (PR-2).
--
-- One definition, two renderers. The template is layout + authored wording;
-- the person fields that HR already stores are read live; the few fields the
-- employee table does not carry (desk/mobile today) live on the user profile.
--
-- Derived fields are NEVER stored on the profile. A promotion that rewrote a
-- stored title would also rewrite history, which Q16 forbade and which PR-5's
-- archive would then have to lie about.
-- ============================================================================

CREATE TABLE IF NOT EXISTS signature_template (
  signature_template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key            text NOT NULL UNIQUE,
  name           text NOT NULL,
  description    text,
  layout         jsonb NOT NULL DEFAULT '{}'::jsonb,
  copy_en        jsonb NOT NULL DEFAULT '{}'::jsonb,
  copy_fr        jsonb NOT NULL DEFAULT '{}'::jsonb,
  scope_kind     text NOT NULL DEFAULT 'TENANT'
                   CHECK (scope_kind IN ('TENANT','DEPARTMENT','ENTITY')),
  scope_value    text,
  is_default     boolean NOT NULL DEFAULT false,
  is_system      boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- One default per scope. COALESCE so a TENANT-wide default (scope_value NULL)
-- still participates in the uniqueness, rather than allowing two of them.
CREATE UNIQUE INDEX IF NOT EXISTS ux_signature_template_default
  ON signature_template (scope_kind, COALESCE(scope_value, ''))
  WHERE is_default;

CREATE INDEX IF NOT EXISTS ix_signature_template_scope
  ON signature_template (scope_kind, scope_value);

CREATE TABLE IF NOT EXISTS user_signature_profile (
  user_id        uuid PRIMARY KEY REFERENCES app_user(user_id) ON DELETE CASCADE,
  signature_template_id uuid REFERENCES signature_template(signature_template_id),
  phone_desk     text,
  phone_mobile   text,
  whatsapp       text,
  pronouns       text,
  credentials    text,
  booking_url    text,
  language       text CHECK (language IN ('en','fr')),
  extra          jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_enabled     boolean NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signature_render (
  signature_render_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES app_user(user_id) ON DELETE CASCADE,
  identity_key   text,
  language       text NOT NULL CHECK (language IN ('en','fr')),
  format         text NOT NULL CHECK (format IN ('HTML','PNG')),
  scale          smallint NOT NULL DEFAULT 1 CHECK (scale IN (1,2,3)),
  content        text,
  storage_path   text,
  source_hash    text NOT NULL,
  generated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_signature_render_subject
    CHECK (num_nonnulls(user_id, identity_key) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_signature_render
  ON signature_render (COALESCE(user_id::text, identity_key), language, format, scale);

CREATE INDEX IF NOT EXISTS ix_signature_render_user
  ON signature_render (user_id) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_signature_render_identity
  ON signature_render (identity_key) WHERE identity_key IS NOT NULL;

-- DOWN
--   DROP TABLE IF EXISTS signature_render;
--   DROP TABLE IF EXISTS user_signature_profile;
--   DROP TABLE IF EXISTS signature_template;
