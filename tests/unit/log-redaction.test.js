"use strict";

/**
 * OBS-L4 / SEC-L4 — what must never reach a log line.
 *
 * This exists because of an ordering constraint, not just a leak: log shipping
 * (OBS-L7) is Phase 2, and the moment logs leave this box everything in them
 * leaves with it. Redaction has to be right *before* that, because you cannot
 * un-send it.
 *
 * The subtle one is `err.detail`. Nobody logs a password on purpose — but
 * `logger.error({ err, sql })` in config/database.js serialises a pg error
 * object, and a unique-violation carries
 *     detail: "Key (email)=(someone@example.com) already exists"
 * so a duplicate-signup attempt wrote a customer's address to disk in plain
 * text, from a call site that looks entirely innocent.
 *
 * Asserts against the REDACT_PATHS the app actually ships, imported rather than
 * copied. A copied list drifts, and then the test guards something that is no
 * longer what runs.
 */

const pino = require("pino");
const { Writable } = require("node:stream");
const { REDACT_PATHS } = require("../../src/config/logger");

/** Log a payload through the real redaction config and return the written line. */
function log(payload) {
  const lines = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  const l = pino({ redact: { paths: REDACT_PATHS, censor: "[REDACTED]" }, level: "info" }, sink);
  l.info(payload, "test");
  return lines[0];
}

describe("OBS-L4 — sensitive fields are redacted", () => {
  it("redacts a pg unique-violation detail — the PII leak nobody writes on purpose", () => {
    const line = log({
      err: {
        message: "duplicate key value violates unique constraint",
        code: "23505",
        detail: "Key (email)=(someone@example.com) already exists.",
      },
    });
    expect(JSON.stringify(line)).not.toContain("someone@example.com");
    expect(line.err.detail).toBe("[REDACTED]");
  });

  it.each([
    ["password", { password: "hunter2" }, "hunter2"],
    ["password_hash", { password_hash: "$argon2id$v=19$SALTVALUE" }, "SALTVALUE"],
    ["refresh_token", { refresh_token: "eyJhbG.REFRESHVALUE" }, "REFRESHVALUE"],
    ["access_token", { access_token: "eyJhbG.ACCESSVALUE" }, "ACCESSVALUE"],
    ["totp_secret_enc", { totp_secret_enc: "TOTPSECRETVALUE" }, "TOTPSECRETVALUE"],
    ["secret_enc", { secret_enc: "ANOTHERSECRETVALUE" }, "ANOTHERSECRETVALUE"],
    ["api_key", { api_key: "PROVIDERKEYVALUE" }, "PROVIDERKEYVALUE"],
    ["pin_hash", { pin_hash: "PINHASHVALUE" }, "PINHASHVALUE"],
    ["bank_account_number", { bank_account_number: "1234567890123" }, "1234567890123"],
  ])("redacts %s", (_name, payload, secret) => {
    expect(JSON.stringify(log(payload))).not.toContain(secret);
  });

  it("redacts a password nested deeper than one wildcard reaches", () => {
    // `*.password` spans exactly one intermediate level, so req.body.user.password
    // needs its own explicit path. Precisely the case the audit called out.
    expect(JSON.stringify(log({ req: { body: { user: { password: "NESTEDSECRET" } } } })))
      .not.toContain("NESTEDSECRET");
  });

  it("redacts the Authorization header", () => {
    expect(JSON.stringify(log({ req: { headers: { authorization: "Bearer TOKENVALUE" } } })))
      .not.toContain("TOKENVALUE");
  });

  it("does NOT redact ordinary operational fields", () => {
    // A redaction list that eats everything is its own failure — an access log
    // with no method or status is not a log. This is the counterweight.
    const line = log({ tenant: "smartls", user_id: "u-1", status: 200, method: "GET" });
    expect(line.tenant).toBe("smartls");
    expect(line.user_id).toBe("u-1");
    expect(line.status).toBe(200);
    expect(line.method).toBe("GET");
  });

  it("covers every field the audit named, at BOTH the top level and nested", () => {
    // Tripwire. Removing one of these should fail here and name the finding,
    // rather than quietly widening the leak.
    //
    // The bare/wildcard pairing is not redundant: pino's `*.x` requires an
    // intermediate level, so `*.password_hash` does NOT match
    // `{ password_hash }`. The first version of this fix listed only the
    // wildcard form and left every top-level occurrence in the clear — caught
    // by this test, which is the entire argument for writing it.
    for (const key of [
      "password_hash",
      "refresh_token",
      "access_token",
      "totp_secret_enc",
      "secret_enc",
      "bank_account_number",
    ]) {
      expect(REDACT_PATHS).toContain(key);
      expect(REDACT_PATHS).toContain(`*.${key}`);
    }
    expect(REDACT_PATHS).toContain("err.detail");
    expect(REDACT_PATHS).toContain("req.body.user.password");
  });
});
