/**
 * The blockage box (13975) — hidden until true, loud once raised.
 *
 * WHAT EACH GROUP PINS:
 *
 * 1. NOTHING ABOUT BLOCKAGES EXISTS UNTIL SOMEBODY HAS ONE. A clean task shows
 *    one affordance and no chrome; the section must not pad every panel with
 *    an empty "blockages" frame, because permanent chrome is skipped chrome.
 * 2. THE EXPLAINER HAS TWO GESTURES AND ONE COPY. Hover on desktop, ⓘ tap on
 *    touch — both open the SAME popover, so the coaching sentence ("it counts
 *    for your review; the due date moves when you resolve") cannot drift
 *    between a phone and a desk.
 * 3. A LIVE HOLD IS COLLAPSED BY DEFAULT: pill + first line + since-when at a
 *    glance, the story and the Resolve button one expansion away.
 * 4. RESOLVE SAYS THE DUE DATE MOVES BEFORE THE CLICK. A deadline that shifts
 *    without warning is a surprise, and in a logistics ERP a surprise is a
 *    phone call — so the confirmation copy is asserted, not just the mutation.
 * 5. A NOTE IS MANDATORY: registering a badge with nothing behind it is the
 *    one thing the composer must refuse.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const raiseMock = vi.fn();
const resolveMock = vi.fn();
const mockToast = vi.fn();
const mockToastApi = { success: mockToast, error: mockToast, info: mockToast, dismiss: vi.fn() };

vi.mock("../hooks", () => ({
  useRaiseBlockage: () => ({ mutateAsync: raiseMock, isPending: false }),
  useResolveBlockage: () => ({ mutateAsync: resolveMock, isPending: false }),
}));
vi.mock("@/components/ui/toast", () => ({
  useToast: () => mockToastApi,
}));
vi.mock("@/lib/smartcomm-api", () => ({
  listChannels: vi.fn(async () => []),
}));
vi.mock("@/components/employee-picker", () => ({
  EmployeePicker: () => null,
}));

import { BlockageSection } from "./task-blockage";
import type { Task } from "../api";

const task = (over: Partial<Task> = {}): Task =>
  ({
    task_id: "t1",
    title: "Lodge the customs declaration",
    status: "IN_PROGRESS",
    blockage: null,
    blockages: [],
    ...over,
  }) as unknown as Task;

const hold = (over = {}) => ({
  task_blockage_id: "b1",
  task_id: "t1",
  note: "Held at customs — network down since Tuesday",
  estimated_resolve_at: null,
  raised_by: "u1",
  raised_by_name: "Ada",
  raised_at: "2026-09-17T08:00:00.000Z",
  resolved_at: null,
  resolved_by_name: null,
  resolve_note: null,
  due_shift: null,
  ...over,
});

beforeEach(() => {
  raiseMock.mockReset();
  resolveMock.mockReset();
  mockToast.mockReset();
  raiseMock.mockResolvedValue({ blockage: hold(), notified: 2, channels_posted: [] });
  resolveMock.mockResolvedValue({ blockage: hold({ resolved_at: "2026-09-19T08:00:00.000Z" }), new_due_at: "2026-09-23T16:00:00.000Z" });
});

describe("a task with no hold", () => {
  it("shows only the add affordance — no empty chrome", () => {
    render(<BlockageSection task={task()} />);
    expect(screen.getByRole("button", { name: /\+ Add Blockage/i })).toBeTruthy();
    expect(screen.queryByText(/Past blockages/i)).toBe(null);
    expect(screen.queryByRole("button", { name: /Resolve blockage/i })).toBe(null);
  });

  it("the ⓘ tap opens the explainer (the touch gesture)", async () => {
    const user = userEvent.setup();
    render(<BlockageSection task={task()} />);
    expect(screen.queryByRole("tooltip")).toBe(null);
    await user.click(screen.getByRole("button", { name: /About blockages/i }));
    expect(screen.getByRole("tooltip").textContent).toMatch(/performance review/i);
    expect(screen.getByRole("tooltip").textContent).toMatch(/due date/i);
  });

  it("refuses to register a badge with no note behind it", async () => {
    const user = userEvent.setup();
    render(<BlockageSection task={task()} />);
    await user.click(screen.getByRole("button", { name: /\+ Add Blockage/i }));
    await user.click(screen.getByRole("button", { name: /Register blockage/i }));
    expect(raiseMock).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalled();
  });

  it("registers the note, the estimate and the fan-out", async () => {
    const user = userEvent.setup();
    render(<BlockageSection task={task()} />);
    await user.click(screen.getByRole("button", { name: /\+ Add Blockage/i }));
    await user.type(screen.getByLabelText("Blockage note"), "held at customs — network down");
    await user.click(screen.getByRole("button", { name: /Register blockage/i }));
    await waitFor(() => expect(raiseMock).toHaveBeenCalledTimes(1));
    const vars = raiseMock.mock.calls[0][0];
    expect(vars.note).toBe("held at customs — network down");
    expect(vars.taskId).toBe("t1");
  });
});

describe("a task with a live hold", () => {
  it("is collapsed by default: the fact visible, the story one tap away", async () => {
    const user = userEvent.setup();
    render(<BlockageSection task={task({ blockage: hold() })} />);
    expect(screen.getByText("Held at customs — network down since Tuesday")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Blocked/i }).textContent).toMatch(/Expand/);
    expect(screen.queryByRole("button", { name: /^Resolve blockage$/i })).toBe(null);
    await user.click(screen.getByRole("button", { name: /Blocked/i }));
    expect(screen.getByRole("button", { name: /Resolve blockage/i })).toBeTruthy();
  });

  it("resolve warns that the due date moves, then moves it", async () => {
    const user = userEvent.setup();
    render(<BlockageSection task={task({ blockage: hold() })} />);
    await user.click(screen.getByRole("button", { name: /Blocked/i }));
    await user.click(screen.getByRole("button", { name: /Resolve blockage/i }));
    // The warning precedes the click, not the response.
    expect(screen.getByText(/moves the due date forward by the time you were blocked/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^Resolve blockage$/i }));
    await waitFor(() => expect(resolveMock).toHaveBeenCalledTimes(1));
    expect(mockToast.mock.calls.some((c) => String(c[0]).match(/due date moved/i))).toBe(true);
  });
});

describe("history", () => {
  it("resolved holds stay readable, with the shift they caused", () => {
    render(
      <BlockageSection
        task={task({
          blockages: [
            hold({
              task_blockage_id: "b0",
              resolved_at: "2026-09-10T08:00:00.000Z",
              resolved_by_name: "Kofi",
              due_shift: "2 days",
              note: "Port terminal on strike",
            }),
          ],
        })}
      />,
    );
    const past = screen.getByText(/Past blockages \(1\)/i);
    expect(past).toBeTruthy();
  });
});
