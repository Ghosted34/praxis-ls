/**
 * THE SEND PATH'S CLASSIFIER, END TO END (FN-1's remaining item).
 *
 * ── THE THREE PIECES, AND WHY THEY HAVE TO BE TESTED TOGETHER ───────────────
 *
 * A failed send passes through three functions that each know part of the
 * answer, and every historical defect here has been a DISAGREEMENT between
 * them rather than a bug inside one:
 *
 *   1. `smtp-error.map.mapSmtpError`   what went wrong, by evidence
 *   2. `mail.service.explainSendError` how to say it for this mailbox
 *   3. `outbox.retryPlan`              whether to try again
 *
 * FN-1 recorded the first disagreement: (1) and (2) were two implementations of
 * the same mapping, and the one on the send path called every 550
 * SENDER_NOT_AUTHORIZED — so a mistyped recipient sent the operator to fix
 * their From address. `mail-service.test.js` pins the two 550 cases that fixed.
 *
 * This file pins the second, which outlived it. (2) collapsed FOUR of the map's
 * verdicts into two codes, and the pair it merged — a greylisting and a hard
 * 5xx refusal — carry the same HTTP status and opposite operational meanings.
 * (3) decides retries from the code, so it could not tell them apart and
 * retried both: a message the recipient's server refused for being too large
 * went out again at 30s, 2min and 8min before anyone was told.
 *
 * ── WHAT IS ASSERTED ────────────────────────────────────────────────────────
 *
 * Not that any one function is right in isolation — `smtp-error-map.test.js`
 * already covers (1), and a test that re-asserts its table here would go green
 * on a send path that ignored it, which is the exact shape of the defect.
 *
 * What is asserted is AGREEMENT: every verdict the map can reach survives to
 * the retry decision, and the retry decision matches the verdict's meaning.
 */
"use strict";

const { mapSmtpError } = require("../../src/modules/mail/mail/smtp-error.map");
const outbox = require("../../src/modules/mail/mail/outbox.service");
const { explainSendError } = require("../../src/modules/mail/mail/mail.service");
const { AppError } = require("../../src/utils/errors");

const CONN = { email_address: "ops@smartls.cm" };
const smtp = (text, over = {}) =>
  Object.assign(new Error(text), { response: text, ...over });

/**
 * One row per outcome the ladder can reach, with a rejection a real mail server
 * actually sends. `permanent` is the OPERATIONAL claim — the thing a retry
 * would waste — and it is what the send path exists to get right.
 */
const CASES = [
  {
    name: "cPanel/Exim sender verify",
    err: smtp("550 Sender verify failed", { responseCode: 550, code: "EENVELOPE" }),
    code: "SENDER_NOT_AUTHORIZED",
    status: 422,
    permanent: true,
  },
  {
    name: "Postfix sender address rejected",
    err: smtp("550 5.7.1 Sender address rejected: not owned by user", { responseCode: 550 }),
    code: "SENDER_NOT_AUTHORIZED",
    status: 422,
    permanent: true,
  },
  {
    name: "relay access denied",
    err: smtp("554 5.7.1 Relay access denied", { responseCode: 554 }),
    code: "SENDER_NOT_AUTHORIZED",
    status: 422,
    permanent: true,
  },
  {
    name: "user unknown is the RECIPIENT's fault, not the sender's",
    err: smtp("550 5.1.1 User unknown", { responseCode: 550, code: "EENVELOPE" }),
    code: "RECIPIENT_REJECTED",
    status: 422,
    permanent: true,
  },
  {
    name: "a rejected login",
    err: smtp("535 5.7.8 Authentication credentials invalid", { responseCode: 535 }),
    code: "MAILBOX_AUTH_FAILED",
    status: 422,
    permanent: true,
  },
  {
    name: "greylisting is TRANSIENT and must be retried",
    err: smtp("451 4.7.1 Greylisted, try again later", { responseCode: 451 }),
    code: "SMTP_SEND_FAILED",
    status: 502,
    permanent: false,
  },
  {
    name: "too many connections is transient",
    err: smtp("421 4.7.0 Too many connections", { responseCode: 421 }),
    code: "SMTP_SEND_FAILED",
    status: 502,
    permanent: false,
  },
  {
    name: "a message over the size limit is PERMANENT",
    err: smtp("552 5.3.4 Message size exceeds fixed limit", { responseCode: 552 }),
    code: "SMTP_SEND_REJECTED",
    status: 502,
    permanent: true,
  },
  {
    name: "a recipient mailbox that is full is permanent",
    err: smtp("552 5.2.2 Mailbox full", { responseCode: 552 }),
    code: "SMTP_SEND_REJECTED",
    status: 502,
    permanent: true,
  },
  {
    name: "a dropped socket is not an SMTP verdict at all — retry it",
    err: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    code: "SMTP_SEND_FAILED",
    status: 502,
    permanent: false,
  },
];

describe("the send path preserves the classifier's verdict", () => {
  test.each(CASES)("$name → $code", ({ err, code, status }) => {
    const out = explainSendError(err, CONN);
    expect(out.code).toBe(code);
    expect(out.status).toBe(status);
  });

  test("it names the mailbox, so the operator knows which one to open", () => {
    const out = explainSendError(CASES[0].err, CONN);
    expect(out.message).toContain("ops@smartls.cm");
  });

  test("it keeps the server's own words, which are the only actionable part", () => {
    const out = explainSendError(CASES[3].err, CONN);
    expect(out.message).toContain("550 5.1.1 User unknown");
  });

  test("MAIL_SEND_FAILED IS NOW UNREACHABLE, which is the point", () => {
    // `mapSmtpError` is total: even an error with no SMTP evidence at all comes
    // back as one of its five verdicts, and all five now have wording. So the
    // generic branch can only be reached by a SIXTH verdict added to the map
    // without wording here — which the last test in this file catches.
    //
    // It used to swallow two of the five, and that is what cost the outbox its
    // retry decision.
    const out = explainSendError(new Error("the vault was unreachable"), CONN);
    expect(out.code).toBe("SMTP_SEND_FAILED");
  });

  test("AN AppError PASSES THROUGH UNTOUCHED, keeping its own code", () => {
    // `outbox.assertRoomFor` throws MAILBOX_ARCHIVED, and `retryPlan` and the
    // outbox screen both recognise it by name. Rewrapping it would keep the
    // status and replace the code, quietly turning a named refusal into the
    // generic one.
    const archived = new AppError("MAILBOX_ARCHIVED", "retired", 422);
    expect(explainSendError(archived, CONN)).toBe(archived);
  });
});

describe("the retry decision agrees with the verdict", () => {
  test.each(CASES)("$name is $permanent", ({ err, permanent }) => {
    const plan = outbox.retryPlan(explainSendError(err, CONN), 0);
    expect(Boolean(plan.retryAt)).toBe(!permanent);
  });

  test("A HARD 5xx IS NOT RETRIED — the defect this file exists for", () => {
    // Before: `explainSendError` flattened SMTP_SEND_REJECTED into
    // MAIL_SEND_FAILED, which `retryPlan` did not recognise, so an 18 MB
    // message refused by the recipient's server was sent three more times.
    const tooBig = smtp("552 5.3.4 Message size exceeds fixed limit", { responseCode: 552 });
    expect(outbox.retryPlan(explainSendError(tooBig, CONN), 0).retryAt).toBeNull();
  });

  test("a greylisting still IS retried — the case that must not be lost", () => {
    const grey = smtp("451 4.7.1 Greylisted, try again later", { responseCode: 451 });
    expect(outbox.retryPlan(explainSendError(grey, CONN), 0).retryAt).toBeInstanceOf(Date);
  });

  test("a rejected login is never retried, whatever its status", () => {
    // Three failed authentications in ten minutes is what a shared host's
    // brute-force protection watches for, and it suspends the mailbox. This
    // used to hold only because the error also carried a 422; the code is now
    // named in PERMANENT_CODES, so it survives a status change.
    const auth = { code: "MAILBOX_AUTH_FAILED", status: 502 };
    expect(outbox.retryPlan(auth, 0).retryAt).toBeNull();
  });

  test("retries stop at MAX_ATTEMPTS even for a transient failure", () => {
    const grey = explainSendError(
      smtp("451 4.7.1 Greylisted", { responseCode: 451 }), CONN,
    );
    expect(outbox.retryPlan(grey, outbox.MAX_ATTEMPTS).retryAt).toBeNull();
  });

  test("the backoff is the documented 30s / 2min / 8min ladder", () => {
    const grey = explainSendError(
      smtp("451 4.7.1 Greylisted", { responseCode: 451 }), CONN,
    );
    const at = (n) => outbox.retryPlan(grey, n).retryAt.getTime() - Date.now();
    expect(at(0)).toBeGreaterThan(25_000);
    expect(at(0)).toBeLessThan(35_000);
    expect(at(1)).toBeGreaterThan(115_000);
    expect(at(2)).toBeGreaterThan(475_000);
  });
});

/**
 * The gate that stops the two lists drifting apart again.
 *
 * `PERMANENT_CODES` and `SEND_ERROR_WORDING` are separate on purpose — one
 * answers an operational question, the other a presentational one — and the way
 * that goes wrong is a verdict added to the map, given wording, and never
 * classified for retries. Or the reverse: FN-1's `AUTH_FAILED`, a name in the
 * permanent list that nothing has ever thrown.
 */
describe("no code is named in one place and not the other", () => {
  const EMITTED = [
    "SENDER_NOT_AUTHORIZED",
    "RECIPIENT_REJECTED",
    "MAILBOX_AUTH_FAILED",
    "SMTP_SEND_REJECTED",
    "SMTP_SEND_FAILED",
  ];

  test("every code the send path can emit is reachable from a real rejection", () => {
    // A code in the wording table that no rejection produces is a table
    // describing a case that cannot happen — the same shape as FN-1's dead
    // `AUTH_FAILED`, one layer up.
    const reached = new Set([
      ...CASES.map((c) => explainSendError(c.err, CONN).code),
      explainSendError(new Error("no SMTP evidence"), CONN).code,
    ]);
    expect([...reached].sort()).toEqual([...EMITTED].sort());
  });

  test("EVERY PERMANENT CODE IS ONE SOMETHING ACTUALLY THROWS", () => {
    // FN-1's dead `AUTH_FAILED` is the reason this exists. `MAILBOX_ARCHIVED`
    // and `SMTP_AUTH_FAILED` are thrown outside `explainSendError` — the first
    // by `outbox.assertRoomFor`, the second by the map itself, which other
    // callers (Test, the platform probe) hand straight to a queue.
    const alsoThrown = ["MAILBOX_ARCHIVED", "SMTP_AUTH_FAILED"];
    const known = new Set([...EMITTED, ...alsoThrown]);
    const orphans = [...outbox.PERMANENT_CODES].filter((c) => !known.has(c));
    expect(orphans).toEqual([]);
  });

  test("MAILBOX_ARCHIVED is thrown where the list says it is", () => {
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "../../src/modules/mail/mail/outbox.service.js"),
      "utf8",
    );
    expect(src).toMatch(/AppError\(\s*"MAILBOX_ARCHIVED"/);
  });

  test("the map's every verdict has send-path wording", () => {
    // Reached through the map rather than by reading the table, so a verdict
    // added to `smtp-error.map.js` without wording fails here rather than
    // falling silently into the generic branch.
    const verdicts = [
      smtp("535 auth failed", { responseCode: 535 }),
      smtp("550 Sender verify failed", { responseCode: 550 }),
      smtp("550 5.1.1 User unknown", { responseCode: 550 }),
      smtp("451 greylisted, try again later", { responseCode: 451 }),
      smtp("552 5.3.4 Message size exceeds fixed limit", { responseCode: 552 }),
    ];
    for (const e of verdicts) {
      const mapped = mapSmtpError(e);
      const explained = explainSendError(e, CONN);
      // Either the map's own code, or a documented rename. Never the generic.
      expect(explained.code).not.toBe("MAIL_SEND_FAILED");
      if (explained.code !== mapped.code) {
        expect([mapped.code, explained.code]).toEqual(["SMTP_AUTH_FAILED", "MAILBOX_AUTH_FAILED"]);
      }
    }
  });
});
