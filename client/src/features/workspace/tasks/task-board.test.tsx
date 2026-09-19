/**
 * The board's touch gesture, end to end through the real sensors.
 *
 * WHY THIS FILE EXISTS. `task-board.tsx` now carries three drag models at once —
 * a finger holds a card to pick it up, a mouse presses anywhere on it, a
 * keyboard takes the grip with Space — and the FIRST of those is the one no
 * existing test could see: it is started by a timer, cancelled by a scroll, and
 * distinguished from a tap by nothing except how long the finger rested. A unit
 * test that stubbed dnd-kit would prove that the props were wired and nothing
 * about the gesture. So these tests drive REAL `TouchEvent`s and REAL
 * `MouseEvent`s into the real `DndContext`, and assert what the network was
 * asked to do at the end.
 *
 * The claims, in the order a reader would check them:
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
 * 4. TWO FINGERS ARE NEVER A DRAG, and a MOUSE DRAGS FROM ANYWHERE ON THE
 *    CARD. The first keeps a pinch-zoom from picking a card up; the second
 *    pins the desktop path that the arrival of the long press could otherwise
 *    have broken. The mouse half speaks pointer events now — `pointerdown` to
 *    `pointerup` is the gesture, not `mousedown` to `mouseup` — and a finger's
 *    `pointerdown` never activates it: touch belongs to the hold, and the
 *    pointer sensor's activator turns it away (claim 8).
 *
 * 5. A CARD STAYS DRAGGABLE AFTER A DROP. The overlay used to call
 *    `useDraggable` with the live card's id, which unregistered the card when
 *    the overlay unmounted — the second drag of the same card never started.
 *    Two drops in a row, two posts, is that regression.
 *
 * 6. A DROP IN THE GUTTER STILL LANDS. The pointer decides when it is inside a
 *    column; when it is in no column, the card's own overlap decides. Releasing
 *    with the pointer between two columns moves to the overlapped one rather
 *    than snapping back.
 *
 * 7. A CANCELLED DRAG ABANDONS THE MOVE. When the platform takes the gesture
 *    back (`pointercancel` — the browser reclaiming it, the pointer leaving
 *    the window), nothing posts and the card is immediately draggable again.
 *    This is the net the old mouse sensor lacked: it listened for `mouseup`
 *    alone, so an ending it did not hear stranded the copy on the pointer
 *    until Escape.
 *
 * 8. A FINGER'S `pointerdown` NEVER REACHES THE POINTER SENSOR. Every touch
 *    gesture below therefore starts with the `pointerdown` a real browser
 *    sends before the `touchstart` — and the hold, the tap and the scroll all
 *    behave exactly as they did when the mouse spoke `mousedown`.
 *
 * GEOMETRY. dnd-kit resolves a drop by intersecting rects (and by testing the
 * pointer), and jsdom reports every rect as 0×0, so the board is given a
 * layout: four columns side by side and a card inside the first. The numbers
 * below are that layout, not decoration — the drag's coordinates are chosen so
 * that the card lands in a column by both readings dnd-kit might take of the
 * moving rect (the card's own measured rect, translated, and the bare pointer
 * position).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";

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

/**
 * jsdom has no `PointerEvent` — the interface is one jsdom never implemented —
 * so the pointer half of the gesture travels on a `MouseEvent` carrying the
 * pointer fields. The substitution is faithful where it matters: dnd-kit's
 * pointer sensor never checks the constructor, it reads `pointerType`,
 * `isPrimary` and `button` off the event (and coordinates off `clientX/Y`),
 * so these events exercise the real sensor, including the real activator and
 * the real `pointercancel` listener.
 */
class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
    init: MouseEventInit & { pointerId?: number; pointerType?: string; isPrimary?: boolean },
  ) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
    this.isPrimary = init.isPrimary ?? true;
  }
}

function pointer(
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  point: TouchPoint,
  extra: { pointerType?: string; isPrimary?: boolean } = {},
) {
  return new TestPointerEvent(type, {
    clientX: point.x,
    clientY: point.y,
    button: 0,
    // Held for down/move, released for up — the browser's own values.
    buttons: type === "pointerup" ? 0 : 1,
    bubbles: true,
    cancelable: true,
    ...extra,
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

  /** The element a press lands on: the wrapper around the card's button and grip. */
  function touchSurface() {
    // Scoped to the card's own column: after a drop the overlay copy lingers
    // until its animation finishes, and an unscoped query would match the copy
    // as well as the card.
    const heading = screen.getByRole("heading", { level: 2, name: COLUMN_LABEL.TO_DO });
    const column = heading.closest("section");
    if (!column) throw new Error("the column heading has no column around it");
    const card = within(column).getByRole("button", { name: CARD });
    const surface = card.parentElement;
    if (!surface) throw new Error("the card's button has no touch surface around it");
    return surface;
  }

  it("moves the task between stages when a card is held and dragged", async () => {
    showBoard();
    const surface = touchSurface();

    // A real browser sends `pointerdown` before `touchstart`; the pointer
    // sensor's activator must turn the finger away, so that the hold below —
    // and nothing else — owns the gesture from here.
    fireEvent(surface, pointer("pointerdown", FROM, { pointerType: "touch" }));
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
    // The `pointerdown` first, as the browser sends it — turned away, tap
    // intact.
    fireEvent(surface, pointer("pointerdown", FROM, { pointerType: "touch" }));
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

    fireEvent(surface, pointer("pointerdown", FROM, { pointerType: "touch" }));
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
    // point of contact. Both fingers' `pointerdown`s first, as the browser
    // sends them — the activator turns touch away, primary or not.
    fireEvent(surface, pointer("pointerdown", FROM, { pointerType: "touch" }));
    fireEvent(
      surface,
      pointer("pointerdown", { x: FROM.x + 60, y: FROM.y + 60 }, { pointerType: "touch", isPrimary: false }),
    );
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

    fireEvent(grip, pointer("pointerdown", FROM));
    // The first movement only arms the drag — 8px is the threshold that keeps a
    // click from being a drag — and the second is the drag itself.
    fireEvent(grip, pointer("pointermove", { x: FROM.x + 20, y: FROM.y }));
    fireEvent(grip, pointer("pointermove", TO));
    fireEvent(grip, pointer("pointerup", TO));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(vi.mocked(apiClient.tenant)).toHaveBeenCalledWith("/workspace/tasks/t-1/status", {
      method: "POST",
      body: { status: "IN_REVIEW" },
    });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("moves the task when the mouse presses the card body and moves", async () => {
    // The desktop fix (13840): the mouse sensor lives on the whole card, so a
    // press-and-move ANYWHERE drags. Before it, the mousedown was only wired to
    // an invisible 20px strip and holding anywhere did nothing.
    showBoard();
    const surface = touchSurface();

    fireEvent(surface, pointer("pointerdown", FROM));
    fireEvent(surface, pointer("pointermove", { x: FROM.x + 20, y: FROM.y }));
    fireEvent(surface, pointer("pointermove", TO));
    fireEvent(surface, pointer("pointerup", TO));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(vi.mocked(apiClient.tenant)).toHaveBeenCalledWith("/workspace/tasks/t-1/status", {
      method: "POST",
      body: { status: "IN_REVIEW" },
    });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("lets the same card be dragged again after a drop", async () => {
    // The overlay used to call `useDraggable` with the live card's id, which
    // overwrote the card's registry entry while dragging and DELETED it when
    // the overlay unmounted — so the second drag of the same card never
    // started ("drag works once, then never again"). Two drops, two posts.
    showBoard();
    const posted = vi.mocked(apiClient.tenant);

    fireEvent(touchSurface(), pointer("pointerdown", FROM));
    fireEvent(touchSurface(), pointer("pointermove", { x: FROM.x + 20, y: FROM.y }));
    fireEvent(touchSurface(), pointer("pointermove", TO));
    fireEvent(touchSurface(), pointer("pointerup", TO));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(posted).toHaveBeenCalledWith("/workspace/tasks/t-1/status", {
      method: "POST",
      body: { status: "IN_REVIEW" },
    });
    // Let the drop animation finish and the overlay unmount, so the second
    // drag starts from the resting board — as a user's second drag would.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    // The board prop here is static, so the card is still TO_DO to the board —
    // what the second drag proves is that the card is still REGISTERED, and
    // dropping it on DONE is the post that proves it.
    posted.mockClear();
    const DONE_AT = { x: (column(3).left + column(3).right) / 2, y: FROM.y };
    fireEvent(touchSurface(), pointer("pointerdown", FROM));
    fireEvent(touchSurface(), pointer("pointermove", { x: FROM.x + 20, y: FROM.y }));
    fireEvent(touchSurface(), pointer("pointermove", DONE_AT));
    fireEvent(touchSurface(), pointer("pointerup", DONE_AT));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(posted).toHaveBeenCalledWith("/workspace/tasks/t-1/status", {
      method: "POST",
      body: { status: "DONE" },
    });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("lands the card by its rect when the pointer is released in the gutter", async () => {
    // The pointer decides when it is inside a column; in the 20px gutter it is
    // inside none, so the card's own overlap decides. The pointer below sits 5px
    // off "In review"'s edge — still in the gutter, with the card hanging
    // mostly over "In review". A snap-back here would punish an honest drop.
    // (Dead centre of the gutter overlaps both columns equally, which tests the
    // sort's tie-break rather than the fallback; off-centre tests the fallback.)
    showBoard();
    const surface = touchSurface();

    const IN_THE_GUTTER = { x: column(2).left - 5, y: FROM.y };
    fireEvent(surface, pointer("pointerdown", FROM));
    fireEvent(surface, pointer("pointermove", { x: FROM.x + 20, y: FROM.y }));
    fireEvent(surface, pointer("pointermove", IN_THE_GUTTER));
    fireEvent(surface, pointer("pointerup", IN_THE_GUTTER));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(vi.mocked(apiClient.tenant)).toHaveBeenCalledWith("/workspace/tasks/t-1/status", {
      method: "POST",
      body: { status: "IN_REVIEW" },
    });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("abandons the move when the platform cancels the drag, and frees the card", async () => {
    // The net the old mouse sensor lacked: it listened for `mouseup` alone, so
    // an ending it did not hear stranded the copy on the pointer until Escape.
    // `pointercancel` — the browser taking the gesture back — must end the drag
    // the same way a drop does, minus the post, and leave the card draggable.
    showBoard();
    const posted = vi.mocked(apiClient.tenant);

    fireEvent(touchSurface(), pointer("pointerdown", FROM));
    fireEvent(touchSurface(), pointer("pointermove", { x: FROM.x + 20, y: FROM.y }));
    fireEvent(touchSurface(), pointer("pointermove", TO));
    // The drag is live — two copies — and then the platform takes it back.
    expect(screen.getAllByText(TASK.title)).toHaveLength(2);
    fireEvent(touchSurface(), pointer("pointercancel", TO));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(posted).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    // The copy is gone: one card, resting, and immediately draggable again.
    expect(screen.getAllByText(TASK.title)).toHaveLength(1);

    fireEvent(touchSurface(), pointer("pointerdown", FROM));
    fireEvent(touchSurface(), pointer("pointermove", { x: FROM.x + 20, y: FROM.y }));
    fireEvent(touchSurface(), pointer("pointermove", TO));
    fireEvent(touchSurface(), pointer("pointerup", TO));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(posted).toHaveBeenCalledWith("/workspace/tasks/t-1/status", {
      method: "POST",
      body: { status: "IN_REVIEW" },
    });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("never lets a finger's pointerdown start the pointer sensor", async () => {
    // The activator's half of the touch contract: a finger fires `pointerdown`
    // on its way into EVERY gesture — tap, scroll, hold — and none of them may
    // reach the pointer sensor's pending state, or the first eight pixels of a
    // scroll flick become a drag. pointerdown, a long way past the 8px
    // threshold, then up: nothing picked up, nothing posted.
    showBoard();

    fireEvent(touchSurface(), pointer("pointerdown", FROM, { pointerType: "touch" }));
    fireEvent(touchSurface(), pointer("pointermove", { x: FROM.x + 120, y: FROM.y + 120 }));
    fireEvent(touchSurface(), pointer("pointerup", { x: FROM.x + 120, y: FROM.y + 120 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getAllByText(TASK.title)).toHaveLength(1);
    expect(vi.mocked(apiClient.tenant)).not.toHaveBeenCalled();
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

  it("shows the grip dots on hover only, never over the resting title", () => {
    // The dots used to sit permanently on the title strip, hiding the first
    // thing a reader looks at. Now the strip is transparent at rest and the
    // dots fade in on hover or keyboard focus. jsdom cannot hover, so the pin
    // is on the classes that encode it — invisible by default, visible on
    // `group-hover`/`group-focus-within`, on a strip that paints nothing.
    renderScreen(
      <TaskBoard board={BOARD} loading={false} selectedId={null} onOpen={() => {}} onCreate={() => {}} />,
    );

    const grip = screen.getByRole("button", { name: GRIP });
    expect(grip.className).not.toMatch(/bg-/);
    const dots = grip.querySelector("span[aria-hidden]");
    expect(dots).not.toBeNull();
    expect(dots!.className).toMatch(/(^|\s)opacity-0(\s|$)/);
    expect(dots!.className).toContain("group-hover:opacity-100");
    expect(dots!.className).toContain("group-focus-within:opacity-100");
  });

  it("keeps the dossier chip inside its card, however long the stage is", () => {
    // The chip is the one thing on a card that cannot shrink by itself —
    // `.status` is `white-space: nowrap` — so a long stage ("Pré-alerte et
    // ordre de travail") once made the chip wider than its column and it
    // overhung the neighbouring one, worst with the detail pane open and the
    // columns at their narrowest. jsdom cannot measure a wrap, so the pin is
    // on the classes that encode the guarantee: the chip may fill its row and
    // no further (`max-w-full`), the row offers it a line of its own when it
    // stops fitting beside the other pills (`flex-wrap`), and the label clips
    // instead of spilling (`truncate`) with the full stage on hover (`title`).
    renderScreen(
      <TaskBoard
        board={{
          ...BOARD,
          TO_DO: [
            {
              ...TASK,
              dossier_ref: "SL3213P44RG55ZSM",
              milestone_label: "Pré-alerte et ordre de travail",
            },
          ],
        }}
        loading={false}
        selectedId={null}
        onOpen={() => {}}
        onCreate={() => {}}
      />,
    );

    const label = screen.getByText("SL3213P44RG55ZSM · Pré-alerte et ordre de travail");
    expect(label).toHaveClass("truncate");
    expect(label).toHaveAttribute("title", "SL3213P44RG55ZSM · Pré-alerte et ordre de travail");
    const chip = label.closest("span.status");
    expect(chip).not.toBeNull();
    expect(chip).toHaveClass("max-w-full");
    expect(chip!.parentElement).toHaveClass("flex-wrap");
  });
});
