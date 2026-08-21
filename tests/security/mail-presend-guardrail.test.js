/**
 * THE ONE HARD BLOCK, ON THE PATH THAT MATTERS (§8.8, §8.11(9)).
 *
 * `assist.guardrails.check()` was written, unit-tested and exposed at
 * `POST /mail/assist/guardrails`. The composer could ask "is this message
 * alright?" and get a correct answer.
 *
 * Nothing on the send path asked.
 *
 * So the programme's single hard block — a financial document to a domain rated
 * Suspicious or Likely impersonation — was advisory. A client that skipped the
 * optional call, a send from the AI action catalogue, a send from a script, a
 * composer bug that dropped the request: all sent the invoice. And the
 * `immutable_ledger` override entry §8.8 requires was written by nothing,
 * because nothing could be overridden.
 *
 * `tests/unit/mail-ai-guardrails.test.js` tests the RULE. This file tests that
 * the product runs it, and that the override leaves a permanent record.
 */
"use strict";

jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: jest.fn(async () => ({})),
  audit: jest.fn(async () => ({})),
  resolveActorId: jest.fn(async (_c, id) => id),
}));

const fs = require("fs");
const path = require("path");
const { audit } = require("../../src/shared/events/emit");
const presend = require("../../src/modules/mail/mail/presend");

function fakeClient(answers = []) {
  const calls = [];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      const hit = answers.find((a) => a.match.test(text));
      return { rows: hit ? hit.rows : [] };
    },
  };
}

const BOUND = { match: /SELECT entity_ref FROM email_thread/, rows: [{ entity_ref: "client:c-1" }] };
const VERIFIED_DOMAINS = (...d) => ({
  match: /FROM party_verified_domain/, rows: d.map((x) => ({ domain: x })),
});
const INBOUND = (...v) => ({
  match: /SELECT auth_verdict FROM email_message/, rows: v.map((x) => ({ auth_verdict: x })),
});

const ME = { user_id: "u-me" };
const INVOICE = { html: "Please find our invoice attached.", text: null };
const CHATTY = { html: "Thanks, see you Tuesday.", text: null };

beforeEach(() => jest.clearAllMocks());

/* ── The wiring, which is the whole point ─────────────────────────────────── */

describe("the check is on the send path, not beside it", () => {
  const outbox = fs.readFileSync(
    path.resolve(__dirname, "../../src/modules/mail/mail/outbox.service.js"), "utf8",
  );

  test("outbox.send calls presend.check", () => {
    expect(outbox).toMatch(/require\("\.\/presend"\)/);
    expect(outbox).toMatch(/presend\.check\(/);
  });

  test("it runs AFTER the signature is baked in", () => {
    // A bank detail introduced by a signature template must be INSIDE the
    // check, not appended after it. Ordering is the difference between a
    // guardrail and a formality.
    expect(outbox.indexOf("attachSignature")).toBeLessThan(outbox.indexOf("presend.check("));
  });

  test("it runs BEFORE the queue row is written", () => {
    expect(outbox.indexOf("presend.check(")).toBeLessThan(outbox.indexOf("repo.enqueue("));
  });

  test("there is exactly one call site, so there is one thing to keep true", () => {
    expect(outbox.match(/presend\.check\(/g)).toHaveLength(1);
    // Every send — POST /mail/send, reply, the AI catalogue's send_mail, the
    // scheduled path — queues through `send`. A check in the route would leave
    // the other three open.
  });
});

/* ── Warnings never block ─────────────────────────────────────────────────── */

describe("warnings ride along and refuse nothing", () => {
  test("a missing subject is a warning, and the send proceeds", async () => {
    const out = await presend.check(fakeClient(), ME, { to: ["a@b.cm"] }, { html: CHATTY.html });
    expect(out.warnings.map((w) => w.code)).toContain("NO_SUBJECT");
    expect(out.blocks).toEqual([]);
  });

  test("'please find attached' with no attachment warns", async () => {
    const out = await presend.check(fakeClient(), ME,
      { to: ["a@b.cm"], subject: "Docs" }, { html: "Please find attached.", attachments: [] });
    expect(out.warnings.map((w) => w.code)).toContain("MISSING_ATTACHMENT");
  });

  test("the message checked is the message SENT, bytes and all", async () => {
    const big = "x".repeat(110 * 1024);
    const out = await presend.check(fakeClient(), ME, { to: ["a@b.cm"], subject: "s" }, { html: big });
    expect(out.warnings.map((w) => w.code)).toContain("OVERSIZED_HTML");
  });
});

/* ── The verdict for an OUTBOUND message ──────────────────────────────────── */

describe("sending asks the mirror question of anti-spoof", () => {
  test("a party with verified domains + a recipient outside them is SUSPICIOUS", async () => {
    const c = fakeClient([BOUND, VERIFIED_DOMAINS("camrail.cm")]);
    const v = await presend.verdictForSend(c, { threadId: "t-1", to: ["thierry@gmail.com"] });
    // A real thread, a real client, one recipient address that is not theirs:
    // the payment-redirection pattern, almost exactly.
    expect(v.verdict).toBe("SUSPICIOUS");
    expect(v.why).toMatch(/gmail\.com/);
  });

  test("a party with NO verified domains tells us nothing, and blocks nothing", async () => {
    const c = fakeClient([BOUND, VERIFIED_DOMAINS()]);
    const v = await presend.verdictForSend(c, { threadId: "t-1", to: ["anyone@anywhere.cm"] });
    // Treating "we never configured this" as "this is an impostor" would block
    // every send in a tenant that has not done the set-up, which teaches
    // everyone to override reflexively.
    expect(v.verdict).toBe("VERIFIED");
  });

  test("a recipient ON a verified domain is fine", async () => {
    const c = fakeClient([BOUND, VERIFIED_DOMAINS("camrail.cm")]);
    const v = await presend.verdictForSend(c, { threadId: "t-1", to: ["Thierry@Camrail.CM"] });
    expect(v.verdict).toBe("VERIFIED");
  });

  test("the worst INBOUND verdict on the thread carries over", async () => {
    const c = fakeClient([BOUND, VERIFIED_DOMAINS(), INBOUND("VERIFIED", "LIKELY_IMPERSONATION", "UNVERIFIED")]);
    const v = await presend.verdictForSend(c, { threadId: "t-1", to: ["x@y.cm"] });
    // If we concluded an hour ago that someone in this thread was likely
    // impersonating a client, replying with a statement attached deserves the
    // same block.
    expect(v.verdict).toBe("LIKELY_IMPERSONATION");
  });

  test("a message with no thread is judged VERIFIED and costs no query", async () => {
    const c = fakeClient();
    const v = await presend.verdictForSend(c, { to: ["x@y.cm"] });
    expect(v.verdict).toBe("VERIFIED");
    expect(c.calls).toHaveLength(0);
  });
});

/* ── The block ────────────────────────────────────────────────────────────── */

describe("a financial document to an unverified domain is refused", () => {
  const suspicious = [BOUND, VERIFIED_DOMAINS("camrail.cm")];
  const send = { to: ["thierry@gmail.com"], subject: "Our invoice", email_thread_id: "t-1" };

  test("it throws rather than queueing", async () => {
    await expect(presend.check(fakeClient(suspicious), ME, send, INVOICE))
      .rejects.toMatchObject({ status: 422, code: "GUARDRAIL_BLOCKED" });
  });

  test("the refusal carries the block and the reason, so the UI can explain", async () => {
    const err = await presend.check(fakeClient(suspicious), ME, send, INVOICE).catch((e) => e);
    expect(err.details.blocks[0].code).toBe("FINANCIAL_TO_SUSPICIOUS");
    expect(err.details.auth_verdict).toBe("SUSPICIOUS");
    expect(err.details.verdict_reason).toMatch(/gmail\.com/);
  });

  test("an ordinary message to the same address is NOT blocked", async () => {
    const out = await presend.check(fakeClient(suspicious), ME, { ...send, subject: "Tuesday" }, CHATTY);
    expect(out.blocks).toEqual([]);
    // The block is narrow on purpose. A wide one is one people learn to click
    // through.
  });

  test("an attachment named like an invoice is enough to trigger it", async () => {
    await expect(presend.check(fakeClient(suspicious), ME,
      { ...send, subject: "Docs" }, { html: "As discussed.", attachments: [{ filename: "facture_2026.pdf" }] }))
      .rejects.toMatchObject({ code: "GUARDRAIL_BLOCKED" });
  });
});

/* ── The override, and its permanent record ───────────────────────────────── */

describe("the override is overridable, and it is never free", () => {
  const suspicious = [BOUND, VERIFIED_DOMAINS("camrail.cm")];
  const send = (over = {}) => ({
    to: ["thierry@gmail.com"], subject: "Our invoice", email_thread_id: "t-1", ...over,
  });

  test("a typed reason lets the send through", async () => {
    const out = await presend.check(fakeClient(suspicious), ME,
      send({ guardrail_override_reason: "Thierry confirmed this address by phone this morning." }), INVOICE);
    expect(out.overridden).toBe(true);
    // A block with no override stops a legitimate invoice at 17:55 on a Friday,
    // and people route around it by sending from Outlook, where there is no
    // check at all.
  });

  test("the reason is written to the immutable ledger", async () => {
    await presend.check(fakeClient(suspicious), ME,
      send({ guardrail_override_reason: "Confirmed by phone with the client this morning." }), INVOICE);
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "mail.guardrail.overridden",
      actorUserId: "u-me",
      after: expect.objectContaining({
        reason: "Confirmed by phone with the client this morning.",
        blocks: ["FINANCIAL_TO_SUSPICIOUS"],
        auth_verdict: "SUSPICIOUS",
      }),
    }));
  });

  test("a ledger failure stops the send", async () => {
    audit.mockRejectedValueOnce(new Error("ledger unavailable"));
    await expect(presend.check(fakeClient(suspicious), ME,
      send({ guardrail_override_reason: "Confirmed by phone this morning with Thierry." }), INVOICE))
      .rejects.toThrow(/ledger unavailable/);
    // The ledger entry IS the control. A send that proceeds on the strength of
    // an override that left no trace is the thing being prevented.
  });

  test("'ok' is not a reason", async () => {
    await expect(presend.check(fakeClient(suspicious), ME,
      send({ guardrail_override_reason: "ok" }), INVOICE))
      .rejects.toMatchObject({ code: "GUARDRAIL_REASON_TOO_SHORT" });
    expect(audit).not.toHaveBeenCalled();
  });

  test("whitespace is not a reason either", async () => {
    await expect(presend.check(fakeClient(suspicious), ME,
      send({ guardrail_override_reason: "          " }), INVOICE))
      .rejects.toMatchObject({ code: "GUARDRAIL_BLOCKED" });
  });

  test("nothing is written to the ledger when there was nothing to override", async () => {
    await presend.check(fakeClient(suspicious), ME,
      send({ subject: "Tuesday", guardrail_override_reason: "I felt like typing something." }), CHATTY);
    expect(audit).not.toHaveBeenCalled();
    // An override record for a send that was never blocked would make the
    // ledger's own count of overrides meaningless.
  });

  test("the API accepts the field, so the composer can actually send it", () => {
    const validator = fs.readFileSync(
      path.resolve(__dirname, "../../src/modules/mail/mail/mail.validator.js"), "utf8",
    );
    // `.strict()` on the send schema means an undeclared field is a 422, so a
    // block with no way to pass a reason would be a dead end.
    expect(validator).toMatch(/guardrail_override_reason/);
  });
});
