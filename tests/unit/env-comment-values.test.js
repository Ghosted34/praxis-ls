/**
 * A config value that is actually a COMMENT — INCIDENT 2026-08-12.
 *
 * `.env` on the production host carried this, copied verbatim out of
 * `.env.example`:
 *
 *     TENANT_DB_POOLER_HOST=                # e.g. pgbouncer  (empty = direct to Postgres)
 *
 * Node's dotenv reads that as `""`. Docker Compose's `env_file` parser keeps the
 * comment as the VALUE. So every tenant pool tried to connect to a host named
 * `# e.g. pgbouncer  (empty = direct to Postgres)`, failed DNS, and timed out at
 * TENANT_POOL_ACQUIRE_TIMEOUT_MS. Tenant sites were down for hours; the platform
 * console was unaffected, because DB_HOST has a value before its comment and
 * parses identically under both.
 *
 * WHY THIS TEST IS WORTH ITS LINES
 *
 *   The bug was invisible to every existing check. It is not a syntax error, not
 *   a schema violation — `TENANT_DB_POOLER_HOST` is `z.string()` and a comment is
 *   a perfectly good string — and it could not be reproduced locally, because
 *   locally the file goes through dotenv and comes out right. Two parsers
 *   disagreeing about one file is not a class of failure any of the other gates
 *   look for.
 *
 *   `.env.example` is fixed (comments moved above their keys) and
 *   `check-env-template.js` now fails if the shape comes back. This pins the
 *   runtime half: even given a bad value, the app must not use it.
 */
"use strict";

/** Load env.js fresh with a given process.env — it caches and freezes on first require. */
function loadEnvWith(vars) {
  let mod;
  jest.isolateModules(() => {
    const saved = {};
    for (const [k, v] of Object.entries(vars)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    try {
      mod = require("../../src/config/env");
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
  return mod;
}

describe("env values that are really comments", () => {
  beforeEach(() => jest.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  test("a pooler host that is a comment is ignored, not dialled", () => {
    const { config, misparsedEnvKeys } = loadEnvWith({
      TENANT_DB_POOLER_HOST: "# e.g. pgbouncer  (empty = direct to Postgres)",
    });

    // Empty is what the operator meant. Anything else and registry.service.js
    // routes every tenant pool at a hostname that cannot resolve.
    expect(config.TENANT_DB_POOLER_HOST).toBe("");
    expect(misparsedEnvKeys).toContain("TENANT_DB_POOLER_HOST");
  });

  test("it is announced — a silently-dropped setting is the other half of the bug", () => {
    loadEnvWith({ TENANT_DB_POOLER_HOST: "#anything" });
    expect(console.warn).toHaveBeenCalled();
    const said = console.warn.mock.calls.flat().join(" ");
    expect(said).toMatch(/TENANT_DB_POOLER_HOST/);
  });

  test("an alert webhook that is a comment does not read as configured", () => {
    // The nastiest instance of the shape. A truthy `#...` passes every
    // "is a destination set?" check while posting nowhere, so the alerting
    // system reports itself healthy precisely when it is not.
    const { config } = loadEnvWith({
      ALERT_WEBHOOK_URL: "# Slack/Teams/Discord incoming webhook",
    });
    expect(config.ALERT_WEBHOOK_URL).toBe("");
    expect(Boolean(config.ALERT_WEBHOOK_URL)).toBe(false);
  });

  test("leading whitespace before the # is still a comment", () => {
    const { config } = loadEnvWith({ S3_ENDPOINT: "   # e.g. Hetzner/Backblaze" });
    expect(config.S3_ENDPOINT).toBe("");
  });

  test("a legitimate value containing # later on is left alone", () => {
    // Only a value that STARTS with # is a mis-parse. A fragment or an anchor
    // inside a real value is not, and coercing it would be its own outage.
    const { config } = loadEnvWith({ S3_ENDPOINT: "https://s3.example.com/#path" });
    expect(config.S3_ENDPOINT).toBe("https://s3.example.com/#path");
  });
});
