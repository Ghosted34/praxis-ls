"use strict";

/**
 * email.service.resolveMail — SYSTEM-email sender resolution with the deploy-wide
 * fallback. A tenant with no own SMTP (no email_identity / email.default) must fall
 * back to a Praxis sender (no-reply@ / support@praxisls.com) so OTP / invoice /
 * notification mail never fails; a tenant's own identity + SMTP must win.
 */

jest.mock("../../src/services/email.repo", () => ({ identityFor: jest.fn() }));
jest.mock("../../src/shared/config/settings", () => ({ getSetting: jest.fn() }));
jest.mock("../../src/modules/security/setting/setting.service", () => ({ readSecret: jest.fn() }));
jest.mock("../../src/services/platform/mail-fallback.service", () => ({ resolve: jest.fn() }));

const emailRepo = require("../../src/services/email.repo");
const { getSetting } = require("../../src/shared/config/settings");
const settingService = require("../../src/modules/security/setting/setting.service");
const mailFallback = require("../../src/services/platform/mail-fallback.service");
const { resolveMail } = require("../../src/services/email.service");

const client = { query: jest.fn() };
const FB = {
  from: "no-reply@praxisls.com", support_from: "support@praxisls.com", from_name: "Praxis",
  reply_to: null, fallback_domain: "praxisls.com", smtp_host: "mail.praxisls.com",
  smtp_port: 587, smtp_user: "relay", smtp_pass: "fb-pass", source: "platform",
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

test("a tenant's own identity + SMTP win over the fallback", async () => {
  emailRepo.identityFor.mockResolvedValue({
    purpose: "BILLING", from_address: "billing@acme.cm", from_name: "Acme Billing",
    reply_to: "ar@acme.cm", smtp_host: "smtp.acme.cm", smtp_port: 587,
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
