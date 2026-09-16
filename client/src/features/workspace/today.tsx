/**
 * Today — the merged surface, and the reason tasks and events share a page.
 *
 * ── ONE LIST, NOT TWO PANELS ───────────────────────────────────────────────
 *
 * A fitting at 10:00 and a task due at 17:00 are the same kind of thing to the
 * person living the day: something that will want them at a time. Two panels
 * side by side make them read the calendar, then read the list, and hold both
 * in their head. One list in time order does not ask that of them — which is
 * the whole argument for these two features living under one roof.
 *
 * The server does the interleaving (`GET /workspace/day`), so the ordering rule
 * is written once and tested once rather than duplicated in every view that
 * wants a day.
 *
 * ── THE COUNTS ARE DERIVED FROM THE SAME FETCH ─────────────────────────────
 *
 * The KPI strip and the list read one response. Computing the tiles from a
 * second request would let them disagree with the list beneath them during a
 * refetch, and "4 overdue" above a list showing three is the kind of wrong a
 * user notices and stops trusting.
 */
import * as React from "react";
import { useNavigate, Link } from "react-router-dom";
import { pageShell } from "@/lib/layout";
import { PageHeader } from "@/components/data-list";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingRow } from "@/components/ui/states";
import { ScreenError } from "@/components/connection/screen-error";
import { dateTimeFmt, money, num } from "@/lib/format";
import { useDay, useReceiptsOwed } from "./hooks";
import type { ReceiptOwed, TimelineItem } from "./api";
import { PRIORITY_LABEL, PRIORITY_TONE, STATUS_LABEL, eventTypeTone, humanizeType } from "./labels";
import { TaskDialog } from "./tasks/task-dialog";
import { EventDialog } from "./calendar/event-dialog";

/** Deep link to the line modal on the reconciliation sheet. The sheet route
 *  reads `?line=` and opens the modal if present (the same convention every
 *  other deep link in the app uses). */
const reconLineLink = (r: ReceiptOwed) =>
  `/costing/reconciliation/${r.dossier_id}?line=${r.costing_line_id}`;

export function TodayPage() {
  const navigate = useNavigate();
  const q = useDay();
  const items = q.data?.items ?? [];
  // "Cash to account for" (MOD-76, owner Q10) — its own fetch so it never
  // gates the day timeline, and its own tile+panel below the day.
  const owedQ = useReceiptsOwed();
  const owed = owedQ.data ?? { count: 0, total_ttc: 0, items: [] };
  const owedItems = owed.items ?? [];
  const [taskOpen, setTaskOpen] = React.useState(false);
  const [eventOpen, setEventOpen] = React.useState(false);

  const overdue = items.filter((i) => i.kind === "task" && i.is_overdue);
  const dueToday = items.filter((i) => i.kind === "task" && !i.is_overdue);
  const events = items.filter((i) => i.kind === "event");

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
          <KpiRow>
            <KpiTile label="Overdue" value={num(overdue.length)} />
            <KpiTile label="Tasks" value={num(dueToday.length)} />
            <KpiTile label="Appointments" value={num(events.length)} />
            <KpiTile
              label="Cash to account for"
              value={num(owed.count || 0)}
              hint={money(owed.total_ttc)}
            />
          </KpiRow>

          <Panel
            title="The day"
            subtitle={
              q.data
                ? `${q.data.tasks} task${q.data.tasks === 1 ? "" : "s"} · ${q.data.events} event${q.data.events === 1 ? "" : "s"}`
                : undefined
            }
            className="mt-4"
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

          <Panel
            title="Cash to account for"
            subtitle="Money you've received that still needs a receipt."
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
  };

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
