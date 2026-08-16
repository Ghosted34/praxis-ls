/**
 * The leave queue — the screen where leave is approved.
 *
 * WHAT THESE PIN
 *
 *   - The approver can SEE THE BALANCE. Before 0696 this screen showed a name
 *     and two dates and offered an Approve button, and nothing in the product
 *     knew whether that person had a day left. The Days and Balance columns are
 *     the whole point of the change, and a regression that quietly drops either
 *     would restore approving-against-nothing without failing anything else.
 *   - An overdraw is legible BEFORE the click, not in the 422 after it.
 *   - Balances are asked for once per employee, not once per row — a queue with
 *     the same person on it three times must not make three calls.
 *   - Advances and missions consume no entitlement and are not asked about.
 *   - An approved request can be cancelled; a rejected one cannot.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

const listLeave = vi.fn();
const leaveBalances = vi.fn();
const leaveTypes = vi.fn();
const decideLeave = vi.fn();
const cancelLeave = vi.fn();
vi.mock("@/lib/hr-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/hr-api")>("@/lib/hr-api");
  return {
    ...actual,
    listLeave: (...a: unknown[]) => listLeave(...a),
    leaveBalances: (...a: unknown[]) => leaveBalances(...a),
    leaveTypes: (...a: unknown[]) => leaveTypes(...a),
    decideLeave: (...a: unknown[]) => decideLeave(...a),
    cancelLeave: (...a: unknown[]) => cancelLeave(...a),
  };
});

import { ApiError } from "@/lib/api-client";
import { LeavePage } from "./leave";
import type { LeaveRequest, LeaveBalance } from "@/lib/hr-api";

const ANNUAL_ID = "type-annual";

const REQUEST: LeaveRequest = {
  leave_request_id: "r1",
  employee_id: "e1",
  employee_name: "Ada Mbarga",
  kind: "leave",
  leave_type_id: ANNUAL_ID,
  leave_type_name: "Annual leave",
  starts_on: "2026-08-03",
  ends_on: "2026-08-07",
  days: 5,
  status: "REQUESTED",
};

const balance = (over: Partial<LeaveBalance> = {}): LeaveBalance => ({
  leave_type_id: ANNUAL_ID,
  code: "ANNUAL",
  name: "Annual leave",
  is_paid: true,
  allow_negative: false,
  requires_document: false,
  max_days_per_year: null,
  period_year: 2026,
  accrued: 9,
  carried: 0,
  taken: 0,
  returned: 0,
  adjustments: 0,
  forfeited: 0,
  balance: 9,
  ...over,
});

/**
 * Every query below is scoped to the TABLE.
 *
 * `DataList` renders the same rows twice — a table for the desktop breakpoint
 * and a stack of cards for the phone — so an unscoped `getByText` finds two of
 * everything and fails on the ambiguity rather than on the assertion.
 */
const table = async () => within(await screen.findByRole("table"));
/** The row for one employee, so a column assertion cannot match the header. */
const rowFor = async (name: string) =>
  within((await table()).getByText(name).closest("tr") as HTMLElement);

beforeEach(() => {
  vi.clearAllMocks();
  listLeave.mockResolvedValue([REQUEST]);
  leaveBalances.mockResolvedValue([balance()]);
  leaveTypes.mockResolvedValue([
    {
      leave_type_id: ANNUAL_ID,
      code: "ANNUAL",
      name: "Annual leave",
      is_paid: true,
      requires_document: false,
      counts_working_days: true,
      allow_negative: false,
      is_active: true,
      is_system: true,
    },
  ]);
  decideLeave.mockResolvedValue({ ...REQUEST, status: "APPROVED" });
  cancelLeave.mockResolvedValue({ ...REQUEST, status: "CANCELLED" });
});

describe("the leave queue", () => {
  it("shows what the request costs and what the employee has", async () => {
    renderScreen(<LeavePage />, {});

    const row = await rowFor("Ada Mbarga");
    // Days: the working-day count frozen when the request was raised.
    expect(row.getByText("5")).toBeInTheDocument();
    // Balance: the number that did not exist before 0696.
    expect(await row.findByText("9")).toBeInTheDocument();
  });

  it("marks a request that would overdraw the balance", async () => {
    leaveBalances.mockResolvedValue([balance({ balance: 2 })]);
    renderScreen(<LeavePage />, {});

    const cell = await (await table()).findByTitle(/overdraw/i);
    // Legible before the click — the server still refuses it, but the approver
    // should not have to discover that from a 422.
    expect(cell).toHaveTextContent("2");
  });

  it("does not mark an overdraw on a type that is allowed to go negative", async () => {
    leaveBalances.mockResolvedValue([balance({ balance: -3, allow_negative: true })]);
    renderScreen(<LeavePage />, {});

    const tbl = await table();
    expect(await tbl.findByText("-3")).toBeInTheDocument();
    expect(tbl.queryByTitle(/overdraw/i)).not.toBeInTheDocument();
  });

  it("asks for each employee's balance once, however many rows they have", async () => {
    listLeave.mockResolvedValue([
      REQUEST,
      { ...REQUEST, leave_request_id: "r2", starts_on: "2026-09-01", ends_on: "2026-09-02", days: 2 },
      { ...REQUEST, leave_request_id: "r3", employee_id: "e2", employee_name: "Bo Nkemi" },
    ]);
    renderScreen(<LeavePage />, {});

    await (await table()).findByText("Bo Nkemi");
    // Two employees, three rows. A per-row fetch would be three calls, and on a
    // real pending queue a great many more.
    await vi.waitFor(() => expect(leaveBalances).toHaveBeenCalledTimes(2));
    expect(leaveBalances.mock.calls.map((c) => c[0]).sort()).toEqual(["e1", "e2"]);
  });

  it("asks for no balance at all on a salary advance", async () => {
    listLeave.mockResolvedValue([
      { ...REQUEST, kind: "salary_advance", leave_type_id: null, leave_type_name: null, days: null, amount: 50000 },
    ]);
    renderScreen(<LeavePage />, {});

    await (await table()).findByText("Ada Mbarga");
    // Advances consume no entitlement, so there is nothing to ask about.
    expect(leaveBalances).not.toHaveBeenCalled();
  });

  it("still renders the queue when a balance cannot be read", async () => {
    leaveBalances.mockRejectedValue(new Error("nope"));
    renderScreen(<LeavePage />, {});

    // A balance we could not fetch must not blank the row — the decision is
    // still available, and the server remains the thing that enforces it.
    const tbl = await table();
    expect(await tbl.findByText("Ada Mbarga")).toBeInTheDocument();
    expect(await tbl.findByRole("button", { name: /approve/i })).toBeInTheDocument();
  });

  it("offers Cancel on an approved request and nothing on a rejected one", async () => {
    listLeave.mockResolvedValue([
      { ...REQUEST, status: "APPROVED" },
      { ...REQUEST, leave_request_id: "r9", employee_id: "e2", employee_name: "Bo Nkemi", status: "REJECTED" },
    ]);
    renderScreen(<LeavePage />, {});

    await (await table()).findByText("Bo Nkemi");
    // APPROVED used to be terminal, so a booking nobody wanted stood forever.
    expect((await rowFor("Ada Mbarga")).getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    // A rejected request has nothing to give back.
    expect((await rowFor("Bo Nkemi")).queryByRole("button")).toBeNull();
  });

  it("gives the days back when Cancel is pressed", async () => {
    listLeave.mockResolvedValue([{ ...REQUEST, status: "APPROVED" }]);
    renderScreen(<LeavePage />, {});

    const row = await rowFor("Ada Mbarga");
    await userEvent.click(row.getByRole("button", { name: /cancel/i }));

    expect(cancelLeave).toHaveBeenCalledWith("r1");
  });

  it("surfaces the server's refusal when an approval is short", async () => {
    // A real INSUFFICIENT_LEAVE from the server — a 422 whose useful half is
    // the per-field detail, which `errMsg` renders in preference to the
    // sentence (API F-2).
    decideLeave.mockRejectedValue(
      new ApiError(
        "INSUFFICIENT_LEAVE",
        "Not enough annual leave: 2 day(s) available, 5 requested",
        422,
        { days: ["2 day(s) available for 2026."] },
      ),
    );
    renderScreen(<LeavePage />, {});

    const row = await rowFor("Ada Mbarga");
    await userEvent.click(row.getByRole("button", { name: /approve/i }));

    expect(await screen.findByText(/2 day\(s\) available for 2026/i)).toBeInTheDocument();
  });
});
