/**
 * The primitives that did not exist before Phase 2: Textarea, Toast,
 * Pagination, ErrorBoundary, and EmptyState's `action` slot.
 *
 * Each maps to a specific audit finding — F6 (no Textarea, three local class
 * constants), F13 (async success/failure announced nowhere), F8 (server-capped
 * lists with no pager), F12 (no error boundary anywhere), F11 (no empty state
 * offers a primary action).
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import { Textarea } from "./textarea";
import { ToastProvider, useToast } from "./toast";
import { Pagination } from "./pagination";
import { ErrorBoundary } from "./error-boundary";
import { EmptyState, ErrorState } from "./states";
import { Field } from "./modal";

/* ───────────────────────────────── Textarea ──────────────────────────────── */

describe("Textarea (F6 — no primitive existed; 18 raw elements, 3 class constants)", () => {
  it("takes its accessible name from the surrounding Field", () => {
    render(
      <Field label="Narration" required>
        <Textarea />
      </Field>,
    );
    const ta = screen.getByRole("textbox", { name: "Narration" });
    expect(ta.tagName).toBe("TEXTAREA");
    expect(ta).toHaveAttribute("aria-required", "true");
  });

  it("stays user-resizable — several of these hold a full OHADA narration", () => {
    const { container } = render(<Textarea />);
    expect(container.querySelector("textarea")!.className).toContain(
      "resize-y",
    );
  });

  it("accepts typing and forwards a ref", async () => {
    const user = userEvent.setup();
    const ref = React.createRef<HTMLTextAreaElement>();
    render(<Textarea ref={ref} aria-label="Notes" />);
    await user.type(screen.getByRole("textbox", { name: "Notes" }), "hello");
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
    expect(ref.current).toHaveValue("hello");
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <Field label="Narration">
        <Textarea />
      </Field>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

/* ────────────────────────────────── Toast ────────────────────────────────── */

function ToastHarness() {
  const toast = useToast();
  return (
    <>
      <button onClick={() => toast.success("Invoice posted")}>Post</button>
      <button onClick={() => toast.error("Period is closed")}>Fail</button>
    </>
  );
}

describe("Toast (F13 — 3 live regions in ~40,000 lines; async result announced nowhere)", () => {
  it("announces a success politely, via role=status", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Post" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Invoice posted",
    );
  });

  it("announces a failure assertively, via role=alert", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Fail" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Period is closed",
    );
  });

  it("can be dismissed", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Post" }));
    await screen.findByRole("status");
    await user.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
  });

  it("fails loudly when used outside the provider, rather than silently doing nothing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<ToastHarness />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});

/** Fake timers are contained in their own block: leaking them breaks userEvent
 *  in every test that follows. fireEvent rather than userEvent here — userEvent's
 *  internal waiting fights a faked clock. */
describe("Toast auto-dismiss", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("clears a success before an error — a failure needs longer to read", async () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    fireEvent.click(screen.getByRole("button", { name: "Fail" }));
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(4500);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

/* ──────────────────────────────── Pagination ─────────────────────────────── */

describe("Pagination (F8 — the API caps lists at 50 rows and nothing paged)", () => {
  it("reports the range, not just the page number", () => {
    render(
      <Pagination
        page={1}
        pageSize={50}
        total={1284}
        onPageChange={() => {}}
      />,
    );
    expect(screen.getByText(/Showing 51–100 of 1,284/)).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 26")).toBeInTheDocument();
  });

  it("disables Previous on the first page and Next on the last", () => {
    const { rerender } = render(
      <Pagination page={0} pageSize={50} total={120} onPageChange={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();

    rerender(
      <Pagination page={2} pageSize={50} total={120} onPageChange={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("degrades honestly to Prev/Next when the endpoint reports no total", () => {
    render(
      <Pagination page={0} pageSize={50} hasMore onPageChange={() => {}} />,
    );
    expect(screen.getByText("Page 1")).toBeInTheDocument();
    expect(screen.queryByText(/of/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });

  it("renders nothing when there is only one page — no dead control", () => {
    const { container } = render(
      <Pagination page={0} pageSize={50} total={12} onPageChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("pages forward", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <Pagination
        page={0}
        pageSize={50}
        total={200}
        onPageChange={onPageChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <Pagination
        page={1}
        pageSize={50}
        total={1284}
        onPageChange={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

/* ─────────────────────────────── ErrorBoundary ───────────────────────────── */

function Boom(): React.ReactElement {
  throw new Error("account_code is undefined");
}

describe("ErrorBoundary (F12 — there was none anywhere; a render throw blanked the SPA)", () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    // React logs the caught error itself; silencing keeps the run readable.
    spy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => spy.mockRestore());

  it("catches a render throw and keeps its siblings alive", () => {
    render(
      <div>
        <p>Still here</p>
        <ErrorBoundary name="Finance">
          <Boom />
        </ErrorBoundary>
      </div>,
    );
    expect(screen.getByText("Still here")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Finance couldn't be displayed",
    );
  });

  it("surfaces the message for a bug report without dressing it as guidance", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("account_code is undefined")).toBeInTheDocument();
  });

  it("offers a recovery path — Try again re-renders the subtree", async () => {
    const user = userEvent.setup();
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error("transient");
      return <p>Recovered</p>;
    }
    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    shouldThrow = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Recovered")).toBeInTheDocument();
  });

  it("accepts a custom fallback for a single widget", () => {
    render(
      <ErrorBoundary fallback={<p>Map unavailable</p>}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Map unavailable")).toBeInTheDocument();
  });

  it("calls onError so a reporting pipeline can hook in", () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ componentStack: expect.any(String) }),
    );
  });

  it("renders children untouched when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>Fine</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Fine")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

/* ──────────────────────────────── EmptyState ─────────────────────────────── */

describe("EmptyState action slot (F11 — no empty state anywhere offered one)", () => {
  it("renders a primary action", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <EmptyState
        title="No invoices"
        hint="Issue a final invoice from an approved costing."
        action={<button onClick={onClick}>New invoice</button>}
      />,
    );
    await user.click(screen.getByRole("button", { name: "New invoice" }));
    expect(onClick).toHaveBeenCalled();
  });

  it("still works without an action", () => {
    render(<EmptyState title="Nothing here yet" />);
    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
  });

  it("ErrorState announces itself via role=alert", () => {
    render(<ErrorState message="You don't have permission to do this." />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "You don't have permission to do this.",
    );
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <EmptyState
        title="No invoices"
        hint="Issue one from a costing."
        action={<button>New invoice</button>}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
