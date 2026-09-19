/**
 * The list row's contract — what these pin, and why each one is a defect
 * waiting to come back.
 *
 * 1. THE TITLE EARNS TWO LINES BEFORE IT IS CLAMPED. The class is on the span,
 *    and the clamp is a MEASUREMENT, so a title that fits on two lines earns
 *    no dots and one that does not does. Both halves are asserted, because the
 *    regression can go either way: dots on a short title is noise, no dots on
 *    a clamped one is a title a reader can never finish.
 *
 * 2. THE DOTS ARE A DOOR, NOT A MENU. Tapping them expands the row in place —
 *    the full title on the row, no dialog, no detail pane — and the same dots
 *    collapse it again. The open-task tap stays the title's own; a dots button
 *    that also opens the task (or is nested inside the title's button, which
 *    is invalid HTML) is a regression.
 *
 * 3. THE PILLS SHARE ONE WRAP ROW. Recurrence, priority and status — plus the
 *    Move menu — are children of ONE container, and that container takes the
 *    whole row below `md`. The pills are `white-space: nowrap` and cannot
 *    shrink; before they shared a row, a long recurrence rule on a 360px
 *    screen overflowed the title zone and landed on top of the priority and
 *    status pills. Structure is what is assertable here: same parent, and the
 *    `max-md:w-full` that makes the narrow row the one that wards.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { waitFor } from "@testing-library/react";

import { apiClientMock, renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());

import { TaskList } from "./task-list";
import type { Task } from "../api";

const LONG_TITLE =
  "Prepare the quarterly board deck for the September leadership review and follow up on the two open action items from the last meeting";

const ROW: Task = {
  task_id: "t-1",
  title: LONG_TITLE,
  description: null,
  status: "IN_REVIEW",
  priority: "HIGH",
  assigned_to: "u-2",
  assigned_to_name: "Amina O.",
  created_by: "u-1",
  created_by_name: "JBS Praxis",
  due_at: "2026-09-20T10:00:00.000Z",
  completed_at: null,
  is_personal: false,
  scope_id: null,
  reminder_minutes: null,
  remind_at: null,
  entity_type: null,
  entity_id: null,
  dossier_id: null,
  dossier_ref: null,
  dossier_client_name: null,
  milestone_instance_id: null,
  milestone_label: null,
  link_url: null,
  entity_label: null,
  has_link: false,
  subtask_count: 0,
  subtask_done_count: 0,
  created_at: "2026-09-17T08:00:00.000Z",
  updated_at: "2026-09-17T08:00:00.000Z",
  recurrence_rule: "FREQ=DAILY;UNTIL=20260920",
};

/**
 * A ResizeObserver a test can fire.
 *
 * `setup.ts` installs a NO-OP shim (jsdom has none at all), and a no-op can
 * never report a size change — the clamp would stay "false" forever and the
 * dots would never appear, which would make the whole file pass while proving
 * nothing. This one keeps its callback.
 */
class RecordingRO {
  static last: RecordingRO | null = null;
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    RecordingRO.last = this;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  fire() {
    this.cb([], this as unknown as ResizeObserver);
  }
}

beforeEach(() => {
  RecordingRO.last = null;
  vi.stubGlobal("ResizeObserver", RecordingRO);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderRow(row: Task = ROW) {
  const onOpen = vi.fn();
  const view = renderScreen(
    <TaskList audience="mine" selectedId={null} onOpen={onOpen} onCreate={() => {}} />,
    { routes: { "/workspace/tasks": [row] } },
  );
  const title = await screen.findByText(row.title);
  return { onOpen, title, ...view };
}

/** Tell the clamp measurement what a real browser would see. */
function reportClamped(title: Element, overflows = true) {
  Object.defineProperty(title, "scrollHeight", {
    configurable: true,
    value: overflows ? 60 : 40,
  });
  Object.defineProperty(title, "clientHeight", { configurable: true, value: 40 });
  act(() => RecordingRO.last?.fire());
}

describe("Task list — the row", () => {
  it("clamps a long title to two lines, and earns the dots", async () => {
    const { title } = await renderRow();
    expect(title).toHaveClass("line-clamp-2");

    reportClamped(title);
    const dots = await screen.findByRole("button", { name: "Show full title" });
    expect(dots).toHaveAttribute("aria-expanded", "false");
    expect(dots).toHaveAttribute("aria-controls", "task-list-title-t-1");
  });

  it("a title that fits on two lines earns no dots", async () => {
    const { title } = await renderRow({
      ...ROW,
      title: "Call the printer about the jam",
    });
    reportClamped(title, false);
    expect(screen.queryByRole("button", { name: "Show full title" })).toBeNull();
  });

  it("the dots expand the row in place, and the same dots collapse it", async () => {
    const user = userEvent.setup();
    const { title } = await renderRow();
    reportClamped(title);
    const dots = await screen.findByRole("button", { name: "Show full title" });

    await user.click(dots);
    expect(title).not.toHaveClass("line-clamp-2");
    expect(dots).toHaveAttribute("aria-expanded", "true");
    expect(dots).toHaveAttribute("aria-label", "Collapse title");
    // IN PLACE: the full title is on the row, and no pane or sheet opened.
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(dots);
    expect(title).toHaveClass("line-clamp-2");
    expect(dots).toHaveAttribute("aria-expanded", "false");
  });

  it("tapping the row still opens the task; the dots do not steal that", async () => {
    const user = userEvent.setup();
    const { onOpen, title } = await renderRow();
    reportClamped(title);

    await user.click(title);
    expect(onOpen).toHaveBeenCalledWith("t-1");

    const dots = screen.getByRole("button", { name: "Show full title" });
    await user.click(dots);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("recurrence, priority and status share one wrap row, full-width on a phone", async () => {
    await renderRow();

    const list = screen.getByRole("list");
    const recurrence = await within(list).findByText(/Repeats every day until/);
    const priority = within(list).getByText("High");
    const status = within(list).getByText("In review");
    const move = within(list).getByRole("button", { name: /^Move “Prepare the quarterly/ });

    // ONE container — not three siblings negotiating a 360px width.
    expect(recurrence.parentElement).toBe(priority.parentElement);
    expect(recurrence.parentElement).toBe(status.parentElement);
    expect(recurrence.parentElement).toBe(move.parentElement);
    // …and that container is the one that takes the whole row below `md`.
    expect(recurrence.parentElement).toHaveClass("flex", "flex-wrap", "max-md:w-full");
  });

  it("the Move menu still moves", async () => {
    let statusHits = 0;
    const routes: Record<string, unknown> = {
      "/workspace/tasks": [ROW],
    };
    // A counting fixture: the harness's longest-prefix match serves this to
    // the POST the move makes, so a hit is a request on the wire.
    Object.defineProperty(routes, "/workspace/tasks/t-1/status", {
      enumerable: true,
      configurable: true,
      get: () => {
        statusHits += 1;
        return { ...ROW, status: "IN_PROGRESS" };
      },
    });

    const user = userEvent.setup();
    renderScreen(
      <TaskList audience="mine" selectedId={null} onOpen={vi.fn()} onCreate={() => {}} />,
      { routes },
    );

    const move = await screen.findByRole("button", { name: /^Move “Prepare the quarterly/ });
    await user.click(move);
    await user.click(await screen.findByRole("menuitem", { name: "In progress" }));

    await waitFor(() => expect(statusHits).toBe(1));
  });

  it("is clean for a screen reader with the dots on the row", async () => {
    const { container, title } = await renderRow();
    reportClamped(title);
    await screen.findByRole("button", { name: "Show full title" });

    expect(await axe(container)).toHaveNoViolations();
  });
});
