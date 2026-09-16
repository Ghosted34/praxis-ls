/**
 * Calendar — a month of events, with the agenda for the month beneath it.
 *
 * ── WHY A GRID *AND* A LIST ────────────────────────────────────────────────
 *
 * The grid answers "which days are busy"; the list answers "what exactly is
 * happening, and where". Neither answers both, and a month view alone forces
 * the user to click every populated cell to find out what is on it. The list
 * is the same data the grid already fetched, so it costs no second request.
 *
 * ── THE WINDOW IS THREE MONTHS WIDE ────────────────────────────────────────
 *
 * The grid shows six weeks, which always spills into the neighbouring months.
 * Fetching only the visible month would leave those spillover cells empty and
 * imply a free fortnight at each end. One window from the 1st of the previous
 * month to the last day of the next covers every cell the grid can draw.
 */
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { pageShell } from "@/lib/layout";
import { PageHeader } from "@/components/data-list";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingRow } from "@/components/ui/states";
import { ScreenError } from "@/components/connection/screen-error";
import { dateTimeFmt, todayISO } from "@/lib/format";
import { useEvents } from "../hooks";
import type { CalendarEvent } from "../api";
import { eventTypeTone, humanizeType } from "../labels";
import { CalendarGrid } from "./calendar-grid";
import { isoDay } from "./dates";
import { EventDialog } from "./event-dialog";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const today = new Date();
  const [cursor, setCursor] = React.useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selected, setSelected] = React.useState<CalendarEvent | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [defaultDay, setDefaultDay] = React.useState<string | null>(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  // One window that covers every cell the six-week grid can draw — see header.
  const from = isoDay(new Date(year, month - 1, 1));
  const to = isoDay(new Date(year, month + 2, 0));
  const q = useEvents({ from, to });
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

  const shift = (delta: number) => setCursor(new Date(year, month + delta, 1));

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
              <Button size="sm" variant="outline" onClick={() => shift(-1)} aria-label="Previous month">
                ‹
              </Button>
              <h2 className="min-w-[9rem] text-center text-sm font-medium">
                {MONTHS[month]} {year}
              </h2>
              <Button size="sm" variant="outline" onClick={() => shift(1)} aria-label="Next month">
                ›
              </Button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}
            >
              This month
            </Button>
          </div>

          <CalendarGrid
            year={year}
            month={month}
            events={events}
            loading={q.isLoading}
            onSelectDay={(day) => openNew(day)}
            onSelectEvent={setSelected}
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
