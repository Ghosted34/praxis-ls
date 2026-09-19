/**
 * My Workspace — the typed API surface for tasks and calendar events.
 *
 * Typed helpers live here rather than inline `tenant()` calls in components
 * (FRONTEND_GUIDE §3.4), so that a route that moves is fixed in one file and
 * the compiler finds every caller.
 *
 * ── `tenant()` ALREADY UNWRAPS THE `{ data }` ENVELOPE ──────────────────────
 *
 * Every endpoint here answers `{ data: ... }`, but `tenant()` (→ `api()` in
 * lib/api-client.ts) returns the UNWRAPPED payload — the same contract every
 * other feature relies on (e.g. `tenant<Payslip[]>("/payroll/mine")`). So a
 * read is `tenant<DayTimeline>(...)`, NOT `tenant<{ data: DayTimeline }>(...)`
 * followed by `.then((r) => r.data)`. Unwrapping a second time returns
 * `undefined`, which is what React Query reports as "… data is undefined" and
 * is why Today and the Calendar failed to load. The one endpoint that carries
 * fields BESIDE the payload is the board (see `getBoard`).
 *
 * ── TWO THINGS ABOUT THE CONTRACT THAT ARE EASY TO GET WRONG ───────────────
 *
 * 1. The board and the day are NOT paged. `board()` returns an object keyed by
 *    status and `day()` returns `{ items, audience, audiences, timezone, counts,
 *    truncated }`, so they go through `tenant()` and not `tenantPaged()`. Only
 *    `listTasks()` is a real list, and it is capped at 50 rows server-side like every other list here —
 *    which is why the board exists: a kanban over a truncated page would show
 *    four columns of the wrong rows.
 *
 * 2. Dates go UP as the user typed them and come DOWN as instants. The server
 *    reads a zoneless `YYYY-MM-DDTHH:mm` on the tenant's workplace clock (see
 *    src/modules/dashboard/workspace/workspace.time.js), so this file must not
 *    "help" by converting to UTC in the browser — the browser's zone is the
 *    user's laptop, which is not necessarily where the business is.
 */
import { tenant, tenantPaged } from "@/lib/api-client";

/* ── vocabulary ───────────────────────────────────────────────────────────── */

export const TASK_STATUSES = [
  "TO_DO",
  "IN_PROGRESS",
  "IN_REVIEW",
  "DONE",
  "CANCELLED",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** The columns a board draws. CANCELLED is not a column — it is a decision
 *  about a task, and a column for it would be a place work goes to be hidden. */
export const BOARD_COLUMNS = ["TO_DO", "IN_PROGRESS", "IN_REVIEW", "DONE"] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

/** Whether an edit to a recurring row applies to one occurrence or the series. */
export type RepeatScope = "this" | "series";

export const PARTICIPANT_RESPONSES = [
  "INVITED",
  "ACCEPTED",
  "DECLINED",
  "TENTATIVE",
] as const;
export type ParticipantResponse = (typeof PARTICIPANT_RESPONSES)[number];

/**
 * Who the caller is asking to see.
 *
 * The SERVER decides which of these a caller may actually use, from their RBAC
 * grants and organigramme closure, and answers with the list it will honour.
 * The switch renders that list and nothing else — offering "Everyone" to
 * somebody the server would quietly narrow is a lie with a control on it.
 */
export const AUDIENCES = ["mine", "team", "all"] as const;
export type Audience = (typeof AUDIENCES)[number];

/* ── shapes ───────────────────────────────────────────────────────────────── */

export type Subtask = {
  task_subtask_id: string;
  task_id: string;
  title: string;
  is_done: boolean;
  display_order: number;
  /** A step's own deadline, independent of the parent task's. */
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export type Watcher = { user_id: string; full_name: string | null; email: string };

/** One stage of the linked file's chain, as a task read carries it (13950). */
export type TaskMilestone = {
  milestone_instance_id: string;
  label: string | null;
  stage_seq: number | string | null;
  status: string | null;
};

export type Task = {
  task_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigned_to: string | null;
  assigned_to_name: string | null;
  created_by: string;
  created_by_name: string | null;
  due_at: string | null;
  completed_at: string | null;
  is_personal: boolean;
  scope_id: string | null;
  reminder_minutes: number | null;
  remind_at: string | null;
  /** iCal RRULE when the task repeats; null/absent is a one-off (13840). */
  recurrence_rule?: string | null;
  recurrence_series_id?: string | null;
  entity_type: string | null;
  entity_id: string | null;
  /** The operations file this work is IN, and the stage of its chain (13920).
   *  Separate from the entity pair above, which is what the task POINTS AT —
   *  a task raised from a costing can carry both. The `*_ref`/`*_label` fields
   *  are joined on read so a row can name its file without a second request. */
  dossier_id: string | null;
  dossier_ref: string | null;
  dossier_client_name: string | null;
  /** The FIRST stage of the set below (13920's column, kept as a projection). */
  milestone_instance_id: string | null;
  milestone_label: string | null;
  /** Every stage of the file's chain the task is on, in chain order (13950).
   *  Absent only on rows older than the field; treat as empty. */
  milestone_instance_ids?: string[];
  milestones?: TaskMilestone[];
  /** Derived on read, never stored — see the service's header for why. */
  link_url: string | null;
  entity_label: string | null;
  has_link: boolean;
  subtask_count: number;
  subtask_done_count: number;
  created_at: string;
  updated_at: string;
  /** 13810's one level of nesting: a separately-assigned operational child. */
  parent_task_id?: string | null;
  subtasks?: Subtask[];
  watchers?: Watcher[];
  /** The up-to-three reminders of 13890, present on the detail read. The
   *  legacy pair above is a projection of the first row, kept for the board's
   *  badge; the form edits THIS list. */
  reminders?: Reminder[];

  /* ── PR 2: hierarchy, dependencies and roll-up ─────────────────────────── */

  /** Unresolved prerequisites, counted over ALL edges — including ones this
   *  caller may not see. Work blocked by something hidden is still blocked. */
  blocking_count?: number;
  is_blocked?: boolean;
  blocked_since?: string | null;
  /** The task's live external hold (13975), when it has one. */
  blockage?: TaskBlockage | null;
  /** Live hold first, then resolved ones, newest first — the panel's history. */
  blockages?: TaskBlockage[];
  dependencies?: Dependency[];
  /** Children the caller may open. `rollup` counts every child, visible or not. */
  children?: Task[];
  hidden_child_count?: number;
  child_count?: number;
  child_done_count?: number;
  rollup?: TaskRollup;
  parent?: TaskParentRef | null;
};

/**
 * One blocked-by edge, as the server chose to describe it to THIS caller.
 *
 * When `is_visible` is false the prerequisite's identity is replaced rather
 * than omitted — `depends_on_task_id` is null and the title is a sentence —
 * because a missing key reads as a client bug while an explicit flag reads as
 * a decision. `is_resolved` is still answered either way: whether the thing
 * you are waiting for has finished is what "am I blocked" MEANS, and it
 * discloses nothing about what that thing is.
 */
export type Dependency = {
  task_dependency_id: string;
  task_id: string;
  is_visible: boolean;
  is_resolved: boolean;
  is_cancelled: boolean;
  is_overridden: boolean;
  overridden_at: string | null;
  override_reason: string | null;
  overridden_by_name: string | null;
  created_at: string;
  depends_on_task_id: string | null;
  depends_on_title: string;
  depends_on_status: TaskStatus | null;
  depends_on_due_at: string | null;
  depends_on_assigned_to_name: string | null;
  link_url: string | null;
};

/**
 * Progress across a parent's children and checklist steps.
 *
 * Two denominators rather than one percentage: a child task and a checklist
 * step are different units of work, and averaging them invents a weighting
 * nobody chose. `progress_ratio` is null when there is nothing to do yet —
 * "0%" would read as "nothing done".
 */
export type TaskRollup = {
  child_count: number;
  child_done_count: number;
  child_cancelled_count: number;
  child_open_count: number;
  step_count: number;
  step_done_count: number;
  progress_done: number;
  progress_total: number;
  progress_ratio: number | null;
};

/** The parent of a child task. `task_id` is null when it is not the caller's to see. */
export type TaskParentRef = {
  task_id: string | null;
  title: string;
  status: TaskStatus | null;
  link_url: string | null;
};

export type TaskBoard = Record<BoardColumn, Task[]>;

/**
 * How much of the board this is.
 *
 * The board endpoint has always been capped; what it did not do was say so,
 * and 200 cards look exactly like all of them. `truncated` is what lets the
 * page point at the List view instead of leaving the gap invisible.
 */
export type BoardCompleteness = {
  total: number;
  shown: number;
  limit: number;
  truncated: boolean;
};

export type Participant = {
  calendar_participant_id: string;
  calendar_event_id: string;
  user_id: string | null;
  user_name: string | null;
  email: string | null;
  external_name: string | null;
  response_status: ParticipantResponse;
  responded_at: string | null;
  is_organiser: boolean;
};

/**
 * One reminder of the up-to-three a record can carry (13890).
 *
 * `reminder_minutes` set = relative to the record's own date and RE-MOVES
 * with it (and, on a series, re-materialises per occurrence when scope is
 * "series"); `remind_at` set = one fixed instant. `reminder_sent_at` is the
 * sweep's stamp: null means ARMED, so a row with a stamp has fired — the
 * dialog renders that rather than offering it as a choice it can still make.
 */
export type Reminder = {
  workspace_reminder_id: string;
  owner_type: "task" | "calendar_event";
  owner_id: string;
  reminder_minutes: number | null;
  remind_at: string | null;
  reminder_sent_at: string | null;
  ordinal: number;
  email: boolean;
  scope: RepeatScope;
  label: string | null;
};

/** One row as the write forms send it. Relative XOR absolute is the API's
 *  refine, not the form's own grammar, so the type only admits the two fields. */
export type ReminderInput = {
  reminder_minutes?: number | null;
  remind_at?: string | null;
  email?: boolean;
  scope?: RepeatScope;
  label?: string | null;
};

export type CalendarEvent = {
  calendar_event_id: string;
  title: string;
  event_type: string;
  location: string | null;
  description: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  recurrence_rule: string | null;
  recurrence_series_id?: string | null;
  reminder_minutes: number | null;
  remind_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
  entity_type: string | null;
  entity_id: string | null;
  scope_id: string | null;
  link_url: string | null;
  entity_label: string | null;
  has_link: boolean;
  participant_count: number;
  created_at: string;
  updated_at: string;
  participants?: Participant[];
  /** The event's up-to-three reminders, on the detail read. */
  reminders?: Reminder[];
};

/** One row of the merged Today list. A discriminated union on `kind`, because
 *  the two halves share a time and almost nothing else. */
export type TimelineItem =
  | {
      kind: "task";
      at: string | null;
      id: string;
      title: string;
      status: TaskStatus;
      priority: TaskPriority;
      link_url: string | null;
      entity_type: string | null;
      entity_id: string | null;
      assigned_to_name: string | null;
      subtask_count: number;
      subtask_done_count: number;
      is_overdue: boolean;
    }
  | {
      kind: "event";
      at: string | null;
      id: string;
      title: string;
      event_type: string;
      location: string | null;
      all_day: boolean;
      end_at: string | null;
      link_url: string | null;
      entity_type: string | null;
      entity_id: string | null;
      participant_count: number;
    }
  | {
      kind: "subtask";
      at: string | null;
      id: string;
      task_id: string;
      title: string;
      task_title: string | null;
      status: TaskStatus;
      priority: TaskPriority;
      link_url: string | null;
      entity_type: string | null;
      entity_id: string | null;
      is_overdue: boolean;
    };

export type DayTimeline = {
  items: TimelineItem[];
  audience: Audience;
  audiences: Audience[];
  timezone: string;
  tasks: number;
  events: number;
  deadlines: number;
  counts: { tasks: number; events: number; deadlines: number };
  truncated: { tasks: boolean; events: boolean; deadlines: boolean };
};

export type WorkspaceContext = { timeZone: string };

export type WorkspaceApproval = {
  approval_task_id?: string;
  id?: string;
  entity_ref?: string | null;
  amount_xaf?: number | string | null;
  created_at?: string | null;
};

export type WorkspaceAlert = {
  notification_id?: string;
  id?: string;
  title?: string | null;
  priority?: string | null;
  event_type_key?: string | null;
  created_at?: string | null;
};

export type TaskInput = {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigned_to?: string | null;
  due_at?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  /** The operations file this work is IN, and the stage of its chain (13920).
   *  Clearing the file clears the stage server-side — a stage is a narrowing
   *  of a file, never an alternative to one. */
  dossier_id?: string | null;
  milestone_instance_id?: string | null;
  /** The stages the work belongs to — one or several, all of the linked file
   *  (13950). Replaces the whole set; [] clears it. Wins over the single id. */
  milestone_instance_ids?: string[];
  is_personal?: boolean;
  reminder_minutes?: number | null;
  remind_at?: string | null;
  /** PR 3's several reminders — supersedes the pair when present (the pair is
   *  13810's one-reminder vocabulary, kept for the older client). Up to 3. */
  reminders?: ReminderInput[];
  recurrence_rule?: string | null;
  /** "series" applies an edit to every future occurrence, not just this one. */
  series?: RepeatScope;
  subtasks?: { title: string; display_order?: number; due_at?: string | null }[];
};

/** One due date on the calendar's deadline overlay — a task's or a step's. */
export type Deadline = {
  kind: "task" | "subtask";
  task_id: string;
  subtask_id: string | null;
  title: string;
  /** For a subtask, the parent task's title; null for a task row. */
  task_title: string | null;
  at: string;
  status: TaskStatus;
  priority: TaskPriority;
  is_done: boolean;
  is_overdue: boolean;
  /** What a person types to find it: the notes, the linked file and its
   *  client, the stages. For a step these are its parent's. Optional because
   *  older payloads lack them; the calendar's filter treats absent as empty. */
  description?: string | null;
  dossier_id?: string | null;
  dossier_ref?: string | null;
  dossier_client_name?: string | null;
  milestone_labels?: string[];
};

export type Deadlines = { items: Deadline[]; audience: Audience; audiences: Audience[] };

export type EventInput = {
  title: string;
  event_type?: string;
  location?: string | null;
  description?: string | null;
  start_at: string;
  end_at: string;
  all_day?: boolean;
  reminder_minutes?: number | null;
  remind_at?: string | null;
  /** Several reminders per event (up to 3) — supersedes the pair when present. */
  reminders?: ReminderInput[];
  recurrence_rule?: string | null;
  series?: RepeatScope;
  entity_type?: string | null;
  entity_id?: string | null;
  scope_id?: string | null;
  participants?: { user_id?: string; external_name?: string; is_organiser?: boolean }[];
  /** Book it anyway, past the clash warning. */
  force?: boolean;
};

/* ── query building ───────────────────────────────────────────────────────── */

/** `?a=1&b=2`, dropping null/undefined/"" so an unset filter is not sent as an
 *  empty parameter the server's strict query schema would reject. */
function qs(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

/* ── the merged surface ───────────────────────────────────────────────────── */

/**
 * Tasks and events for one window, interleaved by time.
 *
 * Send no window and the server answers with TODAY ON THE TENANT'S CLOCK —
 * which is the right default and not something the browser should compute,
 * since the browser's zone is the laptop's, not the business's.
 */
export const getDay = (params: { from?: string; to?: string; audience?: Audience } = {}) =>
  tenant<DayTimeline>(`/workspace/day${qs(params)}`);

/** Tenant-local display and wall-clock serialization context. */
export const getWorkspaceContext = () =>
  tenant<WorkspaceContext>("/workspace/context");

export const getApprovals = () =>
  tenant<WorkspaceApproval[]>("/workspace/approvals");

export const getAlerts = () =>
  tenant<WorkspaceAlert[]>("/workspace/alerts");

/* ── cash to account for (MOD-76) ─────────────────────────────────────────── */

/** One line the caller still owes a receipt on. */
export type ReceiptOwed = {
  dossier_id: string;
  dossier_ref?: string | null;
  costing_line_id: string;
  line_label?: string | null;
  owed_by_name?: string | null;
  reconciliation_id?: string | null;
  claimed_ttc?: number | string | null;
};
export type ReceiptsOwed = { count: number; total_ttc: number; items: ReceiptOwed[] };

/**
 * "Cash to account for" — receipts the signed-in user personally owes (owner
 * Q10, guide §6.5). The endpoint lives under costing rather than /workspace,
 * but the surface is a personal queue-of-work item, so it reads here beside the
 * day. `/owed` is the CALLER'S own and ungated — a person may always see what
 * they owe.
 */
export const getReceiptsOwed = () =>
  tenant<ReceiptsOwed>("/costing/reconciliations/owed");

/* ── tasks ────────────────────────────────────────────────────────────────── */

/**
 * The board plus the audience metadata the switcher needs.
 *
 * This is the one read whose payload is an OBJECT rather than the bare columns:
 * the server nests `{ board, audience, audiences }` inside `data` so the extra
 * fields survive `tenant()`'s unwrap (see the file header). `board` is the
 * status→tasks map the kanban draws.
 */
export type BoardResponse = {
  board: TaskBoard;
  audience: Audience;
  audiences: Audience[];
  completeness: BoardCompleteness;
};

export const getBoard = (
  /** `q` is the same free-text search the list answers — title, notes, the
   *  linked file's reference and client, step titles — so the Tasks page's
   *  one search box narrows whichever view is showing. */
  params: { assigned_to?: string; audience?: Audience; dossier_id?: string; q?: string } = {},
) => tenant<BoardResponse>(`/workspace/tasks/board${qs(params)}`);

export const listTasks = (
  params: {
    status?: TaskStatus;
    assigned_to?: string;
    q?: string;
    audience?: Audience;
    limit?: number;
    offset?: number;
  } = {},
) => tenant<Task[]>(`/workspace/tasks${qs(params)}`);

/** The paginated, filterable list the List view draws — the board's cap-proof twin. */
export const listTasksPaged = (
  params: {
    status?: TaskStatus;
    priority?: TaskPriority;
    assigned_to?: string;
    q?: string;
    audience?: Audience;
    /** Narrow to one operations file, or one stage of its chain (13920). */
    dossier_id?: string;
    milestone_instance_id?: string;
    limit?: number;
    offset?: number;
  } = {},
) => tenantPaged<Task[]>(`/workspace/tasks${qs(params)}`);

/**
 * One task, read at the audience the list or board was rendered at (B-03).
 *
 * Without the parameter the server defaults to "mine", so a Team or All card a
 * manager could see on the board answered NOT FOUND when they clicked it. The
 * value is a request, not a grant: the server narrows it against real grants
 * before it decides.
 */
export const getTask = (id: string, audience?: Audience) =>
  tenant<Task>(`/workspace/tasks/${id}${qs({ audience })}`);

export const createTask = (input: TaskInput) =>
  tenant<Task>("/workspace/tasks", { method: "POST", body: input });

export const updateTask = (id: string, input: Partial<TaskInput>) =>
  tenant<Task>(`/workspace/tasks/${id}`, { method: "PATCH", body: input });

/** Its own verb, not a field on update — the server treats a status change as a
 *  transition with consequences (completed_at, an event, the assignee's alert). */
/**
 * THE status path.
 *
 * Its own verb, not a field on update — the server treats a status change as a
 * transition with consequences (completed_at, an event, the assignee's alert,
 * the watchers'). Board drag, Move menu, keyboard drop, the panel's select and
 * the edit dialog all end here, so one gesture cannot produce a different
 * history from another (B-04).
 */
export const moveTask = (id: string, status: TaskStatus, audience?: Audience) =>
  tenant<Task>(`/workspace/tasks/${id}/status`, {
    method: "POST",
    body: audience ? { status, audience } : { status },
  });

export const deleteTask = (id: string) =>
  tenant<void>(`/workspace/tasks/${id}`, { method: "DELETE" });

export const addSubtask = (taskId: string, title: string, due_at?: string | null) =>
  tenant<Subtask>(`/workspace/tasks/${taskId}/subtasks`, {
    method: "POST",
    body: { title, due_at: due_at || null },
  });

/** One PATCH for a step's edits — tick it done and/or move its deadline. */
export const patchSubtask = (
  taskId: string,
  subtaskId: string,
  patch: { is_done?: boolean; due_at?: string | null },
) =>
  tenant<Subtask>(`/workspace/tasks/${taskId}/subtasks/${subtaskId}`, {
    method: "PATCH",
    body: patch,
  });

export const toggleSubtask = (taskId: string, subtaskId: string, is_done: boolean) =>
  patchSubtask(taskId, subtaskId, { is_done });

export const deleteSubtask = (taskId: string, subtaskId: string) =>
  tenant<void>(`/workspace/tasks/${taskId}/subtasks/${subtaskId}`, { method: "DELETE" });

export const addWatcher = (taskId: string, user_id: string) =>
  tenant<Watcher>(`/workspace/tasks/${taskId}/watchers`, {
    method: "POST",
    body: { user_id },
  });

export const removeWatcher = (taskId: string, userId: string) =>
  tenant<void>(`/workspace/tasks/${taskId}/watchers/${userId}`, { method: "DELETE" });

/* ── hierarchy, dependencies, pings (PR 2) ────────────────────────────────── */

/** A child task. Inherits the parent's operations-file link unless overridden. */
export type ChildTaskInput = {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigned_to?: string | null;
  due_at?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  /** Omitted inherits the parent's file and stages; an explicit null (or [])
   *  detaches. */
  dossier_id?: string | null;
  milestone_instance_id?: string | null;
  milestone_instance_ids?: string[];
  reminder_minutes?: number | null;
  remind_at?: string | null;
};

export const addChildTask = (parentId: string, input: ChildTaskInput, audience?: Audience) =>
  tenant<Task>(`/workspace/tasks/${parentId}/children${qs({ audience })}`, {
    method: "POST",
    body: input,
  });

/**
 * Every dependency call answers with the WHOLE refreshed task.
 *
 * An edge changes `is_blocked`, `blocking_count` and the list the panel draws,
 * so returning the edge alone would force a refetch the client could forget —
 * and a client that forgot would show a task claiming to be blocked beside an
 * empty dependency list.
 */
export const addDependency = (taskId: string, dependsOnTaskId: string, audience?: Audience) =>
  tenant<Task>(`/workspace/tasks/${taskId}/dependencies${qs({ audience })}`, {
    method: "POST",
    body: { depends_on_task_id: dependsOnTaskId },
  });

export const removeDependency = (taskId: string, dependencyId: string, audience?: Audience) =>
  tenant<Task>(`/workspace/tasks/${taskId}/dependencies/${dependencyId}${qs({ audience })}`, {
    method: "DELETE",
  });

/** "Proceed anyway", or withdraw it. A cancelled prerequisite never satisfies
 *  an edge on its own — somebody has to say so, and it is recorded who. */
export const overrideDependency = (
  taskId: string,
  dependencyId: string,
  overridden: boolean,
  reason?: string | null,
  audience?: Audience,
) =>
  tenant<Task>(`/workspace/tasks/${taskId}/dependencies/${dependencyId}/override${qs({ audience })}`, {
    method: "PATCH",
    body: { overridden, reason: reason || null },
  });

/** Nudge the people already on this task. The server refuses anybody who is
 *  not its assignee, creator or watcher — a task is not a messaging channel. */
export const pingTask = (
  taskId: string,
  body: { user_ids?: string[]; message?: string | null } = {},
  audience?: Audience,
) =>
  tenant<{ pinged: number; user_ids: string[] }>(`/workspace/tasks/${taskId}/ping${qs({ audience })}`, {
    method: "POST",
    body,
  });

/* ── blockages (13975) ─────────────────────────────────────────────────────── */

/**
 * An external hold on a task — "held at customs, network down". One active
 * row per task; resolved rows are the history behind "late because of X" and
 * behind the due-date movement a resolve applies.
 */
export type TaskBlockage = {
  task_blockage_id: string;
  task_id: string;
  note: string;
  estimated_resolve_at: string | null;
  raised_by: string | null;
  raised_by_name: string | null;
  raised_at: string;
  resolved_at: string | null;
  resolved_by_name: string | null;
  resolve_note: string | null;
  /** The due-date movement applied when this hold cleared, as an interval
   *  string ("4 days"); null when nothing moved. */
  due_shift: string | null;
};

export const raiseBlockage = (
  taskId: string,
  body: {
    note: string;
    estimated_resolve_at?: string | null;
    notify_user_ids?: string[];
    channel_ids?: string[];
  },
  audience?: Audience,
) =>
  tenant<{ blockage: TaskBlockage; notified: number; channels_posted: string[] }>(
    `/workspace/tasks/${taskId}/blockages${qs({ audience })}`,
    { method: "POST", body },
  );

export const resolveBlockage = (
  taskId: string,
  blockageId: string,
  body: { resolve_note?: string | null } = {},
  audience?: Audience,
) =>
  tenant<{ blockage: TaskBlockage; new_due_at: string | null }>(
    `/workspace/tasks/${taskId}/blockages/${blockageId}/resolve${qs({ audience })}`,
    { method: "POST", body },
  );

/* ── analytics (PR 2) ─────────────────────────────────────────────────────── */

export type AnalyticsBucket = { bucket: string; tasks: number; avg_days?: number };

export type AnalyticsResponse = {
  /** Resolved, defaulted and CLAMPED server-side — `clamped` says when the
   *  window the URL asked for was wider than the aggregate will honour. */
  window: { from: string; to: string; timezone: string; clamped: boolean; max_days: number };
  audience: Audience;
  audiences: Audience[];
  filters: {
    status: TaskStatus | null;
    priority: TaskPriority | null;
    assigned_to: string | null;
    scope_id: string | null;
    dossier_id: string | null;
  };
  summary: {
    open: number;
    overdue: number;
    blocked: number;
    completed: number;
    cancelled: number;
    total: number;
  };
  throughput: { day: string; completed: number }[];
  overdue_aging: AnalyticsBucket[];
  workload: {
    user_id: string | null;
    assignee_name: string;
    open_tasks: number;
    overdue_tasks: number;
    blocked_tasks: number;
  }[];
  cycle_time: { buckets: AnalyticsBucket[]; median_days: number | null };
  blocked: {
    task_id: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    due_at: string | null;
    assigned_to_name: string | null;
    blocking_count: number;
    blocked_since: string | null;
    /** 13975: the hold's own sentence, when the wait is (also) a blockage. */
    blockage_note: string | null;
    blockage_eta: string | null;
    link_url: string | null;
  }[];
  burndown: {
    open_at_start: number;
    days: { day: string; created: number; completed: number; open: number }[];
  };
  composition: { status: TaskStatus; priority: TaskPriority; tasks: number }[];
  /** Open work per operations file (13920). Linked work only — every task with
   *  no file would otherwise be one enormous row saying nothing. */
  by_file: {
    dossier_id: string;
    dossier_ref: string | null;
    client_name: string | null;
    /** The reference, or a sentence when the reader cannot resolve the file. */
    label: string;
    open_tasks: number;
    overdue_tasks: number;
    blocked_tasks: number;
    completed_tasks: number;
    total_tasks: number;
  }[];
  /** Per stage of the chain — populated ONLY when one file is picked, because
   *  milestone labels repeat across files and a tenant-wide grouping would add
   *  unrelated shipments together under one heading. */
  by_milestone: {
    milestone_instance_id: string | null;
    label: string;
    status: string | null;
    stage_seq: number | null;
    open_tasks: number;
    overdue_tasks: number;
    total_tasks: number;
  }[];
};

export type AnalyticsParams = {
  from?: string;
  to?: string;
  audience?: Audience;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigned_to?: string;
  scope_id?: string;
  /** Narrows EVERY figure on the dashboard, not only the by-file panel. */
  dossier_id?: string;
};

/**
 * The whole operational dashboard in one authorised read.
 *
 * One request rather than six, because the panels must describe the same
 * population at the same instant: six requests resolving "now" six times can
 * show a summary saying 42 open beside a workload table adding to 43, and the
 * reader has no way to know which is right.
 */
export const getAnalytics = (params: AnalyticsParams = {}) =>
  tenant<AnalyticsResponse>(`/workspace/analytics${qs(params)}`);

/* ── calendar ─────────────────────────────────────────────────────────────── */

export const listEvents = (
  params: { from?: string; to?: string; event_type?: string; audience?: Audience } = {},
) => tenant<CalendarEvent[]>(`/workspace/events${qs(params)}`);

/**
 * Task + subtask deadlines in a window, for the calendar's overlay.
 *
 * Sibling fields ride inside `data` (like the board), so this goes through
 * `tenant()`; the server defaults an unbounded request to the current month.
 */
export const getDeadlines = (params: { from?: string; to?: string; audience?: Audience } = {}) =>
  tenant<Deadlines>(`/workspace/deadlines${qs(params)}`);

export const getEvent = (id: string) => tenant<CalendarEvent>(`/workspace/events/${id}`);

export const createEvent = (input: EventInput) =>
  tenant<CalendarEvent>("/workspace/events", { method: "POST", body: input });

export const updateEvent = (id: string, input: Partial<EventInput>) =>
  tenant<CalendarEvent>(`/workspace/events/${id}`, {
    method: "PATCH",
    body: input,
  });

export const deleteEvent = (id: string) =>
  tenant<void>(`/workspace/events/${id}`, { method: "DELETE" });

export const addParticipant = (
  eventId: string,
  input: { user_id?: string; external_name?: string; is_organiser?: boolean },
) =>
  tenant<Participant>(`/workspace/events/${eventId}/participants`, {
    method: "POST",
    body: input,
  });

export const respondParticipant = (eventId: string, participantId: string, status: ParticipantResponse) =>
  tenant<Participant>(
    `/workspace/events/${eventId}/participants/${participantId}/response`,
    { method: "PATCH", body: { status } },
  );

export const removeParticipant = (eventId: string, participantId: string) =>
  tenant<void>(`/workspace/events/${eventId}/participants/${participantId}`, {
    method: "DELETE",
  });
