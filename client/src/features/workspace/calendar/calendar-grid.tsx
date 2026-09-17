/**
 * The month grid — one cell per day, the day's events as chips.
 *
 * ── WHY THE GRID IS BUILT FROM A SUNDAY-START 6×7 ──────────────────────────
 *
 * A month view that changes height between months makes the whole page jump
 * when you press "next", and a 5-row month leaves the layout a different size
 * from a 6-row one. Six weeks is always enough (a 31-day month starting on a
 * Saturday needs six) and always the same shape, so navigation moves the
 * contents and not the frame.
 *
 * ── WHY AN EVENT APPEARS ON EVERY DAY IT SPANS ─────────────────────────────
 *
 * A three-day delivery that showed only on its start date would make the other
 * two days look free, which is the classic empty-calendar bug and the reason
 * the server query is `start < to AND end >= from` rather than
 * `start BETWEEN`. The grid and the query have to agree or one of them lies.
 *
 * ── COLOURS ARE TOKENS ─────────────────────────────────────────────────────
 *
 * A chip's tone comes from the UI kit's palette, which resolves from the
 * tenant's own `--primary` and friends. A hardcoded hex here would be the one
 * piece of the calendar that does not belong to the tenant looking at it.
 */
import * as React from "react";
import { cn } from "@/lib/cn";
import { Pill } from "@/components/ui/pill";
import { todayISO } from "@/lib/format";
import type { CalendarEvent, Deadline } from "../api";
import { eventTypeTone, humanizeType } from "../labels";
import { DAY_LABELS, isoDay, monthCells, indexEventsByDay, indexDeadlinesByDay } from "./dates";

/** Chips shown before "+N more". Three is what fits a cell without the grid
 *  becoming taller than it is wide on a phone. */
const MAX_CHIPS = 3;
/** Deadlines sit under the events, so they get a smaller share of the cell. */
const MAX_DUE_CHIPS = 2;

/** A stable key for a deadline — a task or one of its steps. */
const dueKey = (d: Deadline) => `${d.kind}:${d.subtask_id ?? d.task_id}`;
/** A step names its parent so the chip reads "Bank file · Documents to bank". */
const dueTitle = (d: Deadline) => (d.task_title ? `${d.task_title} · ${d.title}` : d.title);

export function CalendarGrid({
  year,
  month,
  events,
  deadlines = [],
  loading,
  onSelectDay,
  onSelectEvent,
  onSelectDeadline,
}: {
  year: number;
  month: number;
  events: CalendarEvent[];
  /** Task + subtask due dates laid over the events as chips. */
  deadlines?: Deadline[];
  loading: boolean;
  onSelectDay: (iso: string) => void;
  onSelectEvent: (event: CalendarEvent) => void;
  onSelectDeadline?: (deadline: Deadline) => void;
}) {
  const byDay = React.useMemo(() => indexEventsByDay(events), [events]);
  const dueByDay = React.useMemo(() => indexDeadlinesByDay(deadlines), [deadlines]);
  const today = todayISO();
  const cells = React.useMemo(() => monthCells(year, month), [year, month]);

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-7 border-b bg-muted/30" role="row">
        {DAY_LABELS.map((d) => (
          <div key={d} className="px-2 py-1.5 text-center micro" aria-hidden>
            <span className="hidden sm:inline">{d}</span>
            <span className="sm:hidden">{d.charAt(0)}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((date) => {
          const iso = isoDay(date);
          const inMonth = date.getMonth() === month;
          const dayEvents = byDay.get(iso) ?? [];
          const dayDue = dueByDay.get(iso) ?? [];
          const isToday = iso === today;
          return (
            // The whole cell is the hit area: a small date number reads as
            // "not clickable", so the day is chosen from anywhere in the cell.
            // A plain <div role="button"> rather than a <button>, because the
            // cell also contains the event-chip buttons and a button inside a
            // button is invalid HTML.
            <div
              key={iso}
              role="button"
              tabIndex={0}
              onClick={() => onSelectDay(iso)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectDay(iso);
                }
              }}
              aria-label={`Schedule an event on ${date.toDateString()} — ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}${dayDue.length ? `, ${dayDue.length} deadline${dayDue.length === 1 ? "" : "s"}` : ""}`}
              className={cn(
                "min-h-[5.5rem] cursor-pointer border-b border-r p-1.5 align-top transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-[7rem]",
                !inMonth && "bg-muted/20 opacity-50",
              )}
            >
              <span
                className={cn(
                  "num mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs",
                  isToday && "bg-primary font-semibold text-primary-foreground",
                )}
              >
                {date.getDate()}
              </span>

              {loading ? (
                <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
              ) : (
                <ul className="space-y-0.5">
                  {/* On a phone the chips are too small to read, so a dot per
                      item carries the count and the cell carries the accessible
                      label — events and deadlines together. */}
                  {(dayEvents.length > 0 || dayDue.length > 0) && (
                    <li className="flex flex-wrap gap-1 sm:hidden">
                      {dayEvents.slice(0, MAX_CHIPS).map((e) => (
                        <span
                          key={e.calendar_event_id}
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            e.event_type === "deadline" ? "bg-destructive" : "bg-primary",
                          )}
                        />
                      ))}
                      {dayDue.slice(0, MAX_CHIPS).map((d) => (
                        <span
                          key={dueKey(d)}
                          className={cn(
                            "h-1.5 w-1.5 rounded-full ring-1 ring-inset ring-border",
                            d.is_overdue ? "bg-destructive" : "bg-muted-foreground",
                          )}
                        />
                      ))}
                    </li>
                  )}

                  {dayEvents.slice(0, MAX_CHIPS).map((e) => (
                    <li key={e.calendar_event_id} className="hidden sm:block">
                      <button
                        type="button"
                        onClick={(ev) => {
                          // The cell is clickable too: without this, choosing
                          // an event would also open the new-event dialog.
                          ev.stopPropagation();
                          onSelectEvent(e);
                        }}
                        title={`${e.title}${e.location ? ` · ${e.location}` : ""}`}
                        className="block w-full truncate rounded px-1 py-0.5 text-left text-xs transition-colors hover:bg-accent"
                      >
                        <Pill tone={eventTypeTone(e.event_type)}>{humanizeType(e.event_type)}</Pill>{" "}
                        <span className="truncate">{e.title}</span>
                      </button>
                    </li>
                  ))}

                  {dayEvents.length > MAX_CHIPS && (
                    <li className="hidden px-1 text-xs text-muted-foreground sm:block">
                      +{dayEvents.length - MAX_CHIPS} more
                    </li>
                  )}

                  {/* Deadlines: task and subtask due dates, laid under the
                      events. A due date opens its task rather than an event. */}
                  {dayDue.slice(0, MAX_DUE_CHIPS).map((d) => (
                    <li key={dueKey(d)} className="hidden sm:block">
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onSelectDeadline?.(d);
                        }}
                        title={`Due — ${dueTitle(d)}`}
                        className="block w-full truncate rounded px-1 py-0.5 text-left text-xs transition-colors hover:bg-accent"
                      >
                        <Pill tone={d.is_overdue ? "bad" : "warn"}>Due</Pill>{" "}
                        <span className={cn("truncate", d.is_done && "line-through opacity-60")}>
                          {d.title}
                        </span>
                      </button>
                    </li>
                  ))}

                  {dayDue.length > MAX_DUE_CHIPS && (
                    <li className="hidden px-1 text-xs text-muted-foreground sm:block">
                      +{dayDue.length - MAX_DUE_CHIPS} due
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
