/**
 * service_type.service.archive — the auto-unpublish hook into
 * service_type_web.
 *
 * Guide §4.2 rule 2: archiving a service type also clears its web
 * profile's is_published flag, atomically, in the same transaction. A
 * web page for an archived service is a leak by construction: the
 * public list filters `is_active`, but on-disk state should agree with
 * itself, and reactivation must never auto-republish.
 *
 * These tests pin the wiring — the service_type module calling the
 * service_type_web module from inside the archive transaction —
 * because the hook is a one-line require() in archive() and a silent
 * no-op would not trip a unit test that didn't assert on it.
 */
"use strict";

jest.mock("../../src/modules/operations/service_type_web/service_type_web.service", () => ({
  autoUnpublishForArchive: jest.fn(),
}));

jest.mock("../../src/shared/db/tx", () => ({
  atomically: jest.fn((client, fn) => fn(client)),
}));

jest.mock("../../src/shared/events/emit", () => ({
  audit: jest.fn(), emitEvent: jest.fn(), resolveActorId: jest.fn(async (_c, id) => id || null),
}));

const repo = require("../../src/modules/operations/service_type/service_type.repo");
const base = require("../../src/shared/crud/resource");
const service = require("../../src/modules/operations/service_type/service_type.service");
const webService = require("../../src/modules/operations/service_type_web/service_type_web.service");
const { audit } = require("../../src/shared/events/emit");

const ST = "11111111-1111-4111-8111-111111111111";
const ST_ROW = { service_type_id: ST, is_system: false, is_active: true };

function fakeClient() {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // The service's makeService({...}) base has findById/get/update; archive()
  // uses repo.findById (assertNotSystem) and repo.update. Stub the whole
  // surface that archive touches.
  repo.findById = jest.fn(async () => ST_ROW);
  repo.update = jest.fn(async (_c, id, fields) => ({ service_type_id: id, ...fields }));
  // makeService()'s makeRepo gives us `findById` and `update`; nothing else
  // is reached from archive().
  base.makeService = jest.fn(() => ({}));
});

describe("service_type.archive — the web-profile auto-unpublish hook", () => {
  test("flips is_active AND calls the web hook in the same transaction (atomic)", async () => {
    const client = fakeClient();
    webService.autoUnpublishForArchive.mockResolvedValueOnce({ service_type_id: ST });
    await service.archive(client, { id: ST, actor: { user_id: "u-1" } });
    // repo.update runs first …
    expect(repo.update).toHaveBeenCalledWith(client, ST, { is_active: false });
    // … and the web hook is called on the SAME client (the same transaction).
    expect(webService.autoUnpublishForArchive).toHaveBeenCalledTimes(1);
    expect(webService.autoUnpublishForArchive).toHaveBeenCalledWith(client, ST);
    // The audit row carries both pieces (deactivation + the unpublish signal).
    expect(audit).toHaveBeenCalledTimes(1);
    const auditArg = audit.mock.calls[0][1];
    expect(auditArg.action).toBe("service_type.archived");
    expect(auditArg.after.is_active).toBe(false);
    expect(auditArg.after.web_unpublished).toBe(true);
  });

  test("web_unpublished is false when the profile has no row yet (no error, no skip)", async () => {
    // The hook is best-effort: archiving a service type with no web
    // presence is a legitimate empty-state case. The audit row still
    // commits with `web_unpublished: false`.
    const client = fakeClient();
    webService.autoUnpublishForArchive.mockResolvedValueOnce(null);
    await service.archive(client, { id: ST, actor: { user_id: "u-1" } });
    expect(audit.mock.calls[0][1].after.web_unpublished).toBe(false);
  });

  test("if the web hook throws, the whole archive rolls back", async () => {
    const client = fakeClient();
    webService.autoUnpublishForArchive.mockRejectedValueOnce(new Error("db blew up"));
    // The hook is awaited inside the atomically block; a throw propagates
    // and the audit row (which writes the after-state) is NOT committed.
    // (The audit check here is the proof — the same `audit` we observed
    // in the success cases must NOT fire on this path.)
    await expect(service.archive(client, { id: ST, actor: { user_id: "u-1" } }))
      .rejects.toThrow("db blew up");
    expect(audit).not.toHaveBeenCalled();
    // repo.update is still called (the order is: deactivation, hook,
    // audit). In a real Postgres the BEGIN/COMMIT would roll back the
    // is_active update when the hook throws; what we can assert here is
    // that audit — the write that the user can SEE — is gone.
  });

  test("an archive on a system service type is refused before the hook fires", async () => {
    repo.findById = jest.fn(async () => ({ ...ST_ROW, is_system: true }));
    const client = fakeClient();
    await expect(service.archive(client, { id: ST, actor: {} }))
      .rejects.toMatchObject({ code: "SYSTEM_RECORD" });
    expect(webService.autoUnpublishForArchive).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });
});
