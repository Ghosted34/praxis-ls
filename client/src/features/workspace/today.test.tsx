/**
 * Today — the two panels that were lost when the workspace became a hub.
 *
 * `/workspace` used to be a read-only roll-up of what is awaiting the signed-in
 * user's approval and which of their alerts are unread. When tasks and the
 * calendar moved in, that page became a redirect (workspace-page.tsx) and the
 * hub kept three sections — but the roll-up itself went with the old page. The
 * endpoint was never removed (`workspace.controller.js` → `service.mine`), the
 * full screens still exist (`/approvals`, `/notifications`), and `hub.tsx` still
 * documents "Today keeps a count of what is awaiting approval". Only the
 * on-page summary had quietly vanished, so Today promised a count it no longer
 * showed.
 *
 * These tests pin the summary to the surface: the rows, the empty states, the
 * links out to the two full queues, and the reused self-scoped Recent-activity
 * widget. (A strip of day counts sat here for a while and was dropped by design
 * — the panels and the day list ARE the source of truth, so no number test.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/components/ui/toast";

const tenant = vi.fn();
const apiPaged = vi.fn();

// Partial mock: `use-resource` imports `ApiError` from the same module to
// classify errors, so replacing the whole module would take that export with it.
// `apiPaged` is stubbed too — the reused `<RecentActivity>` widget feeds on it
// (`/audit/my-feed`), and we only need to know Today mounts the widget.
vi.mock("@/lib/api-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api-client")>(
    "@/lib/api-client",
  );
  return {
    ...actual,
    tenant: (...a: unknown[]) => tenant(...a),
    apiPaged: (...a: unknown[]) => apiPaged(...a),
  };
});

/**
 * The day timeline is not what these tests are about — pin it to a controllable
 * impl so a test can make it succeed or fail. The task and event dialogs, which
 * TodayPage mounts closed, take their mutations from this same module, so the
 * mock is partial rather than a whole-module stub.
 */
const useDayMock = vi.fn();
vi.mock("./hooks", async () => {
  const actual = await vi.importActual<typeof import("./hooks")>("./hooks");
  return {
    ...actual,
    useDay: (args: unknown) => useDayMock(args),
  };
});

import { TodayPage } from "./today";

const view = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
        })
      }
    >
      <ToastProvider>
        <MemoryRouter>
          <TodayPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );

const MINE = {
  approvals_awaiting_me: [
    {
      approval_task_id: "a1",
      entity_ref: "purchase_request:PR-1042",
      amount_xaf: 1250000,
      status: "PENDING",
      created_at: "2026-09-14T08:00:00Z",
    },
    {
      approval_task_id: "a2",
      entity_ref: "leave_request:LV-77",
      amount_xaf: null,
      status: "PENDING",
      created_at: "2026-09-15T08:00:00Z",
    },
  ],
  unread_notifications: [
    {
      notification_id: "n1",
      title: "Container left the yard",
      priority: "HIGH",
      event_type_key: "container.gate_out",
      created_at: "2026-09-15T17:30:00Z",
    },
    {
      notification_id: "n2",
      title: "VAT return due",
      priority: "NORMAL",
      event_type_key: "tax.vat_due",
      created_at: "2026-09-16T06:00:00Z",
    },
  ],
};

/** The `{ data, meta }` envelope `apiPaged` reassembles for the feed hook. */
const EMPTY_FEED = {
  data: [],
  total: 0,
  limit: 10,
  offset: 0,
  hasMore: false,
  meta: { window: "all_time", page: 1, page_size: 10, total: 0, has_more: false },
};

/** "Cash to account for" (MOD-76) — one line the caller still owes a receipt on. */
const OWED = {
  count: 1,
  total_ttc: 85000,
  items: [
    {
      dossier_id: "d1",
      dossier_ref: "DOSS-9",
      costing_line_id: "c1",
      line_label: "Fuel for the Douala run",
      claimed_ttc: 85000,
    },
  ],
};

/** A healthy day timeline — the panel Today does not blank the hub for. */
const DAY_OK = {
  data: { items: [], audience: "mine", audiences: ["mine"], tasks: 0, events: 0 },
  error: null,
  isLoading: false,
  refetch: vi.fn(),
};

/** The panel failing the way it did live: a 500 from the day query. */
const DAY_FAIL = {
  data: undefined,
  error: Object.assign(new Error("Something went wrong on our side — please try again."), { code: "INTERNAL_ERROR" }),
  isLoading: false,
  refetch: vi.fn(),
};

beforeEach(() => {
  tenant.mockReset();
  tenant.mockImplementation((p: string) => {
    if (p === "/workspace/approvals") return Promise.resolve(MINE.approvals_awaiting_me);
    if (p === "/workspace/alerts") return Promise.resolve(MINE.unread_notifications);
    if (p === "/workspace/context") return Promise.resolve({ timeZone: "Africa/Douala" });
    if (p === "/costing/reconciliations/owed") return Promise.resolve(OWED);
    return Promise.resolve({});
  });
  apiPaged.mockReset();
  apiPaged.mockResolvedValue(EMPTY_FEED);
  useDayMock.mockReset();
  useDayMock.mockReturnValue(DAY_OK);
});

describe("Today — the approvals and alerts roll-up", () => {
  it("reads approvals and alerts through focused Today endpoints", async () => {
    view();
    await screen.findByText("Purchase request PR-1042");
    expect(tenant).toHaveBeenCalledWith("/workspace/approvals");
    expect(tenant).toHaveBeenCalledWith("/workspace/alerts");
  });

  it("mounts the self-scoped Recent activity widget beside the day", async () => {
    view();
    // The reused widget renders its own heading even while its feed is empty.
    await screen.findByRole("heading", { name: "Recent activity" });
    // It pulls the caller's own feed, not a tenant-wide log.
    expect(apiPaged).toHaveBeenCalledWith("/tenant/audit/my-feed?page=1");
    // An empty feed shows the widget's honest empty state rather than a crash.
    expect(await screen.findByText("No activity yet")).toBeTruthy();
  });

  it("shows the receipts the person still owes, with a deep link to the sheet", async () => {
    view();
    // The heading paints while the owed fetch is still in flight; wait for the
    // row itself so the assertions below run against the populated list.
    await screen.findByText("DOSS-9");
    expect(screen.getByText(/Fuel for the Douala run/)).toBeTruthy();

    const upload = screen.getByRole("link", { name: /Upload/ });
    expect(upload.getAttribute("href")).toBe("/costing/reconciliation/d1?line=c1");
  });

  it("says so when nothing is owed", async () => {
    tenant.mockImplementation((p: string) => {
      if (p === "/workspace/approvals") return Promise.resolve(MINE.approvals_awaiting_me);
      if (p === "/workspace/alerts") return Promise.resolve(MINE.unread_notifications);
      if (p === "/workspace/context") return Promise.resolve({ timeZone: "Africa/Douala" });
      return Promise.resolve({ count: 0, total_ttc: 0, items: [] });
    });
    view();

    expect(await screen.findByText(/No receipts owed/)).toBeTruthy();
  });

  it("lists every approval row with a humanised ref and its amount", async () => {
    view();
    await screen.findByText("Purchase request PR-1042");

    expect(screen.getByText("Leave request LV-77")).toBeTruthy();
    // The funded row shows its amount…
    expect(screen.getByText(/1[.,]250[.,]000/)).toBeTruthy();
    // …and `money(null)` renders an em dash, so the empty row carries one
    // rather than a misleading "0.00 XAF".
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("lists every unread alert with its priority", async () => {
    view();
    await screen.findByText("Container left the yard");

    expect(screen.getByText("VAT return due")).toBeTruthy();
    // `<Pill>` humanises a string child (`enumLabel`), so the tokens the
    // database stores arrive sentence-cased — "HIGH" reads as "High", the same
    // as on /notifications.
    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.getByText("Normal")).toBeTruthy();
  });

  it("links out to the two full queues", async () => {
    view();
    await screen.findByText("Purchase request PR-1042");

    const queue = screen.getByRole("link", { name: /Open queue/ });
    const all = screen.getByRole("link", { name: /All notifications/ });
    expect(queue.getAttribute("href")).toBe("/approvals");
    expect(all.getAttribute("href")).toBe("/notifications");
  });

  it("says so when there is nothing to act on, rather than showing a blank panel", async () => {
    tenant.mockResolvedValue({
      approvals_awaiting_me: [],
      unread_notifications: [],
    });
    view();

    expect(
      await screen.findByText("Nothing awaiting your validation or approval."),
    ).toBeTruthy();
    expect(await screen.findByText("You're all caught up.")).toBeTruthy();
  });

  it("still renders when the roll-up endpoint answers nothing at all", async () => {
    // `workspace.repo.safe()` turns a failed read into an empty list, so a
    // response with neither key is a real shape and not a programming error.
    tenant.mockResolvedValue({});
    view();

    expect(
      await screen.findByText("Nothing awaiting your validation or approval."),
    ).toBeTruthy();
  });
});

/* A 500 from one panel must not blank the hub.
 *
 * Production on 18 September 2026: `GET /workspace/day` answered 500 while
 * every other Today panel (`/approvals`, `/alerts`, the owed-receipts read)
 * kept rendering. The screenshot showed the day panel dead and the rest fine.
 * That isolation is deliberate — the panels are independent queries, each
 * with its own error branch and retry — and the point of this test is to pin
 * it so a refactor that makes the day gate the rest of the page is caught,
 * not merged. */
describe("Today — one panel's failure stays one panel's failure", () => {
  it("shows the day panel unavailable while approvals, alerts, activity and receipts still render", async () => {
    useDayMock.mockReturnValue(DAY_FAIL);
    /* The default `beforeEach` tenant mock answers every focused read, so by
       the time this overrides only `useDay` the sibling panels have the data
       they need. The day is the one that failed; the rest answer for
       themselves — and that is the whole point. */
    view();

    expect(await screen.findByText(/Something went wrong on our side/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeTruthy();
    expect(await screen.findByText("Purchase request PR-1042")).toBeTruthy();
    expect(screen.getByText("Container left the yard")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Recent activity" })).toBeTruthy();
    expect(screen.getByText("DOSS-9")).toBeTruthy();

    // The hub did not crash: the header and the other panels are still on the page.
    expect(screen.getByRole("heading", { name: "Today" })).toBeTruthy();
  });
});
