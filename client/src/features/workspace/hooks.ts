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
  TaskStatus,
} from "./api";

const ROOT = "workspace" as const;

/** Everything this surface reads, so a write can refresh all of it at once. */
export function useInvalidateWorkspace() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [ROOT] });
}

/* ── reads ────────────────────────────────────────────────────────────────── */

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

export function useTaskBoard(params: { assigned_to?: string; audience?: Audience } = {}) {
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

export function useTask(id: string | null) {
  return useQuery<Task>({
    queryKey: [ROOT, "task", id],
    queryFn: () => api.getTask(id as string),
    enabled: !!id,
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
export const useMoveTask = () =>
  useWorkspaceMutation(({ id, status }: { id: string; status: TaskStatus }) =>
    api.moveTask(id, status),
  );
export const useDeleteTask = () => useWorkspaceMutation((id: string) => api.deleteTask(id));

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
