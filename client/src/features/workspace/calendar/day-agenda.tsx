/**
 * One day, as a bottom sheet — the day-agenda "what's actually on" surface.
 *
 * ── WHY IT EXISTS ──────────────────────────────────────────────────────────
 *
 * On a phone the month cell is a finger-target with dots, and until now its
 * tap opened the NEW-EVENT dialog — which meant the only way to read the day
 * was to risk writing it, and opening an existing event from a dot was
 * impossible. The sheet is the honest shape of a day on a small screen: its
 * events and deadlines as rows you can open, a one-line quick capture for the
 * thing that must exist right now, and an explicit "New event" for everything
 * else. Tapping a day can no longer create anything by accident; creation
 * starts only from a control that names itself.
 *
 * ── QUICK CAPTURE IS DELIBERATELY SMALL ────────────────────────────────────
 *
 * A title and nothing else becomes an ALL-DAY event on this day. All-day, not
 * "09:00 by default": a guessed slot is how a calendar fills with meetings
 * claiming a time nobody chose, and how clash check starts refusing taps.
 * The user refines the slot afterwards in the same dialog as everything else.
 * This is the recorded scope ("light quick capture"), so no parsing of
 * "tomorrow at 5 with Amara", no NLP, no suggestions — a title is what was
 * asked for, a title is what is taken.
 *
 * ── BOTH CLOCKS, ONE DAY ───────────────────────────────────────────────────
 *
 * What the sheet lists is the tenant-local version of the day (the same
 * index the grid already used): an event whose start is UTC-late but
 * Douala-early belongs to the tenant's today, not the server's.
 */
import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { errMsg } from "@/lib/use-resource";
import type { CalendarEvent, Deadline } from "../api";
import { useCreateEvent } from "../hooks";
import { eventTypeTone, humanizeType } from "../labels";
import { tenantDateTimeFmt, tenantTimeFmt } from "../time";
import { indexDeadlinesByDay, indexEventsByDay } from "./dates";

const TITLE_MAX = 200;

/** A step names its parent, exactly as the grid's chips do. */
const dueTitle = (d: Deadline) => (d.task_title ? `${d.task_title} · ${d.title}` : d.title);
/** A stable key for a deadline — a task or one of its steps. */
const dueKey = (d: Deadline) => `${d.kind}:${d.subtask_id ?? d.task_id}`;

export function DayAgenda({
  day,
  onClose,
  events,
  deadlines,
  timeZone,
  onOpenEvent,
  onOpenDeadline,
  onNewEvent,
}: {
  /** The tenant-local `YYYY-MM-DD` the sheet is for, or null when closed. */
  day: string | null;
  onClose: () => void;
  events: CalendarEvent[];
  deadlines: Deadline[];
  timeZone: string;
  onOpenEvent: (event: CalendarEvent) => void;
  onOpenDeadline: (deadline: Deadline) => void;
  onNewEvent: (day: string) => void;
}) {
  const toast = useToast();
  const create = useCreateEvent();
  const [quickTitle, setQuickTitle] = React.useState("");

  // Clear the input with each day: a residual title from Monday offered on
  // Tuesday is a creation nobody meant.
  React.useEffect(() => {
    setQuickTitle("");
  }, [day]);

  // The same per-day index the grid uses, so a three-day delivery shows on
  // its middle day here exactly as it does in the cell. A filter bespoke to
  // the sheet would drift on the first multi-day fix.
  const byDay = React.useMemo(() => indexEventsByDay(events, timeZone), [events, timeZone]);
  const dueByDay = React.useMemo(() => indexDeadlinesByDay(deadlines, timeZone), [deadlines, timeZone]);
  const dayEvents = day ? byDay.get(day) ?? [] : [];
  const dayDue = day ? dueByDay.get(day) ?? [] : [];

  function dayLabel(): string {
    if (!day) return "";
    const d = new Date(`${day}T12:00:00Z`);
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
    }).format(d);
  }

  async function quickAdd() {
    const title = quickTitle.trim();
    if (!title || !day) return;
    try {
      await create.mutateAsync({
        title,
        event_type: "other",
        start_at: `${day}T00:00`,
        end_at: `${day}T23:59`,
        all_day: true,
      });
      setQuickTitle("");
      toast.success("Added — all day. Open it to set a time.");
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  return (
    <Dialog
      open={Boolean(day)}
      onClose={onClose}
      title={dayLabel()}
      size="md"
      footer={
        <Button onClick={() => day && onNewEvent(day)} disabled={create.isPending}>
          New event on this day
        </Button>
      }
    >
      <div className="space-y-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void quickAdd();
          }}
        >
          <Input
            aria-label="Quick add — an all-day event"
            placeholder="Quick add — title only, lands as an all-day event"
            value={quickTitle}
            maxLength={TITLE_MAX}
            onChange={(e) => setQuickTitle(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={create.isPending || !quickTitle.trim()}>
            Add
          </Button>
        </form>

        {dayEvents.length === 0 && dayDue.length === 0 ? (
          <EmptyState
            title="Nothing on this day yet"
            hint="Quick add above for the one-liner, or New event for the full form."
          />
        ) : (
          <ul className="divide-y divide-border/60">
            {dayEvents.map((e) => (
              <li key={e.calendar_event_id}>
                <button
                  type="button"
                  onClick={() => onOpenEvent(e)}
                  className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-accent"
                >
                  <span className="num w-16 shrink-0 text-sm">
                    {e.all_day ? "All day" : tenantTimeFmt(e.start_at, timeZone)}
                  </span>
                  <Pill tone={eventTypeTone(e.event_type)}>{humanizeType(e.event_type)}</Pill>
                  <span className="min-w-0 flex-1 truncate text-sm">{e.title}</span>
                  {e.location && (
                    <span className="truncate text-sm text-muted-foreground">{e.location}</span>
                  )}
                </button>
              </li>
            ))}
            {dayDue.map((d) => (
              <li key={dueKey(d)}>
                <button
                  type="button"
                  onClick={() => onOpenDeadline(d)}
                  title={`Due — ${dueTitle(d)} — ${tenantDateTimeFmt(d.at, timeZone)}`}
                  className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-accent"
                >
                  <span className="num w-16 shrink-0 text-sm">{tenantTimeFmt(d.at, timeZone)}</span>
                  <Pill tone={d.is_overdue ? "bad" : "warn"}>Due</Pill>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      d.is_done && "line-through opacity-60",
                    )}
                  >
                    {dueTitle(d)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
