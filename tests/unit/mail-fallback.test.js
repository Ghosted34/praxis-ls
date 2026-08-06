"use strict";

/**
 * Deploy-wide system-email fallback (src/services/platform/mail-fallback.service.js).
 * The sender used for SYSTEM emails (OTP, invites, invoices, notifications) when a
 * tenant has not configured their own mail — so tenants who haven't pointed their
 * DNS at us never fail to receive system mail. Resolution: platform `mail.fallback`
 * → env (SMTP_* / MAIL_*). Platform settings service is mocked; env is pinned to
 * dev defaults by tests/jest.setup.js (SMTP_* = "").
 */

jest.mock("../../src/services/platform/settings.service", () => ({ resolve: jest.fn() }));

const platformSettings = require("../../src/services/platform/settings.service");
const { resolve, envDefaults } = require("../../src/services/platform/mail-fallback.service");

beforeEach(() => jest.clearAllMocks());

test("resolves the platform-configured fallback sender", async () => {
  platformSettings.resolve.mockResolvedValue({
    value: {
      from: "no-reply@praxisls.com",
      from_name: "Praxis",
      support_from: "support@praxisls.com",
      fallback_domain: "praxisls.com",
      smtp_host: "mail.praxisls.com",
      smtp_port: 465,
      smtp_user: "relay",
    },
    secret: "smtp-pass-1234",
  });
  const r = await resolve();
  expect(r.source).toBe("platform");
  expect(r.from).toBe("no-reply@praxisls.com");
  expect(r.support_from).toBe("support@praxisls.com");
  expect(r.smtp_host).toBe("mail.praxisls.com");
  expect(r.smtp_port).toBe(465);
  expect(r.smtp_pass).toBe("smtp-pass-1234");
});

test("falls back to env defaults when the platform row is absent", async () => {
  platformSettings.resolve.mockResolvedValue(null);
  const r = await resolve();
  expect(r.source).toBe("env");
  expect(r.from).toBe("no-reply@praxisls.com"); // MAIL_DEFAULT_FROM default
  expect(r.support_from).toBe("support@praxisls.com"); // MAIL_SUPPORT_FROM default
  expect(r.fallback_domain).toBe("praxisls.com"); // MAIL_FALLBACK_DOMAIN default
  expect(r.smtp_host).toBeNull(); // SMTP_HOST pinned to "" by jest.setup
});

test("never throws — a platform DB failure degrades to env defaults", async () => {
  platformSettings.resolve.mockRejectedValue(new Error("platform db unreachable"));
  const r = await resolve();
  expect(r.source).toBe("env");
  expect(r.from).toContain("@praxisls.com");
});

test("envDefaults always yields a non-empty from and domain", () => {
  const d = envDefaults();
  expect(d.from).toBeTruthy();
  expect(d.fallback_domain).toBe("praxisls.com");
});
