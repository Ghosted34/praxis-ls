/**
 * Calendar — a month grid or a week agenda, with deadlines laid over both.
 *
 * ── WHY A GRID *AND* A LIST ────────────────────────────────────────────────
 *
 * The month grid answers "which days are busy"; the agenda beneath it answers
 * "what exactly is happening, and where". Neither answers both, and a month view
 * alone forces the user to click every populated cell. The list is the same data
 * the grid already fetched, so it costs no second request.
 *
 * ── WHY A WEEK VIEW ────────────────────────────────────────────────────────
 *
 * A month is the wrong zoom for "what am I doing this week". The view toggle
 * switches the same data between the month grid and a seven-day agenda, and the
 * navigation arrows move by whichever unit is showing — a month, or a week.
 *
 * ── THE WINDOW FOLLOWS THE VIEW ────────────────────────────────────────────
 *
 * The month grid shows six weeks that spill into the neighbouring months, so its
 * window runs the 1st of the previous month to the last day of the next. The
 * week view needs only its seven days. Fetching the visible range and no more
 * keeps each view honest about what it can draw.
 */
import * as React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { pageShell } from "@/lib/layout";
import { PageHeader } from "@/components/data-list";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState, LoadingRow } from "@/components/ui/states";
import { ScreenError } from "@/components/connection/screen-error";
import { dateTimeFmt, todayISO } from "@/lib/format";
import { useDeadlines, useEvents } from "../hooks";
import type { CalendarEvent } from "../api";
import { eventTypeTone, humanizeType } from "../labels";
import { CalendarGrid } from "./calendar-grid";
import { WeekView } from "./week-view";
import { isoDay, weekCells } from "./dates";
import { EventDialog } from "./event-dialog";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MON = MONTHS.map((m) => m.slice(0, 3));

type View = "month" | "week";

export function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const view: View = params.get("view") === "week" ? "week" : "month";
  // `cursor` is a day. In month view only its month matters; in week view it is
  // any day of the week shown. Kept as one Date so switching views keeps you
  // near where you were.
  const [cursor, setCursor] = React.useState(() => new Date());

  const [selected, setSelected] = React.useState<CalendarEvent | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [defaultDay, setDefaultDay] = React.useState<string | null>(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const week = React.useMemo(() => weekCells(cursor), [cursor]);

  // The fetch window follows the view — see the header.
  const from = view === "week" ? isoDay(week[0]) : isoDay(new Date(year, month - 1, 1));
  const to =
    view === "week"
      ? isoDay(new Date(week[6].getFullYear(), week[6].getMonth(), week[6].getDate() + 1))
      : isoDay(new Date(year, month + 2, 0));

  const q = useEvents({ from, to });
  // Deadlines (task + subtask due dates) over the same window, laid on the grid
  // as due-date chips. A separate read from the events so a slow one does not
  // gate the other, and so clicking a deadline opens its task, not an event.
  const dq = useDeadlines({ from, to });
  const deadlines = React.useMemo(() => dq.data?.items ?? [], [dq.data]);
  // Memoised, not `q.data ?? []`: a fresh array each render would make the
  // deep-link effect below re-run on every render and fight the URL.
  const events = React.useMemo(() => q.data ?? [], [q.data]);

  // A deep link (`?event=<id>`) selects the event on arrival and is then
  // stripped, so a refresh does not reopen what the user has since closed.
  React.useEffect(() => {
    const id = params.get("event");
    if (!id) return;
    const hit = events.find((e) => e.calendar_event_id === id);
    if (hit) {
      setSelected(hit);
      params.delete("event");
      setParams(params, { replace: true });
    }
  }, [params, setParams, events]);

  function chooseView(next: View) {
    if (next === "week") params.set("view", "week");
    else params.delete("view");
    setParams(params, { replace: true });
  }

  // Navigation moves by the visible unit: a month, or a week.
  function shift(delta: number) {
    setCursor((c) =>
      view === "week"
        ? new Date(c.getFullYear(), c.getMonth(), c.getDate() + delta * 7)
        : new Date(c.getFullYear(), c.getMonth() + delta, 1),
    );
  }

  const label =
    view === "week"
      ? `${week[0].getDate()} ${MON[week[0].getMonth()]} – ${week[6].getDate()} ${MON[week[6].getMonth()]} ${week[6].getFullYear()}`
      : `${MONTHS[month]} ${year}`;

  const monthEvents = events
    .filter((e) => {
      const d = new Date(e.start_at);
      return d.getFullYear() === year && d.getMonth() === month;
    })
    .sort((a, b) => a.start_at.localeCompare(b.start_at));

  function openNew(day?: string) {
    setDefaultDay(day ?? todayISO());
    setSelected(null);
    setDialogOpen(true);
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader
        title="Calendar"
        description="Appointments, deadlines and meetings — the dated half of your workspace."
        action={<Button onClick={() => openNew()}>New event</Button>}
      />

      {q.error ? (
        <ScreenError message={q.error.message} what="Your calendar" onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => shift(-1)} aria-label={view === "week" ? "Previous week" : "Previous month"}>
                ‹
              </Button>
              <h2 className="min-w-[11rem] text-center text-sm font-medium">{label}</h2>
              <Button size="sm" variant="outline" onClick={() => shift(1)} aria-label={view === "week" ? "Next week" : "Next month"}>
                ›
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCursor(new Date())}>
                {view === "week" ? "This week" : "This month"}
              </Button>
            </div>
            <Segmented
              label="Calendar view"
              value={view}
              onChange={(v) => chooseView(v as View)}
              options={[
                { value: "month", label: "Month" },
                { value: "week", label: "Week" },
              ]}
            />
          </div>

          {view === "week" ? (
            <WeekView
              anchor={cursor}
              events={events}
              deadlines={deadlines}
              loading={q.isLoading}
              onSelectDay={(day) => openNew(day)}
              onSelectEvent={setSelected}
              onSelectDeadline={(d) => navigate(`/workspace/tasks?task=${d.task_id}`)}
            />
          ) : (
            <>
              <CalendarGrid
                year={year}
                month={month}
                events={events}
                deadlines={deadlines}
                loading={q.isLoading}
                onSelectDay={(day) => openNew(day)}
                onSelectEvent={setSelected}
                onSelectDeadline={(d) => navigate(`/workspace/tasks?task=${d.task_id}`)}
              />

              <Panel
                title={`${MONTHS[month]} agenda`}
                subtitle={`${monthEvents.length} event${monthEvents.length === 1 ? "" : "s"}`}
                className="mt-4"
              >
                {q.isLoading ? (
                  <LoadingRow label="Loading events…" />
                ) : monthEvents.length === 0 ? (
                  <EmptyState
                    title="Nothing booked this month"
                    hint="Click any day on the grid to put something in the diary."
                    action={<Button onClick={() => openNew()}>New event</Button>}
                  />
                ) : (
                  <ul className="divide-y">
                    {monthEvents.map((e) => (
                      <li key={e.calendar_event_id}>
                        <button
                          type="button"
                          onClick={() => setSelected(e)}
                          className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-2 text-left transition-colors hover:bg-accent"
                        >
                          <span className="num w-28 shrink-0 text-sm">{dateTimeFmt(e.start_at)}</span>
                          <Pill tone={eventTypeTone(e.event_type)}>{humanizeType(e.event_type)}</Pill>
                          <span className="min-w-0 flex-1 truncate text-sm">{e.title}</span>
                          {e.location && (
                            <span className="truncate text-sm text-muted-foreground">{e.location}</span>
                          )}
                          {e.participant_count > 0 && (
                            <span className="num micro">{e.participant_count} invited</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </>
          )}
        </>
      )}

      <EventDialog
        open={dialogOpen || !!selected}
        onClose={() => {
          setDialogOpen(false);
          setSelected(null);
        }}
        event={selected}
        defaultDay={defaultDay}
      />
    </section>
  );
}
