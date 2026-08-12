// Typed client for the Kaizen ops endpoints (/api/platform/ops/*).
//
// Separate from api.ts for the same reason errors-api.ts is: this is a whole
// subsystem with its own row shapes, and folding twenty more endpoints and a
// dozen types into the main client makes the file that every screen imports
// twice as long for the benefit of screens that don't use any of it.
//
// Every type here mirrors a table in migrations/platform/0094 and 0095. Where a
// field is nullable in the DDL it is nullable here — a tenant that has never
// been backed up, probed or drilled is the case these screens exist to make
// visible, and typing those away would hide exactly the rows worth reading.
import { api, can } from "./api";

/* ── Capability helpers ──────────────────────────────────────────────────── */
//
// Here rather than next to the nav component so the ops screens can import them
// without pulling in a React module (and so the nav file exports only
// components, which is what Fast Refresh needs).
//
// These mirror the server's three tiers exactly. They hide buttons; they do not
// enforce anything — requireCap on the route is the actual gate, and a hidden
// button is a courtesy, not a control.

/** Can the signed-in role trigger work — backups, drills, syncs, probes? */
export const canOperate = () => can("ops.operate");
/** Can it schedule or cancel a maintenance window (which tenant users see)? */
export const canMaintain = () => can("ops.maintain");

/* ── Health (WS-H1 / H2) ─────────────────────────────────────────────────── */

export type HealthStatus = "GREEN" | "AMBER" | "RED";

export type TenantHealth = {
  slug: string;
  tenant_id: string;
  // Null across the board when the collector has never run for this tenant.
  captured_at: string | null;
  status: HealthStatus | null;
  reasons: string[] | null;
  pool_total: number | null;
  pool_idle: number | null;
  pool_waiting: number | null;
  schema_behind: number | null;
  schema_unreachable: boolean | null;
  jobs_failed_24h: number | null;
  mail_verified: boolean | null;
  redis_ok: boolean | null;
  liveness_ok: boolean | null;
  liveness_ms: number | null;
  last_error_at: string | null;
  error_count_24h: number | null;
};

export type FleetHealth = {
  tenants: TenantHealth[];
  green?: number;
  amber?: number;
  red?: number;
  total?: number;
};

/* ── Backup (WS-B1) ──────────────────────────────────────────────────────── */

export type BackupTenantStatus = {
  tenant_id: string;
  slug: string;
  last_ok_at: string | null;
  last_ok_bytes: number | null;
  last_ok_location: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  never_backed_up: boolean;
  stale: boolean;
  age_hours: number | null;
};

export type BackupStatus = {
  rpo_hours: number;
  tenants: BackupTenantStatus[];
  stale_count: number;
  never_count: number;
};

export type BackupRunKind = "PG_DUMP" | "WAL" | "OBJECT_SYNC" | "SNAPSHOT_SCAN";

export type BackupRun = {
  backup_run_id: string;
  tenant_id: string | null;
  slug: string | null;
  kind: BackupRunKind;
  status: "OK" | "FAILED";
  bytes: number | null;
  location: string | null;
  checksum: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  error: string | null;
};

export type BackupPreflight = {
  ok: boolean;
  pg_dump: string | null;
  pg_restore: string | null;
  server: string | null;
  error: string | null;
};

export type WalStatus = {
  enabled: boolean;
  healthy?: boolean;
  segments?: number;
  newest_at?: string | null;
  lag_minutes?: number | null;
  max_lag_minutes?: number;
  // The RPO that actually holds right now — minutes while the archive is
  // healthy, 24h otherwise. Not the number in the plan; the number in reality.
  rpo_minutes: number;
  error?: string | null;
  note?: string;
};

export type ObjectStatus = {
  slug: string;
  last_sync_at: string | null;
  last_sync_status: "OK" | "FAILED" | null;
  last_scan_at: string | null;
  last_scan_status: "OK" | "FAILED" | null;
  last_scan_error: string | null;
};

/* ── Restore drills (WS-B3) ──────────────────────────────────────────────── */

export type RestoreDrill = {
  restore_drill_id: string;
  tenant_id: string | null;
  slug: string | null;
  backup_run_id: string | null;
  restored_to: string | null;
  rto_seconds: number | null;
  ok: boolean;
  checks_json: Record<string, unknown>;
  error: string | null;
  ran_at: string;
};

export type DrillCoverage = {
  slug: string;
  last_drill_at: string | null;
  last_ok_drill_at: string | null;
  drill_count: number;
};

export type DrillsResult = {
  drills: RestoreDrill[];
  coverage: DrillCoverage[];
  never_drilled: string[];
  rto_target_seconds: number;
};

/* ── Uptime (WS-U1) ──────────────────────────────────────────────────────── */

export type HostAvailability = {
  host: string;
  tenant_id: string | null;
  recorded: number;
  // The denominator is EXPECTED samples derived from the probe interval, not
  // recorded ones. A missing sample counts as down — otherwise the metric goes
  // blind during exactly the outages that stopped the prober writing rows.
  expected: number;
  up_samples: number;
  availability_pct: number | null;
  avg_latency_ms: number | null;
  first_at: string;
  last_at: string;
};

export type UptimeIncident = {
  host: string;
  from: string;
  until: string;
  samples: number;
  error: string | null;
  resolved: boolean;
  duration_minutes: number;
};

export type ProbeTarget = { host: string; tenant_id: string | null; slug: string | null };

/* ── Maintenance (WS-M1) ─────────────────────────────────────────────────── */

export type MaintenanceWindow = {
  maintenance_window_id: string;
  tenant_id: string | null;
  // Joined server-side. Null means a fleet-wide window, not a missing lookup —
  // the tenant list endpoint doesn't return tenant_id to resolve against.
  slug: string | null;
  starts_at: string;
  ends_at: string;
  title: string;
  message: string | null;
  mode: "ANNOUNCE" | "READ_ONLY";
  // Hours before starts_at that tenant users begin seeing the banner. 0 = no
  // advance notice.
  notice_hours: number;
  cancelled_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type MaintenanceInput = {
  // Slug, not id: it's what the operator sees everywhere else in the console.
  tenant_slug?: string | null;
  starts_at: string;
  ends_at: string;
  title: string;
  message?: string | null;
  mode?: "ANNOUNCE" | "READ_ONLY";
  notice_hours?: number;
};

/* ── Entitlement & metering (WS-S3) ──────────────────────────────────────── */

export type MetricSpec = {
  metric: string;
  kind: "level" | "flow";
  label: string;
  unit: string | null;
  // false = declared so an entitlement can be set, but nothing measures it yet.
  // Shown explicitly rather than silently always reading zero.
  metered: boolean;
};

export type UsageMetric = {
  metric: string;
  label: string;
  unit: string | null;
  used: number;
  // null = unlimited, which is NOT the same as zero. A metric with no
  // entitlement is uncapped.
  limit: number | null;
  hard: boolean;
  measured_at: string | null;
  pct: number | null;
  over: boolean;
  warning?: boolean;
};

export type TenantUsage = {
  slug: string;
  tenant_id: string;
  plan: string | null;
  metrics: UsageMetric[];
};

export type FleetUsage = {
  period: string;
  tenants: TenantUsage[];
  over: { slug: string; metrics: string[] }[];
};

export type Entitlement = {
  plan_id: string;
  metric: string;
  limit_value: number;
  hard: boolean;
  updated_at: string;
};

/* ── Client ──────────────────────────────────────────────────────────────── */

const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? "?" + s : "";
};

export const ops = {
  // Health
  fleetHealth: () => api<FleetHealth>("/ops/health"),
  tenantHealth: (tenantId: string, hours = 24) =>
    api<TenantHealth[]>(`/ops/health/${encodeURIComponent(tenantId)}${qs({ hours })}`),
  collectHealth: () => api<{ total: number; red: number; amber: number; green: number }>(
    "/ops/health/collect", { method: "POST" },
  ),

  // Postgres backup
  backupStatus: (rpoHours?: number) =>
    api<BackupStatus>(`/ops/backups${qs({ rpo_hours: rpoHours })}`),
  backupRuns: (params: { limit?: number; kind?: BackupRunKind; status?: "OK" | "FAILED"; slug?: string } = {}) =>
    api<BackupRun[]>(`/ops/backups/runs${qs(params)}`),
  backupPreflight: () => api<BackupPreflight>("/ops/backups/preflight"),
  walStatus: () => api<WalStatus>("/ops/backups/wal"),
  backupTenant: (slug: string) =>
    api<{ accepted: boolean; slug: string }>(`/ops/backups/${encodeURIComponent(slug)}`, { method: "POST" }),
  backupFleet: () => api<{ accepted: boolean }>("/ops/backups", { method: "POST" }),
  pruneBackups: () => api<{ removed: string[]; kept: number }>("/ops/backups/prune", { method: "POST" }),

  // Objects
  objectStatus: () => api<ObjectStatus[]>("/ops/objects"),
  syncObjects: (slug: string) =>
    api<{ accepted: boolean }>(`/ops/objects/${encodeURIComponent(slug)}/sync`, { method: "POST" }),
  scanObjects: (slug: string) =>
    api<{ accepted: boolean }>(`/ops/objects/${encodeURIComponent(slug)}/scan`, { method: "POST" }),

  // Drills
  drills: (limit = 50) => api<DrillsResult>(`/ops/drills${qs({ limit })}`),
  drillTenant: (slug: string, at?: string | null) =>
    api<{ accepted: boolean }>(`/ops/drills/${encodeURIComponent(slug)}`, { method: "POST", body: { at: at ?? null } }),
  drillScheduled: () => api<{ accepted: boolean }>("/ops/drills", { method: "POST" }),

  // Uptime
  availability: (days = 30) => api<HostAvailability[]>(`/ops/uptime${qs({ days })}`),
  incidents: (days = 30) => api<UptimeIncident[]>(`/ops/uptime/incidents${qs({ days })}`),
  probeTargets: () => api<ProbeTarget[]>("/ops/uptime/targets"),
  probeNow: () => api<{ probed: number; down: number }>("/ops/uptime/probe", { method: "POST" }),

  // Maintenance
  maintenance: (includePast = false) =>
    api<MaintenanceWindow[]>(`/ops/maintenance${qs({ include_past: includePast })}`),
  scheduleMaintenance: (body: MaintenanceInput) =>
    api<MaintenanceWindow>("/ops/maintenance", { method: "POST", body }),
  cancelMaintenance: (id: string) =>
    api<MaintenanceWindow>(`/ops/maintenance/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // Entitlement & metering (WS-S3)
  usage: (period?: string) => api<FleetUsage>(`/ops/usage${qs({ period })}`),
  tenantUsage: (tenantId: string) => api<UsageMetric[]>(`/ops/usage/${encodeURIComponent(tenantId)}`),
  usageMetrics: () => api<MetricSpec[]>("/ops/usage/metrics"),
  measureUsage: () => api<{ accepted: boolean }>("/ops/usage/measure", { method: "POST" }),
  entitlements: () => api<Entitlement[]>("/ops/entitlements"),
  setEntitlement: (planId: string, body: { metric: string; limit_value: number; hard: boolean }) =>
    api<Entitlement>(`/ops/entitlements/${encodeURIComponent(planId)}`, { method: "PUT", body }),
  removeEntitlement: (planId: string, metric: string) =>
    api<{ removed: boolean }>(`/ops/entitlements/${encodeURIComponent(planId)}/${encodeURIComponent(metric)}`, { method: "DELETE" }),

  // Support telemetry (WS-M2)
  telemetry: (slug: string) => api<Record<string, unknown>>(`/ops/telemetry/${encodeURIComponent(slug)}`),
};

/* ── Small shared formatters ─────────────────────────────────────────────── */

export function fmtBytes(n?: number | null): string {
  if (n === null || n === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = Number(n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function fmtDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.round(Number(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** "3 hours ago" / "just now" — the form a staleness column actually needs. */
export function ago(iso?: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return "—";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
