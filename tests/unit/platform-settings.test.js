"use strict";

/**
 * Platform settings (deploy-wide integrations) — encrypted store + live tests.
 * Mocks the platform DB (in-memory), axios (Geoapify), and aws-sdk (S3 HeadBucket).
 * Proves: secret encrypt + redaction, secret preserved on value-only update,
 * resolve() returns plaintext for consumers, and probes pass/fail cleanly.
 */

jest.mock("axios");
jest.mock("nodemailer", () => ({
  createTransport: jest.fn(() => ({
    verify: jest.fn(async () => true),
    sendMail: jest.fn(async () => ({})),
  })),
}));

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    async send() {
      return {};
    } // HeadBucket ok
  },
  HeadBucketCommand: class {},
}));

jest.mock("../../src/services/platform/db", () => {
  const rows = new Map();
  return {
    __rows: rows,
    query: jest.fn(async (sql, params) => {
      if (sql.includes("INSERT INTO platform.platform_setting")) {
        const [section, key, valueJson, secret_enc, last4, updated_by] = params;
        const k = `${section}:${key}`;
        const prev = rows.get(k);
        const row = {
          section,
          key,
          value: JSON.parse(valueJson),
          secret_enc,
          last4,
          version: prev ? prev.version + 1 : 1,
          updated_by,
          updated_at: new Date().toISOString(),
        };
        rows.set(k, row);
        return { rows: [row] };
      }
      if (sql.includes("WHERE section=$1 AND key=$2")) {
        const row = rows.get(`${params[0]}:${params[1]}`);
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("ORDER BY section, key"))
        return { rows: [...rows.values()] };
      return { rows: [] };
    }),
  };
});

const axios = require("axios");
const db = require("../../src/services/platform/db");
const service = require("../../src/services/platform/settings.service");

beforeEach(() => {
  db.__rows.clear();
  jest.clearAllMocks();
});

describe("platform settings store", () => {
  it("encrypts the secret and redacts on read", async () => {
    const saved = await service.put({
      section: "geocoding",
      key: "geoapify",
      value: {},
      secret: "geo-secret-KEY9",
    });
    expect(saved.secret_set).toBe(true);
    expect(saved.last4).toBe("KEY9");
    expect(JSON.stringify(saved)).not.toContain("geo-secret");
    // resolve() (internal) returns the plaintext for consumers
    const r = await service.resolve("geocoding", "geoapify");
    expect(r.secret).toBe("geo-secret-KEY9");
  });

  it("preserves the secret when only the value is updated", async () => {
    await service.put({
      section: "storage",
      key: "s3",
      value: { bucket: "b1" },
      secret: "s3-secret-AAAA",
    });
    await service.put({
      section: "storage",
      key: "s3",
      value: { bucket: "b2", region: "eu-west-1" },
    });
    const got = await service.get("storage", "s3");
    expect(got.value.bucket).toBe("b2");
    expect(got.secret_set).toBe(true);
    expect(got.last4).toBe("AAAA");
    expect((await service.resolve("storage", "s3")).secret).toBe(
      "s3-secret-AAAA",
    );
  });
});

describe("platform settings tests (probes)", () => {
  it("S3 passes when HeadBucket succeeds", async () => {
    await service.put({
      section: "storage",
      key: "s3",
      value: { bucket: "praxis-vault", region: "us-east-1" },
      secret: "sk",
    });
    const res = await service.test("storage", "s3");
    expect(res.ok).toBe(true);
    expect(res.bucket).toBe("praxis-vault");
  });

  it("Geoapify passes on a 200 and never leaks the key", async () => {
    axios.get.mockResolvedValue({
      data: { results: [{ formatted: "Paris" }] },
    });
    await service.put({
      section: "geocoding",
      key: "geoapify",
      value: {},
      secret: "geo-KEY",
    });
    const res = await service.test("geocoding", "geoapify");
    expect(res.ok).toBe(true);
    expect(res.results).toBe(1);
    expect(axios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        params: expect.objectContaining({ apiKey: "geo-KEY" }),
      }),
    );
    expect(JSON.stringify(res)).not.toContain("geo-KEY");
  });

  it("Geoapify fails cleanly on a 401", async () => {
    axios.get.mockRejectedValue({
      response: { status: 401, data: { message: "Invalid apiKey" } },
    });
    await service.put({
      section: "geocoding",
      key: "geoapify",
      value: {},
      secret: "bad",
    });
    const res = await service.test("geocoding", "geoapify");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(res.error).toMatch(/Invalid apiKey/);
  });

  it("VAPID validates a well-formed keypair", async () => {
    const pub = "B" + "a".repeat(86); // 87 chars, base64url
    const priv = "c".repeat(43);
    await service.put({
      section: "push",
      key: "vapid",
      value: { public_key: pub, subject: "mailto:x@y.z" },
      secret: priv,
    });
    const res = await service.test("push", "vapid");
    expect(res.ok).toBe(true);
    expect(res.subject).toBe("mailto:x@y.z");
  });

  it("VAPID fails when the keypair is missing", async () => {
    await service.put({
      section: "push",
      key: "vapid",
      value: { subject: "mailto:x@y.z" },
    });
    const res = await service.test("push", "vapid");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/VAPID/);
  });

  it("Mail fallback SMTP passes when the transport verifies, and never leaks the pass", async () => {
    const nodemailer = require("nodemailer");
    await service.put({
      section: "mail",
      key: "fallback",
      value: {
        from: "no-reply@praxisls.com",
        support_from: "support@praxisls.com",
        smtp_host: "mail.praxisls.com",
        smtp_port: 587,
        smtp_user: "relay",
      },
      secret: "smtp-pass-42",
    });
    const res = await service.test("mail", "fallback");
    expect(res.ok).toBe(true);
    expect(res.smtp_host).toBe("mail.praxisls.com");
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "mail.praxisls.com",
        auth: { user: "relay", pass: "smtp-pass-42" },
      }),
    );
    expect(JSON.stringify(res)).not.toContain("smtp-pass-42");
  });

  it("Mail fallback SMTP fails cleanly when no host is configured", async () => {
    await service.put({
      section: "mail",
      key: "fallback",
      value: { from: "no-reply@praxisls.com" },
    });
    const res = await service.test("mail", "fallback");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no SMTP host/i);
  });
});
