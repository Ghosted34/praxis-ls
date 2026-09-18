/**
 * `useMoveTask` moves the card before the server answers.
 *
 * WHY THIS FILE EXISTS. A drag that ends with the card snapping BACK, then
 * jumping forward when the refetch lands, reads as a failed drop even when the
 * server said yes — which is exactly the "you drag but can't drop" report. The
 * mutation therefore moves the row in every cached board synchronously
 * (`onMutate`), rolls every cache back on failure (`onError`), and lets the
 * invalidation on settle reconcile with the server. These tests pin all three
 * halves against a QueryClient with the POST held open: the board must show
 * the move while the request is still in flight, keep it when the request
 * succeeds, and undo it when the request fails.
 */
import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, moveTask: vi.fn() };
});

import { moveTask } from "./api";
import type { Task, TaskBoard } from "./api";
import { useMoveTask } from "./hooks";

const TASK: Task = {
  task_id: "t-1",
  title: "Hold the meeting with Smart LS",
  description: "Daily meetings from 10 till 1 PM (Monday to Saturday).",
  status: "TO_DO",
  priority: "URGENT",
  assigned_to: "u-2",
  assigned_to_name: "JBS Praxis",
  created_by: "u-2",
  created_by_name: "JBS Praxis",
  due_at: "2026-09-17T10:00:00.000Z",
  completed_at: null,
  is_personal: false,
  scope_id: null,
  reminder_minutes: 15,
  remind_at: "2026-09-17T09:45:00.000Z",
  entity_type: null,
  entity_id: null,
  link_url: null,
  entity_label: null,
  has_link: false,
  subtask_count: 0,
  subtask_done_count: 0,
  created_at: "2026-09-17T08:00:00.000Z",
  updated_at: "2026-09-17T08:00:00.000Z",
  subtasks: [],
  watchers: [],
};

const BOARD_KEY = ["workspace", "board", { audience: "mine" }];
const DETAIL_KEY = ["workspace", "task", "t-1"];

function boardOf(client: QueryClient): TaskBoard {
  return (client.getQueryData(BOARD_KEY) as { board: TaskBoard }).board;
}

function detailOf(client: QueryClient): Task {
  return client.getQueryData(DETAIL_KEY) as Task;
}

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(BOARD_KEY, {
    board: { TO_DO: [TASK], IN_PROGRESS: [], IN_REVIEW: [], DONE: [] },
    audience: "mine",
    audiences: ["mine"],
  });
  client.setQueryData(DETAIL_KEY, TASK);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

describe("useMoveTask", () => {
  it("moves the card while the POST is still in flight, and keeps it on success", async () => {
    const { client, wrapper } = setup();
    let resolvePost!: (task: Task) => void;
    const post = new Promise<Task>((resolve) => {
      resolvePost = resolve;
    });
    vi.mocked(moveTask).mockReturnValueOnce(post);

    const { result } = renderHook(() => useMoveTask(), { wrapper });
    act(() => {
      result.current.mutate({ id: "t-1", status: "IN_REVIEW" });
    });
    // `onMutate` awaits the board-query cancel first, so the patch lands a
    // microtask after `mutate` — flush it while the POST is still open.
    await act(async () => {});

    // The network has said nothing yet — the board already has.
    expect(boardOf(client).TO_DO).toHaveLength(0);
    expect(boardOf(client).IN_REVIEW.map((t) => t.task_id)).toEqual(["t-1"]);
    expect(boardOf(client).IN_REVIEW[0].status).toBe("IN_REVIEW");
    expect(detailOf(client).status).toBe("IN_REVIEW");

    // The server agrees; the settled board still shows the move.
    resolvePost({ ...TASK, status: "IN_REVIEW" });
    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(boardOf(client).IN_REVIEW.map((t) => t.task_id)).toEqual(["t-1"]);
    expect(vi.mocked(moveTask)).toHaveBeenCalledWith("t-1", "IN_REVIEW");
  });

  it("rolls the card back when the POST fails", async () => {
    const { client, wrapper } = setup();
    // Held open, then failed: an immediate rejection would roll back in the
    // same microtask flush as the optimistic patch, leaving nothing to observe.
    let failPost!: (err: Error) => void;
    const post = new Promise<Task>((_resolve, reject) => {
      failPost = reject;
    });
    // Attach a no-op catch now: the rejection is for the mutation, and an
    // interval between `failPost` and the mutation's own handlers must not
    // read as an unhandled rejection.
    post.catch(() => {
      /* @silent:teardown */
    });
    vi.mocked(moveTask).mockReturnValueOnce(post);

    const { result } = renderHook(() => useMoveTask(), { wrapper });
    act(() => {
      result.current.mutate({ id: "t-1", status: "DONE" });
    });
    await act(async () => {});

    // Optimistic first: the card jumps before the failure is known.
    expect(boardOf(client).DONE.map((t) => t.task_id)).toEqual(["t-1"]);

    failPost(new Error("offline"));
    await vi.waitFor(() => expect(result.current.isError).toBe(true));
    expect(boardOf(client).TO_DO.map((t) => t.task_id)).toEqual(["t-1"]);
    expect(boardOf(client).DONE).toHaveLength(0);
    expect(detailOf(client).status).toBe("TO_DO");
  });

  it("leaves a cached board without the task, and a bare move, alone", async () => {
    // A board read under another audience may not hold the row at all: the
    // mutation must post anyway and touch nothing it cannot see.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const other = { ...TASK, task_id: "t-9", title: "Somebody else's task" };
    client.setQueryData(BOARD_KEY, {
      board: { TO_DO: [other], IN_PROGRESS: [], IN_REVIEW: [], DONE: [] },
      audience: "mine",
      audiences: ["mine"],
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    vi.mocked(moveTask).mockResolvedValueOnce({ ...TASK, status: "IN_REVIEW" });

    const { result } = renderHook(() => useMoveTask(), { wrapper });
    act(() => {
      result.current.mutate({ id: "t-1", status: "IN_REVIEW" });
    });
    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(boardOf(client).TO_DO.map((t) => t.task_id)).toEqual(["t-9"]);
    expect(boardOf(client).IN_REVIEW).toHaveLength(0);
    expect(vi.mocked(moveTask)).toHaveBeenCalledWith("t-1", "IN_REVIEW");
  });
});

/**
 * The reach a board was READ at has to survive the move (B-03), and it has to
 * do so without disturbing the optimistic machinery above.
 *
 * These two properties meet in one function and are easy to break in opposite
 * directions: threading the audience through can leave a trailing `undefined`
 * on every ordinary move, and keying the cache patch on one exact key can miss
 * the copy the open detail pane is rendering — because `useTask` keys on the
 * audience it read at, so the same task legitimately sits in the cache twice.
 */
describe("useMoveTask — the audience it was read at", () => {
  it("sends the reach with the move when the caller states one", async () => {
    const { wrapper } = setup();
    vi.mocked(moveTask).mockResolvedValueOnce({ ...TASK, status: "IN_REVIEW" });

    const { result } = renderHook(() => useMoveTask(), { wrapper });
    act(() => {
      result.current.mutate({ id: "t-1", status: "IN_REVIEW", audience: "team" });
    });
    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

    // A card shown on a Team board belongs to a population the caller's
    // default reach may not contain: dropping the audience would 404 a task
    // that is plainly on screen.
    expect(vi.mocked(moveTask)).toHaveBeenCalledWith("t-1", "IN_REVIEW", "team");
  });

  it("sends no audience argument at all when there is none to state", async () => {
    const { wrapper } = setup();
    vi.mocked(moveTask).mockResolvedValueOnce({ ...TASK, status: "IN_REVIEW" });

    const { result } = renderHook(() => useMoveTask(), { wrapper });
    act(() => {
      result.current.mutate({ id: "t-1", status: "IN_REVIEW" });
    });
    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Not `("t-1", "IN_REVIEW", undefined)`. A move from a screen with no wider
    // reach is the same request it has always been.
    expect(vi.mocked(moveTask).mock.calls[0]).toEqual(["t-1", "IN_REVIEW"]);
  });

  it("patches EVERY cached copy of the task, not one audience's", async () => {
    const { client, wrapper } = setup();
    // The same task, read at two reaches — exactly what happens when a Team
    // board hands its own reach to the detail pane it opens.
    const teamKey = ["workspace", "task", "t-1", "team"];
    client.setQueryData(teamKey, TASK);
    client.setQueryData(["workspace", "task", "t-1", "mine"], TASK);

    let resolvePost!: (task: Task) => void;
    vi.mocked(moveTask).mockReturnValueOnce(
      new Promise<Task>((resolve) => {
        resolvePost = resolve;
      }),
    );

    const { result } = renderHook(() => useMoveTask(), { wrapper });
    act(() => {
      result.current.mutate({ id: "t-1", status: "IN_REVIEW", audience: "team" });
    });
    await act(async () => {});

    // An exact-key patch would update one of these and leave the other showing
    // the old status until the settle — and the stale one is the copy the open
    // pane is most likely rendering.
    expect((client.getQueryData(teamKey) as Task).status).toBe("IN_REVIEW");
    expect((client.getQueryData(["workspace", "task", "t-1", "mine"]) as Task).status).toBe(
      "IN_REVIEW",
    );

    resolvePost({ ...TASK, status: "IN_REVIEW" });
    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("rolls every cached copy back when the server refuses", async () => {
    const { client, wrapper } = setup();
    const teamKey = ["workspace", "task", "t-1", "team"];
    client.setQueryData(teamKey, TASK);
    vi.mocked(moveTask).mockRejectedValueOnce(new Error("That task is blocked."));

    const { result } = renderHook(() => useMoveTask(), { wrapper });
    act(() => {
      result.current.mutate({ id: "t-1", status: "DONE", audience: "team" });
    });
    await vi.waitFor(() => expect(result.current.isError).toBe(true));

    // A refused move must not leave ANY cache claiming a state the database
    // does not hold — a blocked task that still reads DONE in one copy is a
    // lie that survives until the next refetch.
    expect((client.getQueryData(teamKey) as Task).status).toBe("TO_DO");
    expect(boardOf(client).TO_DO.map((t) => t.task_id)).toEqual(["t-1"]);
  });
});
