"use strict";

/**
 * The domain DNS check, pinned.
 *
 * Registering a custom domain writes the row that makes it serve the public
 * site. It does not make the domain resolve — that half is at the client's
 * registrar, and it is the step most likely to be half-done. This check is what
 * turns "did you add the record?" into an answer.
 *
 * Classification is tested WITHOUT a network. A test that resolves a real name
 * depends on somebody else's zone and on the runner having DNS, so it fails on
 * a train and goes red for reasons that have nothing to do with the diff.
 */

const fs = require("fs");
const path = require("path");
const { STATES, classify, checkHost } = require("../../src/shared/net/dns-target");

const HERE = "51.254.165.120";
const ELSEWHERE = "37.59.83.88";

describe("classify", () => {
  it("is ok when the expected IP is among the records", () => {
    expect(classify([HERE], HERE)).toEqual({ state: STATES.OK, ok: true });
  });

  it("is ok when the zone carries extra A records alongside ours", () => {
    // Membership, not equality: a second A record is legitimate, and demanding
    // an exact match would report a correctly-pointed domain as broken.
    expect(classify([ELSEWHERE, HERE], HERE).ok).toBe(true);
  });

  it("separates 'pointed somewhere else' from 'not pointed at all'", () => {
    // These need different replies. Collapsing both into "not working" is what
    // makes the support thread long.
    expect(classify([ELSEWHERE], HERE)).toEqual({ state: STATES.WRONG_TARGET, ok: false });
    expect(classify([], HERE)).toEqual({ state: STATES.UNRESOLVED, ok: false });
  });

  it("admits when WE are the ones not configured", () => {
    // PUBLIC_INGRESS_IP unset — no verdict is possible, and reporting the
    // client's domain as broken would blame them for our gap.
    expect(classify([HERE], "")).toEqual({ state: STATES.UNCONFIGURED, ok: false });
    expect(classify([], undefined)).toEqual({ state: STATES.UNCONFIGURED, ok: false });
  });

  it("tolerates a junk resolver result rather than throwing", () => {
    expect(classify(null, HERE).state).toBe(STATES.UNRESOLVED);
    expect(classify([null, undefined], HERE).state).toBe(STATES.UNRESOLVED);
  });
});

describe("checkHost", () => {
  it("reports the records it found alongside the verdict", async () => {
    const out = await checkHost("staging.smartls.cm", HERE, async () => [HERE]);
    expect(out).toEqual({
      host: "staging.smartls.cm",
      resolved: [HERE],
      expected: HERE,
      state: STATES.OK,
      ok: true,
    });
  });

  it("treats a failed lookup as 'not pointing here', not as an error", async () => {
    // NXDOMAIN, SERVFAIL and a timeout all mean the same thing to the person
    // reading the console, and a 500 would make a normal onboarding state look
    // like an outage.
    const out = await checkHost("nope.example", HERE, async () => {
      throw Object.assign(new Error("queryA ENOTFOUND"), { code: "ENOTFOUND" });
    });
    expect(out.state).toBe(STATES.UNRESOLVED);
    expect(out.ok).toBe(false);
    expect(out.resolved).toEqual([]);
  });

  it("nulls `expected` when we have no ingress IP configured", async () => {
    const out = await checkHost("x.example", "", async () => [HERE]);
    expect(out.expected).toBeNull();
    expect(out.state).toBe(STATES.UNCONFIGURED);
  });
});

describe("wiring", () => {
  const repo = path.resolve(__dirname, "../..");
  const routes = fs.readFileSync(
    path.join(repo, "src/modules/platform/platform.routes.js"),
    "utf8",
  );

  it("exposes the check as a read, under the read capability", () => {
    // It resolves names and writes nothing. Gating it on tenants.write would
    // hide it from exactly the people who triage a domain that is not working.
    expect(routes).toContain(
      'router.get("/tenants/:slug/domains/dns", requireCap("tenants.read"), c.domainDns);',
    );
  });

  it("declares the ingress IP as configuration, defaulted to empty", () => {
    const env = fs.readFileSync(path.join(repo, "src/config/env.js"), "utf8");
    expect(env).toMatch(/PUBLIC_INGRESS_IP:\s*z\.string\(\)\.trim\(\)\.default\(""\)/);
  });
});
