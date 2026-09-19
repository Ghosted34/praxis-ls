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
import { LoadingRow } from "@/components/ui/states";
import { Callout } from "@/components/ui/callout";
import { EmployeePicker } from "@/components/employee-picker";
import { Textarea } from "@/components/ui/textarea";
import { Select, type SelectOption } from "@/components/ui/select";
import { ScreenError } from "@/components/connection/screen-error";
import { useConfirm } from "@/components/ui/use-confirm";
import { useToast } from "@/components/ui/toast";
import { errMsg } from "@/lib/use-resource";
import { dateTimeFmt, fmtRelative } from "@/lib/format";
import type { Audience, Dependency, Subtask, Task } from "../api";
import { BOARD_COLUMNS } from "../api";
import {
  useAddChildTask,
  useAddDependency,
  useAddSubtask,
  useAddWatcher,
  useDeleteSubtask,
  useDeleteTask,
  useMoveTask,
  useOverrideDependency,
  usePingTask,
  useRemoveDependency,
  useRemoveWatcher,
  useSetSubtaskDeadline,
  useTask,
  useTaskListPaged,
  useToggleSubtask,
} from "../hooks";
import { PRIORITY_LABEL, PRIORITY_TONE, STATUS_LABEL, STATUS_TONE } from "../labels";
import { TaskDialog } from "./task-dialog";

/**
 * The status picker's options — the board's four columns plus the one state
 * that is not a column. Each option wears the tone the module maps to it
 * (`STATUS_TONE`), so the closed trigger, the open list and the pills row
 * above all draw one state in one colour: a status that read "In progress"
 * blue in the row and amber in the picker would be two facts, not one.
 */
const STATUS_OPTIONS: SelectOption[] = [
  ...BOARD_COLUMNS.map((c) => ({
    value: c,
    text: STATUS_LABEL[c],
    label: <Pill tone={STATUS_TONE[c]}>{STATUS_LABEL[c]}</Pill>,
  })),
  {
    value: "CANCELLED",
    text: STATUS_LABEL.CANCELLED,
    label: <Pill tone={STATUS_TONE.CANCELLED}>{STATUS_LABEL.CANCELLED}</Pill>,
  },
];

export function TaskPanel({
  taskId,
  onClose,
  /** The reach the list or board was rendered at — see `useTask` (B-03). */
  audience,
  /** Open a child in the same pane. Optional: the sheet on a phone has no
   *  second pane to open it into, and a missing handler simply falls back to
   *  the canonical link. */
  onOpenChild,
}: {
  taskId: string;
  onClose: () => void;
  audience?: Audience;
  onOpenChild?: (taskId: string) => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const q = useTask(taskId, audience);
  const toggle = useToggleSubtask();
  const move = useMoveTask();
  const addStep = useAddSubtask();
  const del = useDeleteTask();
  const delStep = useDeleteSubtask();
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
            {/* The module's tone map, not an inline guess: this is the same
                pill the status picker below draws when closed, and the two
                must agree about what the current state looks like. */}
            <Pill tone={STATUS_TONE[task.status]}>{STATUS_LABEL[task.status]}</Pill>
            {task.is_personal && <Pill tone="mute">Personal</Pill>}
            {overdue && <Pill tone="bad">Overdue</Pill>}
            {task.is_blocked && <Pill tone="warn">Blocked</Pill>}
          </div>

          {/*
            BLOCKED IS SAID FIRST, BECAUSE IT CHANGES WHAT THE READER SHOULD DO.

            A task waiting on something else is not "in progress with a note";
            it is work that cannot finish yet, and burying that under the
            description means somebody starts it and discovers why in an hour.
          */}
          {task.is_blocked && (
            <Callout tone="warn">
              Waiting on {task.blocking_count}{" "}
              {task.blocking_count === 1 ? "task" : "tasks"} that{" "}
              {task.blocking_count === 1 ? "is" : "are"} not finished. It cannot be
              marked done until {task.blocking_count === 1 ? "it is" : "they are"}{" "}
              — or the dependency is overridden below.
            </Callout>
          )}

          {/* The parent, when this task is somebody's child. A child that could
              not name its parent is a fragment: "prepare the declaration" means
              nothing without the file it belongs to. */}
          {task.parent && (
            <p className="text-sm">
              <span className="micro">Part of </span>
              {task.parent.task_id ? (
                <button
                  type="button"
                  className="text-primary-ink underline"
                  onClick={() => navigate(task.parent?.link_url as string)}
                >
                  {task.parent.title}
                </button>
              ) : (
                // The parent exists and is not this reader's to see. Said
                // plainly rather than hidden, so the task does not look orphaned.
                <span className="text-muted-foreground">{task.parent.title}</span>
              )}
            </p>
          )}

          {/* THE record link. Derived, so it appears for tasks written before
              the route existed and disappears for a type nothing maps yet. */}
          {task.has_link && task.link_url && (
            <Button variant="outline" onClick={() => navigate(task.link_url as string)}>
              Open {task.entity_label ?? "the record"}
            </Button>
          )}

          {/* The operations file this work is on (13920), and the stage when it
              is narrower than the file. A separate block from the record link
              above, because they answer different questions — that one is what
              the task POINTS AT, this is the shipment the work is happening
              inside, and a task can carry both. The button goes to the file's
              own Tasks tab rather than its Details, so the reader lands where
              the rest of this file's work is. */}
          {task.dossier_id && (
            <div className="rounded-md border px-3 py-2">
              <p className="micro mb-1">Operations file</p>
              <p className="text-sm">
                <span className="num font-medium">{task.dossier_ref ?? "Linked file"}</span>
                {task.dossier_client_name && (
                  <span className="text-muted-foreground"> · {task.dossier_client_name}</span>
                )}
              </p>
              {task.milestone_label && (
                <p className="text-xs text-muted-foreground">{task.milestone_label}</p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => navigate(`/operations/files/${task.dossier_id}?tab=tasks`)}
              >
                Open the file
              </Button>
            </div>
          )}

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="micro">Status</dt>
            <dd>
              {/* A picker rather than a read-out: changing status is the most
                  common edit and should not need the form. */}
              {/*
                THE status path, and the same one the board drags through.

                This used to be a generic PATCH, so moving a task from here
                wrote `task.updated` while the identical move from the board
                wrote `task.status_changed` — one user action, two histories,
                and an audit trail that could not answer when a task moved
                (B-04). `useMoveTask` is the transition endpoint; the server
                also splits a status out of the edit dialog's PATCH and replays
                it here, so all five gestures now end in one place.

                THE PICKER IS THE DESIGN SYSTEM'S LISTBOX, not a native
                `<select>`. The native control is the one piece of this pane
                the browser drew: an OS-white option list, an OS chevron, and
                trigger text the tenant's fonts never touched — the exact
                white-label break the frontend rules exist to prevent, at the
                control a person touches most on this screen. Radix's listbox
                keeps everything the native one gave (arrow keys, type-ahead,
                Escape, a labelled combobox) and surrenders nothing a native
                option list was doing better here: the options are five known
                strings that never change, so there is no OS picker to miss.
              */}
              <Select
                className="h-8"
                value={task.status}
                aria-label="Status"
                options={STATUS_OPTIONS}
                onValueChange={(v) =>
                  void move
                    .mutateAsync({
                      id: task.task_id,
                      status: v as typeof task.status,
                      audience,
                    })
                    // A refused move (a blocked task being marked done) must
                    // leave the picker where it was, which it does: the value
                    // is the server's task, and nothing local was changed.
                    .catch((err) => toast.error(errMsg(err)))
                }
              />
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

{/* ── children ─────────────────────────────────────────────────── */}
          {!task.parent_task_id && (
            <ChildTasksSection task={task} audience={audience} onOpenChild={onOpenChild} />
          )}

          {/* ── dependencies ─────────────────────────────────────────────── */}
          <DependenciesSection task={task} audience={audience} />

          {/* ── watchers and pings ───────────────────────────────────────── */}
          <CollaborationSection task={task} audience={audience} />

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

/* ── children ─────────────────────────────────────────────────────────────── */

/**
 * A parent's separately-assigned child tasks, and the two ways to add one.
 *
 * ── WHY BOTH AN INLINE ROW AND THE FULL FORM ───────────────────────────────
 *
 * Splitting a file's work is a burst activity: a manager sits down and writes
 * six children in a minute. A dialog per child turns that into six open-fill-
 * save cycles and the sixth never gets written. So the common case — a title,
 * an owner, a date — is one row that stays focused after it saves.
 *
 * The full form still exists beside it, because a child that needs notes, a
 * priority, a reminder or its own checklist is a real case and the inline row
 * would have to grow into the dialog to serve it. Two entry points, ONE
 * endpoint underneath, so they cannot drift.
 *
 * ── WHAT A CHILD INHERITS ──────────────────────────────────────────────────
 *
 * The parent's operations-file link, by default — that is the whole point of
 * breaking a file's work up, and re-picking the same dossier six times is how
 * half the children end up unlinked. Not the assignee (a child exists to be
 * given to somebody else), not the status, and not the recurrence rule.
 */
function ChildTasksSection({
  task,
  audience,
  onOpenChild,
}: {
  task: Task;
  audience?: Audience;
  onOpenChild?: (taskId: string) => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const addChild = useAddChildTask();
  const [title, setTitle] = React.useState("");
  const [dueAt, setDueAt] = React.useState("");
  const [assignedTo, setAssignedTo] = React.useState<string | null>(null);
  const [assignedName, setAssignedName] = React.useState<string | null>(null);
  const [fullFormOpen, setFullFormOpen] = React.useState(false);

  const rollup = task.rollup;
  const children = task.children ?? [];

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      await addChild.mutateAsync({
        parentId: task.task_id,
        input: { title: trimmed, due_at: dueAt || null, assigned_to: assignedTo },
        audience,
      });
      // Only the fields a NEXT child would differ on are cleared. The owner
      // usually stays the same across a burst, and clearing them would make
      // the fast path slower than the dialog it exists to avoid.
      setTitle("");
      setDueAt("");
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  return (
    <section aria-label="Child tasks">
      <h3 className="mb-2 text-sm font-medium">
        Child tasks
        {rollup && rollup.child_count > 0 && (
          <span className="num ml-1.5 micro">
            {rollup.child_done_count}/{rollup.child_count}
            {rollup.child_cancelled_count > 0 && `, ${rollup.child_cancelled_count} cancelled`}
          </span>
        )}
      </h3>

      {children.length > 0 ? (
        <ul className="space-y-1.5">
          {children.map((c) => (
            <li key={c.task_id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-primary-ink underline"
                onClick={() =>
                  onOpenChild ? onOpenChild(c.task_id) : navigate(`/workspace/tasks?task=${c.task_id}`)
                }
              >
                {c.title}
              </button>
              <Pill tone={c.status === "DONE" ? "ok" : c.status === "CANCELLED" ? "bad" : "blue"}>
                {STATUS_LABEL[c.status]}
              </Pill>
              <span className="micro shrink-0">{c.assigned_to_name ?? "Nobody yet"}</span>
              {c.due_at && <span className="num shrink-0 text-xs text-muted-foreground">{dateTimeFmt(c.due_at)}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="micro">No child tasks yet.</p>
      )}

      {/* The denominator counts children this reader cannot open too — a
          roll-up that quietly dropped them would read "2 of 2" on a parent
          with three children, which is a lie with a number on it. */}
      {(task.hidden_child_count ?? 0) > 0 && (
        <p className="micro mt-1">
          {task.hidden_child_count} more child{" "}
          {task.hidden_child_count === 1 ? "task is" : "tasks are"} not yours to view. They are
          still counted above.
        </p>
      )}

      <div className="mt-2 space-y-2">
        <div className="flex gap-2">
          <Input
            value={title}
            placeholder="Add a child task"
            aria-label="New child task"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
              if (e.key === "Escape") setTitle("");
            }}
          />
          <Button size="sm" variant="outline" onClick={() => void submit()} disabled={!title.trim()}>
            Add
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="micro shrink-0">Due (optional)</span>
          <DateField value={dueAt} onChange={setDueAt} aria-label="New child task deadline" className="max-w-[10rem]" />
          {assignedTo ? (
            <span className="flex items-center gap-1.5 text-sm">
              <span className="min-w-0 truncate">{assignedName ?? "Selected employee"}</span>
              <button
                type="button"
                className="micro text-muted-foreground hover:text-destructive"
                onClick={() => {
                  setAssignedTo(null);
                  setAssignedName(null);
                }}
              >
                Clear
              </button>
            </span>
          ) : (
            <div className="min-w-[12rem] flex-1">
              <EmployeePicker
                id="child-task-assignee"
                label="Assign to"
                placeholder="Search staff…"
                requireAccount
                onPick={(e) => {
                  setAssignedTo(e.account_user_id ?? null);
                  setAssignedName(e.full_name ?? null);
                }}
              />
            </div>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setFullFormOpen(true)}>
          Add one with notes, priority or steps…
        </Button>
      </div>

      {/* The full form, seeded with the parent so the dialog's own POST carries
          the relationship. One endpoint, two entry points. */}
      <TaskDialog
        open={fullFormOpen}
        onClose={() => setFullFormOpen(false)}
        parent={task}
      />
    </section>
  );
}

/* ── dependencies ─────────────────────────────────────────────────────────── */

/**
 * What this task is waiting for.
 *
 * ── AN UNAUTHORISED PREREQUISITE IS SHOWN, NOT HIDDEN ──────────────────────
 *
 * The server sends the edge with its identity replaced: "A task you cannot
 * view", no id, no owner, no link — but it DOES say whether that task is
 * finished, because whether you are blocked is the thing you need and it
 * discloses nothing about what is blocking you. Hiding the row entirely would
 * leave a reader looking at a task marked Blocked with an empty list under it,
 * which reads as a bug and provokes a support ticket.
 *
 * ── CANCELLED STILL BLOCKS ─────────────────────────────────────────────────
 *
 * A prerequisite that was called off did not happen, so it keeps blocking
 * until somebody says "proceed anyway" — a recorded, attributed, reversible
 * act rather than an inference. The row says so and offers the override.
 */
function DependenciesSection({ task, audience }: { task: Task; audience?: Audience }) {
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const add = useAddDependency();
  const remove = useRemoveDependency();
  const override = useOverrideDependency();
  const [picking, setPicking] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const searchRef = React.useRef<HTMLInputElement>(null);

  // Focus moved deliberately rather than with `autoFocus`: the prop fires on
  // mount whatever else is happening, which steals focus from a screen-reader
  // user mid-sentence. Here the field appears BECAUSE the reader asked for it,
  // so following their action with the caret is what they expect.
  React.useEffect(() => {
    if (picking) searchRef.current?.focus();
  }, [picking]);
  const [q, setQ] = React.useState("");

  React.useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Searched through the SAME authorised list endpoint the Tasks list uses, so
  // the picker can only offer prerequisites the caller may already open — the
  // client half of the intersection rule the server enforces anyway.
  const candidates = useTaskListPaged({ q: q || undefined, audience, limit: 10, offset: 0 });
  const deps = task.dependencies ?? [];

  async function addDep(dependsOnTaskId: string) {
    try {
      await add.mutateAsync({ taskId: task.task_id, dependsOnTaskId, audience });
      setPicking(false);
      setSearch("");
    } catch (err) {
      // Cycles, duplicates and self-reference all arrive here as a sentence
      // from the server rather than as a constraint name.
      toast.error(errMsg(err));
    }
  }

  async function toggleOverride(dep: Dependency) {
    if (dep.is_overridden) {
      try {
        await override.mutateAsync({
          taskId: task.task_id,
          dependencyId: dep.task_dependency_id,
          overridden: false,
          audience,
        });
      } catch (err) {
        toast.error(errMsg(err));
      }
      return;
    }
    const ok = await confirm({
      title: "Let this task proceed anyway?",
      body: `“${dep.depends_on_title}” has not finished. Overriding records that you decided this work may go ahead regardless, and your name is kept against that decision.`,
      confirmLabel: "Override it",
      cancelLabel: "Keep waiting",
    });
    if (!ok) return;
    try {
      await override.mutateAsync({
        taskId: task.task_id,
        dependencyId: dep.task_dependency_id,
        overridden: true,
        audience,
      });
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  return (
    <section aria-label="Waiting on">
      {confirmDialog}
      <h3 className="mb-2 text-sm font-medium">
        Waiting on
        {task.blocking_count ? <span className="num ml-1.5 micro">{task.blocking_count} unresolved</span> : null}
      </h3>

      {deps.length > 0 ? (
        <ul className="space-y-1.5">
          {deps.map((d) => (
            <DependencyRow
              key={d.task_dependency_id}
              dependency={d}
              onOverride={() => void toggleOverride(d)}
              onRemove={() =>
                void remove
                  .mutateAsync({ taskId: task.task_id, dependencyId: d.task_dependency_id, audience })
                  .catch((err) => toast.error(errMsg(err)))
              }
            />
          ))}
        </ul>
      ) : (
        <p className="micro">Nothing is holding this task up.</p>
      )}

      {picking ? (
        <div className="mt-2 space-y-2">
          <Input
            ref={searchRef}
            value={search}
            placeholder="Search a task this one must wait for…"
            aria-label="Search a task to wait for"
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setPicking(false);
                setSearch("");
              }
            }}
          />
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {(candidates.data?.data ?? [])
              // A task cannot wait for itself, and offering the option only to
              // refuse it is a control that exists to fail.
              .filter((c) => c.task_id !== task.task_id)
              .filter((c) => !deps.some((d) => d.depends_on_task_id === c.task_id))
              .map((c) => (
                <li key={c.task_id}>
                  <button
                    type="button"
                    className="w-full truncate rounded-md border px-2 py-1 text-left text-sm hover:border-primary"
                    onClick={() => void addDep(c.task_id)}
                  >
                    {c.title}
                    <span className="micro ml-1.5">{STATUS_LABEL[c.status]}</span>
                  </button>
                </li>
              ))}
            {q && (candidates.data?.data ?? []).length === 0 && (
              <li className="micro">No task matches that.</li>
            )}
          </ul>
          <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="mt-2" onClick={() => setPicking(true)}>
          Add a dependency
        </Button>
      )}
    </section>
  );
}

function DependencyRow({
  dependency,
  onOverride,
  onRemove,
}: {
  dependency: Dependency;
  onOverride: () => void;
  onRemove: () => void;
}) {
  const navigate = useNavigate();
  const blocking = !dependency.is_resolved && !dependency.is_overridden;
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {dependency.is_visible && dependency.link_url ? (
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-primary-ink underline"
          onClick={() => navigate(dependency.link_url as string)}
        >
          {dependency.depends_on_title}
        </button>
      ) : (
        // No link, no id, no owner — and said as a sentence rather than left
        // as a blank row that reads as a loading failure.
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {dependency.depends_on_title}
        </span>
      )}

      {dependency.is_resolved ? (
        <Pill tone="ok">Done</Pill>
      ) : dependency.is_overridden ? (
        <Pill tone="mute">Overridden</Pill>
      ) : dependency.is_cancelled ? (
        // The one case worth its own words: cancelled is not finished, and a
        // reader who sees "Cancelled" beside a blocked task needs to know that
        // is why they are still waiting.
        <Pill tone="bad">Cancelled — still blocking</Pill>
      ) : (
        <Pill tone="warn">{dependency.depends_on_status ? STATUS_LABEL[dependency.depends_on_status] : "Not finished"}</Pill>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {(blocking || dependency.is_overridden) && (
          <button type="button" className="micro text-muted-foreground hover:text-primary-ink" onClick={onOverride}>
            {dependency.is_overridden ? "Withdraw override" : "Override"}
          </button>
        )}
        <button type="button" className="micro text-muted-foreground hover:text-destructive" onClick={onRemove}>
          Remove
        </button>
      </div>

      {dependency.is_overridden && (
        <p className="micro w-full">
          Overridden{dependency.overridden_by_name ? ` by ${dependency.overridden_by_name}` : ""}
          {dependency.override_reason ? ` — ${dependency.override_reason}` : ""}.
        </p>
      )}
    </li>
  );
}

/* ── watchers and pings ───────────────────────────────────────────────────── */

/**
 * Who else hears about this task, and how to nudge them.
 *
 * ── A PING IS NOT A MESSAGE CHANNEL ────────────────────────────────────────
 *
 * It can only reach people already connected to the task — its assignee, its
 * creator, or a watcher. Widening it to "any user" would bolt an unaudited
 * messaging surface onto a to-do list and route around Smart Comms entirely.
 * Bringing somebody new into the conversation is therefore an explicit act
 * (add them as a watcher), which is visible on the task rather than invisible
 * in a delivery log. The server enforces this; the UI simply does not offer
 * the alternative.
 */
function CollaborationSection({ task, audience }: { task: Task; audience?: Audience }) {
  const toast = useToast();
  const addWatcher = useAddWatcher();
  const removeWatcher = useRemoveWatcher();
  const ping = usePingTask();
  const [message, setMessage] = React.useState("");
  const [composing, setComposing] = React.useState(false);

  const watchers = task.watchers ?? [];

  async function send() {
    try {
      const result = await ping.mutateAsync({
        taskId: task.task_id,
        message: message.trim() || null,
        audience,
      });
      toast.success(
        result.pinged === 1 ? "Pinged 1 person" : `Pinged ${result.pinged} people`,
      );
      setMessage("");
      setComposing(false);
    } catch (err) {
      toast.error(errMsg(err));
    }
  }

  return (
    <section aria-label="Watching">
      <h3 className="mb-2 text-sm font-medium">Watching</h3>
      {watchers.length > 0 ? (
        <ul className="space-y-1">
          {watchers.map((w) => (
            <li key={w.user_id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{w.full_name || w.email}</span>
              <button
                type="button"
                className="micro shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() =>
                  void removeWatcher
                    .mutateAsync({ taskId: task.task_id, userId: w.user_id })
                    .catch((err) => toast.error(errMsg(err)))
                }
              >
                Stop watching
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="micro">Nobody else is following this task.</p>
      )}

      <div className="mt-2">
        <EmployeePicker
          id="task-watcher"
          label="Add a watcher"
          placeholder="Search staff…"
          requireAccount
          exclude={new Set(watchers.map((w) => w.user_id))}
          onPick={(e) => {
            if (!e.account_user_id) return;
            void addWatcher
              .mutateAsync({ taskId: task.task_id, userId: e.account_user_id })
              .catch((err) => toast.error(errMsg(err)));
          }}
        />
      </div>

      {composing ? (
        <div className="mt-2 space-y-2">
          <Textarea
            value={message}
            rows={2}
            maxLength={500}
            aria-label="What to say"
            placeholder="Any news on this? (optional)"
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void send()} disabled={ping.isPending}>
              Send the ping
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setComposing(false)}>
              Cancel
            </Button>
          </div>
          <p className="micro">
            Goes to this task&apos;s assignee, its author and everybody watching it —
            never to you, and never to anybody who is not already on the task.
          </p>
        </div>
      ) : (
        <Button size="sm" variant="outline" className="mt-2" onClick={() => setComposing(true)}>
          Ping everyone on this task
        </Button>
      )}
    </section>
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

/*
 * There is no `TaskPanelEmpty`. There used to be — an `<EmptyState>` for the
 * reserved half of the split — and the reserved half is gone: the detail column
 * exists only while a task is open, so the board has the width rather than a
 * panel explaining that it has nothing to say (tasks-page.tsx).
 */
