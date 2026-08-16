"use strict";
/**
 * Approving leave against a balance (0696).
 *
 * ── THE BUG THIS CLOSES ────────────────────────────────────────────────────
 *
 * `decide` used to flip a status. There was no entitlement in the schema, so an
 * approver approved against NOTHING: the screen showed a name and two dates,
 * the manager clicked Approve, and no part of the system knew whether that
 * person had a day left or had now taken forty.
 *
 * The check lives at APPROVAL, not at request time, and that placement is the
 * point — a fortnight can pass between the two, and three other requests can be
 * approved in between. A request that was affordable when it was raised may not
 * be when it is decided.
 */

const repo = require("../../src/modules/hr/leave_allowance/leave_allowance.repo");
const employees = require("../../src/modules/master/employees/employees.service");
const emit = require("../../src/shared/events/emit");
const guard = require("../../src/services/workflow/pending-guard");
const service = require("../../src/modules/hr/leave_allowance/leave_allowance.service");
const { AppError } = require("../../src/utils/errors");

const ANNUAL = {
  leave_type_id: "type-annual", code: "ANNUAL", name: "Annual leave",
  is_active: true, counts_working_days: true, requires_document: false,
  allow_negative: false, accrual_days_per_month: 1.5, max_days_per_year: null,
};

/** A client that answers the settings read `weekendDays` makes. Nothing here
 *  exercises SQL — every repo call is faked below — but the service reads
 *  `hr.weekend_days` through the real settings helper, and that helper queries. */
const db = { query: async () => ({ rows: [] }) };

const REQUEST = {
  leave_request_id: "req-1", employee_id: "e1", kind: "leave",
  leave_type_id: "type-annual", starts_on: "2026-08-03", ends_on: "2026-08-07",
  days: 5, status: "REQUESTED",
};

/** The ledger as a list, so a test can say "they have 6 days" in one line. */
function withLedger(entries) {
  const posted = [];
  jest.spyOn(repo, "ledgerFor").mockResolvedValue(entries);
  jest.spyOn(repo, "insertLedger").mockImplementation(async (_c, e) => {
    posted.push(e);
    return { ...e, leave_ledger_id: "led-" + posted.length };
  });
  return posted;
}

beforeEach(() => {
  jest.spyOn(repo, "findType").mockResolvedValue(ANNUAL);
  jest.spyOn(repo, "findTypeByCode").mockResolvedValue(ANNUAL);
  jest.spyOn(repo, "listHolidays").mockResolvedValue([]);
  jest.spyOn(repo, "overlappingRequests").mockResolvedValue([]);
  jest.spyOn(repo, "update").mockImplementation(async (_c, id, patch) => ({ ...REQUEST, leave_request_id: id, ...patch }));
  jest.spyOn(employees, "assertActive").mockResolvedValue(true);
  jest.spyOn(emit, "emitEvent").mockResolvedValue(undefined);
  jest.spyOn(emit, "audit").mockResolvedValue(undefined);
  jest.spyOn(guard, "assertNoPendingChain").mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("approving leave", () => {
  it("charges the ledger when the balance covers it", async () => {
    jest.spyOn(repo, "findById").mockResolvedValue(REQUEST);
    const posted = withLedger([{ kind: "ACCRUAL", days: 9 }]);

    const row = await service.decide(db, { id: "req-1", status: "APPROVED", actor: { user_id: "u1" } });

    expect(row.status).toBe("APPROVED");
    expect(posted).toHaveLength(1);
    // NEGATIVE: entitlement is being consumed, and the sign is the design —
    // a magnitude plus a kind would make every reader remember which kinds
    // subtract.
    expect(posted[0]).toMatchObject({
      kind: "TAKEN", days: -5, employee_id: "e1", leave_type_id: "type-annual",
      period_year: 2026, leave_request_id: "req-1",
    });
  });

  it("refuses the approval when the balance is short, and posts nothing", async () => {
    jest.spyOn(repo, "findById").mockResolvedValue(REQUEST);
    const posted = withLedger([{ kind: "ACCRUAL", days: 3 }]);

    await expect(service.decide(db, { id: "req-1", status: "APPROVED", actor: {} }))
      .rejects.toMatchObject({ code: "INSUFFICIENT_LEAVE", status: 422 });

    // The check runs BEFORE the status moves, in the caller's transaction — a
    // refusal must leave neither a ledger entry nor an approved request.
    expect(posted).toHaveLength(0);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it("counts leave already taken against the balance", async () => {
    jest.spyOn(repo, "findById").mockResolvedValue(REQUEST);
    // 9 accrued, 5 already taken → 4 left, and this request wants 5.
    const posted = withLedger([{ kind: "ACCRUAL", days: 9 }, { kind: "TAKEN", days: -5 }]);

    await expect(service.decide(db, { id: "req-1", status: "APPROVED", actor: {} }))
      .rejects.toMatchObject({ code: "INSUFFICIENT_LEAVE" });
    expect(posted).toHaveLength(0);
  });

  it("lets a type that allows it go negative", async () => {
    // Advancing next year's leave is a real decision an employer makes. What it
    // must not be is an accident — so it is a property of the TYPE, not an
    // override on the button.
    jest.spyOn(repo, "findType").mockResolvedValue({ ...ANNUAL, allow_negative: true });
    jest.spyOn(repo, "findById").mockResolvedValue(REQUEST);
    const posted = withLedger([]);

    const row = await service.decide(db, { id: "req-1", status: "APPROVED", actor: {} });

    expect(row.status).toBe("APPROVED");
    expect(posted[0]).toMatchObject({ kind: "TAKEN", days: -5 });
  });

  it("charges nothing when the request is rejected", async () => {
    jest.spyOn(repo, "findById").mockResolvedValue(REQUEST);
    const posted = withLedger([{ kind: "ACCRUAL", days: 9 }]);

    const row = await service.decide(db, { id: "req-1", status: "REJECTED", actor: {} });

    expect(row.status).toBe("REJECTED");
    expect(posted).toHaveLength(0);
  });

  it("charges nothing for a salary advance", async () => {
    // Advances and missions share this table because they share the
    // request-and-approve shape. They are not leave and consume no entitlement.
    jest.spyOn(repo, "findById").mockResolvedValue({ ...REQUEST, kind: "salary_advance", leave_type_id: null, days: null, amount: 50000 });
    const posted = withLedger([]);

    const row = await service.decide(db, { id: "req-1", status: "APPROVED", actor: {} });

    expect(row.status).toBe("APPROVED");
    expect(posted).toHaveLength(0);
  });

  it("refuses a request that was never priced rather than charging zero", async () => {
    // A pre-0696 row. Charging it as zero days would consume nothing and still
    // read as approved leave — the one outcome worse than refusing.
    jest.spyOn(repo, "findById").mockResolvedValue({ ...REQUEST, days: null });
    const posted = withLedger([{ kind: "ACCRUAL", days: 9 }]);

    await expect(service.decide(db, { id: "req-1", status: "APPROVED", actor: {} }))
      .rejects.toBeInstanceOf(AppError);
    expect(posted).toHaveLength(0);
  });
});

describe("cancelling leave", () => {
  it("gives the days back with an opposite entry, not by deleting the consumption", async () => {
    jest.spyOn(repo, "findById").mockResolvedValue({ ...REQUEST, status: "APPROVED" });
    const posted = withLedger([{ kind: "ACCRUAL", days: 9 }, { kind: "TAKEN", days: -5 }]);

    const row = await service.cancel(db, { id: "req-1", actor: { user_id: "u1" } });

    expect(row.status).toBe("CANCELLED");
    // The record should show that leave was booked and returned, not pretend it
    // never happened.
    expect(posted).toEqual([expect.objectContaining({ kind: "RETURNED", days: 5, leave_request_id: "req-1" })]);
  });

  it("returns nothing for a request that was never approved", async () => {
    jest.spyOn(repo, "findById").mockResolvedValue({ ...REQUEST, status: "REQUESTED" });
    const posted = withLedger([]);

    const row = await service.cancel(db, { id: "req-1", actor: {} });

    expect(row.status).toBe("CANCELLED");
    expect(posted).toHaveLength(0);
  });

  it("refuses to cancel a request that is already finished", async () => {
    jest.spyOn(repo, "findById").mockResolvedValue({ ...REQUEST, status: "REJECTED" });
    await expect(service.cancel(db, { id: "req-1", actor: {} }))
      .rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe("raising a request", () => {
  it("prices it in working days and stores the count", async () => {
    const created = [];
    jest.spyOn(repo, "create").mockImplementation(async (_c, data) => {
      created.push(data);
      return { ...data, leave_request_id: "new-1" };
    });

    await service.create(db, { data: { employee_id: "e1", kind: "leave", starts_on: "2026-08-03", ends_on: "2026-08-10" }, actor: {} });

    // Mon 3rd → Mon 10th is six working days, not eight calendar ones.
    expect(created[0]).toMatchObject({ days: 6, leave_type_id: "type-annual" });
  });

  it("refuses a request that overlaps leave already booked", async () => {
    jest.spyOn(repo, "overlappingRequests").mockResolvedValue([
      { leave_request_id: "other", starts_on: "2026-08-05", ends_on: "2026-08-12", status: "APPROVED" },
    ]);

    await expect(service.create(db, {
      data: { employee_id: "e1", kind: "leave", starts_on: "2026-08-03", ends_on: "2026-08-07" }, actor: {},
    })).rejects.toMatchObject({ code: "LEAVE_OVERLAP", status: 409 });
  });

  it("refuses a span with no working days in it", async () => {
    // Sat + Sun. Nearly always a typo, and an approval would charge nothing.
    await expect(service.create(db, {
      data: { employee_id: "e1", kind: "leave", starts_on: "2026-08-01", ends_on: "2026-08-02" }, actor: {},
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("refuses a type that demands evidence when none is attached", async () => {
    jest.spyOn(repo, "findType").mockResolvedValue({ ...ANNUAL, name: "Sick leave", requires_document: true });

    await expect(service.create(db, {
      data: { employee_id: "e1", kind: "leave", leave_type_id: "type-annual", starts_on: "2026-08-03", ends_on: "2026-08-07" }, actor: {},
    })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("refuses a request attached to nobody", async () => {
    // employee_id was optional, which allowed a request that could never be
    // approved, counted or shown in My HR.
    await expect(service.create(db, { data: { kind: "leave", starts_on: "2026-08-03", ends_on: "2026-08-07" }, actor: {} }))
      .rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
