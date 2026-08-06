"use strict";

/**
 * MOD-64 outbound provider config: WhatsApp verifyConfig (live phone-number
 * check), email verifyTransport (SMTP verify), and getConfig redaction. Proves
 * secrets are used upstream but never returned, and failures come back clean.
 */

jest.mock("axios");
jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => ({ verify: jest.fn(async () => true), sendMail: jest.fn(async () => ({})) })),
}));
// email.service.resolveMail reads the platform `mail.fallback` sender when the
// tenant has no own SMTP host — mock it here so the real email.service used by
// verifyTransport never touches the platform DB in these tests. Returns empty
// env defaults (no host) so "no SMTP host" behaviour is preserved.
jest.mock("../../src/services/platform/mail-fallback.service", () => ({
  resolve: jest.fn(async () => ({
    from: "no-reply@praxisls.com", support_from: "support@praxisls.com", from_name: "Praxis",
    reply_to: null, fallback_domain: "praxisls.com", smtp_host: null, smtp_port: 587,
    smtp_user: null, smtp_pass: null, source: "env",
  })),
}));

const axios = require("axios");
const nodemailer = require("nodemailer");
const encryption = require("../../src/services/encryption.service");
const whatsapp = require("../../src/services/whatsapp.service");
const cfg = require("../../src/modules/smartcomm/smartcomm.config.service");

// Fake tenant client: getSetting + setting.repo.getByKey both SELECT WHERE
// section=$1 AND key=$2. Serve rows from a keyed store ("section:key" → row).
function fakeClient(store) {
  return {
    query: async (_sql, params) => {
      const [section, key] = params || [];
      const row = store[`${section}:${key}`];
      return { rows: row ? [row] : [] };
    },
  };
}

const enc = (s) => ({ value: { secret_enc: encryption.encrypt(s) } });

afterEach(() => jest.clearAllMocks());

describe("whatsapp verifyConfig", () => {
  it("passes and never leaks the token", async () => {
    axios.get.mockResolvedValue({ data: { verified_name: "Acme Ltd", display_phone_number: "+237 6xx", quality_rating: "GREEN" } });
    const client = fakeClient({
      "integration_secret:whatsapp_token": { value: { provider: "meta-whatsapp", secret_enc: encryption.encrypt("wa-secret-ABCD") } },
      "comms:whatsapp": { value: { phone_id: "PHONE1", api_version: "v18.0" } },
    });
    const res = await whatsapp.verifyConfig(client);
    expect(res.ok).toBe(true);
    expect(res.verified_name).toBe("Acme Ltd");
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("PHONE1"),
      expect.objectContaining({ headers: { Authorization: "Bearer wa-secret-ABCD" } }),
    );
    expect(JSON.stringify(res)).not.toContain("wa-secret");
  });

  it("reports not-configured when nothing is set", async () => {
    const res = await whatsapp.verifyConfig(fakeClient({}));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/token/i);
  });

  it("fails cleanly on a 401 from Meta", async () => {
    axios.get.mockRejectedValue({ response: { status: 401, data: { error: { message: "Invalid OAuth access token" } } } });
    const client = fakeClient({
      "integration_secret:whatsapp_token": enc("badtoken"),
      "comms:whatsapp": { value: { phone_id: "PHONE1" } },
    });
    const res = await whatsapp.verifyConfig(client);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(res.error).toMatch(/Invalid OAuth/);
  });
});

describe("email verifyTransport", () => {
  it("passes when the SMTP transport verifies", async () => {
    const client = fakeClient({
      "email:default": { value: { smtp_host: "smtp.example.com", smtp_port: 587, smtp_user: "u", from: "a@example.com" } },
      "integration_secret:email_smtp_pass": enc("smtp-pass-99"),
    });
    const res = await cfg.testEmail(client);
    expect(res.ok).toBe(true);
    expect(res.smtp_host).toBe("smtp.example.com");
    // the decrypted pass must reach nodemailer's auth, but never the response
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: { user: "u", pass: "smtp-pass-99" } }));
    expect(JSON.stringify(res)).not.toContain("smtp-pass-99");
  });

  it("reports no-host when SMTP is unconfigured", async () => {
    const res = await cfg.testEmail(fakeClient({}));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no SMTP host/i);
  });
});

describe("getConfig redaction", () => {
  it("returns presence + last4 only, no plaintext secrets", async () => {
    const client = fakeClient({
      "integration_secret:whatsapp_token": enc("wa-secret-WXYZ"),
      "comms:whatsapp": { value: { phone_id: "PHONE1" } },
      "integration_secret:email_smtp_pass": enc("smtp-pass-99"),
      "email:default": { value: { smtp_host: "smtp.example.com", smtp_user: "u", from: "a@example.com" } },
    });
    const res = await cfg.getConfig(client);
    expect(res.whatsapp.token_set).toBe(true);
    expect(res.whatsapp.token_last4).toBe("WXYZ");
    expect(res.whatsapp.phone_id).toBe("PHONE1");
    expect(res.email.pass_set).toBe(true);
    expect(res.email.smtp_host).toBe("smtp.example.com");
    const s = JSON.stringify(res);
    expect(s).not.toContain("wa-secret");
    expect(s).not.toContain("smtp-pass-99");
  });
});
