/**
 * My Workspace — the typed API surface for tasks and calendar events.
 *
 * Typed helpers live here rather than inline `tenant()` calls in components
 * (FRONTEND_GUIDE §3.4), so that a route that moves is fixed in one file and
 * the compiler finds every caller.
 *
 * ── TWO THINGS ABOUT THE CONTRACT THAT ARE EASY TO GET WRONG ───────────────
 *
 * 1. The board and the day are NOT paged. `board()` returns an object keyed by
 *    status and `day()` returns `{ items, audience, audiences }`, so they go
 *    through `tenant()` and not `tenantPaged()`. Only `listTasks()` is a real
 *    list, and it is capped at 50 rows server-side like every other list here —
 *    which is why the board exists: a kanban over a truncated page would show
 *    four columns of the wrong rows.
 *
 * 2. Dates go UP as the user typed them and come DOWN as instants. The server
 *    reads a zoneless `YYYY-MM-DDTHH:mm` on the tenant's workplace clock (see
 *    src/modules/dashboard/workspace/workspace.time.js), so this file must not
 *    "help" by converting to UTC in the browser — the browser's zone is the
 *    user's laptop, which is not necessarily where the business is.
 */
import { tenant } from "@/lib/api-client";

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
  completed_at: string | null;
  created_at: string;
};

export type Watcher = { user_id: string; full_name: string | null; email: string };

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
  entity_type: string | null;
  entity_id: string | null;
  /** Derived on read, never stored — see the service's header for why. */
  link_url: string | null;
  entity_label: string | null;
  has_link: boolean;
  subtask_count: number;
  subtask_done_count: number;
  created_at: string;
  updated_at: string;
  subtasks?: Subtask[];
  watchers?: Watcher[];
};

export type TaskBoard = Record<BoardColumn, Task[]>;

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
  reminder_minutes: number | null;
  remind_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
  entity_type: string | null;
  entity_id: string | null;
  link_url: string | null;
  entity_label: string | null;
  has_link: boolean;
  participant_count: number;
  created_at: string;
  updated_at: string;
  participants?: Participant[];
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
    };

export type DayTimeline = {
  items: TimelineItem[];
  audience: Audience;
  audiences: Audience[];
  tasks: number;
  events: number;
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
  is_personal?: boolean;
  reminder_minutes?: number | null;
  remind_at?: string | null;
  subtasks?: { title: string; display_order?: number }[];
};

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
  entity_type?: string | null;
  entity_id?: string | null;
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
  tenant<{ data: DayTimeline }>(`/workspace/day${qs(params)}`).then((r) => r.data);

/* ── tasks ────────────────────────────────────────────────────────────────── */

export type BoardResponse = { data: TaskBoard; audience: Audience; audiences: Audience[] };

export const getBoard = (params: { assigned_to?: string; audience?: Audience } = {}) =>
  tenant<BoardResponse>(`/workspace/tasks/board${qs(params)}`);

export const listTasks = (
  params: {
    status?: TaskStatus;
    assigned_to?: string;
    q?: string;
    audience?: Audience;
    limit?: number;
    offset?: number;
  } = {},
) => tenant<{ data: Task[] }>(`/workspace/tasks${qs(params)}`).then((r) => r.data);

export const getTask = (id: string) =>
  tenant<{ data: Task }>(`/workspace/tasks/${id}`).then((r) => r.data);

export const createTask = (input: TaskInput) =>
  tenant<{ data: Task }>("/workspace/tasks", { method: "POST", body: input }).then((r) => r.data);

export const updateTask = (id: string, input: Partial<TaskInput>) =>
  tenant<{ data: Task }>(`/workspace/tasks/${id}`, { method: "PATCH", body: input }).then(
    (r) => r.data,
  );

/** Its own verb, not a field on update — the server treats a status change as a
 *  transition with consequences (completed_at, an event, the assignee's alert). */
export const moveTask = (id: string, status: TaskStatus) =>
  tenant<{ data: Task }>(`/workspace/tasks/${id}/status`, {
    method: "POST",
    body: { status },
  }).then((r) => r.data);

export const deleteTask = (id: string) =>
  tenant<void>(`/workspace/tasks/${id}`, { method: "DELETE" });

export const addSubtask = (taskId: string, title: string) =>
  tenant<{ data: Subtask }>(`/workspace/tasks/${taskId}/subtasks`, {
    method: "POST",
    body: { title },
  }).then((r) => r.data);

export const toggleSubtask = (taskId: string, subtaskId: string, is_done: boolean) =>
  tenant<{ data: Subtask }>(`/workspace/tasks/${taskId}/subtasks/${subtaskId}`, {
    method: "PATCH",
    body: { is_done },
  }).then((r) => r.data);

export const deleteSubtask = (taskId: string, subtaskId: string) =>
  tenant<void>(`/workspace/tasks/${taskId}/subtasks/${subtaskId}`, { method: "DELETE" });

export const addWatcher = (taskId: string, user_id: string) =>
  tenant<{ data: Watcher }>(`/workspace/tasks/${taskId}/watchers`, {
    method: "POST",
    body: { user_id },
  }).then((r) => r.data);

export const removeWatcher = (taskId: string, userId: string) =>
  tenant<void>(`/workspace/tasks/${taskId}/watchers/${userId}`, { method: "DELETE" });

/* ── calendar ─────────────────────────────────────────────────────────────── */

export const listEvents = (
  params: { from?: string; to?: string; event_type?: string; audience?: Audience } = {},
) => tenant<{ data: CalendarEvent[] }>(`/workspace/events${qs(params)}`).then((r) => r.data);

export const getEvent = (id: string) =>
  tenant<{ data: CalendarEvent }>(`/workspace/events/${id}`).then((r) => r.data);

export const createEvent = (input: EventInput) =>
  tenant<{ data: CalendarEvent }>("/workspace/events", { method: "POST", body: input }).then(
    (r) => r.data,
  );

export const updateEvent = (id: string, input: Partial<EventInput>) =>
  tenant<{ data: CalendarEvent }>(`/workspace/events/${id}`, {
    method: "PATCH",
    body: input,
  }).then((r) => r.data);

export const deleteEvent = (id: string) =>
  tenant<void>(`/workspace/events/${id}`, { method: "DELETE" });

export const addParticipant = (
  eventId: string,
  input: { user_id?: string; external_name?: string; is_organiser?: boolean },
) =>
  tenant<{ data: Participant }>(`/workspace/events/${eventId}/participants`, {
    method: "POST",
    body: input,
  }).then((r) => r.data);

export const respondParticipant = (eventId: string, participantId: string, status: ParticipantResponse) =>
  tenant<{ data: Participant }>(
    `/workspace/events/${eventId}/participants/${participantId}/response`,
    { method: "PATCH", body: { status } },
  ).then((r) => r.data);

export const removeParticipant = (eventId: string, participantId: string) =>
  tenant<void>(`/workspace/events/${eventId}/participants/${participantId}`, {
    method: "DELETE",
  });
