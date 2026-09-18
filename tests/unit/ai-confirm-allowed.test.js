"use strict";
/**
 * Audit E2 — the post-confirm auto-continue used to run with `allowed: undefined`,
 * silently dropping the caller's confidentiality tags on the follow-up turn. The
 * service layer must thread `allowed` from the controller through to the
 * orchestrator's confirmAction / confirmBatch.
 */
jest.mock("../../src/services/ai/orchestrator.service", () => ({
  confirmAction: jest.fn(async () => ({ ok: true })),
  confirmBatch: jest.fn(async () => ({ ok: true })),
  ask: jest.fn(),
  askStream: jest.fn(),
}));
// Avoid walking every *.ai.js manifest at import; the executor map is irrelevant here.
jest.mock("../../src/services/ai/action-registrar", () => ({ buildExecutorMap: () => ({}) }));

const orchestrator = require("../../src/services/ai/orchestrator.service");
const service = require("../../src/modules/ai/assistant/assistant.service");

const user = { user_id: "u1" };

beforeEach(() => jest.clearAllMocks());

test("confirm() threads the caller's confidentiality tags to the orchestrator (audit E2)", async () => {
  await service.confirm({}, { user, actionRunId: "run1", allowed: ["normal", "payroll"] });
  expect(orchestrator.confirmAction).toHaveBeenCalledWith(
    expect.objectContaining({ allowed: ["normal", "payroll"] }),
  );
});

test("confirmBatch() threads allowed too", async () => {
  await service.confirmBatch({}, { user, batchId: "b1", allowed: ["normal", "payroll"] });
  expect(orchestrator.confirmBatch).toHaveBeenCalledWith(
    expect.objectContaining({ allowed: ["normal", "payroll"] }),
  );
});
