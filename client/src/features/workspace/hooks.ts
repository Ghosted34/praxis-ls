/**
 * My Workspace — data access.
 *
 * `useQuery`/`useMutation` directly rather than the `useList`/`useResource`
 * shims, which FRONTEND_GUIDE §3.4 reserves for screens that need nothing but
 * the four states. This surface needs keyed invalidation: moving a card has to
 * refresh the board AND the day list AND the single task a detail panel is
 * holding, and a shim that invalidates "the tenant" would refetch screens the
 * user is not looking at.
 *
 * ── WHY THE QUERY KEYS ARE SHAPED LIKE THIS ────────────────────────────────
 *
 * Every key starts with `["workspace", …]`, so one `invalidateQueries({ queryKey:
 * ["workspace"] })` after a write is enough and cannot miss a surface. The
 * parameters ride INSIDE the key rather than in a stringified path, so two
 * panels asking for the same thing share one request: the Tasks board and the
 * Today KPIs both ask for `assigned_to: "me"`, and TanStack dedupes them into a
 * single round trip because the keys are structurally equal.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import * as api from "./api";
import type {
  Audience,
  CalendarEvent,
  DayTimeline,
  EventInput,
  ParticipantResponse,
  Task,
  TaskBoard,
  TaskInput,
  TaskPriority,
  TaskStatus,
  WorkspaceContext,
  WorkspaceApproval,
  WorkspaceAlert,
} from "./api";

const ROOT = "workspace" as const;

/** Everything this surface reads, so a write can refresh all of it at once. */
export function useInvalidateWorkspace() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [ROOT] });
}

/* ── reads ────────────────────────────────────────────────────────────────── */

/** The tenant-local contract shared by Today, Calendar, and task forms. */
export function useWorkspaceContext() {
  return useQuery<WorkspaceContext>({
    queryKey: [ROOT, "context"],
    queryFn: () => api.getWorkspaceContext(),
    staleTime: 5 * 60_000,
  });
}

/** Focused Today queue reads. A failure in one panel must not hide the other. */
export function useApprovals() {
  return useQuery<WorkspaceApproval[]>({
    queryKey: [ROOT, "approvals"],
    queryFn: () => api.getApprovals(),
    staleTime: 30_000,
  });
}

export function useUnreadAlerts() {
  return useQuery<WorkspaceAlert[]>({
    queryKey: [ROOT, "alerts"],
    queryFn: () => api.getAlerts(),
    staleTime: 30_000,
  });
}

/** The merged day. `window` narrows it; omit it for today on the tenant clock. */
export function useDay(params: { from?: string; to?: string; audience?: Audience } = {}) {
  return useQuery<DayTimeline>({
    queryKey: [ROOT, "day", params],
    queryFn: () => api.getDay(params),
    // A day is a live thing: other people assign tasks and the clock moves.
    // 30s is frequent enough to feel current without a request per keystroke.
    staleTime: 30_000,
  });
}

/** "Cash to account for" — receipts the caller personally owes (MOD-76, owner
 *  Q10). Its own key under the workspace root, so a workspace write still
 *  refreshes it, and its own request so it never gates the day timeline. */
export function useReceiptsOwed() {
  return useQuery<api.ReceiptsOwed>({
    queryKey: [ROOT, "owed"],
    queryFn: () => api.getReceiptsOwed(),
    staleTime: 30_000,
  });
}

export function useTaskBoard(
  params: { assigned_to?: string; audience?: Audience; dossier_id?: string; q?: string } = {},
) {
  return useQuery<api.BoardResponse>({
    queryKey: [ROOT, "board", params],
    queryFn: () => api.getBoard(params),
    staleTime: 30_000,
  });
}

export function useTaskList(
  params: { status?: TaskStatus; assigned_to?: string; q?: string; audience?: Audience; limit?: number; offset?: number } = {},
) {
  return useQuery<Task[]>({
    queryKey: [ROOT, "tasks", params],
    queryFn: () => api.listTasks(params),
    // Only fires when something asks: a screen showing the board does not need
    // the flat list, and fetching it would be a second read of the same rows.
    enabled: Object.keys(params).length > 0,
  });
}

/**
 * The paginated list the List view draws. Unlike `useTaskList`, this carries the
 * pre-LIMIT `total` from `X-Total-Count`, which is what makes a real pager
 * possible past the board's 200-row cap. The key is separate so the board and the
 * list never share (or fight over) a cache entry.
 */
export function useTaskListPaged(
  params: {
    status?: TaskStatus;
    priority?: TaskPriority;
    assigned_to?: string;
    q?: string;
    audience?: Audience;
    /** Narrow to one operations file, or one stage of its chain (13920). */
    dossier_id?: string;
    milestone_instance_id?: string;
    sort?: string;
    limit?: number;
    offset?: number;
  },
) {
  return useQuery({
    queryKey: [ROOT, "tasks", "paged", params],
    queryFn: () => api.listTasksPaged(params),
  });
}

/**
 * One task, read at the audience the board or list is showing (B-03).
 *
 * The audience is part of the KEY as well as the request: two panels opened at
 * different audiences are two different authorised answers, and sharing one
 * cache entry between them would show a manager the "mine" reading of a card
 * they opened from Everyone.
 */
export function useTask(id: string | null, audience?: Audience) {
  return useQuery<Task>({
    queryKey: [ROOT, "task", id, audience ?? "mine"],
    queryFn: () => api.getTask(id as string, audience),
    enabled: !!id,
  });
}

/** The operational dashboard. One read, one window, one authorised population. */
export function useWorkspaceAnalytics(params: api.AnalyticsParams = {}) {
  return useQuery<api.AnalyticsResponse>({
    queryKey: [ROOT, "analytics", params],
    queryFn: () => api.getAnalytics(params),
    // An aggregate is expensive and does not move by the second. A minute is
    // fresh enough for a dashboard and stops a filter flick refetching six
    // aggregates per keystroke.
    staleTime: 60_000,
  });
}

/** Task + subtask deadlines in a window — the calendar's due-date overlay. */
export function useDeadlines(params: { from?: string; to?: string; audience?: Audience } = {}) {
  return useQuery<api.Deadlines>({
    queryKey: [ROOT, "deadlines", params],
    queryFn: () => api.getDeadlines(params),
    staleTime: 30_000,
  });
}

export function useEvents(params: { from?: string; to?: string; event_type?: string; audience?: Audience } = {}) {
  return useQuery<CalendarEvent[]>({
    queryKey: [ROOT, "events", params],
    queryFn: () => api.listEvents(params),
    // A calendar moves less often than a to-do list, and the window is wide.
    staleTime: 60_000,
  });
}

export function useEvent(id: string | null) {
  return useQuery<CalendarEvent>({
    queryKey: [ROOT, "event", id],
    queryFn: () => api.getEvent(id as string),
    enabled: !!id,
  });
}

/* ── writes ───────────────────────────────────────────────────────────────── */

/**
 * Every mutation below ends in the same invalidate.
 *
 * It is the whole surface rather than the one row that changed, deliberately: a
 * task appears on the board, in the day list, in a detail panel and in the
 * KPI counts at once, and a partial invalidation is how a screen ends up
 * showing a card the server has already moved.
 */
function useWorkspaceMutation<T, V>(fn: (vars: V) => Promise<T>) {
  const qc = useQueryClient();
  return useMutation<T, Error, V>({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: [ROOT] }),
  });
}

export const useCreateTask = () => useWorkspaceMutation((input: TaskInput) => api.createTask(input));
export const useUpdateTask = () =>
  useWorkspaceMutation(({ id, input }: { id: string; input: Partial<TaskInput> }) =>
    api.updateTask(id, input),
  );
/**
 * Move a task to another column — optimistically, at a stated reach.
 *
 * A drag that ends with the card snapping BACK, then jumping forward a beat
 * later when the refetch lands, reads as a failed drop even when the server
 * said yes. So the card jumps on release: every cached board moves the row
 * immediately, the detail panel's copy follows, and the invalidation on settle
 * reconciles all of it with the server. On failure the snapshots below put
 * every cache back where it was, and the caller (`TaskBoard`) explains why.
 *
 * Only the board and the single task are patched. The day timeline and the
 * flat lists carry the same row in shapes that are not worth rewriting by hand;
 * they refresh from the server on settle, a fraction of a second later.
 *
 * ── THE AUDIENCE TRAVELS WITH THE MOVE ─────────────────────────────────────
 *
 * The reach the board was READ at is the reach the move must be authorised at
 * (B-03). A card shown on a Team board belongs to a population the caller's
 * default reach may not contain, so a move that dropped the audience would be
 * refused for a task the user is looking at — a 404 on a card that is plainly
 * on screen, and unreproducible for anybody whose default is wider.
 */
export function useMoveTask() {
  const qc = useQueryClient();
  return useMutation<
    Task,
    Error,
    { id: string; status: TaskStatus; audience?: Audience },
    { boards: Array<[readonly unknown[], api.BoardResponse | undefined]>; tasks: Array<[readonly unknown[], Task | undefined]> }
  >({
    // The audience is passed only when there IS one, rather than as a trailing
    // `undefined`. A move from a screen with no wider reach to name is the same
    // request it has always been, so the default path keeps its exact shape.
    mutationFn: ({ id, status, audience }) =>
      audience ? api.moveTask(id, status, audience) : api.moveTask(id, status),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: [ROOT, "board"] });
      const boards = qc.getQueriesData<api.BoardResponse>({ queryKey: [ROOT, "board"] });
      for (const [key, data] of boards) {
        const next = data ? optimisticBoard(data.board, id, status) : null;
        if (next) qc.setQueryData(key, { ...data, board: next });
      }
      /**
       * EVERY cached copy of this task, not one exact key.
       *
       * `useTask` keys on the audience it read at, so the same task can sit in
       * the cache under `[…, id, "mine"]` and `[…, id, "team"]` at once. An
       * exact-key patch would update whichever one the writer happened to name
       * and leave the OTHER showing the old status until the settle — which is
       * the copy the open detail pane is most likely rendering, because the
       * pane is what the board handed its own reach to.
       */
      await qc.cancelQueries({ queryKey: [ROOT, "task", id] });
      const tasks = qc.getQueriesData<Task>({ queryKey: [ROOT, "task", id] });
      for (const [key, task] of tasks) {
        if (task && task.status !== status) qc.setQueryData<Task>(key, { ...task, status });
      }
      return { boards, tasks };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      for (const [key, data] of context.boards) qc.setQueryData(key, data);
      for (const [key, task] of context.tasks) qc.setQueryData(key, task);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: [ROOT] }),
  });
}

/**
 * The board with one task relocated, or null when there is nothing to do —
 * the task is in no cached column (a board read under another audience), it is
 * already there, or the target is not a column at all (CANCELLED has no
 * column; a stray key would render nowhere and corrupt the counts).
 */
function optimisticBoard(board: TaskBoard, id: string, status: TaskStatus): TaskBoard | null {
  if (!(status in board)) return null;
  const target = status as api.BoardColumn;
  let from: api.BoardColumn | null = null;
  let found: Task | null = null;
  for (const column of api.BOARD_COLUMNS) {
    const hit = board[column]?.find((t) => t.task_id === id);
    if (hit) {
      from = column;
      found = hit;
      break;
    }
  }
  if (!found || !from || from === target) return null;
  return {
    ...board,
    [from]: board[from].filter((t) => t.task_id !== id),
    [target]: [...board[target], { ...found, status: target }],
  };
}export const useDeleteTask = () => useWorkspaceMutation((id: string) => api.deleteTask(id));

export const useAddSubtask = () =>
  useWorkspaceMutation(
    ({ taskId, title, dueAt }: { taskId: string; title: string; dueAt?: string | null }) =>
      api.addSubtask(taskId, title, dueAt),
  );
export const useToggleSubtask = () =>
  useWorkspaceMutation(
    ({ taskId, subtaskId, isDone }: { taskId: string; subtaskId: string; isDone: boolean }) =>
      api.toggleSubtask(taskId, subtaskId, isDone),
  );
export const useSetSubtaskDeadline = () =>
  useWorkspaceMutation(
    ({ taskId, subtaskId, dueAt }: { taskId: string; subtaskId: string; dueAt: string | null }) =>
      api.patchSubtask(taskId, subtaskId, { due_at: dueAt }),
  );
export const useDeleteSubtask = () =>
  useWorkspaceMutation(({ taskId, subtaskId }: { taskId: string; subtaskId: string }) =>
    api.deleteSubtask(taskId, subtaskId),
  );

/* ── hierarchy, dependencies and collaboration (PR 2) ─────────────────────── */

export const useAddChildTask = () =>
  useWorkspaceMutation(
    ({ parentId, input, audience }: { parentId: string; input: api.ChildTaskInput; audience?: Audience }) =>
      api.addChildTask(parentId, input, audience),
  );

export const useAddDependency = () =>
  useWorkspaceMutation(
    ({ taskId, dependsOnTaskId, audience }: { taskId: string; dependsOnTaskId: string; audience?: Audience }) =>
      api.addDependency(taskId, dependsOnTaskId, audience),
  );

export const useRemoveDependency = () =>
  useWorkspaceMutation(
    ({ taskId, dependencyId, audience }: { taskId: string; dependencyId: string; audience?: Audience }) =>
      api.removeDependency(taskId, dependencyId, audience),
  );

export const useOverrideDependency = () =>
  useWorkspaceMutation(
    ({
      taskId,
      dependencyId,
      overridden,
      reason,
      audience,
    }: {
      taskId: string;
      dependencyId: string;
      overridden: boolean;
      reason?: string | null;
      audience?: Audience;
    }) => api.overrideDependency(taskId, dependencyId, overridden, reason, audience),
  );

export const usePingTask = () =>
  useWorkspaceMutation(
    ({
      taskId,
      userIds,
      message,
      audience,
    }: {
      taskId: string;
      userIds?: string[];
      message?: string | null;
      audience?: Audience;
    }) => api.pingTask(taskId, { user_ids: userIds, message }, audience),
  );

export const useAddWatcher = () =>
  useWorkspaceMutation(({ taskId, userId }: { taskId: string; userId: string }) =>
    api.addWatcher(taskId, userId),
  );

/**
 * Register an external hold (13975). Invalidates the whole workspace root on
 * settle like every other task write: the hold moves the card's pill, the
 * panel's collapsible AND the Monitor's Blocked-work panel, and three screens
 * disagreeing about whether a task is stuck is worse than one refetch.
 */
export const useRaiseBlockage = () =>
  useWorkspaceMutation(
    ({
      taskId,
      note,
      estimatedResolveAt,
      notifyUserIds,
      channelIds,
      audience,
    }: {
      taskId: string;
      note: string;
      estimatedResolveAt?: string | null;
      notifyUserIds?: string[];
      channelIds?: string[];
      audience?: Audience;
    }) =>
      api.raiseBlockage(
        taskId,
        {
          note,
          estimated_resolve_at: estimatedResolveAt || null,
          notify_user_ids: notifyUserIds,
          channel_ids: channelIds,
        },
        audience,
      ),
  );

export const useResolveBlockage = () =>
  useWorkspaceMutation(
    ({
      taskId,
      blockageId,
      resolveNote,
      audience,
    }: {
      taskId: string;
      blockageId: string;
      resolveNote?: string | null;
      audience?: Audience;
    }) => api.resolveBlockage(taskId, blockageId, { resolve_note: resolveNote || null }, audience),
  );

export const useRemoveWatcher = () =>
  useWorkspaceMutation(({ taskId, userId }: { taskId: string; userId: string }) =>
    api.removeWatcher(taskId, userId),
  );

export const useCreateEvent = () => useWorkspaceMutation((input: EventInput) => api.createEvent(input));
export const useUpdateEvent = () =>
  useWorkspaceMutation(({ id, input }: { id: string; input: Partial<EventInput> }) =>
    api.updateEvent(id, input),
  );
export const useDeleteEvent = () => useWorkspaceMutation((id: string) => api.deleteEvent(id));

export const useAddParticipant = () =>
  useWorkspaceMutation(
    ({ eventId, input }: { eventId: string; input: { user_id?: string; external_name?: string; is_organiser?: boolean } }) =>
      api.addParticipant(eventId, input),
  );
export const useRespondParticipant = () =>
  useWorkspaceMutation(
    ({
      eventId,
      participantId,
      status,
    }: {
      eventId: string;
      participantId: string;
      status: ParticipantResponse;
    }) => api.respondParticipant(eventId, participantId, status),
  );
export const useRemoveParticipant = () =>
  useWorkspaceMutation(({ eventId, participantId }: { eventId: string; participantId: string }) =>
    api.removeParticipant(eventId, participantId),
  );

export type { UseQueryResult, Task, CalendarEvent, TaskBoard, DayTimeline, Audience };
