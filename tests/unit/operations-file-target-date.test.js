/**
 * The milestone chain re-plans when the date it is scheduled against moves.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────────
 *
 * `milestone.recalculate` ran on ADVANCE, REOPEN and INSERT, and from a manual
 * button. Its validator has accepted a `TARGET_CHANGED` trigger since the weighted
 * engine shipped — and nothing in the codebase ever sent one. `grep TARGET_CHANGED`
 * returned exactly one line: the enum that declares it.
 *
 * So setting or correcting a file's promised delivery date left every downstream
 * stage on dates computed from the old target, and the only way to make the chain
 * agree with the file was for somebody to notice and press Recalculate. Dates that
 * are quietly wrong, which is the failure mode the whole engine exists to remove.
 *
 * ── WHY IT MATTERS MORE THAN "the dates refresh" ────────────────────────────
 *
 * `is_target_lock` marks the SLA-protected stage: upstream slip is supposed to
 * COMPRESS the remaining stages toward the committed date rather than move it, and
 * then report the breach. It cannot do that against a date it was never told
 * changed.
 */
"use strict";

const mockRecalculate = jest.fn();
const mockApplyValues = jest.fn();
const mockResolveMany = jest.fn();

jest.mock("../../src/modules/operations/milestone/milestone.service", () => ({
  recalculate: (...a) => mockRecalculate(...a),
  instantiate: jest.fn(),
}));
jest.mock("../../src/modules/operations/shipment_details/shipment_details.service", () => ({
  applyValues: (...a) => mockApplyValues(...a),
}));
jest.mock("../../src/modules/operations/geo_place/geo_place.service", () => ({
  resolveMany: (...a) => mockResolveMany(...a),
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(),
  audit: jest.fn(),
  resolveActorId: jest.fn(),
}));

const repo = require("../../src/modules/operations/operations_file/operations_file.repo");
const service = require("../../src/modules/operations/operations_file/operations_file.service");
const { logger } = require("../../src/config/logger");

const DOSSIER = {
  dossier_id: "d-1",
  ref: "SLAS-2026-0007",
  status: "OPEN",
  service_type_id: "st-1",
  service_type_field_set_id: "fs-1",
  details_json: {},
  pol: "Shanghai",
  pol_place_id: "gp-shanghai",
  pod: "Douala",
  pod_place_id: "gp-douala",
  eta: "2026-09-01",
  promised_delivery_date: "2026-09-10",
};

/** `update` with a patch, against a `before` and the row the repo returns after. */
async function update(patch, after = {}) {
  const before = { ...DOSSIER };
  jest.spyOn(repo, "get").mockResolvedValue(before);
  jest.spyOn(repo, "update").mockResolvedValue({ ...before, ...patch, ...after });
  return service.update({}, { id: "d-1", patch, actor: { user_id: "u-1" } });
}

beforeEach(() => {
  jest.restoreAllMocks();
  mockRecalculate.mockReset().mockResolvedValue({ changed: 3 });
  mockApplyValues.mockReset().mockResolvedValue({ patch: {} });
  mockResolveMany.mockReset().mockResolvedValue(new Map());
});

describe("moving the target date re-plans the chain", () => {
  test("a new promised delivery date fires TARGET_CHANGED", async () => {
    await update({ promised_delivery_date: "2026-09-25" });
    expect(mockRecalculate).toHaveBeenCalledTimes(1);
    expect(mockRecalculate.mock.calls[0][1]).toMatchObject({
      dossierId: "d-1",
      trigger: "TARGET_CHANGED",
    });
  });

  test("so does a new ETA — it is rule 2 of the same cascade", async () => {
    // The engine falls back to the carrier's estimate when there is no promise, so
    // an ETA correction moves the horizon on exactly those files.
    await update({ eta: "2026-09-06" });
    expect(mockRecalculate).toHaveBeenCalledTimes(1);
    expect(mockRecalculate.mock.calls[0][1].trigger).toBe("TARGET_CHANGED");
  });

  test("setting a promise for the first time counts as a move", async () => {
    jest.spyOn(repo, "get").mockResolvedValue({ ...DOSSIER, promised_delivery_date: null });
    jest.spyOn(repo, "update").mockResolvedValue({ ...DOSSIER, promised_delivery_date: "2026-09-25" });
    await service.update({}, { id: "d-1", patch: { promised_delivery_date: "2026-09-25" }, actor: {} });
    // This is the case the new field creates: files that have never had one.
    expect(mockRecalculate).toHaveBeenCalledTimes(1);
  });

  test("clearing it counts too — the horizon falls back to the ETA", async () => {
    jest.spyOn(repo, "get").mockResolvedValue({ ...DOSSIER });
    jest.spyOn(repo, "update").mockResolvedValue({ ...DOSSIER, promised_delivery_date: null });
    await service.update({}, { id: "d-1", patch: { promised_delivery_date: null }, actor: {} });
    expect(mockRecalculate).toHaveBeenCalledTimes(1);
  });

  test("the actor travels, so the rebaseline log names who moved the date", async () => {
    await update({ promised_delivery_date: "2026-09-25" });
    expect(mockRecalculate.mock.calls[0][1].actor).toEqual({ user_id: "u-1" });
  });
});

describe("what does NOT trigger a re-plan", () => {
  test("an unrelated edit", async () => {
    // A re-plan on every save would rewrite planned dates and write a rebaseline
    // row for nothing, and the log is the audit trail behind every date a client
    // was shown.
    await update({ vessel_flight: "MSC ARUSHI" });
    expect(mockRecalculate).not.toHaveBeenCalled();
  });

  test("the same date sent again in a different shape", async () => {
    // These are `date` columns: they arrive as "2026-09-10" from a form and as a
    // Date from pg. Compared by value rather than by DAY, every save of an
    // untouched form would look like a change.
    await update({ promised_delivery_date: new Date("2026-09-10T00:00:00Z") });
    expect(mockRecalculate).not.toHaveBeenCalled();
  });

  test("a timestamp on the same day", async () => {
    await update({ eta: "2026-09-01T16:30:00.000Z" });
    expect(mockRecalculate).not.toHaveBeenCalled();
  });
});

describe("a chain that cannot be re-planned does not fail the save", () => {
  test("the edit is kept and the failure is logged with the file's ref", async () => {
    // A file whose ETA was just corrected must save. Stale dates are recoverable —
    // the next advance or a press of Recalculate fixes them — whereas a rejected
    // save loses the correction the operator just made.
    const warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
    mockRecalculate.mockRejectedValue(new Error("scheduler unavailable"));

    const row = await update({ promised_delivery_date: "2026-09-25" });

    expect(row.promised_delivery_date).toBe("2026-09-25");
    expect(warn).toHaveBeenCalled();
    const [payload, message] = warn.mock.calls[0];
    expect(payload.dossier).toBe("SLAS-2026-0007");
    expect(payload.moved).toEqual(["promised_delivery_date"]);
    expect(message).toMatch(/not re-planned/i);
  });
});
