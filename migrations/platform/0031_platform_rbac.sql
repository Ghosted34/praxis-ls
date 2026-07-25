-- ============================================================================
-- 0031 — Platform-tier RBAC: custom roles + a role×capability permission matrix
-- (replaces the earlier fixed 3-role CHECK). Root Admin bypasses checks in code
-- (like the tenant CEO), so it always keeps full access even for new caps.
-- ============================================================================

CREATE TABLE platform.platform_role (
  role_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        citext UNIQUE NOT NULL,          -- 'PLATFORM_ROOT_ADMIN' | custom
  name        text NOT NULL,
  is_system   boolean NOT NULL DEFAULT false,  -- system roles can't be deleted
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.platform_role_permission (
  role_id     uuid NOT NULL REFERENCES platform.platform_role(role_id) ON DELETE CASCADE,
  capability  text NOT NULL,                   -- from the code capability catalogue
  PRIMARY KEY (role_id, capability)
);

-- platform_user.role stays a text code, but is no longer limited to the 3
-- built-ins — it now names any platform_role.code.
ALTER TABLE platform.platform_user DROP CONSTRAINT IF EXISTS platform_user_role_check;

-- Seed the three built-in roles.
INSERT INTO platform.platform_role (code, name, is_system) VALUES
  ('PLATFORM_ROOT_ADMIN', 'Root Admin', true),
  ('PLATFORM_SUPPORT',    'Support',    true),
  ('PLATFORM_BILLING',    'Billing',    true)
ON CONFLICT (code) DO NOTHING;

-- Seed each built-in role's capabilities (Root gets the full set for display;
-- it also bypasses checks in code).
INSERT INTO platform.platform_role_permission (role_id, capability)
SELECT r.role_id, c.capability
FROM platform.platform_role r
CROSS JOIN (VALUES
  ('tenants.read'),('tenants.write'),('features.write'),
  ('plans.read'),('plans.write'),
  ('users.read'),('users.write'),
  ('roles.read'),('roles.write'),
  ('support.read'),('support.write'),
  ('audit.read'),('catalogue.read')
) AS c(capability)
WHERE r.code = 'PLATFORM_ROOT_ADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO platform.platform_role_permission (role_id, capability)
SELECT r.role_id, c.capability
FROM platform.platform_role r
CROSS JOIN (VALUES
  ('tenants.read'),('support.read'),('support.write'),
  ('plans.read'),('audit.read'),('catalogue.read')
) AS c(capability)
WHERE r.code = 'PLATFORM_SUPPORT'
ON CONFLICT DO NOTHING;

INSERT INTO platform.platform_role_permission (role_id, capability)
SELECT r.role_id, c.capability
FROM platform.platform_role r
CROSS JOIN (VALUES
  ('tenants.read'),('plans.read'),('plans.write'),
  ('audit.read'),('catalogue.read')
) AS c(capability)
WHERE r.code = 'PLATFORM_BILLING'
ON CONFLICT DO NOTHING;
