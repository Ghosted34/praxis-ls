#!/usr/bin/env node
/**
 * Run the tests and print EVERY failure in full.
 *
 * WHY THIS EXISTS. Jest's default reporter is tuned for a person watching a
 * short run: it truncates long diffs, collapses repeated failures, and prints
 * the summary last — so on a suite this size the interesting lines have already
 * scrolled off, and "82 failed" arrives with no way to see what 82 things
 * broke. Copying the console back out is then lossy in exactly the places that
 * matter.
 *
 * This drives Jest with `--json`, which contains every assertion's full failure
 * message, and re-prints them grouped by suite with nothing elided. It also
 * writes the same text to a file so a whole run can be pasted in one go.
 *
 * Usage:
 *   node scripts/test-report.js                 # all unit tests
 *   node scripts/test-report.js tests/unit/x    # a subset — any jest arg works
 *   npm run test:report
 *
 * Exit code mirrors Jest's, so it is safe in CI.
 */
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "test-failures.txt");
const jsonFile = path.join(os.tmpdir(), `praxis-jest-${process.pid}.json`);

const passthrough = process.argv.slice(2);
const args = [
  ...(passthrough.length ? passthrough : ["tests/unit"]),
  "--json",
  `--outputFile=${jsonFile}`,
  // The run's own console noise is not the point here and doubles the output.
  "--silent",
];

/**
 * Run Jest's entry script with THIS node, no shell.
 *
 * Not `node_modules/.bin/jest`: on Windows that is `jest.cmd`, which needs a
 * shell to launch — and a shell re-splits the arguments, so
 * `--outputFile=<path>` breaks the moment the temp path contains a space. Same
 * class of bug as the `npx` calls removed from new-screen.test.js under
 * TC-CI10. Resolving the JS entry and running it with `process.execPath` avoids
 * the shell on every platform.
 */
const jestEntry = require.resolve("jest/bin/jest");
const res = spawnSync(process.execPath, [jestEntry, ...args], {
  cwd: ROOT,
  stdio: ["ignore", "inherit", "inherit"],
});

if (!fs.existsSync(jsonFile)) {
  console.error("\nNo JSON report was produced — Jest failed before it could run (see above).");
  process.exit(res.status === null ? 1 : res.status);
}

const report = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
fs.unlinkSync(jsonFile);

const lines = [];
const say = (s = "") => lines.push(s);

/** Suites that failed to LOAD at all — these produce no assertions, so they are
 *  invisible in a per-test listing and are usually the actual cause. */
const brokenSuites = report.testResults.filter(
  (s) => s.testExecError || (s.failureMessage && s.assertionResults.every((a) => a.status !== "failed")),
);

const failedAssertions = report.testResults
  .map((s) => ({ file: s.name, failed: s.assertionResults.filter((a) => a.status === "failed") }))
  .filter((s) => s.failed.length);

say("=".repeat(78));
say(`SUITES  ${report.numFailedTestSuites} failed / ${report.numTotalTestSuites} total`);
say(`TESTS   ${report.numFailedTests} failed / ${report.numTotalTests} total`);
say("=".repeat(78));

if (brokenSuites.length) {
  say("");
  say("SUITES THAT DID NOT LOAD — read these FIRST.");
  say("A suite that throws on require reports zero passing tests and every test");
  say("in it as failed, so it inflates the failure count and hides the cause.");
  say("");
  for (const s of brokenSuites) {
    say("-".repeat(78));
    say(path.relative(ROOT, s.name));
    say("-".repeat(78));
    say((s.failureMessage || String(s.testExecError && s.testExecError.message || "")).trimEnd());
    say("");
  }
}

if (failedAssertions.length) {
  say("");
  say("FAILED ASSERTIONS, in full");
  say("");
  for (const s of failedAssertions) {
    say("=".repeat(78));
    say(`${path.relative(ROOT, s.file)}  — ${s.failed.length} failed`);
    say("=".repeat(78));
    for (const a of s.failed) {
      say("");
      say(`  ✕ ${a.fullName}`);
      for (const m of a.failureMessages) {
        say(m.split("\n").map((l) => `    ${l}`).join("\n"));
      }
    }
    say("");
  }
}

if (!brokenSuites.length && !failedAssertions.length) say("\nAll green.");

/**
 * The distinct-causes roll-up. On a large run most failures are one root cause
 * repeated — 80 modules failing the same assertion is one bug, not eighty — and
 * the count alone actively misleads about how much is wrong.
 */
if (failedAssertions.length) {
  const firstLine = (m) => (m.split("\n").find((l) => l.trim()) || "").trim().slice(0, 100);
  const byCause = new Map();
  for (const s of failedAssertions) {
    for (const a of s.failed) {
      const k = firstLine(a.failureMessages[0] || "");
      byCause.set(k, (byCause.get(k) || 0) + 1);
    }
  }
  say("=".repeat(78));
  say("DISTINCT CAUSES (most failures on a big run are one bug repeated)");
  say("=".repeat(78));
  for (const [cause, n] of [...byCause].sort((a, b) => b[1] - a[1])) {
    say(`  ${String(n).padStart(4)} ×  ${cause}`);
  }
}

const text = lines.join("\n");
process.stdout.write(`\n${text}\n`);
fs.writeFileSync(OUT, text);
process.stdout.write(`\nFull report written to ${path.relative(ROOT, OUT)} — paste that file.\n`);

process.exit(report.success ? 0 : 1);
