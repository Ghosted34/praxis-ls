"use strict";

/**
 * email.service.resolveMail — SYSTEM-email sender resolution with the deploy-wide
 * fallback. A tenant with no own SMTP (no email_identity / email.default) must fall
 * back to a Praxis sender (no-reply@ / support@praxisls.com) so OTP / invoice /
 * notification mail never fails; a tenant's own identity + SMTP must win.
 */

jest.mock("../../src/services/email.repo", () => ({
  identityFor: jest.fn(),
  recordSend: jest.fn(),
}));
jest.mock("../../src/shared/config/settings", () => ({
  getSetting: jest.fn(),
}));
jest.mock("../../src/modules/security/setting/setting.service", () => ({
  readSecret: jest.fn(),
}));
jest.mock("../../src/services/platform/mail-fallback.service", () => ({
  resolve: jest.fn(),
}));

const emailRepo = require("../../src/services/email.repo");
const { getSetting } = require("../../src/shared/config/settings");
const settingService = require("../../src/modules/security/setting/setting.service");
const mailFallback = require("../../src/services/platform/mail-fallback.service");
const { resolveMail, send } = require("../../src/services/email.service");

const client = { query: jest.fn() };
const FB = {
  from: "no-reply@praxisls.com",
  support_from: "support@praxisls.com",
  from_name: null,
  reply_to: null,
  fallback_domain: "praxisls.com",
  smtp_host: "mail.praxisls.com",
  smtp_port: 587,
  smtp_user: "relay",
  smtp_pass: "fb-pass",
  source: "platform",
};

beforeEach(() => {
  jest.clearAllMocks();
  emailRepo.identityFor.mockResolvedValue(null);
  getSetting.mockResolvedValue({});
  settingService.readSecret.mockResolvedValue(null);
});

test("uses the platform fallback sender when the tenant has no own SMTP", async () => {
  mailFallback.resolve.mockResolvedValue(FB);
  const cfg = await resolveMail(client, { purpose: "NOTIFICATIONS" });
  expect(cfg.from).toBe("no-reply@praxisls.com");
  expect(cfg.smtp_host).toBe("mail.praxisls.com");
  expect(cfg.smtp_pass).toBe("fb-pass");
  expect(cfg.sender_source).toBe("fallback");
  expect(cfg.fallback.domain).toBe("praxisls.com");
});

test("SUPPORT purpose falls back to support@praxisls.com", async () => {
  mailFallback.resolve.mockResolvedValue(FB);
  const cfg = await resolveMail(client, { purpose: "SUPPORT" });
  expect(cfg.from).toBe("support@praxisls.com");
});

test("fallback From carries the display name when set (G-8)", async () => {
  mailFallback.resolve.mockResolvedValue({ ...FB, from_name: "Praxis" });
  const cfg = await resolveMail(client, { purpose: "NOTIFICATIONS" });
  expect(cfg.from).toBe('"Praxis" <no-reply@praxisls.com>');
});

test("a tenant's own identity + SMTP win over the fallback", async () => {
  emailRepo.identityFor.mockResolvedValue({
    purpose: "BILLING",
    from_address: "billing@acme.cm",
    from_name: "Acme Billing",
    reply_to: "ar@acme.cm",
    smtp_host: "smtp.acme.cm",
    smtp_port: 587,
  });
  getSetting.mockResolvedValue({ smtp_user: "u" });
  settingService.readSecret.mockResolvedValue("acme-pass");
  const cfg = await resolveMail(client, { purpose: "BILLING" });
  expect(cfg.from).toContain("billing@acme.cm");
  expect(cfg.smtp_host).toBe("smtp.acme.cm");
  expect(cfg.smtp_pass).toBe("acme-pass");
  expect(cfg.reply_to).toBe("ar@acme.cm");
  expect(mailFallback.resolve).not.toHaveBeenCalled();
});

test("with client null (injectable transport path) it does not call the platform DB", async () => {
  const cfg = await resolveMail(null, { purpose: "NOTIFICATIONS" });
  expect(mailFallback.resolve).not.toHaveBeenCalled();
  expect(cfg.from).toContain("@praxisls.com"); // env default, not a throw
});

test("a tenant From without its own SMTP host still falls back to the Praxis sender (deliverability)", async () => {
  // settings.from is set but no smtp_host anywhere → must NOT send from the
  // tenant domain through the deploy SMTP (would fail SPF/DKIM); use the fallback.
  getSetting.mockResolvedValue({ from: "billing@acme.cm" });
  mailFallback.resolve.mockResolvedValue(FB);
  const cfg = await resolveMail(client, { purpose: "BILLING" });
  expect(cfg.from).toBe("no-reply@praxisls.com");
  expect(cfg.smtp_host).toBe("mail.praxisls.com");
  expect(cfg.sender_source).toBe("fallback");
});

// ── send-log ledger (G-1): every send records a row to email_send_log ──

test("successful send records a SENT log row with the provider message-id", async () => {
  emailRepo.identityFor.mockResolvedValue({
    email_identity_id: "id-1",
    purpose: "BILLING",
    from_address: "billing@acme.cm",
    from_name: "Acme",
    smtp_host: "smtp.acme.cm",
    smtp_port: 587,
  });
  emailRepo.recordSend.mockResolvedValue({ email_send_id: "log-1" });
  const tx = { sendMail: async () => ({ messageId: "abc-123" }) };
  const info = await send(
    client,
    {
      to: "x@y.cm",
      subject: "Invoice",
      purpose: "BILLING",
      entityRef: "invoice:rec-1",
    },
    tx,
  );
  expect(info.messageId).toBe("abc-123");
  expect(emailRepo.recordSend).toHaveBeenCalledTimes(1);
  const row = emailRepo.recordSend.mock.calls[0][1];
  expect(row).toMatchObject({
    status: "SENT",
    provider_message_id: "abc-123",
    to_address: "x@y.cm",
    entity_ref: "invoice:rec-1",
    email_identity_id: "id-1",
  });
});

test("failed send records a FAILED log row and still throws", async () => {
  emailRepo.identityFor.mockResolvedValue({
    email_identity_id: "id-1",
    purpose: "BILLING",
    from_address: "billing@acme.cm",
    smtp_host: "h",
  });
  emailRepo.recordSend.mockResolvedValue({ email_send_id: "log-1" });
  const tx = {
    sendMail: async () => {
      throw new Error("smtp down");
    },
  };
  await expect(
    send(client, { to: "x@y.cm", subject: "Invoice", purpose: "BILLING" }, tx),
  ).rejects.toThrow("smtp down");
  expect(emailRepo.recordSend).toHaveBeenCalledTimes(1);
  expect(emailRepo.recordSend.mock.calls[0][1]).toMatchObject({
    status: "FAILED",
    error: "smtp down",
  });
});

test("no log is written when client is null (injectable transport path)", async () => {
  const tx = { sendMail: async () => ({ messageId: "m" }) };
  await send(
    null,
    { to: "x@y.cm", subject: "Hi", purpose: "NOTIFICATIONS" },
    tx,
  );
  expect(emailRepo.recordSend).not.toHaveBeenCalled();
});

// ── G-4: a `from` override is ignored on the fallback (SPF), honoured with own host ──
test("a from override is NOT honoured on the fallback sender (deliverability)", async () => {
  // no identity, no host → fallback. Caller passes a tenant-domain from.
  getSetting.mockResolvedValue({});
  mailFallback.resolve.mockResolvedValue(FB);
  emailRepo.recordSend.mockResolvedValue({ email_send_id: "log" });
  const tx = {
    sendMail: async (m) => {
      sentFrom = m.from;
      return {};
    },
  };
  let sentFrom = null;
  await send(
    client,
    {
      to: "x@y.cm",
      subject: "Campaign",
      from: "ceo@acme.cm",
      purpose: "NOTIFICATIONS",
    },
    tx,
  );
  expect(sentFrom).toBe("no-reply@praxisls.com"); // fallback sender, not the override
});

test("a from override IS honoured when the tenant has its own host", async () => {
  emailRepo.identityFor.mockResolvedValue({
    email_identity_id: "id-1",
    purpose: "BILLING",
    from_address: "billing@acme.cm",
    smtp_host: "smtp.acme.cm",
    smtp_port: 587,
  });
  emailRepo.recordSend.mockResolvedValue({ email_send_id: "log" });
  const tx = {
    sendMail: async (m) => {
      sentFrom = m.from;
      return {};
    },
  };
  let sentFrom = null;
  await send(
    client,
    {
      to: "x@y.cm",
      subject: "Invoice",
      from: "ceo@acme.cm",
      purpose: "BILLING",
    },
    tx,
  );
  expect(sentFrom).toBe("ceo@acme.cm");
});
