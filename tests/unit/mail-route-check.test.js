"use strict";

/**
 * The outbound route check, pinned.
 *
 * Classification is tested WITHOUT a network, for the same reason the domain DNS
 * check is: a test that resolves a real name depends on somebody else's zone and
 * on the runner having DNS, so it fails on a train for reasons unrelated to the
 * diff.
 *
 * The cases below are the real incident. A shared cPanel relay hosted the
 * tenant's website while their MX pointed at Microsoft 365; mail to that domain
 * was delivered into a local mailbox on the relay, reported SENT, and never
 * bounced. RELAY is the relay's IP, ELSEWHERE is Microsoft.
 */

// The guard resolves for real; the resolver is replaced so these stay offline.
const mockResolve4 = jest.fn();
const mockResolveMx = jest.fn();
jest.mock("dns/promises", () => ({
  resolve4: (...a) => mockResolve4(...a),
  resolveMx: (...a) => mockResolveMx(...a),
}));

const {
  STATES, classify, assertRoutable, _resetCache,
} = require("../../src/modules/mail/deliverability/route-check");

const RELAY = "37.59.83.88";
const ELSEWHERE = "104.47.1.33";

describe("classify", () => {
  it("flags the local-domain trap: we host the domain, its mail lives elsewhere", () => {
    expect(
      classify({ relayIps: [RELAY], recipientIps: [RELAY], mxIps: [ELSEWHERE] }),
    ).toMatchObject({ state: STATES.LOCAL_TRAP, ok: false });
  });

  it("is ok when the relay does not host the recipient domain", () => {
    // The ordinary case for every domain on the internet we do not host. A
    // remote MX on its own is not evidence of anything.
    expect(
      classify({ relayIps: [RELAY], recipientIps: [ELSEWHERE], mxIps: [ELSEWHERE] }),
    ).toMatchObject({ state: STATES.OK, ok: true });
  });

  it("is ok when the relay is legitimately the domain's own mail server", () => {
    // Co-hosting alone must NOT be reported: here local delivery is correct, and
    // flagging it would condemn every domain whose site and mail both live with
    // us — which is most of them.
    expect(
      classify({ relayIps: [RELAY], recipientIps: [RELAY], mxIps: [RELAY] }),
    ).toMatchObject({ state: STATES.OK, ok: true });
  });

  it("still flags the trap when the relay answers on several addresses", () => {
    // Membership, not equality: a relay with two A records is co-hosted if
    // EITHER matches, and demanding an exact match would miss the trap.
    expect(
      classify({ relayIps: ["203.0.113.9", RELAY], recipientIps: [RELAY], mxIps: [ELSEWHERE] }),
    ).toMatchObject({ state: STATES.LOCAL_TRAP, ok: false });
  });

  it("does not judge when a lookup came back empty", () => {
    // Absence of evidence is never rendered as a fault — telling an
    // administrator their mail is being swallowed because a resolver timed out
    // is worse than saying nothing.
    for (const args of [
      { relayIps: [], recipientIps: [RELAY], mxIps: [ELSEWHERE] },
      { relayIps: [RELAY], recipientIps: [], mxIps: [ELSEWHERE] },
      { relayIps: [RELAY], recipientIps: [RELAY], mxIps: [] },
    ]) {
      const out = classify(args);
      expect(out.state).toBe(STATES.UNKNOWN);
      expect(out.ok).toBeNull();
    }
  });

  it("does not judge a domain that publishes no MX at all", () => {
    // Broken or mail-less, but either way local delivery is not what is wrong.
    expect(
      classify({ relayIps: [RELAY], recipientIps: [RELAY], mxIps: [], hasMx: false }),
    ).toMatchObject({ state: STATES.UNKNOWN, ok: null });
  });

  it("tolerates junk resolver results rather than throwing", () => {
    expect(classify({}).state).toBe(STATES.UNKNOWN);
    expect(classify({ relayIps: null, recipientIps: undefined, mxIps: [null] }).state).toBe(STATES.UNKNOWN);
  });

  it("always explains itself", () => {
    // The verdict is shown to an administrator who has to act on it, so a
    // reason is part of the contract, not a nicety.
    for (const args of [
      { relayIps: [RELAY], recipientIps: [RELAY], mxIps: [ELSEWHERE] },
      { relayIps: [RELAY], recipientIps: [ELSEWHERE], mxIps: [ELSEWHERE] },
      { relayIps: [], recipientIps: [], mxIps: [] },
    ]) {
      expect(typeof classify(args).reason).toBe("string");
      expect(classify(args).reason.length).toBeGreaterThan(0);
    }
  });
});

/* ── THE SEND-PATH GUARD ──────────────────────────────────────────────────
 *
 * Detection alone would have changed nothing. The entire cost of the incident
 * was that the system reported SUCCESS for a message it had lost, so on the
 * send path a proven-unreachable recipient has to FAIL rather than be filed
 * as SENT. These cases pin that, and pin the two ways it must NOT overreach:
 * silence on an unproven verdict, and silence when the checker itself breaks.
 */
describe("assertRoutable", () => {
  const RELAY = "37.59.83.88";
  const MS = "104.47.1.33";

  // The relay hosts the domain; the domain's mail is at Microsoft.
  const trapped = () => {
    mockResolve4.mockImplementation(async (host) => {
      if (host === "mail.praxisls.com" || host === "smartls.cm") return [RELAY];
      return [MS];
    });
    mockResolveMx.mockResolvedValue([{ exchange: "smartls-cm.mail.protection.outlook.com", priority: 0 }]);
  };

  beforeEach(() => {
    _resetCache();
    jest.clearAllMocks();
  });

  it("throws MAIL_ROUTE_TRAPPED for a recipient the relay would swallow", async () => {
    trapped();
    const err = await assertRoutable({
      smtpHost: "mail.praxisls.com", to: "timothee.massomba@smartls.cm",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("MAIL_ROUTE_TRAPPED");
    // The operator has to be able to act on it, so the message names the real
    // destination and says plainly that nothing was sent.
    expect(err.message).toMatch(/smartls\.cm/);
    expect(err.message).toMatch(/has NOT been sent/i);
    expect(err.details.mx_hosts).toContain("smartls-cm.mail.protection.outlook.com");
  });

  it("reads the address out of a display-name form too", async () => {
    trapped();
    await expect(
      assertRoutable({ smtpHost: "mail.praxisls.com", to: '"Timothee" <timothee@smartls.cm>' }),
    ).rejects.toMatchObject({ code: "MAIL_ROUTE_TRAPPED" });
  });

  /* CodeQL flagged the original `/<([^>]+)>/` as a high-severity ReDoS on the
   * PR that added it, and it was right: unanchored, so on a recipient with no
   * `>` the engine restarted `[^>]+` at every `<`. 64KB of `<=<=<=…` held the
   * event loop for 2.6 seconds — on the send path, on a field a user types
   * into. The parse is index-based now. The bound below is ~1000x the fixed
   * cost and ~20x under the OLD cost at a sixth of the length, so it cannot
   * flake, but it still fails loudly if a regex ever creeps back in. */
  it("parses a pathological recipient in linear time", async () => {
    const evil = `<${"<=".repeat(200_000)}`;
    const started = Date.now();
    await assertRoutable({ smtpHost: null, to: evil });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("takes the LAST bracket, so a display name containing '<' still parses", async () => {
    // The regex got this wrong — on `a<b" <x@y.cm>` it returned `b" <x@y.cm`,
    // and the domain lookup then asked DNS about nonsense.
    trapped();
    await expect(
      assertRoutable({ smtpHost: "mail.praxisls.com", to: 'a<b <franco@smartls.cm>' }),
    ).rejects.toMatchObject({ code: "MAIL_ROUTE_TRAPPED" });
  });

  it("checks every recipient, not just the first", async () => {
    trapped();
    await expect(
      assertRoutable({ smtpHost: "mail.praxisls.com", to: ["ok@example.org", "x@smartls.cm"] }),
    ).rejects.toMatchObject({ code: "MAIL_ROUTE_TRAPPED" });
  });

  it("stays silent when the relay does not host the recipient domain", async () => {
    mockResolve4.mockResolvedValue([MS]);
    mockResolveMx.mockResolvedValue([{ exchange: "mx.example.org", priority: 10 }]);
    await expect(
      assertRoutable({ smtpHost: "mail.praxisls.com", to: "a@example.org" }),
    ).resolves.toBeUndefined();
  });

  it("stays silent on an UNPROVEN verdict rather than blocking mail", async () => {
    // Nothing resolves -> UNKNOWN. A suspicion is not evidence, and refusing a
    // send on one would turn a DNS wobble into an outage.
    mockResolve4.mockRejectedValue(Object.assign(new Error("nope"), { code: "ESERVFAIL" }));
    mockResolveMx.mockRejectedValue(Object.assign(new Error("nope"), { code: "ESERVFAIL" }));
    await expect(
      assertRoutable({ smtpHost: "mail.praxisls.com", to: "a@example.org" }),
    ).resolves.toBeUndefined();
  });

  it("stays silent when the checker itself throws", async () => {
    mockResolve4.mockImplementation(() => { throw new Error("boom"); });
    mockResolveMx.mockImplementation(() => { throw new Error("boom"); });
    await expect(
      assertRoutable({ smtpHost: "mail.praxisls.com", to: "a@example.org" }),
    ).resolves.toBeUndefined();
  });

  it("does nothing without a relay host or recipients", async () => {
    await expect(assertRoutable({ smtpHost: null, to: "a@b.cm" })).resolves.toBeUndefined();
    await expect(assertRoutable({ smtpHost: "mail.praxisls.com", to: null })).resolves.toBeUndefined();
    expect(mockResolve4).not.toHaveBeenCalled();
  });

  it("caches a settled verdict so this is not a lookup per message", async () => {
    // It sits in front of every OTP, invite and invoice; a resolver round trip
    // on each one would be a latency tax on the hottest path in the product.
    trapped();
    for (let i = 0; i < 3; i++) {
      await assertRoutable({ smtpHost: "mail.praxisls.com", to: "x@smartls.cm" }).catch(() => {});
    }
    expect(mockResolveMx).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache an unknown verdict", async () => {
    // Pinning "could not tell" for ten minutes would suppress the check exactly
    // when DNS has just recovered.
    mockResolve4.mockRejectedValue(Object.assign(new Error("nope"), { code: "ESERVFAIL" }));
    mockResolveMx.mockRejectedValue(Object.assign(new Error("nope"), { code: "ESERVFAIL" }));
    await assertRoutable({ smtpHost: "mail.praxisls.com", to: "a@example.org" });
    await assertRoutable({ smtpHost: "mail.praxisls.com", to: "a@example.org" });
    expect(mockResolveMx).toHaveBeenCalledTimes(2);
  });
});
