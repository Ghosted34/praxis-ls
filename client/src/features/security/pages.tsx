/**
 * Security & Access admin screens — skeletal (read-only lists) by intent. The
 * roles/permission-matrix/capabilities/scopes/field-visibility screens are the
 * first real auth+RBAC round-trip (client/README.md); build create/edit and the
 * grant-matrix grid on top of these as prioritised.
 */
import { ResourceList } from "@/components/resource-list";

export const UsersPage = () => (
  <ResourceList
    title="Users"
    description="Tenant users. Now gated (MOD-67) — you'll see this only with the grant or as CEO."
    endpoint="/users"
    columns={[
      { key: "email", label: "Email" },
      { key: "full_name", label: "Name" },
      { key: "status", label: "Status" },
      { key: "is_2fa_enabled", label: "2FA" },
    ]}
  />
);

export const RolesPage = () => (
  <ResourceList
    title="Roles"
    description="Default roles are seeded; Super Admin can add tenant-specific ones."
    endpoint="/roles"
    columns={[
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
      { key: "is_system", label: "System" },
      { key: "is_line_manager", label: "Line manager" },
    ]}
  />
);

export const PermissionsPage = () => (
  <ResourceList
    title="Permission matrix"
    description="role × module CRUD grants. A grid editor goes here next; this lists the seeded grants."
    endpoint="/permissions"
    columns={[
      { key: "role_id", label: "Role" },
      { key: "module_key", label: "Module" },
      { key: "can_read", label: "Read" },
      { key: "can_create", label: "Create" },
      { key: "can_update", label: "Update" },
      { key: "can_delete", label: "Delete" },
      { key: "can_approve", label: "Approve" },
    ]}
  />
);

export const CapabilitiesPage = () => (
  <ResourceList
    title="Capabilities"
    description="Authority overlay (ISSUER / VALIDATOR / APPROVER / LINE_MANAGER)."
    endpoint="/capabilities"
    columns={[
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
    ]}
  />
);

export const ScopesPage = () => (
  <ResourceList
    title="Scopes"
    description="Entity / branch / department a user can be confined to."
    endpoint="/scopes"
    columns={[
      { key: "code", label: "Code" },
      { key: "name", label: "Name" },
      { key: "entity_id", label: "Entity" },
    ]}
  />
);

export const FieldVisibilityPage = () => (
  <ResourceList
    title="Field visibility"
    description="Per-role field masking (margins, salaries, cost rates)."
    endpoint="/field-visibility"
    columns={[
      { key: "role_id", label: "Role" },
      { key: "field_key", label: "Field" },
      { key: "visibility", label: "Visibility" },
    ]}
  />
);

export const SessionsPage = () => (
  <ResourceList
    title="My sessions"
    description="Your active sessions. Self-scoped — no grant needed."
    endpoint="/sessions/mine"
    columns={[
      { key: "session_id", label: "Session" },
      { key: "ip", label: "IP" },
      { key: "created_at", label: "Started" },
      { key: "last_seen_at", label: "Last seen" },
    ]}
  />
);
