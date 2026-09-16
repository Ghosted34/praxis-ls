/**
 * Today — the merged surface, and the reason tasks and events share a page.
 *
 * ── ONE LIST, NOT TWO PANELS ───────────────────────────────────────────────
 *
 * A fitting at 10:00 and a task due at 17:00 are the same kind of thing to the
 * person living the day: something that will want them at a time. One list in
 * time order does not ask the reader to hold two panels in their head — which
 * is the whole argument for these two features living under one roof. The
 * server does the interleaving (`GET /workspace/day`), so the ordering rule is
 * written once and tested once.
 *
 * ── WHAT SITS BESIDE THE LIST, AND WHY IT IS NOT IN IT ─────────────────────
 *
 * "Awaiting me", "Unread alerts", "Cash to account for" and "Recent activity"
 * are panels, not rows in the timeline: they are things that arrived and want
 * an answer, with no honest position in a list ordered by clock. Each links out
 * to its full screen rather than re-rendering it.
 *
 * There is deliberately NO strip of day-count tiles. A number above the list
 * can never agree with the list beneath it during a refetch ("4 overdue" over a
 * list showing three is the kind of wrong a user notices and stops trusting),
 * and the panels already surface what those tiles were counting. The list IS
 * the source of truth.
 *
 * ── DESKTOP LAYOUT ─────────────────────────────────────────────────────────
 *
 * `lg+`: "Awaiting me" | "Unread alerts" share a row; below them "The day" takes
 * two thirds and "Recent activity" one third, side by side; "Cash to account
 * for" runs full width last. Smaller screens stack everything.
 */
import * as React from "react";
import { useNavigate, Link } from "react-router-dom";
import { pageShell } from "@/lib/layout";
import { PageHeader } from "@/components/data-list";
import { Panel } from "@/components/ui/panel";
import { Pill, type Tone } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingRow } from "@/components/ui/states";
import { ScreenError } from "@/components/connection/screen-error";
import { dateFmt, dateTimeFmt, humanizeRef, money, num } from "@/lib/format";
import { useResource } from "@/lib/use-resource";
import { tenant } from "@/lib/api-client";
import { RecentActivity } from "@/features/dashboard/components/recent-activity";
import { useDay, useReceiptsOwed } from "./hooks";
import type { ReceiptOwed, TimelineItem } from "./api";
import { PRIORITY_LABEL, PRIORITY_TONE, STATUS_LABEL, eventTypeTone, humanizeType } from "./labels";
import { TaskDialog } from "./tasks/task-dialog";
import { EventDialog } from "./calendar/event-dialog";

/* ── the approvals / alerts roll-up (`GET /workspace`) ────────────────────── */

/**
 * One row of `GET /workspace`'s roll-up. The fields are the COLUMNS of the two
 * tables behind it — `approval_task` and `notification` — because the repo
 * answers both with `SELECT *` (workspace.repo.js). Every field is optional for
 * the same reason: that query runs through `safe()`, which turns a failed read
 * into an empty list, so a row here is a best-effort shape, not a promise.
 *
 * Note what is NOT here: `step_kind` (VALIDATE / APPROVE) belongs to
 * `workflow_step`, not `approval_task`, so this endpoint cannot supply it. The
 * queue at `/approvals` can, because it joins the step.
 */
type Approval = {
  approval_task_id?: string;
  id?: string;
  entity_ref?: string | null;
  amount_xaf?: number | string | null;
  created_at?: string | null;
};

type Note = {
  notification_id?: string;
  id?: string;
  title?: string | null;
  priority?: string | null;
  event_type_key?: string | null;
  created_at?: string | null;
};

type Mine = {
  approvals_awaiting_me?: Approval[];
  unread_notifications?: Note[];
};

/**
 * `notification.priority` is CHECK-constrained to NORMAL | HIGH
 * (migrations/tenant/0410_notifications_ux.sql), so this is the same two-way
 * mapping the notifications screen already uses.
 */
const prioTone = (p?: string | null): Tone =>
  String(p || "").toUpperCase() === "HIGH" ? "bad" : "mute";

/** Deep link to the line modal on the reconciliation sheet. The sheet route
 *  reads `?line=` and opens the modal if present (the same convention every
 *  other deep link in the app uses). */
const reconLineLink = (r: ReceiptOwed) =>
  `/costing/reconciliation/${r.dossier_id}?line=${r.costing_line_id}`;

export function TodayPage() {
  const navigate = useNavigate();
  const q = useDay();
  const items = q.data?.items ?? [];

  // Approvals awaiting this person and alerts they have not opened. One
  // request, `GET /workspace`, answers both — and unlike the task and event
  // routes it carries no permission gate (workspace.routes.js), so it cannot
  // 403 a user who is entitled to their own queue.
  const mine = useResource(() => tenant<Mine>("/workspace"), []);
  const approvals = mine.data?.approvals_awaiting_me ?? [];
  const notes = mine.data?.unread_notifications ?? [];

  // "Cash to account for" (MOD-76, owner Q10) — its own fetch so it never gates
  // the day timeline, and its own panel below the day.
  const owedQ = useReceiptsOwed();
  const owed = owedQ.data ?? { count: 0, total_ttc: 0, items: [] };
  const owedItems = owed.items ?? [];

  const [taskOpen, setTaskOpen] = React.useState(false);
  const [eventOpen, setEventOpen] = React.useState(false);

  return (
    <section className={pageShell.wide}>
      <PageHeader
        title="Today"
        description="Everything that wants you today, in the order it wants you — tasks and appointments in one list."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEventOpen(true)}>
              New event
            </Button>
            <Button onClick={() => setTaskOpen(true)}>New task</Button>
          </div>
        }
      />

      {q.error ? (
        <ScreenError message={q.error.message} what="Your day" onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel
              title="Awaiting me"
              action={
                <Link
                  to="/approvals"
                  className="text-sm text-muted-foreground transition-colors hover:text-primary-ink"
                >
                  Open queue →
                </Link>
              }
            >
              {mine.loading ? (
                <LoadingRow label="Loading your queue…" />
              ) : approvals.length ? (
                <ul className="space-y-2">
                  {approvals.slice(0, 8).map((a, i) => (
                    <li
                      key={a.approval_task_id || a.id || i}
                      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {humanizeRef(a.entity_ref) || "—"}
                      </span>
                      <span className="num shrink-0 text-muted-foreground">
                        {money(a.amount_xaf)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="micro">Nothing awaiting your validation or approval.</p>
              )}
            </Panel>

            <Panel
              title="Unread alerts"
              action={
                <Link
                  to="/notifications"
                  className="text-sm text-muted-foreground transition-colors hover:text-primary-ink"
                >
                  All notifications →
                </Link>
              }
            >
              {mine.loading ? (
                <LoadingRow label="Loading your alerts…" />
              ) : notes.length ? (
                <ul className="space-y-2">
                  {notes.slice(0, 8).map((n, i) => (
                    <li
                      key={n.notification_id || n.id || i}
                      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <Pill tone={prioTone(n.priority)}>{n.priority || "NORMAL"}</Pill>
                        <span className="truncate">
                          {n.title || n.event_type_key || "Notification"}
                        </span>
                      </span>
                      <span className="micro num shrink-0">{dateFmt(n.created_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="micro">You're all caught up.</p>
              )}
            </Panel>
          </div>

          <div className="mt-4 grid items-start gap-4 lg:grid-cols-3">
            <Panel
              title="The day"
              subtitle={
                q.data
                  ? `${q.data.tasks} task${q.data.tasks === 1 ? "" : "s"} · ${q.data.events} event${q.data.events === 1 ? "" : "s"}`
                  : undefined
              }
              className="lg:col-span-2"
            >
              {q.isLoading ? (
                <LoadingRow label="Loading your day…" />
              ) : items.length === 0 ? (
                <EmptyState
                  title="Nothing due today"
                  hint="Add a task with a date, or put an appointment in the diary, and it will appear here in time order."
                  action={<Button onClick={() => setTaskOpen(true)}>New task</Button>}
                />
              ) : (
                <ul className="divide-y">
                  {items.map((item) => (
                    <TimelineRow key={`${item.kind}:${item.id}`} item={item} onOpen={navigate} />
                  ))}
                </ul>
              )}
            </Panel>

            <div className="lg:col-span-1">
              {/* Self-scoped (`/audit/my-feed`) — the person's own recent
                  actions, the same widget the Control Tower renders, reused
                  rather than rebuilt. `tight` drops the margins it carries for
                  the wide tower layout so it aligns with the day Panel. */}
              <RecentActivity tight />
            </div>
          </div>

          <Panel
            title="Cash to account for"
            subtitle={
              owedQ.isLoading
                ? "Money you've received that still needs a receipt."
                : `Money you've received that still needs a receipt · ${num(owed.count)} for ${money(owed.total_ttc)}.`
            }
            className="mt-4"
            action={
              <Link
                to="/costing/reconciliation"
                className="text-sm text-muted-foreground transition-colors hover:text-primary-ink"
              >
                Open sheets →
              </Link>
            }
          >
            {owedQ.isLoading ? (
              <LoadingRow label="Loading what you owe…" />
            ) : owedItems.length ? (
              <ul className="space-y-2">
                {owedItems.slice(0, 8).map((it, i) => (
                  <li
                    key={it.costing_line_id + "-" + i}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{it.dossier_ref || "—"}</span>
                      <span className="text-muted-foreground"> · {it.line_label || "—"}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <Link
                        to={reconLineLink(it)}
                        className="text-sm text-primary-ink transition-colors hover:underline"
                      >
                        Upload →
                      </Link>
                      <span className="num text-muted-foreground">{money(it.claimed_ttc)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="micro">No receipts owed. Any cash you take will show up here.</p>
            )}
          </Panel>
        </>
      )}

      <TaskDialog open={taskOpen} onClose={() => setTaskOpen(false)} />
      <EventDialog open={eventOpen} onClose={() => setEventOpen(false)} />
    </section>
  );
}

function TimelineRow({
  item,
  onOpen,
}: {
  item: TimelineItem;
  onOpen: (path: string) => void;
}) {
  const open = () => {
    // A record link goes to the record; otherwise the item opens in its own
    // surface. A row with nowhere to go is still a row — it just is not a link.
    if (item.link_url) onOpen(item.link_url);
    else if (item.kind === "task") onOpen(`/workspace/tasks?task=${item.id}`);
    else onOpen(`/workspace/calendar?event=${item.id}`);
  }

  const time = item.at ? dateTimeFmt(item.at) : "No deadline";

  return (
    <li>
      <button
        type="button"
        onClick={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-left transition-colors hover:bg-accent"
      >
        <span
          aria-hidden
          className={`h-2 w-2 shrink-0 rounded-full ${
            item.kind === "event"
              ? "bg-primary"
              : item.is_overdue
                ? "bg-destructive"
                : "bg-muted-foreground"
          }`}
        />

        <span className="num w-32 shrink-0 text-sm text-muted-foreground">{time}</span>

        <span className="min-w-0 flex-1 truncate text-sm">
          {item.kind === "event" ? (
            <>
              <Pill tone={eventTypeTone(item.event_type)}>{humanizeType(item.event_type)}</Pill>{" "}
              {item.title}
            </>
          ) : (
            <>
              <Pill tone={PRIORITY_TONE[item.priority]}>{PRIORITY_LABEL[item.priority]}</Pill>{" "}
              {item.title}
            </>
          )}
        </span>

        {item.kind === "task" ? (
          <span className="flex shrink-0 items-center gap-2">
            {item.is_overdue && <Pill tone="bad">Overdue</Pill>}
            <Pill tone={item.status === "DONE" ? "ok" : "mute"}>{STATUS_LABEL[item.status]}</Pill>
            {item.subtask_count > 0 && (
              <span className="num micro">
                {item.subtask_done_count}/{item.subtask_count}
              </span>
            )}
            {item.assigned_to_name && (
              <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                {item.assigned_to_name}
              </span>
            )}
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-2">
            {item.all_day && <Pill tone="mute">All day</Pill>}
            {item.location && (
              <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                {item.location}
              </span>
            )}
            {item.participant_count > 0 && (
              <span className="num micro">{item.participant_count} invited</span>
            )}
          </span>
        )}
      </button>
    </li>
  );
}
