/**
 * The event write form — create and edit, one component.
 *
 * ── THE CLASH IS A WARNING, NOT A WALL ─────────────────────────────────────
 *
 * Two things genuinely can happen in one room, and a calendar that refuses to
 * book the second one gets worked around by people not booking rooms at all —
 * which is worse than the double-booking it was meant to prevent. So the server
 * answers 409 `CLASH_DETECTED` with the conflicting rows, this form shows them,
 * and one more click books it anyway (`force: true`). The user decides; the
 * product just makes sure they decided.
 *
 * ── END DEFAULTS TO AN HOUR AFTER START ────────────────────────────────────
 *
 * Because "an hour" is the modal event and an empty end field is a form that
 * cannot be submitted. It is overwritten the moment the user types their own,
 * and never silently re-derived afterwards.
 */
import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/modal";
import { NativeSelect } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateTimeField } from "@/components/ui/datetime-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api-client";
import { errMsg } from "@/lib/use-resource";
import { useConfirm } from "@/components/ui/use-confirm";
import type { CalendarEvent, EventInput, RepeatScope } from "../api";
import {
  useCreateEvent,
  useDeleteEvent,
  useUpdateEvent,
  useWorkspaceContext,
} from "../hooks";
import { addWallMinutes, tenantDateTimeFmt, tenantWallInput } from "../time";
import { EVENT_TYPE_OPTIONS, humanizeType } from "../labels";
import { RepeatField } from "../repeat-field";
import { RemindersField } from "../reminders-field";
import { draftsToInput, fromLegacyReminder, toReminderDrafts } from "../reminder-drafts";
import type { ReminderDraft } from "../reminder-drafts";
import { ParticipantsSection } from "./participants-section";

const TITLE_MAX = 200;
const LOCATION_MAX = 300;

/** The shape the server sends back inside a 409 `CLASH_DETECTED`. */
type Clash = {
  calendar_event_id: string;
  title: string;
  start_at: string;
  end_at: string;
  location: string | null;
};

export function EventDialog({
  open,
  onClose,
  event,
  defaultDay,
}: {
  open: boolean;
  onClose: () => void;
  event?: CalendarEvent | null;
  /** `YYYY-MM-DD` when opened from a day cell. */
  defaultDay?: string | null;
}) {
  const toast = useToast();
  const create = useCreateEvent();
  const update = useUpdateEvent();
  const del = useDeleteEvent();
  const contextQ = useWorkspaceContext();
  const timeZone = contextQ.data?.timeZone;
  const [confirm, confirmDialog] = useConfirm();
  const editing = !!event;
  const initialised = React.useRef<string | null>(null);

  const [title, setTitle] = React.useState("");
  const [eventType, setEventType] = React.useState<string>("meeting");
  const [location, setLocation] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [startAt, setStartAt] = React.useState("");
  const [endAt, setEndAt] = React.useState("");
  const [allDay, setAllDay] = React.useState(false);
  // The up-to-three reminders of 13890, edited as rows rather than as the
  // single preset of 13810.
  const [reminders, setReminders] = React.useState<ReminderDraft[]>([]);
  const [repeatRule, setRepeatRule] = React.useState<string | null>(null);
  const [seriesScope, setSeriesScope] = React.useState<RepeatScope>("this");
  const [error, setError] = React.useState<string | null>(null);
  const [clashes, setClashes] = React.useState<Clash[]>([]);

  React.useEffect(() => {
    if (!open) {
      initialised.current = null;
      return;
    }
    if (!timeZone) return;
    const key = `${event?.calendar_event_id ?? "new"}:${defaultDay ?? ""}:${timeZone}`;
    if (initialised.current === key) return;
    initialised.current = key;
    setTitle(event?.title ?? "");
    setEventType(event?.event_type ?? "meeting");
    setLocation(event?.location ?? "");
    setDescription(event?.description ?? "");
    setStartAt(
      event
        ? tenantWallInput(event.start_at, timeZone)
        : dayToInput(defaultDay, "09:00"),
    );
    setEndAt(
      event
        ? tenantWallInput(event.end_at, timeZone)
        : dayToInput(defaultDay, "10:00"),
    );
    setAllDay(event?.all_day ?? false);
    setReminders(
      event
        ? event.reminders && event.reminders.length
          ? toReminderDrafts(event.reminders, timeZone)
          : fromLegacyReminder(event.reminder_minutes, event.remind_at, timeZone)
        : [],
    );
    setRepeatRule(event?.recurrence_rule ?? null);
    setSeriesScope("this");
    setError(null);
    setClashes([]);
  }, [defaultDay, event, open, timeZone]);

  /** One hour after start, in the tenant wall-clock field's string shape. */
  function defaultEnd(start: string): string {
    return addWallMinutes(start, 60);
  }

  function buildInput(force = false): EventInput | { error: string } {
    const built = draftsToInput(reminders);
    if ("error" in built) return built;
    const input: EventInput = {
      title: title.trim(),
      event_type: eventType,
      location: location.trim() ? location.trim() : null,
      description: description.trim() ? description.trim() : null,
      start_at: startAt,
      end_at: endAt,
      all_day: allDay,
      // PR 3's list supersedes the 13810 pair server-side; an empty list
      // disarms. See the task dialog for the same payload contract.
      reminders: built.input,
      // On create, a one-off event omits recurrence_rule; on edit, an explicit
      // null disarms an existing series.
      recurrence_rule: repeatRule || (editing ? null : undefined),
      force,
    };
    // Only meaningful for a row that is one occurrence of a series; the server
    // ignores it otherwise.
    if (editing && event?.recurrence_series_id) input.series = seriesScope;
    return input;
  }

  async function submit(force = false) {
    if (!title.trim()) {
      setError("An event needs a title.");
      return;
    }
    if (!startAt || !endAt) {
      setError("Both a start and an end are needed.");
      return;
    }
    if (endAt < startAt) {
      setError("The event has to end after it starts.");
      return;
    }
    const built = buildInput(force);
    if ("error" in built) {
      setError(built.error);
      return;
    }
    const input = built;
    try {
      if (editing && event)
        await update.mutateAsync({ id: event.calendar_event_id, input });
      else await create.mutateAsync(input);
      toast.success(editing ? "Event updated" : "Event added");
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === "CLASH_DETECTED") {
        // Show what is already booked and let the user decide — see header.
        // The server puts `AppError.details` on the wire as `fields`, so the
        // rows are at `fields.clashes` and not at `fields` itself.
        const payload = err.fields as { clashes?: Clash[] } | undefined;
        setClashes(
          Array.isArray(payload?.clashes) ? (payload?.clashes as Clash[]) : [],
        );
        setError(err.message);
        return;
      }
      const message = errMsg(err);
      setError(message);
      toast.error(message);
    }
  }

  async function remove() {
    if (!event) return;
    const ok = await confirm({
      title: "Delete this event?",
      body: event.recurrence_series_id
        ? "The event is removed from the calendar. Occurrences already spawned stay in the history of their series."
        : "It is removed from the calendar. This cannot be undone from here.",
      confirmLabel: "Delete event",
      cancelLabel: "Keep it",
      destructive: true,
    });
    if (!ok) return;
    try {
      await del.mutateAsync(event.calendar_event_id);
      toast.success("Event deleted");
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  const busy = create.isPending || update.isPending || del.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Edit event" : "New event"}
      size="lg"
      footer={
        <>
          {editing && (
            <Button
              variant="ghost"
              onClick={() => void remove()}
              disabled={busy}
              className="mr-auto text-destructive"
            >
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit(false)}
            disabled={busy || !timeZone}
          >
            {editing ? "Save changes" : "Add event"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {contextQ.isLoading && <LoadingRow label="Loading the tenant clock…" />}
        {contextQ.error && (
          <ErrorState
            message={contextQ.error.message}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => void contextQ.refetch()}
              >
                Retry
              </Button>
            }
          />
        )}
        {confirmDialog}
        {error && (
          <Callout
            tone={clashes.length ? "warn" : "bad"}
            title={clashes.length ? "Something is already booked" : undefined}
          >
            {error}
          </Callout>
        )}

        {clashes.length > 0 && (
          <div className="space-y-2">
            <ul className="space-y-1 rounded-md border p-3 text-sm">
              {clashes.map((c) => (
                <li
                  key={c.calendar_event_id}
                  className="flex flex-wrap gap-x-2"
                >
                  <span className="num">
                    {tenantDateTimeFmt(c.start_at, timeZone ?? "Africa/Douala")}
                  </span>
                  <span className="font-medium">{c.title}</span>
                  {c.location && (
                    <span className="text-muted-foreground">{c.location}</span>
                  )}
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              onClick={() => void submit(true)}
              disabled={busy}
            >
              Book it anyway
            </Button>
          </div>
        )}

        <Field label="Title" required htmlFor="event-title">
          <Input
            id="event-title"
            value={title}
            maxLength={TITLE_MAX}
            onChange={(e) => {
              setTitle(e.target.value);
              if (error) setError(null);
            }}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="event-type">
            <NativeSelect
              id="event-type"
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
            >
              {/* A type written by another client that is not in the list still
                  has to be selectable, or editing would silently change it. */}
              {!EVENT_TYPE_OPTIONS.includes(
                eventType as (typeof EVENT_TYPE_OPTIONS)[number],
              ) && <option value={eventType}>{humanizeType(eventType)}</option>}
              {EVENT_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {humanizeType(t)}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field
            label="Where"
            htmlFor="event-location"
            hint="Two events in the same place at the same time will warn you."
          >
            <Input
              id="event-location"
              value={location}
              maxLength={LOCATION_MAX}
              onChange={(e) => setLocation(e.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts" required htmlFor="event-start">
            <DateTimeField
              id="event-start"
              value={startAt}
              onChange={(v) => {
                setStartAt(v);
                // Only fill an end the user has not chosen. Overwriting one
                // they typed would be the form arguing with them.
                if (!endAt && v) setEndAt(defaultEnd(v));
              }}
            />
          </Field>

          <Field label="Ends" required htmlFor="event-end">
            <DateTimeField id="event-end" value={endAt} onChange={setEndAt} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <RemindersField
            rows={reminders}
            onChange={setReminders}
            recurring={Boolean(repeatRule) || Boolean(event?.recurrence_series_id)}
            idPrefix="event"
          />

          <div className="flex items-end">
            <Checkbox
              checked={allDay}
              onCheckedChange={(v) => {
                setAllDay(v);
                // An all-day event spans the day; leaving 09:00–10:00 stored
                // would make the grid draw it as a one-hour appointment.
                if (v && startAt) {
                  const day = startAt.slice(0, 10);
                  setStartAt(`${day}T00:00`);
                  setEndAt(`${day}T23:59`);
                }
              }}
              label="All day"
            />
          </div>
        </div>

        {/* Who is coming — the participants live on the SAVED event, so this
            section answers only in edit mode; a brand-new event gains invitees
            the moment it exists, and offering the editor here would write
            invitations against an id that is not yet one. */}
        {editing && event && (
          <ParticipantsSection event={event} timeZone={timeZone ?? "Africa/Douala"} />
        )}

        <RepeatField
          idPrefix="event"
          value={repeatRule}
          dueIso={startAt || null}
          onChange={setRepeatRule}
        />

        {editing && event?.recurrence_series_id && (
          <Field label="Apply changes to" htmlFor="event-series-scope">
            <NativeSelect
              id="event-series-scope"
              value={seriesScope}
              onChange={(e) => setSeriesScope(e.target.value as RepeatScope)}
            >
              <option value="this">Just this one</option>
              <option value="series">This and future occurrences</option>
            </NativeSelect>
          </Field>
        )}

        <Field label="Notes" htmlFor="event-description">
          <Textarea
            id="event-description"
            value={description}
            rows={3}
            maxLength={2000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}

/** A tenant-local day cell's `YYYY-MM-DD` plus a time of day. */
function dayToInput(day: string | null | undefined, time: string): string {
  return day ? `${day}T${time}` : "";
}
