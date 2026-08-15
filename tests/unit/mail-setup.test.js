"use strict";

/**
 * Mail-setup wizard backend — hermetic.
 *
 * 1. dns-check module: MX / SPF / DKIM verdicts against mocked DNS answers —
 *    present → ok:true (with record values), missing → ok:false (with
 *    suggestions / hints), resolver failure → ok:null (self-check territory).
 * 2. smartcomm.config.service.testSend: a real send through the tenant
 *    transport; SMTP verdicts come back classified (SMTP_SENDER_REJECTED …)
 *    so the wizard renders the same fix guide the rest of the UI does.
 */

const mockResolveMx = jest.fn();
const mockResolveTxt = jest.fn();
jest.mock("dns/promises", () => ({
  resolveMx: (...a) => mockResolveMx(...a),
  resolveTxt: (...a) => mockResolveTxt(...a),
}));

jest.mock("../../src/services/platform/mail-fallback.service", () => ({
  resolve: jest.fn(async () => ({
    from: "no-reply@praxisls.com",
    smtp_host: null,
    smtp_port: 587,
    smtp_user: null,
    smtp_pass: null,
    source: "env",
  })),
}));
jest.mock("../../src/services/email.service", () => ({
  send: jest.fn(),
  resolveMail: jest.fn(async () => ({ smtp_host: "smtp.sendgrid.net" })),
}));

const email = require("../../src/services/email.service");
const { checkDomain } = require("../../src/modules/mail/dns-check");
const cfg = require("../../src/modules/smartcomm/smartcomm.config.service");

const noRecord = () => {
  const e = new Error("queryTxt ENOTFOUND x");
  e.code = "ENOTFOUND";
  return e;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("dns-check.checkDomain", () => {
  it("passes everything when MX, SPF and DKIM are all published", async () => {
    mockResolveMx.mockResolvedValue([{ exchange: "mail.x.cm", priority: 10 }]);
    mockResolveTxt.mockImplementation((name) => {
      if (name === "google._domainkey.x.cm")
        return Promise.resolve([["v=DKIM1; k=rsa; p=MIGfMA"]]);
      if (name === "x.cm") return Promise.resolve([["v=spf1 mx ~all"]]);
      return Promise.reject(noRecord());
    });
    const r = await checkDomain("x.cm", { smtpHost: "smtp.sendgrid.net" });
    expect(r.done).toBe(true);
    expect(r.mx.ok).toBe(true);
    expect(r.mx.records[0].host).toBe("mail.x.cm");
    expect(r.spf.record).toBe("v=spf1 mx ~all");
    expect(r.dkim).toMatchObject({ ok: true, selector: "google" });
  });

  it("reports missing records with relay-aware SPF suggestions and DKIM hints", async () => {
    mockResolveMx.mockRejectedValue(noRecord());
    mockResolveTxt.mockRejectedValue(noRecord());
    const r = await checkDomain("x.cm", { smtpHost: "smtp.sendgrid.net" });
    expect(r.done).toBe(false);
    expect(r.mx.ok).toBe(false);
    expect(r.spf.ok).toBe(false);
    expect(r.spf.suggest).toContain("v=spf1 include:sendgrid.net ~all");
    expect(r.dkim.ok).toBe(false);
    expect(r.dkim.hint).toMatch(/SendGrid/i);
  });

  it("accepts SPF published on the parent domain", async () => {
    mockResolveMx.mockResolvedValue([{ exchange: "mail.x.cm", priority: 10 }]);
    mockResolveTxt.mockImplementation((name) => {
      if (name === "mail.x.cm") return Promise.reject(noRecord());
      if (name === "x.cm") return Promise.resolve([["v=spf1 mx -all"]]); // parent
      return Promise.reject(noRecord());
    });
    const r = await checkDomain("mail.x.cm");
    expect(r.spf.ok).toBe(true);
    expect(r.spf.domain).toBe("x.cm");
  });

  it("marks records ok:null when the resolver fails (self-check fallback)", async () => {
    const mkErr = (code) => {
      const e = new Error(code);
      e.code = code;
      return e;
    };
    mockResolveMx.mockRejectedValue(mkErr("ETIMEOUT"));
    mockResolveTxt.mockRejectedValue(mkErr("ETIMEOUT"));
    const r = await checkDomain("x.cm");
    expect(r.done).toBe(false);
    expect(r.mx.ok).toBeNull();
    expect(r.spf.ok).toBeNull();
    expect(r.dkim.ok).toBeNull();
  });

  it("rejects non-domain input", async () => {
    await expect(checkDomain("not a domain")).rejects.toThrow(
      "Not a domain name",
    );
  });
});

describe("smartcomm.config.testSend", () => {
  it("classifies a 550 sender-verify rejection so the wizard shows the right guide", async () => {
    const err = new Error("send failed");
    err.response = "550 Sender verify failed";
    err.responseCode = 550;
    email.send.mockRejectedValue(err);
    const r = await cfg.testSend({}, { to: "admin@x.cm" });
    expect(r).toMatchObject({ ok: false, code: "SMTP_SENDER_REJECTED" });
    expect(r.error).toMatch(/Sender verify failed/);
  });

  it("reports ok with the provider message id on success", async () => {
    email.send.mockResolvedValue({ messageId: "abc-123" });
    const r = await cfg.testSend({}, { to: "admin@x.cm" });
    expect(r).toMatchObject({
      ok: true,
      to: "admin@x.cm",
      message_id: "abc-123",
    });
  });

  it("keeps the raw reason for non-SMTP failures", async () => {
    email.send.mockRejectedValue(new Error("email: no sender configured"));
    const r = await cfg.testSend({}, { to: "admin@x.cm" });
    expect(r.ok).toBe(false);
    expect(r.code).toBeUndefined();
    expect(r.error).toMatch(/no sender configured/);
  });
});
