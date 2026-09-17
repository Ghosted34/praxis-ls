/**
 * The board's touch gesture, end to end through the real sensors.
 *
 * WHY THIS FILE EXISTS. `task-board.tsx` now carries three drag models at once —
 * a finger holds a card to pick it up, a mouse grabs the grip, a keyboard takes
 * the grip with Space — and the FIRST of those is the one no existing test could
 * see: it is started by a timer, cancelled by a scroll, and distinguished from a
 * tap by nothing except how long the finger rested. A unit test that stubbed
 * dnd-kit would prove that the props were wired and nothing about the gesture.
 * So these tests drive REAL `TouchEvent`s and REAL `MouseEvent`s into the real
 * `DndContext`, and assert what the network was asked to do at the end.
 *
 * The four claims, in the order a reader would check them:
 *
 * 1. A HOLD, THEN A MOVE, MOVES THE TASK. Hold a card for `LONG_PRESS_MS`, drag
 *    it over another column, let go: the board posts the move. This is the
 *    gesture the user asked for — "click and hold, then drag it into another
 *    stage" — and it is asserted on the request, not on a callback we control.
 *
 * 2. A TAP IS STILL A TAP. No hold, no drag; the card opens. The delay is what
 *    keeps a tap and a drag from being the same event, so a regression that
 *    dropped the delay (or made the card `touch-action: none`) fails here.
 *
 * 3. A FINGER THAT MOVES FIRST IS SCROLLING. Move past `tolerance` before the
 *    hold completes and the pending drag is abandoned — nothing moves, and the
 *    board scrolled, which is the whole reason the gesture is a dwell and not a
 *    claim on touchstart.
 *
 * 4. TWO FINGERS ARE NEVER A DRAG, and a MOUSE DRAGS FROM THE GRIP. The first
 *    keeps a pinch-zoom from picking a card up; the second pins the desktop
 *    path that the arrival of the long press could otherwise have broken.
 *
 * GEOMETRY. dnd-kit resolves a drop by intersecting rects, and jsdom reports
 * every rect as 0×0, so the board is given a layout: four columns side by side
 * and a card inside the first. The numbers below are that layout, not
 * decoration — the drag's coordinates are chosen so that the card lands in a
 * column by both readings dnd-kit might take of the moving rect (the card's own
 * measured rect, translated, and the bare pointer position).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";

import { renderScreen } from "@/test/screen-harness";
import * as apiClient from "@/lib/api-client";

/**
 * The api-client fake, wrapped in spies so the drag can be asserted where it
 * matters: the request the board actually made. Everything else about the
 * screen — the hooks, the sensors, the mutation — stays real.
 */
vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  const { vi } = await import("vitest");
  const mod = await apiClientMock();
  return { ...mod, tenant: vi.fn(mod.tenant), api: vi.fn(mod.api) };
});

import { BOARD_COLUMNS } from "../api";
import type { BoardColumn, Task } from "../api";
import { COLUMN_LABEL } from "../labels";
import { LONG_PRESS_MS, TaskBoard } from "./task-board";

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

const BOARD = {
  TO_DO: [TASK],
  IN_PROGRESS: [],
  IN_REVIEW: [],
  DONE: [],
};

/** The card's own button — anchored so it cannot match the grip or Move menu. */
const CARD = /^Hold the meeting with Smart LS/;
const GRIP = /^Drag “Hold the meeting with Smart LS”/;

/**
 * How long a finger is held. Comfortably past the dwell, so the test fails on
 * a missing gesture rather than on a millisecond of timer jitter.
 */
const HOLD = LONG_PRESS_MS + 100;

// ── the board's geometry ────────────────────────────────────────────────────

type Rect = { left: number; top: number; right: number; bottom: number };

/** Four columns, 280 wide with a 20px gutter, stacked nowhere — side by side. */
const COLUMN_WIDTH = 280;
const COLUMN_GAP = 20;
const COLUMN_TOP = 200;
const COLUMN_BOTTOM = 700;

const column = (i: number): Rect => ({
  left: i * (COLUMN_WIDTH + COLUMN_GAP),
  top: COLUMN_TOP,
  right: i * (COLUMN_WIDTH + COLUMN_GAP) + COLUMN_WIDTH,
  bottom: COLUMN_BOTTOM,
});

/** The card sits in the first column, clear of every edge. */
const CARD_RECT: Rect = { left: 10, top: 300, right: 270, bottom: 380 };

/** Where the finger lands: the card's middle. */
const FROM = { x: (CARD_RECT.left + CARD_RECT.right) / 2, y: (CARD_RECT.top + CARD_RECT.bottom) / 2 };

/** Where it is dragged to: the middle of the "In review" column. */
const TO = { x: (column(2).left + column(2).right) / 2, y: FROM.y };

const ZERO: Rect = { left: 0, top: 0, right: 0, bottom: 0 };

let realGetBoundingClientRect: typeof Element.prototype.getBoundingClientRect;

/**
 * The rect of whatever dnd-kit asks for, computed from the element itself
 * rather than from a table filled in before the test: measuring happens inside
 * effects (and frames) that a table would have to guess the timing of.
 */
function rectFor(element: Element): Rect {
  if (element.tagName === "SECTION") {
    const label = element.getAttribute("aria-label") ?? "";
    const i = BOARD_COLUMNS.findIndex((c) => label.startsWith(COLUMN_LABEL[c]));
    if (i >= 0) return column(i);
  }
  // The card, and the copy of it the board draws under the finger.
  if (element.tagName === "ARTICLE" || element.parentElement?.tagName === "ARTICLE") return CARD_RECT;
  return ZERO;
}

// ── events ──────────────────────────────────────────────────────────────────

type TouchPoint = { x: number; y: number };

/**
 * A real `TouchEvent`, because dnd-kit's sensors branch on `instanceof
 * TouchEvent` before they read coordinates. jsdom has the interface but no
 * `Touch` constructor, so the points are plain objects — which jsdom's
 * conversion accepts, and which is what it does for `touches` anyway.
 */
function touch(type: "touchstart" | "touchmove" | "touchend" | "touchcancel", target: Element, points: TouchPoint[]) {
  const list = points.map((p, i) => ({ identifier: i + 1, target, clientX: p.x, clientY: p.y }));
  const lifted = type === "touchend" || type === "touchcancel";
  return new TouchEvent(type, {
    touches: lifted ? [] : list,
    targetTouches: lifted ? [] : list,
    changedTouches: list,
    bubbles: true,
    cancelable: true,
  } as unknown as TouchEventInit);
}

function mouse(type: "mousedown" | "mousemove" | "mouseup", point: TouchPoint, buttons = 1) {
  return new MouseEvent(type, {
    clientX: point.x,
    clientY: point.y,
    button: 0,
    buttons,
    bubbles: true,
    cancelable: true,
  });
}

/** Let the dwell elapse, and with it any frames dnd-kit queued behind it. */
async function waitForHold() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(HOLD);
  });
}

describe("TaskBoard — moving a card", () => {
  const onOpen = vi.fn();
  const onCreate = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    realGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const r = rectFor(this);
      return { ...r, width: r.right - r.left, height: r.bottom - r.top, x: r.left, y: r.top } as DOMRect;
    };
  });

  afterEach(async () => {
    /**
     * LET dnd-kit FINISH CLEANING UP BEFORE THE NEXT TEST.
     *
     * Once a drag activates, dnd-kit stops the click that follows a drop — a
     * real requirement, or letting go of a card would also open it — and it
     * keeps that listener on the document for 50ms after the drag ends, then
     * removes it on a timer. A test that ends mid-drag leaves the stopper
     * behind on the shared jsdom document, where it swallows the NEXT test's
     * clicks. Flushing the timer here is the difference between testing the
     * board and testing the debris of the last test.
     */
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    Element.prototype.getBoundingClientRect = realGetBoundingClientRect;
    vi.useRealTimers();
  });

  function showBoard(selectedId: string | null = null) {
    return renderScreen(
      <TaskBoard board={BOARD} loading={false} selectedId={selectedId} onOpen={onOpen} onCreate={onCreate} />,
    );
  }

  /** The element the finger lands on: the card's touch surface. */
  function touchSurface() {
    const card = screen.getByRole("button", { name: CARD });
    const surface = card.parentElement;
    if (!surface) throw new Error("the card's button has no touch surface around it");
    return surface;
  }

  it("moves the task between stages when a card is held and dragged", async () => {
    showBoard();
    const surface = touchSurface();

    fireEvent(surface, touch("touchstart", surface, [FROM]));
    await waitForHold();

    // The card is picked up: the board draws a second copy of it, under the
    // finger, and dims the one that stayed behind.
    fireEvent(surface, touch("touchmove", surface, [{ x: FROM.x + 40, y: FROM.y }]));
    const copies = screen.getAllByText(TASK.title);
    expect(copies).toHaveLength(2);

    fireEvent(surface, touch("touchmove", surface, [TO]));
    fireEvent(surface, touch("touchend", surface, [TO]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // …and the stage it was dropped on is the stage the server is told about.
    expect(vi.mocked(apiClient.tenant)).toHaveBeenCalledWith("/workspace/tasks/t-1/status", {
      method: "POST",
      body: { status: "IN_REVIEW" },
    });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens the card, and moves nothing, when a card is tapped", async () => {
    showBoard();
    const surface = touchSurface();

    // A tap: down and up inside the dwell, which is what a finger does when it
    // means "open this", and then the click the browser would send after it.
    fireEvent(surface, touch("touchstart", surface, [FROM]));
    fireEvent(surface, touch("touchend", surface, [FROM]));
    await waitForHold();
    fireEvent.click(screen.getByRole("button", { name: CARD }));

    expect(onOpen).toHaveBeenCalledWith("t-1");
    expect(vi.mocked(apiClient.tenant)).not.toHaveBeenCalled();
    // Nothing was picked up: one copy of the card, not two.
    expect(screen.getAllByText(TASK.title)).toHaveLength(1);
  });

  it("scrolls instead of dragging when the finger moves first", async () => {
    showBoard();
    const surface = touchSurface();

    fireEvent(surface, touch("touchstart", surface, [FROM]));
    // Down the board, before the dwell is up: a flick, not a drag.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LONG_PRESS_MS / 4);
    });
    fireEvent(surface, touch("touchmove", surface, [{ x: FROM.x, y: FROM.y + 120 }]));
    fireEvent(surface, touch("touchend", surface, [{ x: FROM.x, y: FROM.y + 120 }]));
    await waitForHold();

    expect(screen.getAllByText(TASK.title)).toHaveLength(1);
    expect(vi.mocked(apiClient.tenant)).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("does not drag on a two-finger touch", async () => {
    showBoard();
    const surface = touchSurface();

    // A pinch, a two-finger scroll, a palm: none of them is a request to move
    // this card, and TouchSensor refuses the moment there is more than one
    // point of contact.
    fireEvent(surface, touch("touchstart", surface, [FROM, { x: FROM.x + 60, y: FROM.y + 60 }]));
    await waitForHold();
    fireEvent(surface, touch("touchmove", surface, [TO, { x: TO.x + 60, y: TO.y + 60 }]));
    fireEvent(surface, touch("touchend", surface, []));
    await waitForHold();

    expect(screen.getAllByText(TASK.title)).toHaveLength(1);
    expect(vi.mocked(apiClient.tenant)).not.toHaveBeenCalled();
  });

  it("moves the task when the mouse drags the grip", async () => {
    showBoard();
    const grip = screen.getByRole("button", { name: GRIP });

    fireEvent(grip, mouse("mousedown", FROM));
    // The first movement only arms the drag — 8px is the threshold that keeps a
    // click from being a drag — and the second is the drag itself.
    fireEvent(grip, mouse("mousemove", { x: FROM.x + 20, y: FROM.y }));
    fireEvent(grip, mouse("mousemove", TO));
    fireEvent(grip, mouse("mouseup", TO, 0));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(vi.mocked(apiClient.tenant)).toHaveBeenCalledWith("/workspace/tasks/t-1/status", {
      method: "POST",
      body: { status: "IN_REVIEW" },
    });
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("TaskBoard — the board's parts", () => {
  it("keeps every column reachable without a pointer", () => {
    renderScreen(
      <TaskBoard board={BOARD} loading={false} selectedId={null} onOpen={() => {}} onCreate={() => {}} />,
    );

    // The Move menu is the control; dragging is the shortcut to it. A board
    // whose only affordance is a drag fails FRONTEND_GUIDE §7.3, and this is
    // the assertion that fails when somebody deletes the menu.
    expect(screen.getByRole("button", { name: /^Move “Hold the meeting/ })).toBeInTheDocument();
    for (const c of BOARD_COLUMNS) {
      expect(screen.getByRole("heading", { level: 2, name: COLUMN_LABEL[c as BoardColumn] })).toBeInTheDocument();
    }
  });
});
