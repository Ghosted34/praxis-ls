-- ============================================================================
-- TENANT DB — 0460 portal_user (external-user auth for the Client / Investor /
-- Audit portals, PRD §11.1). Credentials ONLY — the *scope* (which portal, which
-- client) stays in portal_access (0340), so a grant can be revoked without
-- touching the login. External users are never app_user rows: they carry no RBAC
-- role and can only reach the scoped portal views. Authenticated against the
-- identity (live) schema, like app_user.
-- ============================================================================

CREATE TABLE portal_user (
  portal_user_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            citext UNIQUE NOT NULL,
  password_hash    text NOT NULL,                    -- Argon2id
  full_name        text,
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  failed_logins    integer NOT NULL DEFAULT 0,
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_portal_user_updated BEFORE UPDATE ON portal_user FOR EACH ROW EXECUTE FUNCTION set_updated_at();
