/**
 * One task, in full — the detail panel beside the board or under a phone sheet.
 *
 * ── THE LINK IS THE POINT ──────────────────────────────────────────────────
 *
 * When a task is ABOUT something (`entity_type` + `entity_id`), the panel shows
 * a button that opens that record. The path is derived server-side on every
 * read by the shared entity-route map, so a task written before a route existed
 * gains its link the day the route lands, and the bell and this panel cannot
 * disagree about where the record is.
 *
 * A task with no entity is not an error and does not render a dead button: it
 * is a note, and the honest UI simply has nothing to open.
 *
 * ── SUBTASKS ARE CHECKABLE IN PLACE ────────────────────────────────────────
 *
 * Ticking a step is the most frequent thing anybody does to a task, so it is
 * one click here rather than an edit form. The count in the header (`3/5`) is
 * the progress read; the checkboxes are the write.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { Panel } from "@/components/ui/panel";
import { Pill } from "@/components/ui/pill";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { EmptyState, LoadingRow } from "@/components/ui/states";
import { ScreenError } from "@/components/connection/screen-error";
import { useConfirm } from "@/components/ui/use-confirm";
import { useToast } from "@/components/ui/toast";
import { errMsg } from "@/lib/use-resource";
import { dateTimeFmt, fmtRelative } from "@/lib/format";
import type { Subtask } from "../api";
import { BOARD_COLUMNS } from "../api";
import {
  useDeleteSubtask,
  useDeleteTask,
  useTask,
  useToggleSubtask,
  useUpdateTask,
  useAddSubtask,
  useSetSubtaskDeadline,
} from "../hooks";
import { PRIORITY_LABEL, PRIORITY_TONE, STATUS_LABEL } from "../labels";
import { TaskDialog } from "./task-dialog";

export function TaskPanel({
  taskId,
  onClose,
}: {
  taskId: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const q = useTask(taskId);
  const toggle = useToggleSubtask();
  const addStep = useAddSubtask();
  const del = useDeleteTask();
  const delStep = useDeleteSubtask();
  const update = useUpdateTask();
  const setStepDeadline = useSetSubtaskDeadline();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [draftDue, setDraftDue] = React.useState("");

  const task = q.data;

  async function removeTask() {
    if (!task) return;
    const ok = await confirm({
      title: "Delete this task for ever?",
      body: `“${task.title}” will be removed from your workspace. Its steps go with it.`,
      confirmLabel: "Delete task",
      cancelLabel: "Keep it",
      destructive: true,
    });
    if (!ok) return;
    try {
      await del.mutateAsync(task.task_id);
      toast.success("Task deleted");
      onClose();
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  async function submitStep() {
    const title = draft.trim();
    if (!title || !task) return;
    try {
      await addStep.mutateAsync({ taskId: task.task_id, title, dueAt: draftDue || null });
      setDraft("");
      setDraftDue("");
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  if (q.isLoading) {
    return (
      <Panel title="Task">
        <LoadingRow label="Loading task…" />
      </Panel>
    );
  }

  if (q.error || !task) {
    // `message` is required and a hook's `error` is null while loading, so the
    // fallback is the thing that is actually true: the task could not be read.
    return <ScreenError message={q.error?.message ?? "This task could not be loaded."} what="This task" onRetry={() => void q.refetch()} />;
  }

  const overdue =
    task.due_at && task.status !== "DONE" && task.status !== "CANCELLED" && new Date(task.due_at) < new Date();

  return (
    <>
      {confirmDialog}
      <Panel
        title={task.title}
        subtitle={`Added ${fmtRelative(task.created_at)}${task.created_by_name ? ` by ${task.created_by_name}` : ""}`}
        action={
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close task">
              Close
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone={PRIORITY_TONE[task.priority]}>{PRIORITY_LABEL[task.priority]}</Pill>
            <Pill tone={task.status === "DONE" ? "ok" : "blue"}>{STATUS_LABEL[task.status]}</Pill>
            {task.is_personal && <Pill tone="mute">Personal</Pill>}
            {overdue && <Pill tone="bad">Overdue</Pill>}
          </div>

          {/* THE record link. Derived, so it appears for tasks written before
              the route existed and disappears for a type nothing maps yet. */}
          {task.has_link && task.link_url && (
            <Button variant="outline" onClick={() => navigate(task.link_url as string)}>
              Open {task.entity_label ?? "the record"}
            </Button>
          )}

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="micro">Status</dt>
            <dd>
              {/* A picker rather than a read-out: changing status is the most
                  common edit and should not need the form. */}
              <select
                className="input h-8 py-0 text-sm"
                value={task.status}
                aria-label="Status"
                onChange={(e) =>
                  void update
                    .mutateAsync({ id: task.task_id, input: { status: e.target.value as typeof task.status } })
                    .catch((err) => toast.error(errMsg(err)))
                }
              >
                {BOARD_COLUMNS.map((c) => (
                  <option key={c} value={c}>
                    {STATUS_LABEL[c]}
                  </option>
                ))}
                <option value="CANCELLED">Cancelled</option>
              </select>
            </dd>

            <dt className="micro">Due</dt>
            <dd className={overdue ? "text-destructive" : undefined}>
              {task.due_at ? dateTimeFmt(task.due_at) : "No deadline"}
            </dd>

            <dt className="micro">Assigned</dt>
            <dd>{task.assigned_to_name ?? "Nobody yet"}</dd>

            {task.remind_at && (
              <>
                <dt className="micro">Reminder</dt>
                <dd>{dateTimeFmt(task.remind_at)}</dd>
              </>
            )}
          </dl>

          {task.description && (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{task.description}</p>
          )}

          <section aria-label="Steps">
            <h3 className="mb-2 text-sm font-medium">
              Steps
              {task.subtask_count > 0 && (
                <span className="num ml-1.5 micro">
                  {task.subtask_done_count}/{task.subtask_count}
                </span>
              )}
            </h3>

            {task.subtasks && task.subtasks.length > 0 ? (
              <ul className="space-y-1.5">
                {task.subtasks.map((s) => (
                  <SubtaskRow
                    key={s.task_subtask_id}
                    subtask={s}
                    onToggle={(checked) =>
                      void toggle
                        .mutateAsync({ taskId: task.task_id, subtaskId: s.task_subtask_id, isDone: checked })
                        .catch((err) => toast.error(errMsg(err)))
                    }
                    onSetDeadline={(iso) =>
                      void setStepDeadline
                        .mutateAsync({ taskId: task.task_id, subtaskId: s.task_subtask_id, dueAt: iso })
                        .catch((err) => toast.error(errMsg(err)))
                    }
                    onRemove={() =>
                      void delStep
                        .mutateAsync({ taskId: task.task_id, subtaskId: s.task_subtask_id })
                        .catch((err) => toast.error(errMsg(err)))
                    }
                  />
                ))}
              </ul>
            ) : (
              <p className="micro">No steps yet.</p>
            )}

            {/* A step can be added with its own deadline — the "milestones with
                their own dates" the calendar then shows alongside the task. */}
            <div className="mt-2 space-y-2">
              <div className="flex gap-2">
                <Input
                  value={draft}
                  placeholder="Add a step"
                  aria-label="New step"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void submitStep();
                    }
                    if (e.key === "Escape") {
                      setDraft("");
                      setDraftDue("");
                    }
                  }}
                />
                <Button size="sm" variant="outline" onClick={() => void submitStep()} disabled={!draft.trim()}>
                  Add
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <span className="micro shrink-0">Due (optional)</span>
                <DateField
                  value={draftDue}
                  onChange={setDraftDue}
                  aria-label="New step deadline"
                  className="max-w-[10rem]"
                />
              </div>
            </div>
          </section>

          {task.watchers && task.watchers.length > 0 && (
            <section aria-label="Watching">
              <h3 className="mb-1 text-sm font-medium">Watching</h3>
              <p className="text-sm text-muted-foreground">
                {task.watchers.map((w) => w.full_name || w.email).join(", ")}
              </p>
            </section>
          )}

          <div className="border-t pt-3">
            <Button size="sm" variant="destructive" onClick={() => void removeTask()}>
              Delete task
            </Button>
          </div>
        </div>
      </Panel>

      <TaskDialog open={editing} onClose={() => setEditing(false)} task={task} />
    </>
  );
}

/**
 * One step row: tick it done, see and change its own deadline, remove it.
 *
 * The deadline commits on BLUR rather than on every keystroke: `DateField`
 * emits "" while a date is half-typed, and firing a save on that would clear
 * the step's date the moment the operator started editing it. A local draft
 * held here, re-synced when the stored value changes from a save, keeps the
 * field responsive while only writing a finished value.
 */
function SubtaskRow({
  subtask,
  onToggle,
  onSetDeadline,
  onRemove,
}: {
  subtask: Subtask;
  onToggle: (checked: boolean) => void;
  onSetDeadline: (iso: string | null) => void;
  onRemove: () => void;
}) {
  const stored = dayInput(subtask.due_at);
  const [due, setDue] = React.useState(stored);
  React.useEffect(() => setDue(dayInput(subtask.due_at)), [subtask.due_at]);

  const overdue =
    !subtask.is_done && Boolean(subtask.due_at) && new Date(subtask.due_at as string) < new Date();

  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Checkbox checked={subtask.is_done} label={subtask.title} onCheckedChange={onToggle} />
      <div className="ml-auto flex items-center gap-1.5">
        <DateField
          value={due}
          onChange={setDue}
          onBlur={() => {
            if (due !== stored) onSetDeadline(due || null);
          }}
          aria-label={`Deadline for “${subtask.title}”`}
          className="max-w-[8.5rem]"
        />
        {overdue && <span className="shrink-0 text-xs text-destructive">Overdue</span>}
        <button
          type="button"
          className="micro shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
        >
          Remove
        </button>
      </div>
    </li>
  );
}

/** An ISO instant back to the field's `YYYY-MM-DD` in the browser's zone — the
 *  same read-side convention `task-dialog` uses for the parent's due date. */
function dayInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The empty half of a master-detail split, so the panel's absence is
 *  explained rather than leaving a hole in the layout. */
export function TaskPanelEmpty() {
  return (
    <EmptyState
      title="No task selected"
      hint="Pick a task to see its steps, who it belongs to, and the record it came from."
    />
  );
}
