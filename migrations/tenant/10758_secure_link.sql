CREATE TABLE IF NOT EXISTS secure_link (
  secure_link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   text NOT NULL UNIQUE,
  target_kind  text NOT NULL CHECK (target_kind IN ('VAULT_DOC','GENERATED_PDF')),
  target_ref   text NOT NULL,
  entity_ref   text,
  label        text,
  created_by   uuid NOT NULL REFERENCES app_user(user_id),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  first_viewed_at timestamptz,
  view_count   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS secure_link_view (
  secure_link_view_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  secure_link_id uuid NOT NULL REFERENCES secure_link(secure_link_id) ON DELETE CASCADE,
  ip inet, user_agent text, viewed_at timestamptz NOT NULL DEFAULT now()
);
-- DOWN
--   DROP TABLE IF EXISTS secure_link_view, secure_link;
