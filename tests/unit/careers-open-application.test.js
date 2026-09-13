"use strict";
/**
 * The careers page when nothing is open (13792).
 *
 * Three behaviours, each of which is a decision somebody could reasonably
 * reverse without noticing what it cost:
 *
 *   1. AN OPEN APPLICATION IS GATED. The endpoint is unauthenticated and writes
 *      a row, so "is this tenant accepting these?" has to be answered by the
 *      SERVER. A page that hid the button would leave the endpoint open to a
 *      curl, and the switch would be a lie told to whoever set it.
 *   2. IT LANDS WHERE A RECRUITER LOOKS. `vacancy_id` NULL and `status`
 *      TALENT_POOL is not an arbitrary pair — it is what puts the candidate in
 *      0525's `searchPool`, which a recruiter already opens. Writing any other
 *      status, or the `talent_pool` bench table, puts a real person somewhere
 *      nobody is looking.
 *   3. THE CV ASYMMETRY SURVIVES. A file the CANDIDATE can fix must reach them;
 *      a failure that is OURS must never cost them the application. That
 *      asymmetry was broken once already on the role path (`err.status` vs
 *      `err.httpStatus`, which swallowed every rejected file), so it is pinned
 *      here on the new path rather than assumed to have been copied correctly.
 */

// `careers.service` DESTRUCTURES these at module load, so a `jest.spyOn` on the
// module object afterwards rebinds nothing. Mocked at the module boundary, which
// is also what `check-jest-mock-hoisting.js` expects to see.
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => null),
  audit: jest.fn(async () => null),
  resolveActorId: jest.fn(async () => null),
}));

const service = require("../../src/modules/hr/careers/careers.service");
const careersRepo = require("../../src/modules/hr/careers/careers.repo");
const vacancyRepo = require("../../src/modules/hr/vacancy/vacancy.repo");
const vault = require("../../src/modules/vault/document_vault/document_vault.service");
const { AppError } = require("../../src/utils/errors");

/** A request that records which schema each read and write went to. */
function fakeReq() {
  const envs = [];
  return {
    envs,
    tenant: { slug: "t", sandbox_schema: "sandbox_schema" },
    tenantDbIn(env, fn) {
      envs.push(env);
      return fn({ env });
    },
  };
}

const settings = (over = {}) => ({
  open_applications: false,
  alerts_enabled: false,
  culture_tag: null,
  ...over,
});

beforeEach(() => {
  jest
    .spyOn(vacancyRepo, "insertApplicant")
    .mockImplementation(async (_c, row) => ({
      applicant_id: "3f2a91cc-0000-4000-8000-000000000001",
      ...row,
    }));
});
afterEach(() => jest.restoreAllMocks());

const body = { full_name: "Ada Lovelace", email: "ada@example.com" };

describe("publicSettings", () => {
  it("reads live and narrows the row to what a stranger may see", async () => {
    jest.spyOn(careersRepo, "getSettings").mockResolvedValue({
      site_careers_id: "id",
      singleton: true,
      open_applications: true,
      alerts_enabled: false,
      culture_tag: "life",
      updated_by: "a-real-user-id",
      updated_at: "2026-01-01",
    });
    const req = fakeReq();
    const out = await service.publicSettings(req);

    expect(req.envs).toEqual(["live"]);
    // An allow-list, not a row: `updated_by` is a staff id and `updated_at` is
    // when somebody was last in the settings screen.
    expect(out).toEqual({
      open_applications: true,
      alerts_enabled: false,
      culture_tag: "life",
    });
  });

  it("falls back to everything-off rather than throwing on a read failure", async () => {
    // This is read on the first paint of a public page. A 500 here would take
    // the careers page down for a fault that has a correct quiet answer.
    jest.spyOn(careersRepo, "getSettings").mockRejectedValue(new Error("no db"));
    await expect(service.publicSettings(fakeReq())).resolves.toEqual({
      open_applications: false,
      alerts_enabled: false,
      culture_tag: null,
    });
  });
});

describe("applyOpen", () => {
  it("404s when the tenant has not switched open applications on", async () => {
    jest.spyOn(careersRepo, "getSettings").mockResolvedValue(settings());
    await expect(service.applyOpen(fakeReq(), { data: body, slug: "t" }))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(vacancyRepo.insertApplicant).not.toHaveBeenCalled();
  });

  it("writes a vacancy-less TALENT_POOL applicant, live-only, with no score", async () => {
    jest
      .spyOn(careersRepo, "getSettings")
      .mockResolvedValue(settings({ open_applications: true }));
    const req = fakeReq();
    const out = await service.applyOpen(req, { data: body, slug: "t" });

    // Both the settings read and the write go to live. There is no token to
    // choose a schema with, and a rehearsal workspace must not receive a real
    // person's CV.
    expect(req.envs).toEqual(["live", "live"]);

    const row = vacancyRepo.insertApplicant.mock.calls[0][1];
    expect(row.vacancy_id).toBeNull();
    expect(row.status).toBe("TALENT_POOL");
    expect(row.source).toBe("careers_open");
    // Nothing to score against. A number derived from no criteria, in the same
    // column as one derived from a role's, would make ai_score mean two things.
    expect(row.ai_score).toBeUndefined();
    expect(row.ai_provisional).toBeUndefined();

    // The receipt, and nothing the candidate could read themselves out of.
    expect(out).toEqual({
      received: true,
      reference: "3F2A91CC",
      cv_attached: false,
    });
  });

  it("records the application when OUR storage fails, and says the CV is missing", async () => {
    jest
      .spyOn(careersRepo, "getSettings")
      .mockResolvedValue(settings({ open_applications: true }));
    jest
      .spyOn(vault, "createDocument")
      .mockRejectedValue(new AppError("STORAGE_DOWN", "bucket unreachable", 503));

    const out = await service.applyOpen(fakeReq(), {
      data: { ...body, cv_data_url: "data:application/pdf;base64,AAAA" },
      slug: "t",
    });

    expect(out.received).toBe(true);
    expect(out.cv_attached).toBe(false);
    expect(vacancyRepo.insertApplicant).toHaveBeenCalled();
  });

  it("refuses, and tells the candidate, when the FILE is the problem", async () => {
    jest
      .spyOn(careersRepo, "getSettings")
      .mockResolvedValue(settings({ open_applications: true }));
    jest
      .spyOn(vault, "createDocument")
      .mockRejectedValue(new AppError("FILE_TOO_LARGE", "that file is 20 MB", 413));

    // The one thing they could fix in ten seconds. Swallowing it would confirm
    // an application whose CV nobody received.
    await expect(
      service.applyOpen(fakeReq(), {
        data: { ...body, cv_data_url: "data:application/pdf;base64,AAAA" },
        slug: "t",
      }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    expect(vacancyRepo.insertApplicant).not.toHaveBeenCalled();
  });
});

describe("job alerts", () => {
  it("404s when alerts are off", async () => {
    jest.spyOn(careersRepo, "getSettings").mockResolvedValue(settings());
    jest.spyOn(careersRepo, "subscribeAlert").mockResolvedValue({});
    await expect(
      service.subscribeAlert(fakeReq(), { data: { email: "a@b.com" } }),
    ).rejects.toMatchObject({ status: 404 });
    expect(careersRepo.subscribeAlert).not.toHaveBeenCalled();
  });

  it("mints a 32-byte token and defaults an unknown locale to French", async () => {
    jest
      .spyOn(careersRepo, "getSettings")
      .mockResolvedValue(settings({ alerts_enabled: true }));
    jest.spyOn(careersRepo, "subscribeAlert").mockResolvedValue({});

    await service.subscribeAlert(fakeReq(), {
      data: { email: "a@b.com", locale: "de" },
    });

    const arg = careersRepo.subscribeAlert.mock.calls[0][1];
    expect(arg.locale).toBe("fr");
    // base64url of 32 bytes — the same strength as a vacancy's public token,
    // because it is the same kind of thing: the only credential on an
    // unauthenticated action.
    expect(arg.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("answers the same whether the token matched or not", async () => {
    // A 404 on a miss is a way to probe which tokens exist.
    jest.spyOn(careersRepo, "unsubscribeAlert").mockResolvedValue(null);
    await expect(service.unsubscribeAlert(fakeReq(), "nope")).resolves.toEqual({
      unsubscribed: true,
    });
    jest.spyOn(careersRepo, "unsubscribeAlert").mockResolvedValue({ careers_alert_id: "x" });
    await expect(service.unsubscribeAlert(fakeReq(), "real")).resolves.toEqual({
      unsubscribed: true,
    });
  });
});
