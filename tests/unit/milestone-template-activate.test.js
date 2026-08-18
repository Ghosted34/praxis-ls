"use strict";
/**
 * Template rollback (10708b) — re-activating a superseded version.
 *
 * ── WHAT THIS PROTECTS ─────────────────────────────────────────────────────
 *
 * Before `activateTemplate`, the only way back to an older chain was to
 * publish ANOTHER new version — which bumps the counter and leaves a "v4"
 * that is byte-identical to v2, a lie in the ledger. Activation re-points
 * "active" at the existing version instead, so the register stays an honest
 * history.
 *
 * The properties that matter:
 *   · activating sets `is_active` on the target and deactivates everything
 *     else for that service type — there is always exactly ONE active chain;
 *   · activating the already-active version is a no-op, not an error;
 *   · existing dossiers are untouched (nothing about instances is written).
 */

const mockEmit = jest.fn();
const mockAudit = jest.fn();
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: (...a) => mockEmit(...a),
  audit: (...a) => mockAudit(...a),
  resolveActorId: jest.fn().mockResolvedValue("user-1"),
}));

const repo = require("../../src/modules/operations/milestone/milestone.repo");
const service = require("../../src/modules/operations/milestone/milestone.service");

const TPL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SVC_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const client = { query: jest.fn().mockResolvedValue({ rows: [] }) };

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(repo, "updateTemplate").mockImplementation(async (_c, _id, patch) => patch);
  jest.spyOn(repo, "deactivateOthers").mockResolvedValue(undefined);
  jest.spyOn(repo, "getTemplate").mockResolvedValue({ milestone_template_id: TPL_ID, service_type_id: SVC_ID, version: 2, is_active: true });
});

describe("service.activateTemplate", () => {
  it("re-activates the version and deactivates everything else for the service type", async () => {
    jest.spyOn(repo, "getTemplate")
      .mockResolvedValueOnce({ milestone_template_id: TPL_ID, service_type_id: SVC_ID, version: 2, is_active: false }) // before
      .mockResolvedValueOnce({ milestone_template_id: TPL_ID, service_type_id: SVC_ID, version: 2, is_active: true }); // after

    const row = await service.activateTemplate(client, { id: TPL_ID, actor: { user_id: "user-1" } });

    expect(repo.updateTemplate).toHaveBeenCalledWith(client, TPL_ID, { is_active: true });
    expect(repo.deactivateOthers).toHaveBeenCalledWith(client, SVC_ID, TPL_ID);
    expect(row.is_active).toBe(true);
    expect(mockEmit).toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalled();
  });

  it("is a no-op on the already-active version — the button can be pressed twice", async () => {
    jest.spyOn(repo, "getTemplate").mockResolvedValue({
      milestone_template_id: TPL_ID, service_type_id: SVC_ID, version: 2, is_active: true,
    });

    const row = await service.activateTemplate(client, { id: TPL_ID, actor: {} });

    expect(repo.updateTemplate).not.toHaveBeenCalled();
    expect(repo.deactivateOthers).not.toHaveBeenCalled();
    expect(row.is_active).toBe(true);
  });

  it("returns null for a template that does not exist", async () => {
    jest.spyOn(repo, "getTemplate").mockResolvedValue(null);

    const row = await service.activateTemplate(client, { id: "missing", actor: {} });
    expect(row).toBeNull();
    expect(repo.updateTemplate).not.toHaveBeenCalled();
  });
});
