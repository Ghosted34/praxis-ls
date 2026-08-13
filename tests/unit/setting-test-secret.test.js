"use strict";

/**
 * Unit cover for MOD-70 settings key testing (setting.service.testSecret +
 * setting.probes). Verifies: not-set / unknown-provider branches, a passing
 * live check, a clean upstream-failure shape, and that the decrypted secret is
 * used upstream but never leaks into the returned payload.
 */

jest.mock("axios");
const axios = require("axios");
const encryption = require("../../src/services/encryption.service");
const service = require("../../src/modules/security/setting/setting.service");

const SECRET = "integration_secret";

// Fake tenant client: setting.repo.getByKey issues a single SELECT; return the
// row we want (or none). We don't assert on SQL — just feed the service a row.
function clientReturning(row) {
  return { query: async () => ({ rows: row ? [row] : [] }) };
}

describe("settings testSecret", () => {
  afterEach(() => jest.clearAllMocks());

  it("reports not-set when no secret row exists", async () => {
    const res = await service.testSecret(
      clientReturning(null),
      "fx_exchangerate",
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no integration secret/i);
  });

  it("reports no-probe for a provider without a test", async () => {
    const row = {
      section: SECRET,
      key: "misc",
      value: { provider: "acme", secret_enc: encryption.encrypt("x") },
    };
    const res = await service.testSecret(clientReturning(row), "misc");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no connectivity test/i);
  });

  it("passes when exchangerate-api authenticates, without leaking the key", async () => {
    axios.get.mockResolvedValue({
      data: { result: "success", terms_of_use: "t" },
    });
    const row = {
      section: SECRET,
      key: "fx_exchangerate",
      value: {
        provider: "exchangerate-api",
        secret_enc: encryption.encrypt("realkey123"),
      },
    };
    const res = await service.testSecret(
      clientReturning(row),
      "fx_exchangerate",
    );
    expect(res.ok).toBe(true);
    expect(res.provider).toBe("exchangerate-api");
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("realkey123"),
      expect.any(Object),
    );
    expect(JSON.stringify(res)).not.toContain("realkey123");
  });

  it("fails cleanly on an upstream 401", async () => {
    axios.get.mockRejectedValue({
      response: { status: 401, data: { "error-type": "invalid-key" } },
    });
    const row = {
      section: SECRET,
      key: "fx_exchangerate",
      value: {
        provider: "exchangerate-api",
        secret_enc: encryption.encrypt("badkey"),
      },
    };
    const res = await service.testSecret(
      clientReturning(row),
      "fx_exchangerate",
    );
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(res.error).toMatch(/invalid-key/);
  });
});
