/**
 * My workspace — the read-only personal overview (Overview area). Rolls up what's
 * on the signed-in user's desk from GET /workspace: approvals awaiting them,
 * unread notifications, and recent activity. Composes the locked kit; accents
 * resolve to --primary.
 */
import { pageShell } from "@/lib/layout";
import { Panel } from "@/components/ui/panel";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/data-list";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Pill, type Tone } from "@/components/ui/pill";
import { ErrorState } from "@/components/ui/states";
import { useResource } from "@/lib/use-resource";
import { money, num, dateFmt, humanizeEvent, humanizeRef } from "@/lib/format";
import { tenant } from "@/lib/api-client";

type Approval = { approval_task_id?: string; id?: string; entity_ref?: string | null; step_kind?: string | null; amount_xaf?: number | string | null; status?: string | null; created_at?: string | null };
type Note = { notification_id?: string; id?: string; title?: string | null; priority?: string | null; event_type_key?: string | null; created_at?: string | null };
type Activity = { event_id?: string; id?: string; action?: string | null; event_type_key?: string | null; entity_ref?: string | null; created_at?: string | null };
type Mine = { approvals_awaiting_me?: Approval[]; unread_notifications?: Note[]; recent_activity?: Activity[] };

const prioTone = (p?: string | null): Tone => {
  const u = String(p || "").toUpperCase();
  if (u === "HIGH" || u === "CRITICAL") return "bad";
  if (u === "MEDIUM") return "warn";
  return "mute";
};


export function WorkspacePage() {
  const r = useResource(() => tenant<Mine>("/workspace"), []);
  const d = r.data;
  const approvals = d?.approvals_awaiting_me || [];
  const notes = d?.unread_notifications || [];
  const activity = d?.recent_activity || [];

  return (
    <section className={pageShell.wide}>
      <PageHeader title="My workspace" description="What's on your desk right now — approvals, alerts and the latest activity." />
      {r.loading ? (
        <div className="py-10 text-center micro">Loading…</div>
      ) : r.error ? (
        <ErrorState message={r.error} />
      ) : (
        <>
          <KpiRow>
            <KpiTile label="Awaiting my approval" value={num(approvals.length)} />
            <KpiTile label="Unread alerts" value={num(notes.length)} />
            <KpiTile label="Recent events" value={num(activity.length)} />
          </KpiRow>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Awaiting me" action={<Link to="/approvals" className="text-sm text-muted-foreground transition-colors hover:text-primary">Open queue →</Link>}>
              {approvals.length ? (
                <ul className="space-y-2">
                  {approvals.slice(0, 8).map((a, i) => (
                    <li key={a.approval_task_id || a.id || i} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                      <span className="flex items-center gap-2">
                        {a.step_kind && <Pill tone="blue">{a.step_kind}</Pill>}
                        <span>{humanizeRef(a.entity_ref) || "—"}</span>
                      </span>
                      <span className="num text-muted-foreground">{money(a.amount_xaf)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="micro">Nothing awaiting your validation or approval.</p>}
            </Panel>

            <Panel title="Unread alerts" action={<Link to="/notifications" className="text-sm text-muted-foreground transition-colors hover:text-primary">All notifications →</Link>}>
              {notes.length ? (
                <ul className="space-y-2">
                  {notes.slice(0, 8).map((n, i) => (
                    <li key={n.notification_id || n.id || i} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                      <span className="flex items-center gap-2 truncate">
                        <Pill tone={prioTone(n.priority)}>{n.priority || "INFO"}</Pill>
                        <span className="truncate">{n.title || n.event_type_key || "Notification"}</span>
                      </span>
                      <span className="micro shrink-0">{dateFmt(n.created_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="micro">You're all caught up.</p>}
            </Panel>
          </div>

          <div className="mt-4">
            <Panel title="Recent activity" action={<Link to="/audit" className="text-sm text-muted-foreground transition-colors hover:text-primary">Audit ledger →</Link>}>
              {activity.length ? (
                <ol className="space-y-1.5">
                  {activity.slice(0, 12).map((e, i) => (
                    <li key={e.event_id || e.id || i} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate"><span className="font-medium text-foreground">{humanizeEvent(e.action || e.event_type_key)}</span>{e.entity_ref ? <span className="text-muted-foreground"> · {humanizeRef(e.entity_ref)}</span> : null}</span>
                      <span className="micro shrink-0">{dateFmt(e.created_at)}</span>
                    </li>
                  ))}
                </ol>
              ) : <p className="micro">No recent activity.</p>}
            </Panel>
          </div>
        </>
      )}
    </section>
  );
}
