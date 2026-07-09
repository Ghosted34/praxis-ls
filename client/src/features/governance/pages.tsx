/** Governance skeletons — audit, notifications (Watch-the-Watcher), event engine, settings. */
import { ResourceList } from "@/components/resource-list";

export const AuditPage = () => (
  <ResourceList
    title="Audit ledger"
    description="Append-only trail. Read-only by design."
    endpoint="/audit"
    columns={[
      { key: "action", label: "Action" },
      { key: "module_key", label: "Module" },
      { key: "entity_ref", label: "Entity" },
      { key: "actor_user_id", label: "Actor" },
      { key: "created_at", label: "When" },
    ]}
  />
);

export const NotificationsPage = () => (
  <ResourceList
    title="Notifications"
    description="Watch-the-Watcher writes HIGH alerts here for CEO/Management on security-critical changes."
    endpoint="/notifications"
    columns={[
      { key: "priority", label: "Priority" },
      { key: "title", label: "Title" },
      { key: "event_type_key", label: "Event" },
      { key: "created_at", label: "When" },
    ]}
  />
);

export const WorkflowsPage = () => (
  <ResourceList
    title="Workflows"
    description="Validate/approve chains bound to approvable events (Universal Event Engine)."
    endpoint="/workflows"
    columns={[
      { key: "name", label: "Name" },
      { key: "event_type_key", label: "Event" },
      { key: "is_active", label: "Active" },
    ]}
  />
);

export const ApprovalsPage = () => (
  <ResourceList
    title="Approvals"
    description="Runtime approval queue."
    endpoint="/approvals?status=PENDING"
    columns={[
      { key: "entity_ref", label: "Entity" },
      { key: "status", label: "Status" },
      { key: "amount_xaf", label: "Amount (XAF)" },
      { key: "created_at", label: "Created" },
    ]}
  />
);

export const SettingsPage = () => (
  <ResourceList title="Settings" description="Tenant configuration key/value store." endpoint="/settings" />
);
