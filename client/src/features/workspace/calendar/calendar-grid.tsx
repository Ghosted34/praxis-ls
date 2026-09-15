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
import type { CalendarEvent } from "../api";
import { eventTypeTone, humanizeType } from "../labels";
import { DAY_LABELS, isoDay, monthCells } from "./dates";

/** Events by local day, so the grid is one Map lookup per cell. */
function indexByDay(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const out = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const start = new Date(e.start_at);
    const end = new Date(e.end_at);
    // Walk the days it spans rather than filing it under its start alone.
    for (let d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); d <= end; d.setDate(d.getDate() + 1)) {
      const key = isoDay(d);
      const list = out.get(key);
      if (list) list.push(e);
      else out.set(key, [e]);
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.start_at.localeCompare(b.start_at));
  return out;
}

/** Chips shown before "+N more". Three is what fits a cell without the grid
 *  becoming taller than it is wide on a phone. */
const MAX_CHIPS = 3;

export function CalendarGrid({
  year,
  month,
  events,
  loading,
  onSelectDay,
  onSelectEvent,
}: {
  year: number;
  month: number;
  events: CalendarEvent[];
  loading: boolean;
  onSelectDay: (iso: string) => void;
  onSelectEvent: (event: CalendarEvent) => void;
}) {
  const byDay = React.useMemo(() => indexByDay(events), [events]);
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
          const isToday = iso === today;
          return (
            <div
              key={iso}
              className={cn(
                "min-h-[5.5rem] border-b border-r p-1.5 align-top sm:min-h-[7rem]",
                !inMonth && "bg-muted/20 opacity-50",
              )}
            >
              <button
                type="button"
                onClick={() => onSelectDay(iso)}
                aria-label={`${date.toDateString()} — ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}`}
                className={cn(
                  "num mb-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs transition-colors hover:bg-accent",
                  isToday && "bg-primary font-semibold text-primary-foreground",
                )}
              >
                {date.getDate()}
              </button>

              {loading ? (
                <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
              ) : (
                <ul className="space-y-0.5">
                  {/* On a phone the chips are too small to read, so a dot per
                      event carries the count and the day button carries the
                      accessible label. */}
                  <li className="flex gap-1 sm:hidden">
                    {dayEvents.slice(0, MAX_CHIPS).map((e) => (
                      <span
                        key={e.calendar_event_id}
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          e.event_type === "deadline" ? "bg-destructive" : "bg-primary",
                        )}
                      />
                    ))}
                  </li>

                  {dayEvents.slice(0, MAX_CHIPS).map((e) => (
                    <li key={e.calendar_event_id} className="hidden sm:block">
                      <button
                        type="button"
                        onClick={() => onSelectEvent(e)}
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
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
