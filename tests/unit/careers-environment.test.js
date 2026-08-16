"use strict";
/**
 * Which environment a careers link opens in.
 *
 * WHAT BROKE. The public page is unauthenticated, so a candidate sends no
 * `X-Praxis-Env` and tenant-context resolves them to LIVE. But the client
 * attaches that header from the VIEWER's localStorage — so whether a careers
 * link worked depended on who was holding it: it opened for the recruiter who
 * had just been in Test, and answered "no longer accepting applications" to the
 * candidate they sent it to. A public URL has to mean the same thing to
 * everyone.
 *
 * SO THE TOKEN DECIDES. It is minted per vacancy and is the only way in, which
 * makes it the one thing both viewers share. Live is tried first so a real role
 * can never be shadowed by a rehearsal, the environment travels with the answer
 * so the page can badge a Test posting as TEST, and an application is written
 * where the role lives rather than somewhere its recruiter will never look.
 */

const service = require("../../src/modules/hr/careers/careers.service");
const vacancyRepo = require("../../src/modules/hr/vacancy/vacancy.repo");

/** A request whose two environments hold different rows. */
function fakeReq({ live = null, sandbox = null, hasSandbox = true } = {}) {
  const seen = [];
  return {
    seen,
    tenant: { slug: "t", sandbox_schema: hasSandbox ? "sandbox_schema" : null },
    tenantDbIn(env, fn) {
      seen.push(env);
      return fn({ env });
    },
  };
}

beforeEach(() => {
  jest.spyOn(vacancyRepo, "publishedByToken").mockImplementation(async (client) =>
    client.env === "live" ? global.__live : global.__sandbox,
  );
});
afterEach(() => {
  jest.restoreAllMocks();
  delete global.__live;
  delete global.__sandbox;
});

describe("careers — the token chooses the environment", () => {
  it("serves a live role and says so", async () => {
    global.__live = { vacancy_id: "v1", title: "Accountant", public_token: "tok", skills_required: [] };
    const req = fakeReq();

    const out = await service.get(req, "tok");
    expect(out.title).toBe("Accountant");
    expect(out.environment).toBe("live");
    // Found in live: the second schema is never touched.
    expect(req.seen).toEqual(["live"]);
  });

  it("falls through to Test, and marks the page TEST", async () => {
    global.__sandbox = { vacancy_id: "v2", title: "Rehearsal", public_token: "tok", skills_required: [] };
    const req = fakeReq();

    const out = await service.get(req, "tok");
    expect(out.title).toBe("Rehearsal");
    // This is what the public page badges on.
    expect(out.environment).toBe("sandbox");
    expect(req.seen).toEqual(["live", "sandbox"]);
  });

  it("prefers live when a token somehow exists in both", async () => {
    global.__live = { vacancy_id: "v1", title: "Real", public_token: "tok", skills_required: [] };
    global.__sandbox = { vacancy_id: "v2", title: "Rehearsal", public_token: "tok", skills_required: [] };

    const out = await service.get(fakeReq(), "tok");
    expect(out.title).toBe("Real");
  });

  it("does not pay for a second lookup on a workspace with no Test schema", async () => {
    const req = fakeReq({ hasSandbox: false });
    await expect(service.get(req, "tok")).rejects.toMatchObject({ status: 404 });
    expect(req.seen).toEqual(["live"]);
  });

  it("still refuses an unknown token the same way, in both", async () => {
    const req = fakeReq();
    // Closed, unpublished and never-existed are deliberately indistinguishable
    // — nobody should be able to enumerate a company's vacancies.
    await expect(service.get(req, "nope")).rejects.toMatchObject({
      status: 404,
      message: "This role is no longer accepting applications",
    });
  });
});
