/**
 * The week view — the seven days of one week as a vertical agenda.
 *
 * The companion the month grid needed: the "switch to this week" the calendar
 * could not previously do. It is a LIST rather than a seven-wide grid on
 * purpose — a busy day does not fit a column a seventh of a phone wide, and a
 * week reads top-to-bottom the way it is lived. It draws the same two things the
 * grid does, events and deadlines, from the same fetch, so the two views can
 * never disagree about what is on a day.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Pill } from "@/components/ui/pill";
import { todayISO } from "@/lib/format";
import type { CalendarEvent, Deadline } from "../api";
import { eventTypeTone, humanizeType } from "../labels";
import { isoDay, weekCells, indexEventsByDay, indexDeadlinesByDay } from "./dates";

const WEEKDAY = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/** A step names its parent so a row reads "Bank file · Documents to bank". */
const dueTitle = (d: Deadline) => (d.task_title ? `${d.task_title} · ${d.title}` : d.title);

export function WeekView({
  anchor,
  events,
  deadlines = [],
  loading,
  onSelectDay,
  onSelectEvent,
  onSelectDeadline,
}: {
  /** Any day in the week to show; the view snaps to its Sunday–Saturday. */
  anchor: Date;
  events: CalendarEvent[];
  deadlines?: Deadline[];
  loading: boolean;
  onSelectDay: (iso: string) => void;
  onSelectEvent: (event: CalendarEvent) => void;
  onSelectDeadline?: (deadline: Deadline) => void;
}) {
  const days = React.useMemo(() => weekCells(anchor), [anchor]);
  const byDay = React.useMemo(() => indexEventsByDay(events), [events]);
  const dueByDay = React.useMemo(() => indexDeadlinesByDay(deadlines), [deadlines]);
  const today = todayISO();

  return (
    <div className="divide-y rounded-lg border">
      {days.map((day) => {
        const iso = isoDay(day);
        const dayEvents = byDay.get(iso) ?? [];
        const dayDue = dueByDay.get(iso) ?? [];
        const isToday = iso === today;
        const empty = dayEvents.length === 0 && dayDue.length === 0;
        return (
          <div key={iso} className="flex flex-col gap-1.5 p-3 sm:flex-row sm:gap-4">
            <button
              type="button"
              onClick={() => onSelectDay(iso)}
              className="flex shrink-0 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-40"
              aria-label={`Schedule an event on ${day.toDateString()}`}
            >
              <span
                className={cn(
                  "num inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-sm",
                  isToday && "bg-primary font-semibold text-primary-foreground",
                )}
              >
                {day.getDate()}
              </span>
              <span className="text-sm font-medium">{WEEKDAY[day.getDay()]}</span>
            </button>

            <div className="min-w-0 flex-1 space-y-1">
              {loading ? (
                <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
              ) : empty ? (
                <button
                  type="button"
                  onClick={() => onSelectDay(iso)}
                  className="micro text-muted-foreground hover:text-primary-ink"
                >
                  Nothing — click to add
                </button>
              ) : (
                <>
                  {dayEvents.map((e) => (
                    <button
                      key={e.calendar_event_id}
                      type="button"
                      onClick={() => onSelectEvent(e)}
                      title={`${e.title}${e.location ? ` · ${e.location}` : ""}`}
                      className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm transition-colors hover:bg-accent"
                    >
                      <Pill tone={eventTypeTone(e.event_type)}>{humanizeType(e.event_type)}</Pill>
                      <span className="min-w-0 flex-1 truncate">{e.title}</span>
                      {e.location && (
                        <span className="hidden shrink-0 truncate text-xs text-muted-foreground sm:inline">
                          {e.location}
                        </span>
                      )}
                    </button>
                  ))}
                  {dayDue.map((d) => (
                    <button
                      key={`${d.kind}:${d.subtask_id ?? d.task_id}`}
                      type="button"
                      onClick={() => onSelectDeadline?.(d)}
                      title={`Due — ${dueTitle(d)}`}
                      className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm transition-colors hover:bg-accent"
                    >
                      <Pill tone={d.is_overdue ? "bad" : "warn"}>Due</Pill>
                      <span className={cn("min-w-0 flex-1 truncate", d.is_done && "line-through opacity-60")}>
                        {dueTitle(d)}
                      </span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
