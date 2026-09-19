/**
 * Tasks — one search box for both views.
 *
 * What is pinned: the box is on the page (not inside the List), what is typed
 * reaches the BOARD request as `q` and, after a switch, the LIST request as
 * the same `q`; the value lives in the URL (`?q=`) so a link reproduces it;
 * an empty board under a search says "nothing matches" with a way out, not
 * "nothing on the board"; and the List renders no second box of its own
 * while the page owns the search.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

const tenant = vi.fn();
const tenantPaged = vi.fn();
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>("@/lib/api-client");
  return {
    ...actual,
    tenant: (...a: unknown[]) => tenant(...a),
    tenantPaged: (...a: unknown[]) => tenantPaged(...a),
  };
});
vi.mock("@/app/auth/auth-context", async () => {
  const actual = await vi.importActual<typeof import("@/app/auth/auth-context")>("@/app/auth/auth-context");
  return {
    ...actual,
    useAuth: () => ({ user: { user_id: "u-1", full_name: "Viewer One" }, status: "authed" }),
  };
});

import { TasksPage } from "./tasks-page";

const EMPTY_BOARD = { board: { TO_DO: [], IN_PROGRESS: [], IN_REVIEW: [], DONE: [] }, audience: "mine", audiences: ["mine"] };

function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{loc.search}</output>;
}

function view(at = "/workspace/tasks") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <TooltipProvider>
          <MemoryRouter initialEntries={[at]}>
            <Routes>
              <Route
                path="/workspace/tasks"
                element={
                  <>
                    <TasksPage />
                    <LocationProbe />
                  </>
                }
              />
            </Routes>
          </MemoryRouter>
        </TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const boardCalls = () => tenant.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("/workspace/tasks/board"));
const listCalls = () => tenantPaged.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  tenant.mockReset();
  tenantPaged.mockReset();
  tenant.mockImplementation((url: string) => {
    if (url.startsWith("/workspace/tasks/board")) return Promise.resolve(EMPTY_BOARD);
    return Promise.resolve({});
  });
  tenantPaged.mockResolvedValue({ data: [], total: 0, limit: 25, offset: 0, hasMore: false, meta: null });
});
afterEach(() => cleanup());

describe("Tasks — the shared search", () => {
  it("what is typed reaches the board as q, lands in the URL, and says so when nothing matches", async () => {
    view();
    await waitFor(() => expect(boardCalls().length).toBeGreaterThan(0));
    expect(boardCalls()[0]).not.toContain("q=");

    fireEvent.change(screen.getByRole("searchbox", { name: "Search tasks" }), { target: { value: "brasseries" } });
    await waitFor(() => expect(boardCalls().some((u) => u.includes("q=brasseries"))).toBe(true), { timeout: 3000 });
    expect(screen.getByTestId("location").textContent).toContain("q=brasseries");

    // An empty board under a search is "nothing matches", with a way out.
    expect(await screen.findByText("No tasks match “brasseries”")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show all tasks" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).not.toContain("q="));
    expect(await screen.findByText("Nothing on the board")).toBeTruthy();
  });

  it("a ?q= link opens searched, and the List view carries the same q with no second box", async () => {
    view("/workspace/tasks?q=SL3213&view=list");
    await waitFor(() => expect(listCalls().some((u) => u.includes("q=SL3213"))).toBe(true), { timeout: 3000 });
    const boxes = screen.getAllByRole("searchbox");
    expect(boxes).toHaveLength(1);
    expect((boxes[0] as HTMLInputElement).value).toBe("SL3213");
    expect(await screen.findByText("No tasks match “SL3213”")).toBeTruthy();
  });
});
