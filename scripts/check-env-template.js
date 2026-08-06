#!/usr/bin/env node
/**
 * TC-E1 — keep `.env.example` honest about what the application requires.
 *
 * THE FAILURE THIS PREVENTS, in order:
 *
 *   1. a change adds a required env var and updates nothing else
 *   2. CI passes — nothing in CI validates any `.env` against the schema
 *   3. the image builds
 *   4. `deploy.sh` BACKS UP AND MIGRATES — every tenant database is written to
 *   5. the container starts, `env.js` runs its Zod parse, and refuses to boot
 *
 * The guard in `env.js` is well built and is the right control; the problem is
 * purely *when* it runs. By the time it speaks, migrations are already applied
 * and the only way forward is forward. Everything above happens on the
 * production host, with no staging to catch it (TC-D6 is a deliberate,
 * cost-based decision — so the mitigations have to be cheap ones like this).
 *
 * WHAT IT CHECKS, in both directions, because drift goes both ways:
 *
 *   MISSING  — a key the schema requires (no `.default()`) that `.env.example`
 *              does not mention. This is the one that breaks a deploy.
 *   UNKNOWN  — a key `.env.example` documents that the schema has never heard
 *              of. Harmless at runtime and corrosive over time: it is how a
 *              template becomes folklore, and how an operator sets a variable
 *              that does nothing while believing it did something.
 *
 * It reads the SCHEMA, not a hand-kept list, so it cannot drift from `env.js`
 * the way `.env.example` drifted from the app.
 *
 * Exits 1 on any mismatch. `--json` for machine consumption.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TEMPLATE = path.join(ROOT, ".env.example");

/**
 * Read the schema without booting the app.
 *
 * `env.js` runs `dotenv.config()` and its production guard at require time, so
 * requiring it here would read the developer's real `.env` and could throw. The
 * schema shape is what we want, and it is recoverable from the source text:
 * every entry is `KEY: z.…` or `KEY: int(…)` / `bool(…)` at one indent level
 * inside the single `z.object({ … })`.
 *
 * Text-scanned rather than executed, and that is a deliberate trade: a false
 * reading here costs a CI failure that a human resolves in a minute, whereas
 * executing env.js in CI would need a fabricated environment that is itself a
 * second copy of the thing being checked.
 */
function schemaKeys() {
  const src = fs.readFileSync(path.join(ROOT, "src", "config", "env.js"), "utf8");
  const start = src.indexOf("z.object({");
  if (start === -1) throw new Error("could not find the z.object({ … }) schema in src/config/env.js");
  // BOUND THE SCAN to the schema literal. Reading to end-of-file also swept up
  // `INSECURE_DEFAULTS`, whose keys are UPPER_CASE at the same indent — those
  // three happen to be real schema keys too, so it was invisible, but the next
  // uppercase constant object added to this file would have invented a required
  // variable and failed CI for a key that does not exist.
  const end = src.indexOf("\n});", start);
  const body = end === -1 ? src.slice(start) : src.slice(start, end);

  const required = new Set();
  const optional = new Set();
  for (const line of body.split("\n")) {
    const bare = line.replace(/\/\/.*$/, "");
    const m = bare.match(/^\s{2}([A-Z][A-Z0-9_]*)\s*:\s*(.+)$/);
    if (!m) continue;
    const [, key, rhs] = m;
    // `.default(` / `.optional(` anywhere in the definition means the app boots
    // without it. `int(1536)` and `bool(true)` are the local helpers, and both
    // take their default as the argument.
    const hasDefault = /\.default\(|\.optional\(|^\s*(int|bool)\(\s*[^)]/.test(rhs);
    (hasDefault ? optional : required).add(key);
  }
  if (required.size + optional.size < 20) {
    // The scanner found almost nothing, which means the file's shape changed.
    // Fail loudly: a check that silently matches zero keys passes forever.
    throw new Error(`only ${required.size + optional.size} keys parsed from env.js — the scanner needs updating`);
  }
  return { required, optional, all: new Set([...required, ...optional]) };
}

/** Every key `.env.example` mentions, set or commented-out-but-documented. */
function templateKeys() {
  const keys = new Set();
  for (const raw of fs.readFileSync(TEMPLATE, "utf8").split("\n")) {
    // Accept both `KEY=value` and `# KEY=value` — a commented example still
    // documents the variable, which is the point of the file.
    const m = raw.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

function main() {
  const schema = schemaKeys();
  const template = templateKeys();

  const missing = [...schema.required].filter((k) => !template.has(k)).sort();
  const unknown = [...template].filter((k) => !schema.all.has(k)).sort();

  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ missing, unknown }, null, 2) + "\n");
  } else {
    process.stdout.write(
      `env template: ${schema.required.size} required / ${schema.optional.size} defaulted keys in the schema, `
      + `${template.size} documented in .env.example\n`,
    );
    for (const k of missing) {
      console.error(`::error file=.env.example::${k} is REQUIRED by src/config/env.js and is not in .env.example — a deploy that needs it will fail AFTER migrations have run`);
    }
    for (const k of unknown) {
      console.error(`::error file=.env.example::${k} is documented in .env.example but no longer exists in src/config/env.js — setting it does nothing`);
    }
    if (!missing.length && !unknown.length) process.stdout.write(".env.example matches the schema.\n");
  }
  process.exit(missing.length || unknown.length ? 1 : 0);
}

main();
