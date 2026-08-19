#!/usr/bin/env node
/**
 * Run CI locally, before pushing.
 *
 * ── WHY ────────────────────────────────────────────────────────────────────
 *
 * `.github/workflows/ci.yaml` runs about thirty gates across four jobs. Most of
 * them are bespoke scripts in `scripts/` that nobody runs by hand, so the normal
 * way to discover you have broken one is to push, wait several minutes, read a
 * log, fix one thing, and push again. That loop has two costs, and the second is
 * the expensive one:
 *
 *   1. The wait.
 *   2. It reports ONE failure at a time when the job is fail-fast, so five
 *      unrelated breakages take five round trips. This runs everything it can
 *      and gives you the whole list at once (`--fast` if you want otherwise).
 *
 * ── WHAT IT DOES NOT DO, AND WHY THAT IS STATED RATHER THAN HIDDEN ─────────
 *
 * Four CI jobs need infrastructure this cannot assume: a live Postgres
 * (provisioning, migration replay, integration suites), PgBouncer, a Docker
 * build, and a Chromium download for the layout gate. Skipping them silently
 * would make a green run here mean less than it appears to — which is worse than
 * not running at all, because it is trusted. They are listed as SKIPPED at the
 * end, with the command to run each one deliberately.
 *
 * So: green here means "the gates that do not need infrastructure pass". It is
 * not a promise that CI will be green, and it does not try to be.
 *
 *   node scripts/ci-local.js            everything runnable, full report
 *   node scripts/ci-local.js --fast     stop at the first failure
 *   node scripts/ci-local.js --backend  backend gates only
 *   node scripts/ci-local.js --frontend client gates only
 *   node scripts/ci-local.js --list     print the gates and exit
 */
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);

const FAST = has("fast");
const ONLY_BACKEND = has("backend");
const ONLY_FRONTEND = has("frontend");

/**
 * The gates, in CI's own order.
 *
 * `cmd` is argv, never a shell string: this has to run identically on Windows
 * (where the team develops) and in Actions, and a shell string re-splits on
 * spaces differently between the two. `npm` is resolved through `npm.cmd` on
 * Windows for the same reason `runTool` does it in new-screen.test.ts.
 */
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const npm = (...args) => [NPM, ...args];
const node = (...args) => ["node", ...args];

const GATES = [
  // ── Backend job ─────────────────────────────────────────────────────────
  { group: "backend", name: "Lint", cmd: npm("run", "lint") },
  { group: "backend", name: "Env template matches the schema", cmd: node("scripts/check-env-template.js") },
  { group: "backend", name: "Font gate", cmd: npm("run", "check:fonts") },
  { group: "backend", name: "Test (jest)", cmd: ["npx", "jest"] },
  { group: "backend", name: "Migration numbering", cmd: node("scripts/db/check-migration-numbers.js") },
  { group: "backend", name: "Actor FK guard", cmd: node("scripts/check-actor-fk-guard.js") },
  { group: "backend", name: "No hardcoded FX literals", cmd: node("scripts/check-currency-literals.js") },
  { group: "backend", name: "jest.mock hoisting", cmd: node("scripts/check-jest-mock-hoisting.js") },
  { group: "backend", name: "API docs in sync", cmd: node("scripts/generate-api-docs.js", "--check") },
  { group: "backend", name: "Migration reversibility", cmd: node("scripts/db/check-migration-reversibility.js") },
  { group: "backend", name: "Migration idempotency", cmd: node("scripts/db/check-migration-idempotency.js") },
  { group: "backend", name: "Destructive migrations declared", cmd: node("scripts/db/check-destructive-migrations.js") },
  { group: "backend", name: "Schema drift", cmd: node("scripts/db/check-schema-drift.js") },
  { group: "backend", name: "Query columns exist", cmd: node("scripts/db/check-query-columns.js") },
  { group: "backend", name: "Write routes are validated", cmd: node("scripts/check-write-route-validators.js") },
  { group: "backend", name: "API contract", cmd: node("scripts/check-api-contract.js") },
  { group: "backend", name: "Response-contract drift", cmd: node("scripts/check-response-contract.js") },
  { group: "backend", name: "No new silent catches", cmd: node("scripts/check-silent-catch.js") },

  // ── Frontend job ────────────────────────────────────────────────────────
  { group: "frontend", name: "Lint (client)", cmd: npm("run", "lint", "--prefix", "client") },
  { group: "frontend", name: "Design-token contrast", cmd: npm("run", "check:contrast", "--prefix", "client") },
  { group: "frontend", name: "Frontend guide is not lying", cmd: npm("run", "check:docs", "--prefix", "client") },
  { group: "frontend", name: "Motion budget", cmd: npm("run", "check:motion", "--prefix", "client") },
  { group: "frontend", name: "Raw-palette gate", cmd: npm("run", "check:palette", "--prefix", "client") },
  { group: "frontend", name: "Test (vitest)", cmd: npm("run", "test", "--if-present", "--prefix", "client") },
  // Typecheck lives here: `npm run build` is `tsc -b && vite build`, and tsc is
  // the only thing in the whole pipeline that reads the client's types. Vitest
  // does not typecheck, so without this a type error reaches CI untouched.
  { group: "frontend", name: "Build (tsc + vite)", cmd: npm("run", "build", "--prefix", "client") },
  { group: "frontend", name: "Shared schema package", cmd: npm("run", "check:shared", "--prefix", "client") },
  { group: "frontend", name: "Shared-schema gate", cmd: npm("run", "check:schemas", "--prefix", "client") },
  { group: "frontend", name: "Bundle graph", cmd: npm("run", "check:bundle", "--prefix", "client") },

  /*
   * ── platform-console ────────────────────────────────────────────────────
   *
   * The frontend job is a MATRIX over `[client, platform-console]`. Most of its
   * steps hardcode `--prefix client` (contrast, docs, motion, palette, shared,
   * schemas, bundle), but lint / test / build run against `${{ matrix.app }}`
   * and therefore run twice.
   *
   * Easy to miss, and missing it is the precise failure this tool exists to
   * prevent: a green local run followed by a red CI on a second app nobody
   * remembered was in the matrix. `--if-present` on test because the console
   * declares no test script — CI passes it for the same reason.
   */
  { group: "frontend", name: "Lint (platform-console)", cmd: npm("run", "lint", "--prefix", "platform-console") },
  { group: "frontend", name: "Test (platform-console)", cmd: npm("run", "test", "--if-present", "--prefix", "platform-console") },
  { group: "frontend", name: "Build (platform-console)", cmd: npm("run", "build", "--prefix", "platform-console") },
];

/** Gates this cannot honestly run, and what each one needs. Printed, not hidden. */
const SKIPPED = [
  ["Provisioning + migration replay", "a live Postgres", "node scripts/db/migrate-platform.js && node scripts/db/provision-tenant.js --slug=citenant"],
  ["Integration suites", "a live Postgres + seeded tenant", "RUN_DB_TESTS=1 npx jest tests/integration"],
  ["PgBouncer pooling", "PgBouncer", "see .github/workflows/ci.yaml — 'Stand up PgBouncer'"],
  ["Desktop layout gate (e2e)", "a Chromium download", "npm run e2e:install --prefix client && npm run test:e2e --prefix client"],
  ["Docker image + module mount check", "Docker", "docker build --target runtime -t praxis-ls:ci ."],
  ["Dependency audit + secret scan", "network / CI tooling", "npm audit"],
];

function selected() {
  if (ONLY_BACKEND) return GATES.filter((g) => g.group === "backend");
  if (ONLY_FRONTEND) return GATES.filter((g) => g.group === "frontend");
  return GATES;
}

if (has("list")) {
  for (const g of selected()) console.warn(`  [${g.group}] ${g.name}  —  ${g.cmd.join(" ")}`);
  process.exit(0);
}

const gates = selected();
const results = [];
const started = Date.now();

console.warn(`\nRunning ${gates.length} gate(s) from .github/workflows/ci.yaml\n`);

for (const [i, gate] of gates.entries()) {
  const label = `[${String(i + 1).padStart(2)}/${gates.length}] ${gate.name}`;
  process.stdout.write(`${label} … `);
  const t0 = Date.now();
  const r = spawnSync(gate.cmd[0], gate.cmd.slice(1), {
    cwd: ROOT,
    encoding: "utf8",
    // Captured rather than inherited so a passing gate stays one line. The
    // output of a FAILING one is printed in full below — which is the only
    // time anybody wants to read it.
    stdio: ["ignore", "pipe", "pipe"],
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  // `r.error` is the launch failing (ENOENT on a missing binary), which is a
  // different problem from the gate failing and must not be reported as one.
  const launchFailed = !!r.error;
  const ok = !launchFailed && r.status === 0;
  results.push({ ...gate, ok, launchFailed, secs, out: `${r.stdout || ""}${r.stderr || ""}`, err: r.error });

  console.warn(ok ? `ok (${secs}s)` : launchFailed ? `COULD NOT RUN (${r.error.code})` : `FAILED (${secs}s)`);
  if (!ok && FAST) break;
}

const failed = results.filter((r) => !r.ok);

if (failed.length) {
  console.warn("\n" + "=".repeat(78));
  console.warn(`FAILURES — ${failed.length} of ${results.length} gate(s)`);
  console.warn("=".repeat(78));
  for (const f of failed) {
    console.warn(`\n──── ${f.name}\n     ${f.cmd.join(" ")}\n`);
    if (f.launchFailed) {
      console.warn(`     Could not launch: ${f.err.message}`);
      console.warn("     (a missing binary is an environment problem, not a gate failure)");
    } else {
      console.warn(f.out.trimEnd());
    }
  }
}

console.warn("\n" + "-".repeat(78));
console.warn(`NOT RUN HERE — these need infrastructure, and CI still checks them:`);
for (const [name, needs, cmd] of SKIPPED) {
  console.warn(`  · ${name} (needs ${needs})`);
  console.warn(`      ${cmd}`);
}
console.warn("-".repeat(78));

const wall = ((Date.now() - started) / 1000).toFixed(0);
console.warn(
  `\n${results.length - failed.length}/${results.length} passed in ${wall}s.` +
  (failed.length ? `  ${failed.length} to fix before pushing.\n` : "  Safe to push — subject to the skipped jobs above.\n"),
);

process.exit(failed.length ? 1 : 0);
