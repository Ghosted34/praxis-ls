/**
 * The board's master-detail contract — what these pin, and why each one is a
 * defect waiting to come back.
 *
 * 1. THE DETAIL IS IN THE LAYOUT, NOT OVER IT. The sheet that used to open on
 *    desktop was a `<Dialog>` inside a `<div className="xl:hidden">`, which
 *    hides nothing: Radix renders it through a portal into `<body>`, so the
 *    wrapper is never an ancestor of anything visible. The card's detail
 *    opened as a full-height drawer over the board at EVERY width, next to the
 *    reserved column it was supposed to fill. `queryByRole("dialog")` after a
 *    card is clicked is that regression, and it fails the moment anybody puts
 *    the sheet back into the wide branch.
 *
 * 2. THE CARD IS THE TARGET. Clicking the owner's name — a child of the card
 *    that is not the title — has to open the task, because "click the card"
 *    is what the board promises. Asserted through a child rather than through
 *    the title so a card that only responds on its title line fails here.
 *
 * 3. THE PANE IS NOT RESERVED FOR NOTHING. With nothing open there is no
 *    detail column and no "Select a card…" placeholder: the board has the
 *    width. `<aside>` has role `complementary`, so its absence is assertable.
 *
 * 4. THE PHONE STILL GETS THE SHEET. `useIsWide` answers TRUE when
 *    `matchMedia` is absent — jsdom's case, and the first frame in production —
 *    so the wide branch is the default here and the phone branch has to be
 *    asked for explicitly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { TasksPage } from "./tasks-page";

const TASK = {
  task_id: "t-1",
  title: "Hold the meeting with Smart LS",
  description: "Daily meetings from 10 till 1 PM (Monday to Saturday).",
  status: "IN_PROGRESS",
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
  subtask_count: 1,
  subtask_done_count: 0,
  created_at: "2026-09-17T08:00:00.000Z",
  updated_at: "2026-09-17T08:00:00.000Z",
  subtasks: [
    {
      task_subtask_id: "s-1",
      task_id: "t-1",
      title: "Review changes made in Monitor",
      is_done: false,
      display_order: 1,
      due_at: null,
      completed_at: null,
      created_at: "2026-09-17T08:00:00.000Z",
    },
  ],
  watchers: [],
};

const ROUTES = {
  "/workspace/tasks/board": {
    board: { TO_DO: [], IN_PROGRESS: [TASK], IN_REVIEW: [], DONE: [] },
    audience: "mine",
    audiences: ["mine"],
  },
  "/workspace/tasks/t-1": TASK,
};

/** The card's own button, whose name starts with the title. Anchored so it does
 *  not also match the grip (“Drag …”) or the Move menu (“Move …”). */
const CARD = /^Hold the meeting with Smart LS/;

describe("Tasks — the open task", () => {
  it("opens beside the board rather than over it", async () => {
    const user = userEvent.setup();
    const { container } = renderScreen(<TasksPage />, { routes: ROUTES });

    await user.click(await screen.findByRole("button", { name: CARD }));

    // The detail is on the page, in the column beside the board…
    expect(
      await screen.findByRole("heading", { level: 2, name: TASK.title }),
    ).toBeInTheDocument();
    // …and it is NOT a dialog: no scrim, no focus trap, nothing covering the
    // board the reader is working on.
    expect(screen.queryByRole("dialog")).toBeNull();
    // The board is still there and still operable underneath it.
    expect(
      screen.getByRole("button", { name: /^Move “Hold the meeting/ }),
    ).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });

  it("opens from anywhere on the card, not only from the title", async () => {
    const user = userEvent.setup();
    renderScreen(<TasksPage />, { routes: ROUTES });

    // The owner's name is a child of the card. Clicking it is clicking the
    // card, because the whole card is the one button.
    await user.click(await screen.findByText("JBS Praxis"));

    expect(
      await screen.findByRole("heading", { level: 2, name: TASK.title }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not open the task from the drag grip", async () => {
    const user = userEvent.setup();
    renderScreen(<TasksPage />, { routes: ROUTES });

    // The grip sits ON the title strip and is a sibling of the card's button —
    // not an ancestor of it. That is what keeps a drag from ending in a click
    // that opens the task: the pointerup lands on the grip, whose only listener
    // is dnd-kit's.
    await user.click(await screen.findByRole("button", { name: /^Drag “Hold the meeting/ }));

    expect(screen.queryByRole("heading", { level: 2, name: TASK.title })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("spends no column on a placeholder while nothing is open", async () => {
    renderScreen(<TasksPage />, { routes: ROUTES });

    await screen.findByRole("button", { name: CARD });
    expect(screen.queryByText(/Select a card/)).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("opens a ?task= deep link in the pane, and marks the card", async () => {
    renderScreen(<TasksPage />, { routes: ROUTES, path: "/workspace/tasks?task=t-1" });

    expect(
      await screen.findByRole("heading", { level: 2, name: TASK.title }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    // The board's half of the bond: the pane's task is the marked card.
    expect(await screen.findByRole("button", { name: CARD })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  describe("on a phone", () => {
    beforeEach(() => {
      vi.stubGlobal(
        "matchMedia",
        (query: string) =>
          ({
            matches: false,
            media: query,
            addEventListener: () => {},
            removeEventListener: () => {},
          }) as unknown as MediaQueryList,
      );
    });
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("opens the sheet instead of the pane", async () => {
      const user = userEvent.setup();
      renderScreen(<TasksPage />, { routes: ROUTES });

      await user.click(await screen.findByRole("button", { name: CARD }));

      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      // One body, one shell: the pane is not mounted behind the sheet.
      expect(screen.queryByRole("complementary")).toBeNull();
    });
  });
});
