"use strict";

/**
 * WS-S2 — per-tenant database credentials
 * (src/services/tenant/db-credential.service.js).
 *
 * Tenant isolation is the database boundary, but every tenant pool used to
 * authenticate with the same shared DB_PASSWORD, so a leaked app password
 * reached every tenant DB. This resolves each tenant's own credential from the
 * PLATFORM vault (it cannot live in the tenant vault — reading it would need a
 * connection to the database the password opens).
 *
 * The behaviour that matters most here is the FALLBACK: resolution must degrade
 * to the shared credential rather than throw, or a secret-store hiccup takes a
 * tenant offline. Every failure mode below asserts that.
 *
 * Platform DB and encryption are mocked; no network, no Postgres.
 */

jest.mock("../../src/services/platform/db", () => ({ query: jest.fn(), close: jest.fn() }));
jest.mock("../../src/services/encryption.service", () => ({
  encrypt: jest.fn((s) => `enc(${s})`),
  decrypt: jest.fn((s) => String(s).replace(/^enc\(|\)$/g, "")),
}));

const platformDb = require("../../src/services/platform/db");
const encryption = require("../../src/services/encryption.service");
const { config } = require("../../src/config/env");
const creds = require("../../src/services/tenant/db-credential.service");

const meta = (over = {}) => ({
  slug: "acme",
  app_role: "praxis_acme",
  secret_ref: "vault:tenant/acme/db-password",
  db_name: "tenant_acme",
  ...over,
});

// Default fake crypto, restored before every test. `clearMocks` in jest.config
// clears CALLS but keeps IMPLEMENTATIONS, so the decrypt-throws case below would
// otherwise leak its failure into every test that ran after it.
const fakeEncrypt = (s) => `enc(${s})`;
const fakeDecrypt = (s) => String(s).replace(/^enc\(|\)$/g, "");

beforeEach(() => {
  jest.clearAllMocks();
  encryption.encrypt.mockImplementation(fakeEncrypt);
  encryption.decrypt.mockImplementation(fakeDecrypt);
  creds.invalidate(); // clear the TTL cache between cases
});

describe("secret_ref parsing", () => {
  test("parses the vault scheme provisioning writes", () => {
    expect(creds.parseSecretRef("vault:tenant/acme/db-password")).toEqual({
      kind: "vault",
      slug: "acme",
    });
  });

  test("parses the env escape hatch", () => {
    expect(creds.parseSecretRef("env:ACME_DB_PASSWORD")).toEqual({
      kind: "env",
      varName: "ACME_DB_PASSWORD",
    });
  });

  test("returns null for anything unrecognised rather than throwing", () => {
    expect(creds.parseSecretRef("")).toBeNull();
    expect(creds.parseSecretRef(null)).toBeNull();
    expect(creds.parseSecretRef("s3://nope")).toBeNull();
    expect(creds.parseSecretRef("vault:tenant/acme/api-key")).toBeNull();
  });
});

describe("resolveCredential", () => {
  test("returns the tenant's own password when one is vaulted", async () => {
    platformDb.query.mockResolvedValue({ rows: [{ secret_enc: "enc(tenant-secret)" }] });
    const cred = await creds.resolveCredential(meta());
    expect(cred).toEqual({ user: "praxis_acme", password: "tenant-secret", source: "vault" });
  });

  test("uses app_role from the registry row, not the deploy-wide role", async () => {
    platformDb.query.mockResolvedValue({ rows: [{ secret_enc: "enc(x)" }] });
    const cred = await creds.resolveCredential(meta({ app_role: "praxis_other" }));
    expect(cred.user).toBe("praxis_other");
  });

  test("falls back to the shared credential when no secret is stored (backfill pending)", async () => {
    platformDb.query.mockResolvedValue({ rows: [] });
    const cred = await creds.resolveCredential(meta());
    expect(cred.source).toBe("shared");
    expect(cred.password).toBe(config.DB_PASSWORD);
  });

  test("falls back when the row exists but holds no ciphertext", async () => {
    platformDb.query.mockResolvedValue({ rows: [{ secret_enc: null }] });
    expect((await creds.resolveCredential(meta())).source).toBe("shared");
  });

  test("falls back — and does not throw — when the platform DB query fails", async () => {
    platformDb.query.mockRejectedValue(new Error("platform DB unreachable"));
    const cred = await creds.resolveCredential(meta());
    expect(cred.source).toBe("shared");
    expect(cred.password).toBe(config.DB_PASSWORD);
  });

  test("falls back when decryption fails (wrong ENCRYPTION_KEY / corrupt ciphertext)", async () => {
    platformDb.query.mockResolvedValue({ rows: [{ secret_enc: "garbage" }] });
    encryption.decrypt.mockImplementation(() => {
      throw new Error("unsupported state or unable to authenticate data");
    });
    const cred = await creds.resolveCredential(meta());
    expect(cred.source).toBe("shared");
  });

  test("falls back on an unparseable secret_ref instead of taking the tenant offline", async () => {
    const cred = await creds.resolveCredential(meta({ secret_ref: "not-a-ref" }));
    expect(cred.source).toBe("shared");
    expect(platformDb.query).not.toHaveBeenCalled();
  });

  test("reads the env scheme without touching the platform DB", async () => {
    process.env.ACME_DB_PASSWORD = "from-env";
    const cred = await creds.resolveCredential(meta({ secret_ref: "env:ACME_DB_PASSWORD" }));
    expect(cred).toEqual({ user: "praxis_acme", password: "from-env", source: "vault" });
    expect(platformDb.query).not.toHaveBeenCalled();
    delete process.env.ACME_DB_PASSWORD;
  });
});

describe("caching and rotation", () => {
  test("caches a resolved credential so pool churn does not re-query the platform DB", async () => {
    platformDb.query.mockResolvedValue({ rows: [{ secret_enc: "enc(cached)" }] });
    await creds.resolveCredential(meta());
    await creds.resolveCredential(meta());
    expect(platformDb.query).toHaveBeenCalledTimes(1);
  });

  test("invalidate() forces the next resolve to re-read — this is what makes rotation take effect", async () => {
    platformDb.query.mockResolvedValue({ rows: [{ secret_enc: "enc(old)" }] });
    expect((await creds.resolveCredential(meta())).password).toBe("old");

    platformDb.query.mockResolvedValue({ rows: [{ secret_enc: "enc(new)" }] });
    expect((await creds.resolveCredential(meta())).password).toBe("old"); // still cached
    creds.invalidate("acme");
    expect((await creds.resolveCredential(meta())).password).toBe("new");
  });

  test("a shared-credential fallback is NOT cached, so a backfilled tenant picks up its credential", async () => {
    platformDb.query.mockResolvedValue({ rows: [] });
    expect((await creds.resolveCredential(meta())).source).toBe("shared");
    platformDb.query.mockResolvedValue({ rows: [{ secret_enc: "enc(now-provisioned)" }] });
    expect((await creds.resolveCredential(meta())).source).toBe("vault");
  });
});

describe("putCredential", () => {
  test("encrypts before writing and never stores plaintext", async () => {
    platformDb.query.mockResolvedValue({ rows: [] });
    await creds.putCredential("acme", "s3cret-value");

    expect(encryption.encrypt).toHaveBeenCalledWith("s3cret-value");
    const [sql, params] = platformDb.query.mock.calls[0];
    expect(sql).toMatch(/platform\.platform_setting/);
    expect(params).toContain("enc(s3cret-value)");
    expect(params).not.toContain("s3cret-value");
    expect(params).toContain("alue"); // last4, for console display
  });

  test("rejects an empty or oversized password", async () => {
    await expect(creds.putCredential("acme", "")).rejects.toThrow(/1–4000/);
    await expect(creds.putCredential("acme", "x".repeat(4001))).rejects.toThrow(/1–4000/);
  });

  test("writes under the tenant_db section keyed by slug, lowercased", async () => {
    platformDb.query.mockResolvedValue({ rows: [] });
    await creds.putCredential("ACME", "pw");
    const [, params] = platformDb.query.mock.calls[0];
    expect(params[0]).toBe(creds.SECTION);
    expect(params[1]).toBe("acme");
  });
});
