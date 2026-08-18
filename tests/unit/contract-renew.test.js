"use strict";
/**
 * Contract renewal (10708) — the action `renews_contract_id` (0700) has been
 * waiting for.
 *
 * ── THE PROPERTIES THAT MATTER ────────────────────────────────────────────
 *
 * A renewal SUPERSEDES; it never mutates the signed record. The new row:
 *   · carries the TERMS that stay true (job title, salary, notice, working
 *     hours, place of work, probation) as columns;
 *   · does NOT copy the signed text — the old `body_md` has the old dates in
 *     it, and the new DRAFT is exactly the state redrafting exists for;
 *   · starts the day after the old term ends and keeps the old term's LENGTH;
 *   · points back at the contract it renews via `renews_contract_id`.
 * A DRAFT has no agreed term, so renewing one is refused.
 */

const mockEmit = jest.fn();
const mockAudit = jest.fn();
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: (...a) => mockEmit(...a),
  audit: (...a) => mockAudit(...a),
  resolveActorId: jest.fn().mockResolvedValue("user-1"),
}));

const mockAssertActive = jest.fn();
jest.mock("../../src/modules/master/employees/employees.service", () => ({
  assertActive: (...a) => mockAssertActive(...a),
}));

const repo = require("../../src/modules/hr/hr_contract/hr_contract.repo");
const service = require("../../src/modules/hr/hr_contract/hr_contract.service");

const CID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const client = {};

const SIGNED = {
  hr_contract_id: CID,
  employee_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  kind: "EMPLOYMENT",
  status: "SIGNED",
  title: "Employment contract",
  effective_on: "2025-09-01",
  end_on: "2026-08-31",
  gross_salary: 450000,
  salary_currency: "XAF",
  probation_months: 3,
  notice_days: 30,
  working_hours: "08:00–17:00",
  place_of_work: "Douala",
  vacancy_id: null,
};

beforeEach(() => {
  jest.restoreAllMocks();
  mockAssertActive.mockResolvedValue(true);
});

describe("service.renew", () => {
  it("creates a DRAFT that supersedes the signed contract, terms carried", async () => {
    const created = jest.fn(async (_c, data) => ({ hr_contract_id: "new-id", ...data }));
    jest.spyOn(repo, "findById").mockResolvedValue(SIGNED);
    jest.spyOn(repo, "create").mockImplementation(created);

    const row = await service.renew(client, { id: CID, actor: { user_id: "user-1" } });

    expect(repo.create).toHaveBeenCalled();
    const payload = repo.create.mock.calls[0][1];
    expect(payload).toMatchObject({
      employee_id: SIGNED.employee_id,
      kind: "EMPLOYMENT",
      status: "DRAFT",
      renews_contract_id: CID,
      gross_salary: 450000,
      salary_currency: "XAF",
      probation_months: 3,
      notice_days: 30,
      working_hours: "08:00–17:00",
      place_of_work: "Douala",
    });
    // The signed text is NOT copied — the old prose carries the old dates.
    expect(payload.body_md).toBeUndefined();
    expect(mockAssertActive).toHaveBeenCalledWith(client, SIGNED.employee_id);
    expect(row.status).toBe("DRAFT");
    expect(mockEmit).toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalled();
  });

  it("starts the day after the old term ends and keeps the term's length", async () => {
    jest.spyOn(repo, "findById").mockResolvedValue(SIGNED);
    jest.spyOn(repo, "create").mockImplementation(async (_c, data) => data);

    await service.renew(client, { id: CID, actor: {} });
    const payload = repo.create.mock.calls[0][1];

    expect(payload.effective_on).toBe("2026-09-01");
    // 2025-09-01 → 2026-08-31 is 364 days; the renewal mirrors it.
    expect(payload.end_on).toBe("2027-08-31");
    // Probation re-derived from the NEW effective date.
    expect(payload.probation_ends_on).toBe("2026-12-01");
  });

  it("lets the caller override the new term's dates", async () => {
    jest.spyOn(repo, "findById").mockResolvedValue(SIGNED);
    jest.spyOn(repo, "create").mockImplementation(async (_c, data) => data);

    await service.renew(client, { id: CID, effective_on: "2026-10-01", end_on: "2027-09-30", actor: {} });

    const payload = repo.create.mock.calls[0][1];
    expect(payload.effective_on).toBe("2026-10-01");
    expect(payload.end_on).toBe("2027-09-30");
    expect(payload.probation_ends_on).toBe("2027-01-01");
  });

  it("refuses to renew a DRAFT — there is no agreed term to continue", async () => {
    jest.spyOn(repo, "findById").mockResolvedValue({ ...SIGNED, status: "DRAFT" });
    jest.spyOn(repo, "create");

    await expect(service.renew(client, { id: CID, actor: {} })).rejects.toThrow(/no agreed term/);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("refuses a contract with no employee rather than minting an orphan", async () => {
    jest.spyOn(repo, "findById").mockResolvedValue({ ...SIGNED, employee_id: null });
    jest.spyOn(repo, "create");

    await expect(service.renew(client, { id: CID, actor: {} })).rejects.toThrow(/no employee/);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe("addDays", () => {
  it("adds across month and year boundaries", () => {
    expect(service.addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(service.addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(service.addDays("2026-02-28", 4)).toBe("2026-03-04");
  });

  it("returns null for a non-date input", () => {
    expect(service.addDays("not-a-date", 1)).toBeNull();
  });
});
