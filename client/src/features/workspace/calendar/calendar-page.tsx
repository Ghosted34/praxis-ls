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
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState, LoadingRow } from "@/components/ui/states";
import { ScreenError } from "@/components/connection/screen-error";
import {
  useDeadlines,
  useEvent,
  useEvents,
  useWorkspaceContext,
} from "../hooks";
import type { CalendarEvent } from "../api";
import { eventTypeTone, humanizeType } from "../labels";
import {
  addTenantDays,
  dateFromTenantDay,
  tenantDateTimeFmt,
  tenantDay,
  tenantToday,
} from "../time";
import { CalendarGrid } from "./calendar-grid";
import { WeekView } from "./week-view";
import { DayAgenda } from "./day-agenda";
import { isoDay, monthCells, weekCells } from "./dates";
import { EventDialog } from "./event-dialog";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MON = MONTHS.map((m) => m.slice(0, 3));

type View = "month" | "week";

export function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const contextQ = useWorkspaceContext();
  const timeZone = contextQ.data?.timeZone ?? "Africa/Douala";

  const view: View = params.get("view") === "week" ? "week" : "month";
  const dateParam = params.get("date");
  // The URL owns the visible date. A Date is only a convenient date-only
  // cursor for the grid; all API windows and event grouping use the tenant
  // timezone explicitly below.
  const initialDay = dateParam || tenantToday(timeZone);
  const [cursor, setCursor] = React.useState(
    () => dateFromTenantDay(initialDay) ?? new Date(),
  );
  const syncedTenantClock = React.useRef(Boolean(dateParam));

  React.useEffect(() => {
    if (dateParam) {
      const next = dateFromTenantDay(dateParam);
      if (next && isoDay(next) !== isoDay(cursor)) setCursor(next);
      syncedTenantClock.current = true;
    } else if (!syncedTenantClock.current && contextQ.data?.timeZone) {
      const next = dateFromTenantDay(tenantToday(contextQ.data.timeZone));
      if (next) setCursor(next);
      syncedTenantClock.current = true;
    }
  }, [contextQ.data?.timeZone, cursor, dateParam]);

  const [selected, setSelected] = React.useState<CalendarEvent | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [defaultDay, setDefaultDay] = React.useState<string | null>(null);
  // The day's own sheet — what the tap on a cell means now, on every viewport:
  // the events and deadlines of that day, plus its quick capture. "Create"
  // stays one more, explicitly named, step away.
  const [agendaDay, setAgendaDay] = React.useState<string | null>(null);
  // Client-side filter over the already-fetched window — never a second
  // request, per the recorded scope ("no new search endpoint").
  const [filter, setFilter] = React.useState("");

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const week = React.useMemo(() => weekCells(cursor), [cursor]);
  const cells = React.useMemo(() => monthCells(year, month), [year, month]);

  // The fetch window is half-open and expressed on the tenant wall clock.
  const fromDay = view === "week" ? isoDay(week[0]) : isoDay(cells[0]);
  const lastDay =
    view === "week" ? isoDay(week[6]) : isoDay(cells[cells.length - 1]);
  const from = `${fromDay}T00:00`;
  const to = `${addTenantDays(lastDay, 1)}T00:00`;

  const q = useEvents({ from, to });
  // Deadlines (task + subtask) are a separate read: a slow or failed overlay
  // must not hide the calendar's event list, and vice versa.
  const dq = useDeadlines({ from, to });
  const allDeadlines = React.useMemo(() => dq.data?.items ?? [], [dq.data]);
  const allEvents = React.useMemo(() => q.data ?? [], [q.data]);

  // The filter narrows the visible set, never the query: the window the page
  // fetched stays the truth, and clearing the box restores it whole. Matched
  // on the words a person would type — title, the kind, the room.
  const needle = filter.trim().toLowerCase();
  const events = React.useMemo(() => {
    if (!needle) return allEvents;
    return allEvents.filter((e) =>
      [e.title, e.event_type, e.location ?? ""].join(" ").toLowerCase().includes(needle),
    );
  }, [allEvents, needle]);
  const deadlines = React.useMemo(() => {
    if (!needle) return allDeadlines;
    return allDeadlines.filter((d) =>
      [d.title, d.task_title ?? ""].join(" ").toLowerCase().includes(needle),
    );
  }, [allDeadlines, needle]);

  // A deep link (`?event=<id>`) selects from the visible range or fetches the
  // record directly when it is outside that range, then is stripped so a
  // refresh does not reopen what the user has since closed.
  const deepEventId = params.get("event");
  const listedEvent =
    events.find((e) => e.calendar_event_id === deepEventId) ?? null;
  const selectedQ = useEvent(deepEventId && !listedEvent ? deepEventId : null);
  React.useEffect(() => {
    const hit = listedEvent ?? selectedQ.data;
    if (!deepEventId || !hit) return;
    setSelected(hit);
    const next = new URLSearchParams(params);
    next.delete("event");
    setParams(next, { replace: true });
  }, [deepEventId, listedEvent, params, selectedQ.data, setParams]);

  function chooseView(next: View) {
    if (next === "week") params.set("view", "week");
    else params.delete("view");
    setParams(params, { replace: true });
  }

  function moveCursor(next: Date) {
    setCursor(next);
    params.set("date", isoDay(next));
    setParams(params, { replace: true });
  }

  // Navigation moves by the visible unit: a month, or a week.
  function shift(delta: number) {
    moveCursor(
      view === "week"
        ? new Date(
            cursor.getFullYear(),
            cursor.getMonth(),
            cursor.getDate() + delta * 7,
          )
        : new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1),
    );
  }

  const label =
    view === "week"
      ? `${week[0].getDate()} ${MON[week[0].getMonth()]} – ${week[6].getDate()} ${MON[week[6].getMonth()]} ${week[6].getFullYear()}`
      : `${MONTHS[month]} ${year}`;

  const monthEvents = events
    .filter(
      (e) =>
        tenantDay(e.start_at, timeZone).slice(0, 7) ===
        `${year}-${String(month + 1).padStart(2, "0")}`,
    )
    .sort((a, b) => a.start_at.localeCompare(b.start_at));

  function openNew(day?: string) {
    setDefaultDay(day ?? tenantToday(timeZone));
    setSelected(null);
    setDialogOpen(true);
  }

  /**
   * A tap on a day — all viewports. The day's own sheet answers first ("what's
   * on"), and nothing is created until a control that names creation is
   * pressed. On a phone this is what stops a dot-sized target from opening the
   * write form over an existing meeting; on the desktop it is also the a11y
   * fix: chips stop being buttons inside a cell-sized role="button".
   */
  function openDayAgenda(day: string) {
    setAgendaDay(day);
  }

  return (
    <section className={pageShell.wide}>
      <PageHeader
        title="Calendar"
        description="Appointments, deadlines and meetings — the dated half of your workspace."
        action={<Button onClick={() => openNew()}>New event</Button>}
      />

      {contextQ.error && (
        <ScreenError
          message={contextQ.error.message}
          what="Workspace timezone"
          onRetry={() => void contextQ.refetch()}
        />
      )}
      {q.error && (
        <ScreenError
          message={q.error.message}
          what="Your calendar"
          onRetry={() => void q.refetch()}
        />
      )}
      {dq.error && (
        <ScreenError
          message={dq.error.message}
          what="Calendar deadlines"
          onRetry={() => void dq.refetch()}
        />
      )}
      <>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => shift(-1)}
              aria-label={view === "week" ? "Previous week" : "Previous month"}
            >
              ‹
            </Button>
            <h2 className="min-w-[11rem] text-center text-sm font-medium">
              {label}
            </h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => shift(1)}
              aria-label={view === "week" ? "Next week" : "Next month"}
            >
              ›
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const day = dateFromTenantDay(tenantToday(timeZone));
                if (day) moveCursor(day);
              }}
            >
              {view === "week" ? "This week" : "This month"}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Input
              aria-label="Filter the visible calendar"
              placeholder="Filter this view…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-40 sm:w-52"
            />
            {needle && (
              <span className="micro">
                {events.length} event{events.length === 1 ? "" : "s"}, {deadlines.length} deadline
                {deadlines.length === 1 ? "" : "s"} match
              </span>
            )}
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
            timeZone={timeZone}
            loading={q.isLoading || dq.isLoading}
            onSelectDay={openDayAgenda}
            onSelectEvent={setSelected}
            onSelectDeadline={(d) =>
              navigate(`/workspace/tasks?task=${d.task_id}`)
            }
          />
        ) : (
          <>
            <CalendarGrid
              year={year}
              month={month}
              events={events}
              deadlines={deadlines}
              timeZone={timeZone}
              loading={q.isLoading || dq.isLoading}
              onSelectDay={openDayAgenda}
              onSelectEvent={setSelected}
              onSelectDeadline={(d) =>
                navigate(`/workspace/tasks?task=${d.task_id}`)
              }
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
                        <span className="num w-28 shrink-0 text-sm">
                          {tenantDateTimeFmt(e.start_at, timeZone)}
                        </span>
                        <Pill tone={eventTypeTone(e.event_type)}>
                          {humanizeType(e.event_type)}
                        </Pill>
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {e.title}
                        </span>
                        {e.location && (
                          <span className="min-w-0 truncate text-sm text-muted-foreground">
                            {e.location}
                          </span>
                        )}
                        {e.participant_count > 0 && (
                          <span className="num micro">
                            {e.participant_count} invited
                          </span>
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

      <EventDialog
        open={dialogOpen || !!selected}
        onClose={() => {
          setDialogOpen(false);
          setSelected(null);
        }}
        event={selected}
        defaultDay={defaultDay}
      />

      <DayAgenda
        day={agendaDay}
        onClose={() => setAgendaDay(null)}
        events={events}
        deadlines={deadlines}
        timeZone={timeZone}
        onOpenEvent={(e) => {
          setAgendaDay(null);
          setSelected(e);
        }}
        onOpenDeadline={(d) => navigate(`/workspace/tasks?task=${d.task_id}`)}
        onNewEvent={(day) => {
          setAgendaDay(null);
          openNew(day);
        }}
      />
    </section>
  );
}
