"use strict";

/**
 * Regression guard for doc/PHASE0_PRODUCTION_AUDIT.md §2.
 *
 * The Zod schema ships dev-safe defaults for the JWT/ENCRYPTION secrets so the
 * app boots without a .env. In production those published defaults are a full
 * auth-bypass, so env.js must refuse to boot when they are left in place. These
 * tests re-load env.js in isolation with a crafted process.env.
 */

const REAL_ACCESS = "a".repeat(48);
const REAL_REFRESH = "b".repeat(48);
const REAL_ENCKEY = "0".repeat(63) + "1"; // 64 hex, not the default constant

/**
 * TC-F3 — swallow the EXPECTED console.error while these tests run.
 *
 * `env.js` prints "Refusing to boot in production with insecure/default
 * secrets" before it throws, which is correct and is the control working. But
 * this suite triggers it deliberately on every run, so every GREEN build
 * printed a red error block. That trains people to skim past red text in CI
 * output, which is precisely the habit you do not want the day the red block is
 * real.
 *
 * Silenced only for the duration of these cases, and only for `error` — an
 * unexpected message from anywhere else in the same window would be swallowed
 * too, so the spy is asserted on rather than merely installed: the first test
 * below checks the guard DID speak, which keeps the silencing honest.
 */
let errorSpy;
beforeEach(() => { errorSpy = jest.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { errorSpy.mockRestore(); });

function loadEnv(overrides) {
  let mod;
  jest.isolateModules(() => {
    const saved = { ...process.env };
    Object.assign(process.env, overrides);
    try {
      mod = require("../../src/config/env");
    } finally {
      // restore so other tests are unaffected
      for (const k of Object.keys(overrides)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
  return mod;
}

describe("production secret guard", () => {
  it("refuses to boot in production with the default JWT/encryption secrets", () => {
    // JWT/ENCRYPTION intentionally NOT provided → the Zod schema fills the
    // published insecure defaults, which the production guard must reject.
    // Asserted, not just silenced (TC-F3): if the guard ever stops PRINTING as
    // well as throwing, an operator loses the one line that names which secret
    // is wrong — and the mock above would hide that from this suite forever.
    expect(() =>
      loadEnv({
        NODE_ENV: "production",
        DB_PASSWORD: "realpw",
      }),
    ).toThrow(/[Ii]nsecure/);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Refusing to boot"),
      expect.stringContaining("JWT_ACCESS_SECRET"),
    );
  });

  it("refuses to boot in production when DB_PASSWORD is empty", () => {
    expect(() =>
      loadEnv({
        NODE_ENV: "production",
        JWT_ACCESS_SECRET: REAL_ACCESS,
        JWT_REFRESH_SECRET: REAL_REFRESH,
        ENCRYPTION_KEY: REAL_ENCKEY,
        DB_PASSWORD: "",
      }),
    ).toThrow(/[Ii]nsecure/);
  });

  it("boots in production when real secrets are provided", () => {
    const mod = loadEnv({
      NODE_ENV: "production",
      JWT_ACCESS_SECRET: REAL_ACCESS,
      JWT_REFRESH_SECRET: REAL_REFRESH,
      ENCRYPTION_KEY: REAL_ENCKEY,
      DB_PASSWORD: "realpw",
    });
    expect(mod.config.NODE_ENV).toBe("production");
    expect(mod.config.JWT_ACCESS_SECRET).toBe(REAL_ACCESS);
  });

  it("still boots in development with defaults (dev ergonomics preserved)", () => {
    const mod = loadEnv({ NODE_ENV: "development" });
    expect(mod.config.NODE_ENV).toBe("development");
  });
});
