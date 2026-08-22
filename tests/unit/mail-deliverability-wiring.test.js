/**
 * THE DELIVERABILITY REGRESSION ALERT ACTUALLY FIRES (§6.5).
 *
 * `mail-deliverability.test.js` proves the `regression()` predicate is right.
 * For the whole of the PR-2 merge that was the only thing tested: the service
 * wrote the FAIL row and the alert depended on a transition check that the
 * tests never ran at the call site. A PASS→FAIL transition must emit
 * `deliverability.regressed` AND notify MOD-70 (the CEOs) — a regression row
 * with no notification is the version where DNS broke a week ago and nobody
 * was told. This file runs `checkOne` for real (with the network leaves
 * mocked) and asserts on what it emits.
 */
"use strict";

const dnsPromises = require("dns").promises;

jest.mock("../../src/modules/mail/mail/dns-check", () => ({
  checkDomain: jest.fn(async () => ({ mx: { ok: true }, spf: { ok: true }, dkim: { ok: true } })),
}));
jest.mock("../../src/modules/mail/deliverability/ptr", () => ({
  checkPtr: jest.fn(async () => ({ ok: true })),
}));
jest.mock("../../src/modules/mail/deliverability/rbl", () => ({
  checkRbl: jest.fn(async () => ({ ok: true })),
  hostsFrom: jest.fn(() => ["zen.spamhaus.org"]),
}));
jest.mock("../../src/modules/mail/deliverability/deliverability.repo", () => ({
  previous: jest.fn(async () => ({ verdict: "PASS", checked_at: new Date("2026-08-18T10:00:00Z") })),
  insertCheck: jest.fn(async (_c, row) => row),
  sendingDomains: jest.fn(async () => ["maersk.cm"]),
  sendingIp: jest.fn(async () => null),
}));
jest.mock("../../src/modules/notification/notification.service", () => ({
  notifyMany: jest.fn(async () => ({})),
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => ({})),
  audit: jest.fn(async () => ({})),
}));

const { checkPtr } = require("../../src/modules/mail/deliverability/ptr");
const repo = require("../../src/modules/mail/deliverability/deliverability.repo");
const { emitEvent } = require("../../src/shared/events/emit");
const notify = require("../../src/modules/notification/notification.service");
const svc = require("../../src/modules/mail/deliverability/deliverability.service");

/** A tenant client that knows only the CEO lookup. */
const client = {
  query: jest.fn(async (text) => {
    if (/FROM app_user/.test(text)) return { rows: [{ user_id: "u-ceo" }] };
    return { rows: [] };
  }),
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(dnsPromises, "resolveTxt").mockResolvedValue([["v=DMARC1; p=reject; rua=mailto:postmaster@maersk.cm"]]);
  checkPtr.mockResolvedValue({ ok: true });
  repo.previous.mockResolvedValue({ verdict: "PASS", checked_at: new Date("2026-08-18T10:00:00Z") });
});

afterAll(() => jest.restoreAllMocks());

describe("a PASS → FAIL transition", () => {
  beforeEach(() => {
    checkPtr.mockResolvedValue({ ok: false, hint: "PTR mismatch — banner says mail.maersk.cm, reverse says an ISP pool." });
  });

  test("emits deliverability.regressed with the transition in the payload", async () => {
    const out = await svc.checkOne(client, "maersk.cm", { ip: "203.0.113.7" });

    expect(out.regressions).toEqual([
      expect.objectContaining({ domain: "maersk.cm", record: "PTR", from: "PASS", to: "FAIL" }),
    ]);
    expect(emitEvent).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        eventTypeKey: "deliverability.regressed",
        moduleKey: "MOD-70",
        entityRef: "domain:maersk.cm",
      }),
    );
  });

  test("notifies the CEOs — a stored row with no notification is a silent outage", async () => {
    await svc.checkOne(client, "maersk.cm", { ip: "203.0.113.7" });
    expect(notify.notifyMany).toHaveBeenCalledWith(
      client,
      ["u-ceo"],
      expect.objectContaining({
        eventTypeKey: "deliverability.regressed",
        priority: "HIGH",
        title: expect.stringContaining("maersk.cm"),
      }),
    );
  });

  test("the FAIL row is still stored and the check still returns when the notifier is down", async () => {
    notify.notifyMany.mockRejectedValueOnce(new Error("notification service down"));
    const out = await svc.checkOne(client, "maersk.cm", { ip: "203.0.113.7" });
    // §6.5: the stored FAIL is the record; the alert is amplification. Losing
    // the alert must not lose the evidence.
    expect(out.checks).toContainEqual(expect.objectContaining({ record: "PTR", verdict: "FAIL" }));
    expect(repo.insertCheck).toHaveBeenCalled();
  });
});

describe("a check that did not regress", () => {
  test("emits nothing — FAIL→FAIL and PASS→PASS are not regressions", async () => {
    repo.previous.mockResolvedValue({ verdict: "FAIL", checked_at: new Date("2026-08-18T10:00:00Z") });
    const out = await svc.checkOne(client, "maersk.cm", { ip: "203.0.113.7" });
    expect(out.regressions).toEqual([]);
    expect(emitEvent).not.toHaveBeenCalled();
    expect(notify.notifyMany).not.toHaveBeenCalled();
  });
});
