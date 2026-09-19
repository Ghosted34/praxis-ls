/**
 * The task detail — hierarchy, dependencies, collaboration, and the ONE status
 * path.
 *
 * WHAT EACH GROUP PINS, and why it is a defect waiting to come back:
 *
 * 1. ONE TRANSITION PATH (B-04). Five gestures can move a task: a board drag,
 *    the Move menu, the keyboard, this picker, and the edit dialog. Before PR2
 *    the last two sent a generic PATCH, so the same user action produced
 *    `task.updated` from one place and `task.status_changed` from another —
 *    one event, two histories, and an audit trail that could not answer when a
 *    task moved. This asserts the detail's picker hits the TRANSITION endpoint,
 *    which is the only assertion that can catch the regression, because both
 *    versions look identical on screen.
 *
 * 2. THE EFFECTIVE AUDIENCE TRAVELS (B-03). A card opened from a Team board
 *    must be READ at team reach. Without it the detail asks at the caller's
 *    default and a task the board just showed 404s on click — the bug reads as
 *    a broken link and is unreproducible for anybody whose default is wider.
 *
 * 3. BLOCKED IS SAID BEFORE IT IS DISCOVERED. A waiting task is not "in
 *    progress with a note", and the reason must be visible above the fold or
 *    somebody starts it and finds out in an hour.
 *
 * 4. AN UNAUTHORISED PREREQUISITE IS SHOWN, REDACTED — never dropped. A task
 *    marked Blocked above an empty list reads as a bug; a title the reader is
 *    not cleared for is a leak. Both are wrong; the redacted row is the answer.
 *
 * 5. CANCELLED STILL BLOCKS, and says so. The tempting simplification silently
 *    lets unresolved work through.
 *
 * 6. THE ROLL-UP COUNTS WHAT IT CANNOT SHOW. A denominator that quietly dropped
 *    invisible children would read "2 of 2" on a parent with three.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import { renderScreen, fixtures } from "@/test/screen-harness";
import * as apiClient from "@/lib/api-client";

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  const { vi } = await import("vitest");
  const mod = await apiClientMock();
  return { ...mod, tenant: vi.fn(mod.tenant), api: vi.fn(mod.api) };
});
vi.mock("@/app/auth/auth-context", async () => {
  const { authContextMock } = await import("@/test/screen-harness");
  return authContextMock();
});

import { TaskPanel } from "./task-panel";

const BASE = {
  task_id: "t-1",
  title: "File the customs declaration",
  description: "Before the vessel berths.",
  status: "IN_PROGRESS",
  priority: "HIGH",
  assigned_to: "u-2",
  assigned_to_name: "JBS Praxis",
  created_by: "u-2",
  created_by_name: "JBS Praxis",
  due_at: "2026-09-20T16:00:00.000Z",
  completed_at: null,
  is_personal: false,
  scope_id: null,
  reminder_minutes: 15,
  remind_at: "2026-09-20T15:45:00.000Z",
  entity_type: null,
  entity_id: null,
  link_url: null,
  entity_label: null,
  has_link: false,
  subtask_count: 0,
  subtask_done_count: 0,
  created_at: "2026-09-10T08:00:00.000Z",
  updated_at: "2026-09-10T08:00:00.000Z",
  subtasks: [],
  watchers: [],
  parent_task_id: null,
  parent: null,
  children: [],
  hidden_child_count: 0,
  child_count: 0,
  child_done_count: 0,
  rollup: null,
  dependencies: [],
  blocking_count: 0,
  is_blocked: false,
  blocked_since: null,
};

const task = (over: Record<string, unknown> = {}) => ({ ...BASE, ...over });

const show = (data: Record<string, unknown>, audience?: "mine" | "team" | "all") =>
  renderScreen(<TaskPanel taskId="t-1" onClose={() => {}} audience={audience} />, {
    path: "/workspace/tasks?task=t-1",
    routes: { "/workspace/tasks/t-1": data, "/workspace/tasks": [] },
  });

type Call = [string, { method?: string; body?: Record<string, unknown> }?];
const calls = () => (apiClient.tenant as unknown as { mock: { calls: Call[] } }).mock.calls;

/** Every path the panel asked for, in order. */
const paths = () => calls().map((c) => String(c[0]));

/** The body of the first request to a path matching `re`. */
const bodyOf = (re: RegExp) => calls().find((c) => re.test(String(c[0])))?.[1]?.body ?? null;

type User = ReturnType<typeof userEvent.setup>;

/**
 * Choose a status through the real control. The picker is the design system's
 * listbox (Radix `Select`), so the gesture is open-then-pick — `selectOptions`
 * belongs to the native `<select>` this control stopped being. Going through
 * the combobox is also what proves the picker is reachable and operable at
 * all: a listbox that cannot be opened fails here, not in production.
 */
async function pickStatus(user: User, label: string) {
  await user.click(await screen.findByRole("combobox", { name: "Status" }));
  await user.click(await screen.findByRole("option", { name: label }));
}

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.current = {};
});

describe("one status path", () => {
  it("moves the task through the transition endpoint, not a generic edit", async () => {
    const user = userEvent.setup();
    show(task());
    await pickStatus(user, "Done");

    await waitFor(() => {
      // `/status`, and nothing that looks like a bare PATCH of the task. This
      // is the whole of B-04: the same request as the board's drag.
      expect(paths().some((p) => p.endsWith("/tasks/t-1/status"))).toBe(true);
    });
  });

  it("carries the reach the list was read at into the move", async () => {
    const user = userEvent.setup();
    show(task(), "team");
    await pickStatus(user, "Done");
    // In the BODY, beside the status: a transition is a POST, and the reach it
    // was requested at belongs with the request rather than in the URL.
    await waitFor(() =>
      expect(bodyOf(/\/tasks\/t-1\/status$/)).toMatchObject({ status: "DONE", audience: "team" }),
    );
  });

  it("leaves the control where it was when the server refuses the move", async () => {
    const user = userEvent.setup();
    renderScreen(<TaskPanel taskId="t-1" onClose={() => {}} />, {
      path: "/workspace/tasks?task=t-1",
      routes: {
        "/workspace/tasks/t-1": task({ is_blocked: true, blocking_count: 1 }),
        "/workspace/tasks": [],
      },
    });
    // The closed picker reads the SERVER's task from the moment it renders —
    // never a placeholder or a local guess.
    const trigger = await screen.findByRole("combobox", { name: "Status" });
    await waitFor(() => expect(trigger).toHaveTextContent("In progress"));

    await pickStatus(user, "Done");
    // The value is the SERVER's task, never a local optimistic guess, so a
    // refused transition cannot leave the screen claiming a state the database
    // does not hold.
    await waitFor(() => expect(paths().some((p) => p.endsWith("/tasks/t-1/status"))).toBe(true));
    expect(trigger).toHaveTextContent("In progress");
  });
});

describe("the effective audience reaches the detail read", () => {
  it("asks for the task at the reach the board showed it at", async () => {
    show(task(), "team");
    await screen.findByText("File the customs declaration");
    expect(paths().some((p) => /\/workspace\/tasks\/t-1\?.*audience=team/.test(p))).toBe(true);
  });

  it("sends nothing when the caller has no wider reach to ask for", async () => {
    show(task());
    await screen.findByText("File the customs declaration");
    expect(paths().some((p) => /\/workspace\/tasks\/t-1(\?|$)/.test(p) && !/audience=/.test(p))).toBe(
      true,
    );
  });
});

describe("blocked work says so, first", () => {
  it("names the wait above the description rather than inside it", async () => {
    show(
      task({
        is_blocked: true,
        blocking_count: 2,
        dependencies: [
          {
            task_dependency_id: "d-1",
            depends_on_task_id: "t-2",
            depends_on_title: "Receive the bill of lading",
            depends_on_status: "TO_DO",
            depends_on_assigned_to_name: "Ada",
            depends_on_due_at: null,
            is_visible: true,
            is_resolved: false,
            is_cancelled: false,
            is_overridden: false,
            overridden_by_name: null,
            override_reason: null,
            link_url: "/workspace/tasks?task=t-2",
            created_at: "2026-09-11T08:00:00.000Z",
          },
        ],
      }),
    );
    expect(await screen.findByText(/Waiting on 2 tasks/)).toBeInTheDocument();
    expect(screen.getByText("Receive the bill of lading")).toBeInTheDocument();
  });

  it("says the task is not waiting on anything when it is not", async () => {
    show(task());
    // An empty section with no words in it reads as a section that failed to
    // load, and "nothing is blocking this" is a useful thing to have confirmed.
    expect(await screen.findByText(/Nothing is holding this task up/)).toBeInTheDocument();
  });
});

describe("a prerequisite the reader may not see", () => {
  const hidden = task({
    is_blocked: true,
    blocking_count: 1,
    dependencies: [
      {
        task_dependency_id: "d-9",
        depends_on_task_id: null,
        depends_on_title: "A task you cannot view",
        depends_on_status: null,
        depends_on_assigned_to_name: null,
        depends_on_due_at: null,
        is_visible: false,
        is_resolved: false,
        is_cancelled: false,
        is_overridden: false,
        overridden_by_name: null,
        override_reason: null,
        link_url: null,
        created_at: "2026-09-11T08:00:00.000Z",
      },
    ],
  });

  it("shows the row, so a blocked task is not blocked by an empty list", async () => {
    show(hidden);
    expect(await screen.findByText("A task you cannot view")).toBeInTheDocument();
  });

  it("gives it nothing to click, because there is nothing it may open", async () => {
    show(hidden);
    const row = await screen.findByText("A task you cannot view");
    expect(row.tagName).not.toBe("BUTTON");
    expect(row.closest("a")).toBeNull();
  });
});

describe("a cancelled prerequisite", () => {
  const cancelled = task({
    is_blocked: true,
    blocking_count: 1,
    dependencies: [
      {
        task_dependency_id: "d-2",
        depends_on_task_id: "t-3",
        depends_on_title: "Book the survey",
        depends_on_status: "CANCELLED",
        depends_on_assigned_to_name: "Ada",
        depends_on_due_at: null,
        is_visible: true,
        is_resolved: false,
        is_cancelled: true,
        is_overridden: false,
        overridden_by_name: null,
        override_reason: null,
        link_url: "/workspace/tasks?task=t-3",
        created_at: "2026-09-11T08:00:00.000Z",
      },
    ],
  });

  it("says out loud that calling it off did not unblock anything", async () => {
    show(cancelled);
    expect(await screen.findByText(/Cancelled — still blocking/)).toBeInTheDocument();
  });

  it("offers the override as a deliberate, attributable act", async () => {
    show(cancelled);
    // Not a silent inference — somebody's name ends up on the decision.
    expect(await screen.findByRole("button", { name: "Override" })).toBeInTheDocument();
  });

  it("records who overrode it once somebody has", async () => {
    show(
      task({
        dependencies: [
          {
            ...(cancelled.dependencies as Record<string, unknown>[])[0],
            is_overridden: true,
            overridden_by_name: "JBS Praxis",
            override_reason: "Survey no longer required",
          },
        ],
      }),
    );
    expect(await screen.findByText(/Overridden by JBS Praxis/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Withdraw override/ })).toBeInTheDocument();
  });
});

describe("children and the roll-up", () => {
  const parent = task({
    children: [
      {
        task_id: "c-1",
        title: "Collect the packing list",
        status: "DONE",
        assigned_to_name: "Ada",
        due_at: null,
      },
      {
        task_id: "c-2",
        title: "Pay the duty",
        status: "TO_DO",
        assigned_to_name: null,
        due_at: "2026-09-19T16:00:00.000Z",
      },
    ],
    hidden_child_count: 1,
    rollup: {
      child_count: 3,
      child_done_count: 1,
      child_cancelled_count: 0,
      step_count: 0,
      step_done_count: 0,
      progress_done: 1,
      progress_total: 3,
      progress_ratio: 1 / 3,
    },
  });

  it("counts children the reader cannot open, and says that it did", async () => {
    show(parent);
    expect(await screen.findByText("1/3")).toBeInTheDocument();
    // The alternative — a denominator of 2 — is a lie with a number on it.
    expect(screen.getByText(/1 more child task is not yours to view/)).toBeInTheDocument();
  });

  it("names each child's own owner, because that is what a child is for", async () => {
    show(parent);
    expect(await screen.findByText("Collect the packing list")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
    // An unassigned child is a sentence, not a blank.
    expect(screen.getByText("Nobody yet")).toBeInTheDocument();
  });

  it("adds a child from one row, without opening a form", async () => {
    const user = userEvent.setup();
    show(parent);
    const field = await screen.findByLabelText("New child task");
    await user.type(field, "Lodge the manifest{Enter}");
    await waitFor(() =>
      expect(paths().some((p) => p.includes("/tasks/t-1/children"))).toBe(true),
    );
  });

  it("keeps the quick-add row focused for the next child", async () => {
    const user = userEvent.setup();
    show(parent);
    const field = (await screen.findByLabelText("New child task")) as HTMLInputElement;
    await user.type(field, "Lodge the manifest{Enter}");
    // Splitting a file's work is a burst; a form that closes after each one
    // turns six children into six open-fill-save cycles and the sixth is never
    // written.
    await waitFor(() => expect(field.value).toBe(""));
    expect(field).toHaveFocus();
  });

  it("offers no child section on a task that is already a child", async () => {
    show(task({ parent_task_id: "t-0", parent: { task_id: "t-0", title: "Clear the shipment", link_url: "/workspace/tasks?task=t-0" } }));
    await screen.findByText(/Clear the shipment/);
    // One level of nesting: a tree deeper than two is a project, which is a
    // different product.
    expect(screen.queryByLabelText("New child task")).not.toBeInTheDocument();
  });

  it("names a parent the reader cannot open, rather than looking orphaned", async () => {
    show(task({ parent_task_id: "t-0", parent: { task_id: null, title: "A task you cannot view", link_url: null } }));
    const parentName = await screen.findByText("A task you cannot view");
    expect(parentName.closest("button")).toBeNull();
  });
});

describe("watchers and pings", () => {
  const watched = task({
    watchers: [
      { user_id: "u-3", full_name: "Ada Lovelace", email: "ada@example.test" },
    ],
  });

  it("lists who is following and lets them be removed", async () => {
    show(watched);
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stop watching/ })).toBeInTheDocument();
  });

  it("says nobody is following rather than rendering an empty list", async () => {
    show(task());
    expect(await screen.findByText(/Nobody else is following this task/)).toBeInTheDocument();
  });

  it("states who a ping can reach before it is sent", async () => {
    const user = userEvent.setup();
    show(watched);
    await user.click(await screen.findByRole("button", { name: /Ping everyone on this task/ }));
    // A ping is not a messaging channel: it reaches only people already on the
    // task, and saying so prevents it being used as one.
    expect(
      screen.getByText(/never to you, and never to anybody who is not already on the task/i),
    ).toBeInTheDocument();
  });

  it("sends the ping through the task's own endpoint", async () => {
    const user = userEvent.setup();
    show(watched);
    await user.click(await screen.findByRole("button", { name: /Ping everyone on this task/ }));
    await user.type(screen.getByLabelText("What to say"), "Any news?");
    await user.click(screen.getByRole("button", { name: "Send the ping" }));
    await waitFor(() => expect(paths().some((p) => p.includes("/tasks/t-1/ping"))).toBe(true));
  });
});

describe("accessibility", () => {
  it("has no axe violations with every section populated", async () => {
    const { container } = show(
      task({
        is_blocked: true,
        blocking_count: 1,
        watchers: [{ user_id: "u-3", full_name: "Ada Lovelace", email: "ada@example.test" }],
        children: [{ task_id: "c-1", title: "Collect the packing list", status: "DONE", assigned_to_name: "Ada", due_at: null }],
        rollup: {
          child_count: 1, child_done_count: 1, child_cancelled_count: 0,
          step_count: 0, step_done_count: 0,
          progress_done: 1, progress_total: 1, progress_ratio: 1,
        },
        dependencies: [
          {
            task_dependency_id: "d-1",
            depends_on_task_id: "t-2",
            depends_on_title: "Receive the bill of lading",
            depends_on_status: "TO_DO",
            depends_on_assigned_to_name: "Ada",
            depends_on_due_at: null,
            is_visible: true,
            is_resolved: false,
            is_cancelled: false,
            is_overridden: false,
            overridden_by_name: null,
            override_reason: null,
            link_url: "/workspace/tasks?task=t-2",
            created_at: "2026-09-11T08:00:00.000Z",
          },
        ],
      }),
    );
    await screen.findByText("File the customs declaration");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("gives every new section a name a screen reader can navigate to", async () => {
    show(task());
    await screen.findByText("File the customs declaration");
    for (const name of ["Waiting on", "Watching", "Child tasks"]) {
      const section = screen.getByRole("region", { name }) ?? null;
      expect(section ?? screen.getByLabelText(name)).toBeTruthy();
    }
  });
});
