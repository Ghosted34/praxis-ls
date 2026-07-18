/**
 * My Workspace (`/workspace`) — a personal landing that aggregates read-only
 * surfaces the user already has access to: what's awaiting their approval
 * (`/approvals?status=PENDING`, RBAC/scope-filtered server-side) and their recent
 * notifications (`/notifications`), plus quick links into the app. No dedicated
 * "tasks" backend exists, so this composes existing endpoints rather than
 * inventing one. Design on the app's --primary tokens.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LoadingRow, EmptyState, ErrorState } from "@/components/ui/states";
import { useAuth } from "@/app/auth/auth-context";
import { Row, cell, when, useList, MetricTile } from "@/features/sales/ui";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function priorityPill(p: string) {
  const key = p.toUpperCase();
  const cls =
    key === "HIGH" || key === "CRITICAL"
      ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
      : key === "MEDIUM"
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{p.toLowerCase()}</span>;
}

const QUICK_LINKS = [
  { to: "/", label: "Control Tower" },
  { to: "/approvals", label: "Approvals" },
  { to: "/notifications", label: "Notifications" },
  { to: "/vault/documents", label: "Documents" },
  { to: "/comms", label: "Smart Comms" },
];

export function WorkspacePage() {
  const { user } = useAuth();
  const [nonce, setNonce] = React.useState(0);
  const reload = () => setNonce((n) => n + 1);
  const { rows: approvals, error: apprError } = useList("/approvals?status=PENDING", nonce);
  const { rows: notifications, error: notifError } = useList("/notifications", nonce);

  const name = (user?.display_name || user?.email || "").split("@")[0];
  const pendingCount = approvals === null ? "…" : String(approvals.length);
  const highCount =
    notifications === null ? "…" : String((notifications || []).filter((n) => ["HIGH", "CRITICAL"].includes(String(n.priority ?? "").toUpperCase())).length);
  const notifCount = notifications === null ? "…" : String(notifications.length);

  return (
    <section className="mx-auto max-w-6xl animate-fade-in">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight">
            {greeting()}
            {name ? `, ${name}` : ""}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Your approvals, alerts and shortcuts in one place.</p>
        </div>
        <Button variant="outline" onClick={reload}>
          Refresh
        </Button>
      </header>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricTile label="Awaiting your approval" value={pendingCount} accent />
        <MetricTile label="High-priority alerts" value={highCount} />
        <MetricTile label="Notifications" value={notifCount} />
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {QUICK_LINKS.map((q) => (
          <Link key={q.to} to={q.to} className="rounded-full border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
            {q.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Awaiting approval */}
        <div className="lux-card flex min-h-0 flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Awaiting your approval</h2>
            <Link to="/approvals" className="text-xs text-primary hover:underline">
              View all
            </Link>
          </div>
          {apprError ? (
            <ErrorState message={apprError} />
          ) : approvals === null ? (
            <LoadingRow label="Loading approvals…" />
          ) : approvals.length === 0 ? (
            <EmptyState title="Nothing awaiting you" hint="Approvals routed to you will appear here." />
          ) : (
            <div className="space-y-2">
              {approvals.slice(0, 8).map((a: Row) => {
                const id = String(a.approval_task_id ?? a.id ?? a.entity_ref);
                return (
                  <div key={id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{cell(a.entity_ref)}</p>
                      <p className="text-xs text-muted-foreground">{when(a.created_at)}</p>
                    </div>
                    {a.amount_xaf != null && <span className="num shrink-0 text-sm text-muted-foreground">{Number(a.amount_xaf).toLocaleString()} XAF</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent notifications */}
        <div className="lux-card flex min-h-0 flex-col p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Recent notifications</h2>
            <Link to="/notifications" className="text-xs text-primary hover:underline">
              View all
            </Link>
          </div>
          {notifError ? (
            <ErrorState message={notifError} />
          ) : notifications === null ? (
            <LoadingRow label="Loading notifications…" />
          ) : notifications.length === 0 ? (
            <EmptyState title="No notifications" hint="Alerts and mentions will show up here." />
          ) : (
            <div className="space-y-2">
              {notifications.slice(0, 8).map((n: Row, i) => (
                <div key={String(n.notification_id ?? n.id ?? i)} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{cell(n.title)}</p>
                    {n.priority ? priorityPill(String(n.priority)) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {cell(n.event_type_key) === "—" ? "" : `${cell(n.event_type_key)} · `}
                    {when(n.created_at)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
