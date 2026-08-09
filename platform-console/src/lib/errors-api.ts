/**
 * Typed client for the Error Command Center endpoints.
 *
 * Kept out of lib/api.ts because that file is already the whole platform
 * surface and this feature adds eighteen endpoints. It reuses the same `api()`
 * transport, so token refresh, the { data } envelope and ApiError handling all
 * behave identically — this is a namespace, not a second client.
 *
 * Types mirror the server payloads in doc/PROMPT_ErrorMonitor_Module.md §6.
 */

import { api, session } from "./api";

export type ErrorLevel = "fatal" | "error" | "warning" | "notice" | "info";
export type ErrorOrigin = "server" | "browser" | "worker";
export type ErrorStatus = "active" | "resolved" | "all";
export type ErrorSort = "recent" | "count" | "severity";

export type StackFrame = {
  index: number;
  function: string;
  file: string | null;
  line: number | null;
  column: number | null;
  module: string | null;
  vendor: boolean;
};

export type ErrorRow = {
  id: string;
  signature: string;
  tenant_id: string | null;
  tenant_slug: string | null;
  tenant_name: string | null;
  level: ErrorLevel;
  origin: ErrorOrigin;
  message: string;
  name: string | null;
  module: string | null;
  route: string | null;
  file_path: string | null;
  line_number: number | null;
  release: string | null;
  env: string | null;
  occurrence_count: number;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_by_name: string | null;
};

export type ErrorDetail = ErrorRow & {
  stack_trace: StackFrame[];
  raw_stack: string | null;
  context: Record<string, unknown>;
  explanation: string | null;
  explanation_by: string | null;
  explanation_at: string | null;
};

export type ErrorPage = {
  items: ErrorRow[];
  page: number;
  limit: number;
  total: number;
  pages: number;
};

export type ErrorStats = {
  total_occurrences: number;
  unique_errors: number;
  fatal: number;
  /**
   * Fatals still OPEN. `fatal` counts the whole window regardless of
   * resolution — right for the KPI card, wrong for a status light, which has to
   * describe NOW.
   */
  fatal_active: number;
  errors: number;
  warnings: number;
  resolved: number;
  active: number;
  today: number;
  resolved_rate: number;
  avg_resolution_seconds: number | null;
};

export type TrendPoint = { bucket: string; occurrences: number; groups: number; fatal: number };
export type Trends = { bucket: "hour" | "day"; hours: number; points: TrendPoint[] };

export type ShareTargets = {
  url: string;
  whatsapp: { text: string; url: string };
  email: { subject: string; body: string; url: string };
  in_house: { title: string; body: string; metadata: Record<string, unknown> };
  plain: string;
};

export type Explanation = {
  signature: string;
  explanation: string;
  generated_by: string;
  generated_at: string;
  cached: boolean;
  source: "redis" | "db" | "live";
};

export type EscalationRule = {
  id: string;
  tenant_id: string | null;
  tenant_slug: string | null;
  name: string;
  level_filter: ErrorLevel[];
  threshold_count: number;
  threshold_window_minutes: number;
  action_email: boolean;
  action_inhouse: boolean;
  action_webhook_url: string | null;
  email_recipients: string[];
  escalation_delay_minutes: number;
  repeat_interval_minutes: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type EscalationLogRow = {
  id: string;
  rule_id: string;
  error_id: string | null;
  signature: string;
  triggered_at: string;
  actions_taken: Record<string, unknown>;
  notes: string | null;
  /**
   * A log row is either a DELIVERY or an ARMING record for the delay clock.
   * `pending` distinguishes them — an armed row means "the condition is true and
   * the delay is running", which is a state an operator needs to see, because
   * otherwise a rule with a 10-minute delay looks like a rule that is not working.
   */
  pending: boolean;
};

export type NotificationType = "error_escalation" | "error_share" | "system";

export type Notification = {
  id: string;
  to_user_id: string;
  from_user_id: string | null;
  from_name: string | null;
  type: NotificationType;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export type HealthIncident = {
  started_at: string;
  ended_at: string;
  samples: number;
  duration_seconds: number;
};

export type HealthSummary = {
  /** null when nothing has been sampled — the widget must render "—", not 0%. */
  uptime_percent: number | null;
  window_days: number;
  samples: number;
  expected_samples: number;
  /**
   * The real start of the measured period. On a deployment younger than the
   * window this is later than `now - window_days`, and the UI has to say so —
   * "99.9% (last 6 hours)" is honest, "99.9% (30d)" from six hours of data is not.
   */
  measured_from: string | null;
  last_sample: string | null;
  degraded_samples: number;
  avg_db_latency_ms: number | null;
  p95_db_latency_ms: number | null;
  collector: "running" | "disabled" | "no_samples";
  incidents: HealthIncident[];
  /**
   * Appendix A.5 — is the error pipeline itself still capturing?
   *
   * `stale` is only ever true when the platform is demonstrably alive and yet
   * nothing has been captured: a quiet night and a broken capture path look
   * identical in the feed, and this is the only field that tells them apart.
   */
  capture: {
    stale: boolean;
    reason: "capturing" | "no_errors_while_healthy" | "collector_down" | "insufficient_history";
    quiet_hours: number;
    last_error_at: string | null;
    errors_in_window: number;
    last_sample_at: string | null;
    sample_age_seconds: number | null;
  };
};

/** One error group that a rule would currently fire on. */
export type RuleMatch = {
  error_id: string;
  signature: string;
  level: ErrorLevel;
  message: string;
  module: string | null;
  route: string | null;
  occurrence_count: number;
  last_seen: string;
  tenant_slug: string | null;
};

export type ErrorQuery = {
  page?: number;
  limit?: number;
  level?: string;
  status?: ErrorStatus;
  scope?: "all" | "platform";
  tenant?: string;
  module?: string;
  signature?: string;
  search?: string;
  from?: string;
  to?: string;
  sort?: ErrorSort;
};

function qs(q: Record<string, unknown> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const errorsApi = {
  list: (q: ErrorQuery = {}) => api<ErrorPage>(`/errors${qs(q)}`),
  recent: (since?: string, scope?: string) =>
    api<{ items: ErrorRow[]; server_time: string }>(
      `/errors/recent${qs({
        since,
        // "all" is the absence of a filter; "platform" is the NULL-tenant scope;
        // anything else is a tenant slug.
        scope: scope === "platform" ? "platform" : undefined,
        tenant: scope && scope !== "all" && scope !== "platform" ? scope : undefined,
      })}`,
    ),
  get: (id: string) => api<ErrorDetail>(`/errors/${encodeURIComponent(id)}`),
  stats: (q: ErrorQuery = {}) => api<ErrorStats>(`/errors/stats${qs(q)}`),
  trends: (q: ErrorQuery & { hours?: number } = {}) => api<Trends>(`/errors/trends${qs(q)}`),
  modules: () => api<{ module: string; count: number }[]>("/errors/modules"),

  resolve: (id: string) =>
    api<{ id: string; signature: string; resolved_at: string }>(
      `/errors/${encodeURIComponent(id)}/resolve`,
      { method: "POST" },
    ),
  reopen: (id: string) => api(`/errors/${encodeURIComponent(id)}/reopen`, { method: "POST" }),

  explain: (id: string, force = false) =>
    api<Explanation>(`/errors/${encodeURIComponent(id)}/explain`, { method: "POST", body: { force } }),

  share: (id: string) => api<ShareTargets>(`/errors/${encodeURIComponent(id)}/share`),

  /**
   * Export is a file download, not a JSON call, so it bypasses `api()` — that
   * helper unwraps a { data } envelope a CSV does not have. The token has to be
   * carried explicitly because a plain anchor href cannot set an
   * Authorization header.
   */
  exportUrl: async (q: ErrorQuery & { format?: "csv" | "json" } = {}) => {
    const res = await fetch(session.base + `/errors/export${qs(q)}`, {
      headers: session.token ? { Authorization: "Bearer " + session.token } : {},
    });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    return res.blob();
  },

  rules: () => api<EscalationRule[]>("/escalation/rules"),
  createRule: (body: Partial<EscalationRule> & { name: string; tenant?: string | null }) =>
    api<EscalationRule>("/escalation/rules", { method: "POST", body }),
  updateRule: (id: string, body: Partial<EscalationRule>) =>
    api<EscalationRule>(`/escalation/rules/${encodeURIComponent(id)}`, { method: "PATCH", body }),
  deleteRule: (id: string) =>
    api(`/escalation/rules/${encodeURIComponent(id)}`, { method: "DELETE" }),
  escalationLog: (ruleId?: string) => api<EscalationLogRow[]>(`/escalation/log${qs({ rule_id: ruleId })}`),

  /**
   * Dry-run: what would this rule fire on right now? Takes the DRAFT thresholds
   * rather than a rule id, so a rule can be tested before it is saved — which is
   * the only moment the answer changes a decision.
   */
  previewRule: (body: {
    level_filter: ErrorLevel[];
    threshold_count: number;
    threshold_window_minutes: number;
    tenant?: string | null;
  }) => api<RuleMatch[]>("/escalation/rules/preview", { method: "POST", body }),

  // ── In-house notifications (§3.3) ─────────────────────────────────────────
  notifications: (q: { status?: "unread" | "read" | "all"; limit?: number; before?: string } = {}) =>
    api<Notification[]>(`/notifications${qs(q)}`),
  unreadCount: () => api<{ unread: number }>("/notifications/unread-count"),
  markNotificationRead: (id: string) =>
    api<{ id: string; read_at: string }>(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }),
  markAllNotificationsRead: () => api<{ marked: number }>("/notifications/read-all", { method: "POST" }),
  /**
   * The spec's push endpoint. `error_id` is sent rather than a rendered title
   * and body — the server rebuilds those from the error so a client cannot put
   * arbitrary text into a colleague's alert feed with the system's name on it.
   */
  sendNotification: (body: { to_user_id: string; error_id?: string; note?: string }) =>
    api<Notification>("/notifications", { method: "POST", body }),

  // ── Platform health (§8.2) ────────────────────────────────────────────────
  health: (days?: number) => api<HealthSummary>(`/health/summary${qs({ days })}`),
};

/** Spec §9.1 severity tokens. Exported so the feed, drawer and chart agree. */
export const LEVEL_STYLE: Record<ErrorLevel, { bg: string; fg: string; border: string; badge: string; label: string }> = {
  fatal:   { bg: "#FEE2E2", fg: "#991B1B", border: "#FECACA", badge: "🔴", label: "Fatal" },
  error:   { bg: "#FEF3C7", fg: "#92400E", border: "#FDE68A", badge: "🟠", label: "Error" },
  warning: { bg: "#FEF9C3", fg: "#854D0E", border: "#FDE047", badge: "🟡", label: "Warning" },
  notice:  { bg: "#DBEAFE", fg: "#1E40AF", border: "#BFDBFE", badge: "🔵", label: "Notice" },
  info:    { bg: "#F3F4F6", fg: "#374151", border: "#D1D5DB", badge: "⚪", label: "Info" },
};

export const LEVELS: ErrorLevel[] = ["fatal", "error", "warning", "notice", "info"];

/** "2 min ago" — the feed's time format throughout the spec's mockups. */
export function ago(iso?: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return "—";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Seconds → "2.3s" / "14m" / "3h 20m", for the Avg Fix KPI. */
export function duration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
}
