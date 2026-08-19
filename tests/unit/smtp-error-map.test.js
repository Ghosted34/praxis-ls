/**
 * Table-driven contract for the shared SMTP classifier.
 *
 * The bug this locks: two maps survived a merge, then the "unify them" fix
 * treated every 550/553/554 as sender-not-authorised. A 550 user-unknown on
 * an enquiry reply then told the operator to fix MX/SPF, and the outbox
 * stopped retrying. Classification is by evidence, not SMTP family.
 */
"use strict";

const { AppError } = require("../../src/utils/errors");
const {
  mapSmtpError,
  smtpCodeFromMessage,
} = require("../../src/modules/mail/mail/smtp-error.map");

function smtp(message, { responseCode, code } = {}) {
  return Object.assign(new Error(message), {
    response: message,
    responseCode,
    code,
  });
}

const CASES = [
  {
    name: "cPanel sender verify",
    err: smtp("550 Sender verify failed", { responseCode: 550, code: "EENVELOPE" }),
    code: "SENDER_NOT_AUTHORIZED",
    status: 422,
  },
  {
    name: "relay denied",
    err: smtp("554 Relay access denied", { responseCode: 554 }),
    code: "SENDER_NOT_AUTHORIZED",
    status: 422,
  },
  {
    name: "not allowed to send as",
    err: smtp("553 not allowed to send as billing@co.cm", { responseCode: 553 }),
    code: "SENDER_NOT_AUTHORIZED",
    status: 422,
  },
  {
    name: "550 user unknown is a RECIPIENT problem",
    err: smtp("550 5.1.1 User unknown", { responseCode: 550, code: "EENVELOPE" }),
    code: "RECIPIENT_REJECTED",
    status: 422,
  },
  {
    name: "no such user",
    err: smtp("550 no such user here", { responseCode: 550 }),
    code: "RECIPIENT_REJECTED",
    status: 422,
  },
  {
    name: "535 is auth, not sender",
    err: smtp("535 5.7.8 Authentication failed", { responseCode: 535 }),
    code: "SMTP_AUTH_FAILED",
    status: 502,
  },
  {
    name: "EAUTH nodemailer",
    err: smtp("Invalid login", { code: "EAUTH", responseCode: 535 }),
    code: "SMTP_AUTH_FAILED",
    status: 502,
  },
  {
    name: "530 authentication required is auth, not sender",
    err: smtp("530 5.7.0 Authentication required", { responseCode: 530 }),
    code: "SMTP_AUTH_FAILED",
    status: 502,
  },
  {
    name: "451 greylist is transient",
    err: smtp("451 Try again later (greylist)", { responseCode: 451 }),
    code: "SMTP_SEND_FAILED",
    status: 502,
  },
  {
    name: "421 service not available is transient",
    err: smtp("421 4.7.0 Try again later", { responseCode: 421 }),
    code: "SMTP_SEND_FAILED",
    status: 502,
  },
  {
    name: "bare 554 policy reject is not sender",
    err: smtp("554 5.7.1 Message rejected as spam", { responseCode: 554 }),
    code: "SMTP_SEND_REJECTED",
    status: 502,
  },
  {
    name: "bare 550 without a phrase is not sender",
    err: smtp("550 Requested action not taken", { responseCode: 550 }),
    code: "SMTP_SEND_REJECTED",
    status: 502,
  },
];

describe("mapSmtpError", () => {
  test.each(CASES)("$name → $code $status", ({ err, code, status }) => {
    expect(mapSmtpError(err)).toMatchObject({ name: "AppError", code, status });
  });

  test("already-classified AppErrors pass through", () => {
    const e = new AppError("SENDER_NOT_AUTHORIZED", "already", 422);
    expect(mapSmtpError(e)).toBe(e);
  });
});

describe("smtpCodeFromMessage", () => {
  test("sender verify without a responseCode still classifies", () => {
    expect(smtpCodeFromMessage("550 Sender verify failed")).toBe("SENDER_NOT_AUTHORIZED");
  });
  test("user unknown without a responseCode is a recipient", () => {
    expect(smtpCodeFromMessage("550 5.1.1 User unknown")).toBe("RECIPIENT_REJECTED");
  });
  test("authentication required is not sender", () => {
    expect(smtpCodeFromMessage("530 Authentication required")).toBe("SMTP_AUTH_FAILED");
  });
});

