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
import { useToast } from "@/components/ui/toast";
import { errMsg } from "@/lib/use-resource";
import { TASK_PRIORITIES, TASK_STATUSES } from "../api";
import type { Task, TaskInput, TaskPriority, TaskStatus } from "../api";
import { useCreateTask, useUpdateTask } from "../hooks";
import { PRIORITY_LABEL, REMINDER_PRESETS, STATUS_LABEL } from "../labels";

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
}: {
  open: boolean;
  onClose: () => void;
  task?: Task | null;
  defaultDue?: string | null;
}) {
  const toast = useToast();
  const create = useCreateTask();
  const update = useUpdateTask();
  const editing = !!task;

  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [status, setStatus] = React.useState<TaskStatus>("TO_DO");
  const [priority, setPriority] = React.useState<TaskPriority>("NORMAL");
  const [dueAt, setDueAt] = React.useState("");
  const [reminder, setReminder] = React.useState("");
  const [isPersonal, setIsPersonal] = React.useState(false);
  // The `user_id` the task is handed to, plus the name to show for it. Held as a
  // pair because the picker searches employees but a task is assigned to a
  // LOGIN (`assigned_to` is an app_user id), and the panel needs a name to draw
  // without a second lookup.
  const [assignedTo, setAssignedTo] = React.useState<string | null>(null);
  const [assignedName, setAssignedName] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Reset on open rather than on unmount: the Dialog stays mounted and only
  // `open` flips, so a stale form would otherwise reopen showing the last
  // task the user edited.
  React.useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setStatus(task?.status ?? "TO_DO");
    setPriority(task?.priority ?? "NORMAL");
    setDueAt(toLocalInput(task?.due_at ?? defaultDue ?? null));
    setReminder(fromReminder(task));
    setIsPersonal(task?.is_personal ?? false);
    setAssignedTo(task?.assigned_to ?? null);
    setAssignedName(task?.assigned_to_name ?? null);
    setError(null);
  }, [open, task, defaultDue]);

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) {
      setError("A task needs a title.");
      return;
    }
    const input: TaskInput = {
      title: trimmed,
      description: description.trim() ? description.trim() : null,
      status,
      priority,
      due_at: dueAt || null,
      // An empty preset means "no reminder" — sent as an explicit null so
      // editing a task REMOVES its reminder rather than leaving it behind.
      reminder_minutes: reminder === "" ? null : Number(reminder),
      is_personal: isPersonal,
      // Explicit null when nobody is chosen, so EDITING a task can UNASSIGN it
      // rather than silently leaving the previous owner in place.
      assigned_to: assignedTo,
    };
    try {
      if (editing && task) await update.mutateAsync({ id: task.task_id, input });
      else await create.mutateAsync(input);
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

  const busy = create.isPending || update.isPending;
  const titleTooLong = title.length > TITLE_MAX;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "Edit task" : "New task"}
      description={
        editing
          ? undefined
          : "What has to happen, and by when. Leave the date off and it stays on your list without a deadline."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || titleTooLong}>
            {editing ? "Save changes" : "Add task"}
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

          <Field
            label="Remind me"
            htmlFor="task-reminder"
            hint={dueAt ? undefined : "Set a due date and the reminder moves with it."}
          >
            <NativeSelect
              id="task-reminder"
              value={reminder}
              onChange={(e) => setReminder(e.target.value)}
              disabled={!dueAt}
            >
              {REMINDER_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

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

/**
 * Which preset a stored reminder corresponds to, or "" when there is none.
 *
 * A value outside the offered list is still echoed back as the select's value,
 * which renders as a blank option rather than as "No reminder". Snapping it to
 * the nearest preset would be worse: the user would open a task that reminds
 * them 45 minutes ahead, see "1 hour before", save, and silently change it.
 */
function fromReminder(task: Task | null | undefined): string {
  const minutes = task?.reminder_minutes;
  if (minutes === null || minutes === undefined) return "";
  return String(minutes);
}
