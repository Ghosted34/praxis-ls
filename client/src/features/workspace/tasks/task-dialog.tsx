/**
 * The task write form — create and edit, one component.
 *
 * ── WHY ONE COMPONENT FOR BOTH ─────────────────────────────────────────────
 *
 * The fields, their validation and their vocabulary are identical; only the
 * verb on the button and the endpoint differ. Two components would drift on
 * the first field one of them grows, and the drift shows up as "I can set a
 * reminder when I create a task but not when I edit it" — a bug nobody reports
 * because it reads as a missing feature.
 *
 * ── DATES GO UP AS TYPED ───────────────────────────────────────────────────
 *
 * `<DateTimeField>` holds and emits `YYYY-MM-DDTHH:mm`, and that string is
 * posted unchanged. It is a wall-clock time with no offset, and the SERVER
 * reads it on the tenant's workplace clock. Converting it in the browser would
 * substitute the laptop's timezone for the business's, which for anyone
 * working away from head office is silently an hour or more out.
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
import { EmployeePicker } from "@/components/employee-picker";
import { FileLinkField } from "../file-link-field";
import { EMPTY_LINK, linkOf } from "../file-link";
import type { FileLink } from "../file-link";
import { useToast } from "@/components/ui/toast";
import { errMsg } from "@/lib/use-resource";
import { TASK_PRIORITIES, TASK_STATUSES } from "../api";
import type { Task, TaskInput, TaskPriority, TaskStatus } from "../api";
import { useAddChildTask, useCreateTask, useUpdateTask, useWorkspaceContext } from "../hooks";
import { PRIORITY_LABEL, STATUS_LABEL } from "../labels";
import { RepeatField } from "../repeat-field";
import { RemindersField } from "../reminders-field";
import {
  draftsToInput,
  fromLegacyReminder,
  toReminderDrafts,
} from "../reminder-drafts";
import type { ReminderDraft } from "../reminder-drafts";
import type { RepeatScope } from "../api";

/** The most a title can be. Mirrors the CHECK on the column, so the user is
 *  told here rather than by a 23514 from Postgres. */
const TITLE_MAX = 300;
const DESCRIPTION_MAX = 4000;

export function TaskDialog({
  open,
  onClose,
  task,
  /** Pre-filled due date when the form is opened from a day on the calendar. */
  defaultDue,
  /** Seed for a NEW task (mail conversion). Ignored when `task` is set. */
  initial,
  /** Receives the created task's id on POST, so callers can link back to it. */
  onSaved,
  /**
   * Open in CHILD mode, under this parent.
   *
   * The same component rather than a second dialog, for the reason in the
   * header: two forms drift on the first field one of them grows, and the
   * drift shows up as "I can set a reminder on a task but not on a child task"
   * — a bug nobody reports because it reads as a missing feature. Child mode
   * hides the fields that are structurally meaningless on a child (personal,
   * repeat) rather than offering controls the server would refuse.
   */
  parent,
}: {
  open: boolean;
  onClose: () => void;
  task?: Task | null;
  defaultDue?: string | null;
  initial?: {
    title?: string | null;
    description?: string | null;
    /** Opens the form already linked to an operations file (13920) — what the
     *  file's own Tasks tab raises a task through, so the link is visible in
     *  the form rather than applied invisibly on save. */
    dossier_id?: string | null;
    dossier_ref?: string | null;
    dossier_client_name?: string | null;
    milestone_instance_id?: string | null;
  } | null;
  onSaved?: (id?: string | null) => void;
  parent?: Task | null;
}) {
  const toast = useToast();
  const create = useCreateTask();
  const update = useUpdateTask();
  const addChild = useAddChildTask();
  const editing = !!task;
  const childMode = !editing && !!parent;
  // The tenant clock, for echoing an absolute reminder instant back in the
  // zone the business reads rather than the laptop's — same contract as the
  // event dialog.
  const contextQ = useWorkspaceContext();
  const timeZone = contextQ.data?.timeZone;

  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [status, setStatus] = React.useState<TaskStatus>("TO_DO");
  const [priority, setPriority] = React.useState<TaskPriority>("NORMAL");
  const [dueAt, setDueAt] = React.useState("");
  // The up-to-three reminder rows of 13890. A relative row re-moves with the
  // due date; an absolute one stays where it is put.
  const [reminders, setReminders] = React.useState<ReminderDraft[]>([]);
  const [isPersonal, setIsPersonal] = React.useState(false);
  const [repeatRule, setRepeatRule] = React.useState<string | null>(null);
  // When the open task is one occurrence of a series, whether an edit rewrites
  // just this row or every future one (13840).
  const [seriesScope, setSeriesScope] = React.useState<RepeatScope>("this");
  // The `user_id` the task is handed to, plus the name to show for it. Held as a
  // pair because the picker searches employees but a task is assigned to a
  // LOGIN (`assigned_to` is an app_user id), and the panel needs a name to draw
  // without a second lookup.
  const [assignedTo, setAssignedTo] = React.useState<string | null>(null);
  const [assignedName, setAssignedName] = React.useState<string | null>(null);
  // The operations file this work is on, and optionally the stage of its chain
  // (13920). One piece of state rather than two, because clearing the file has
  // to clear the stage and a split pair makes that an effect that can be
  // forgotten — see file-link-field.tsx.
  const [fileLink, setFileLink] = React.useState<FileLink>(EMPTY_LINK);
  const [error, setError] = React.useState<string | null>(null);

  // Reset on open rather than on unmount: the Dialog stays mounted and only
  // `open` flips, so a stale form would otherwise reopen showing the last
  // task the user edited. The tenant clock gates the seed so an absolute
  // reminder instant echoes back as the time the business means, not the
  // laptop's — the same reason the event dialog waits for `timeZone`.
  React.useEffect(() => {
    if (!open || !timeZone) return;
    setTitle(task?.title ?? initial?.title ?? "");
    setDescription(task?.description ?? initial?.description ?? "");
    setStatus(task?.status ?? "TO_DO");
    setPriority(task?.priority ?? "NORMAL");
    setDueAt(toLocalInput(task?.due_at ?? defaultDue ?? null));
    setReminders(
      task
        ? task.reminders && task.reminders.length
          ? toReminderDrafts(task.reminders, timeZone)
          : fromLegacyReminder(task.reminder_minutes, task.remind_at, timeZone)
        : [],
    );
    setIsPersonal(task?.is_personal ?? false);
    setRepeatRule(task?.recurrence_rule ?? null);
    setSeriesScope("this");
    setAssignedTo(task?.assigned_to ?? null);
    setAssignedName(task?.assigned_to_name ?? null);
    // A child seeds from the PARENT's file, so the pre-filled form shows the
    // link it will inherit rather than an empty picker that then fills itself
    // in server-side — the user would have no way to tell it was going to.
    setFileLink(
      task ? linkOf(task) : childMode && parent ? linkOf(parent) : linkOf(initial ?? null),
    );
    setError(null);
    // `initial` is a dep like the rest: the mail conversion page memoises it,
    // so this re-seeds only when the seed itself changes, not on every render.
  }, [open, task, defaultDue, initial, timeZone, childMode, parent]);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("A task needs a title.");
      return;
    }
    // The server refuses this too — a repeat with no anchor never spawns, and
    // the failure is silent and discovered weeks later by its absence. Saying
    // it here means the user is told at the field instead of by a 422.
    if (repeatRule && !dueAt) {
      setError("A repeating task needs a due date to repeat from.");
      return;
    }
    const built = draftsToInput(reminders);
    if ("error" in built) {
      setError(built.error);
      return;
    }
    // A reminder relative to the due date needs the task to HAVE one — the
    // server's 400 would say so, and it is better said here, at the field.
    if (!dueAt && built.input.some((r) => r.reminder_minutes != null)) {
      setError("A reminder before the due date needs the task to have one — set the date, or make this reminder an exact time.");
      return;
    }
    const input: TaskInput = {
      title: trimmed,
      description: description.trim() ? description.trim() : null,
      status,
      priority,
      due_at: dueAt || null,
      // PR 3's list supersedes the 13810 pair server-side. An EMPTY list is a
      // real statement ("no reminders"), so editing a task can disarm it.
      reminders: built.input,
      is_personal: isPersonal,
      // On create, an unrepeated task omits recurrence_rule (or passes null).
      // On edit, an explicit null disarms an existing series.
      recurrence_rule: repeatRule || (editing ? null : undefined),
      // Explicit null when nobody is chosen, so EDITING a task can UNASSIGN it
      // rather than silently leaving the previous owner in place.
      assigned_to: assignedTo,
      // Both explicit, for the same reason: an edit that clears the picker has
      // to UNLINK the task, and an omitted field would leave the old file on
      // it. The server clears the stage whenever the file goes, so the two can
      // never disagree even if a future caller sends only one.
      dossier_id: fileLink.dossier_id,
      milestone_instance_id: fileLink.milestone_instance_id,
    };
    // Only meaningful when the open task belongs to a series; otherwise the
    // server ignores it (there is nothing else to rewrite).
    if (editing && task?.recurrence_series_id) input.series = seriesScope;
    try {
      if (childMode && parent) {
        // ONE endpoint under the parent, shared with the inline quick-add row:
        // the child inherits the parent's operations-file link server-side, so
        // the two entry points cannot disagree about what a child is.
        const { is_personal: _ignoredPersonal, recurrence_rule: _ignoredRule, ...childInput } = input;
        const created = await addChild.mutateAsync({ parentId: parent.task_id, input: childInput });
        onSaved?.(created?.task_id ?? null);
      } else if (editing && task) {
        await update.mutateAsync({ id: task.task_id, input });
        onSaved?.(task.task_id);
      } else {
        const created = await create.mutateAsync(input);
        onSaved?.(created?.task_id ?? null);
      }
      toast.success(editing ? "Task updated" : "Task added");
      onClose();
    } catch (err) {
      // `errMsg` on a CAUGHT exception — not on a hook's `error`, which is
      // already a string (F12).
      const message = errMsg(err);
      setError(message);
      toast.error(message);
    }
  }

  const busy = create.isPending || update.isPending || addChild.isPending;
  const titleTooLong = title.length > TITLE_MAX;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Edit task" : childMode ? "New child task" : "New task"}
      description={
        editing
          ? undefined
          : childMode
            ? `A separately assigned piece of “${parent?.title}”. It inherits the parent's linked record unless you change it, and it carries its own owner, deadline and reminder.`
            : "What has to happen, and by when. Leave the date off and it stays on your list without a deadline."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || titleTooLong}>
            {editing ? "Save changes" : childMode ? "Add child task" : "Add task"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Callout tone="bad">{error}</Callout>}

        <Field
          label="Title"
          required
          htmlFor="task-title"
          error={titleTooLong ? `Keep it under ${TITLE_MAX} characters.` : undefined}
          hint={!editing ? "Start with the verb — “Chase the BL”, not “BL”." : undefined}
        >
          <Input
            id="task-title"
            value={title}
            maxLength={TITLE_MAX}
            onChange={(e) => {
              setTitle(e.target.value);
              if (error) setError(null);
            }}
          />
        </Field>

        <Field label="Notes" htmlFor="task-description" hint={`${description.length}/${DESCRIPTION_MAX}`}>
          <Textarea
            id="task-description"
            value={description}
            rows={3}
            maxLength={DESCRIPTION_MAX}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status" htmlFor="task-status">
            <NativeSelect
              id="task-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as TaskStatus)}
            >
              {TASK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field label="Priority" htmlFor="task-priority">
            <NativeSelect
              id="task-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriority)}
            >
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Due"
            htmlFor="task-due"
            hint="No date means no deadline — it stays on your list."
          >
            <DateTimeField id="task-due" value={dueAt} onChange={setDueAt} />
          </Field>

        </div>

        {/* Which operations file this work is on, and optionally which stage of
            its chain (13920). Both optional, and NULL on most tasks — a
            reminder to renew a licence is not about a shipment. Linking it puts
            the task on the file's own Tasks tab and into the Analytics rollup;
            it never moves the milestone. */}
        <FileLinkField value={fileLink} onChange={setFileLink} idPrefix="task" disabled={busy} />

        {/* The several reminders of 13890. A relative row rides the due date;
            an absolute one is written as a zoneless wall clock and read by the
            server on the TENANT's workplace clock, exactly like the due date
            above — the browser must not substitute the laptop's zone. */}
        <RemindersField
          rows={reminders}
          onChange={setReminders}
          recurring={Boolean(repeatRule) || Boolean(task?.recurrence_series_id)}
          idPrefix="task"
        />

        {/* A child task is a one-off piece of a parent's work. A repeat here
            would spawn a new child per occurrence and multiply the board by
            the recurrence count, so child mode does not offer it. */}
        {!childMode && (
        <RepeatField
          idPrefix="task"
          value={repeatRule}
          dueIso={dueAt || null}
          onChange={setRepeatRule}
        />
        )}

        {editing && task?.recurrence_series_id && (
          <Field label="Apply changes to" htmlFor="task-series-scope">
            <NativeSelect
              id="task-series-scope"
              value={seriesScope}
              onChange={(e) => setSeriesScope(e.target.value as RepeatScope)}
            >
              <option value="this">Just this one</option>
              <option value="series">This and future occurrences</option>
            </NativeSelect>
          </Field>
        )}

        {/* Who it is on. A task assigned to someone else is notified to them and
            lands in their board's "My work" — the meeting's "assign it so it
            shows on their dashboard". Left empty, the task stays on the
            creator's own list. Hidden for a personal task, which by definition
            is nobody else's. */}
        {!isPersonal &&
          (assignedTo ? (
            <Field label="Assigned to" htmlFor="task-assignee">
              <div
                id="task-assignee"
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate">{assignedName ?? "Selected employee"}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAssignedTo(null);
                    setAssignedName(null);
                  }}
                >
                  Change
                </Button>
              </div>
            </Field>
          ) : (
            <EmployeePicker
              id="task-assignee"
              label="Assign to"
              placeholder="Search staff by name or job title…"
              requireAccount
              onPick={(e) => {
                setAssignedTo(e.account_user_id ?? null);
                setAssignedName(e.full_name ?? null);
              }}
            />
          ))}

        {/* A child of shared work is not a private note. */}
        {!childMode && (
        <Checkbox
          checked={isPersonal}
          onCheckedChange={(checked) => {
            setIsPersonal(checked);
            // A personal task is nobody else's, so choosing it drops any pending
            // assignee rather than sending a contradiction to the server.
            if (checked) {
              setAssignedTo(null);
              setAssignedName(null);
            }
          }}
          label="Personal task"
          hint="Keeps it off your team's view even where your role would otherwise show them your work."
        />
        )}
      </div>
    </Dialog>
  );
}

/**
 * An instant back into the field's `YYYY-MM-DDTHH:mm` shape.
 *
 * Rendered in the BROWSER's zone on purpose, and this is the one place the two
 * clocks legitimately differ: the field shows the user the time as THEY will
 * read it, and posts it back as the wall-clock string the server then resolves
 * on the tenant's clock. A user in Douala on a laptop set to Douala sees the
 * time they set; the round trip is stable because both readings agree.
 */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}


