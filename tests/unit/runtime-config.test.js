"use strict";

/**
 * Vault-first runtime configuration (src/services/platform/runtime-config.service.js).
 *
 * The rule: anything that CAN live in the platform settings vault does, and
 * `.env` is the fallback. These tests pin the three properties that decide
 * whether that is safe to rely on.
 *
 *   1. THE VAULT WINS, but only where it actually has a value. A half-filled
 *      vault entry must not blank out the env values it says nothing about —
 *      that would turn "I set the bucket in the console" into "the region reset
 *      to nothing".
 *
 *   2. A VAULT FAILURE FALLS BACK, silently and completely. These settings are
 *      read by backups, probes and the WAL archiver. If a platform-DB hiccup
 *      propagated, a settings lookup would take down the machinery that exists
 *      to survive outages.
 *
 *   3. `0` AND `false` ARE VALUES. A retention of 0 days or a disabled flag must
 *      not be treated as "unset" and silently replaced by a default — the
 *      classic falsy-coalescing bug, and an expensive one when the value governs
 *      what gets deleted.
 */

jest.mock("../../src/services/platform/settings.service", () => ({ resolve: jest.fn() }));

const settings = require("../../src/services/platform/settings.service");
const runtimeConfig = require("../../src/services/platform/runtime-config.service");
const { config } = require("../../src/config/env");

/** Vault answers with this row for any section/key. */
const vault = (value, secret = null) => settings.resolve.mockResolvedValue({ value, secret });
const emptyVault = () => settings.resolve.mockResolvedValue(null);

beforeEach(() => {
  jest.clearAllMocks();
  runtimeConfig.invalidate();
});

describe("backupStorage", () => {
  test("falls back to env when the vault has nothing", async () => {
    emptyVault();
    const c = await runtimeConfig.backupStorage();
    expect(c.driver).toBe(config.BACKUP_DRIVER || "local");
    expect(c.source).toBe("env");
  });

  test("the vault wins over env", async () => {
    vault({ driver: "s3", bucket: "praxis-offsite", region: "eu-central-1" }, "vault-secret-key");
    const c = await runtimeConfig.backupStorage();
    expect(c.driver).toBe("s3");
    expect(c.s3.bucket).toBe("praxis-offsite");
    expect(c.s3.secretKey).toBe("vault-secret-key");
    expect(c.source).toBe("vault");
  });

  test("a partial vault entry does not blank the fields it omits", async () => {
    // Setting only the bucket in the console must not wipe the region — the
    // whole entry is one row, so a naive replace would.
    vault({ bucket: "only-this" });
    const c = await runtimeConfig.backupStorage();
    expect(c.s3.bucket).toBe("only-this");
    expect(c.s3.region).toBe(config.BACKUP_S3_REGION || "us-east-1");
  });

  test("a vault failure falls back to env instead of propagating", async () => {
    settings.resolve.mockRejectedValue(new Error("platform db unreachable"));
    const c = await runtimeConfig.backupStorage();
    // A settings lookup must never be the reason a backup does not run.
    expect(c.driver).toBe(config.BACKUP_DRIVER || "local");
    expect(c.source).toBe("env");
  });

  test("the secret never leaks into the non-secret half", async () => {
    vault({ driver: "s3", bucket: "b" }, "super-secret");
    const c = await runtimeConfig.backupStorage();
    expect(JSON.stringify({ driver: c.driver, bucket: c.s3.bucket, source: c.source }))
      .not.toContain("super-secret");
  });
});

describe("opsTuning", () => {
  test("falls back to env defaults", async () => {
    emptyVault();
    const t = await runtimeConfig.opsTuning();
    expect(t.backupRetainDailyDays).toBe(Number(config.BACKUP_RETAIN_DAILY_DAYS));
    expect(t.source).toBe("env");
  });

  test("the vault wins", async () => {
    vault({ backup_retain_daily_days: 7, health_error_amber: 999 });
    const t = await runtimeConfig.opsTuning();
    expect(t.backupRetainDailyDays).toBe(7);
    expect(t.healthErrorAmber).toBe(999);
  });

  test("zero is a value, not a miss", async () => {
    // The falsy-coalescing bug: `value || default` turns a deliberate 0 into the
    // default. Here that would mean "keep nothing" silently becoming "keep 30
    // days", which is the wrong direction for a setting that governs deletion.
    vault({ backup_retain_daily_days: 0 });
    const t = await runtimeConfig.opsTuning();
    expect(t.backupRetainDailyDays).toBe(0);
  });

  test("a non-numeric vault value falls back rather than producing NaN", async () => {
    // NaN comparisons are all false, so a NaN threshold silently disables the
    // check it governs — a control that looks configured and does nothing.
    vault({ health_error_amber: "not-a-number" });
    const t = await runtimeConfig.opsTuning();
    expect(Number.isFinite(t.healthErrorAmber)).toBe(true);
  });
});

describe("caching", () => {
  test("repeated reads hit the vault once", async () => {
    emptyVault();
    await runtimeConfig.opsTuning();
    await runtimeConfig.opsTuning();
    await runtimeConfig.opsTuning();
    // These are read on hot paths — every backup, probe and WAL segment. One
    // round trip per read would be a real cost.
    expect(settings.resolve).toHaveBeenCalledTimes(1);
  });

  test("invalidate() makes the next read fresh — this is what makes a console save take effect", async () => {
    vault({ backup_retain_daily_days: 7 });
    expect((await runtimeConfig.opsTuning()).backupRetainDailyDays).toBe(7);

    vault({ backup_retain_daily_days: 14 });
    // Still cached.
    expect((await runtimeConfig.opsTuning()).backupRetainDailyDays).toBe(7);

    runtimeConfig.invalidate();
    expect((await runtimeConfig.opsTuning()).backupRetainDailyDays).toBe(14);
  });

  test("storage and tuning are cached separately", async () => {
    emptyVault();
    await runtimeConfig.backupStorage();
    await runtimeConfig.opsTuning();
    expect(settings.resolve).toHaveBeenCalledTimes(2);
    expect(settings.resolve).toHaveBeenCalledWith("storage", "backup");
    expect(settings.resolve).toHaveBeenCalledWith("ops", "tuning");
  });
});
