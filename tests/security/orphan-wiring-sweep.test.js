/**
 * THE ORPHAN SWEEP, GENERALISED.
 *
 * ── WHY THERE ARE NOW THREE OF THESE ────────────────────────────────────────
 *
 * `mail-orphan-sweep.test.js` catches a TABLE that no code reads. It caught
 * eleven. Then the commit that emptied its escape hatch introduced an orphan
 * WORKER — `mail-ocr-extract`, registered in `workers.js` and enqueued by
 * nothing — which that gate could not see, because a worker is not a table.
 * A third sweep then found orphan EVENT TYPES and an entire orphan
 * configuration layer (`mail-send-point-wiring.test.js` holds that one).
 *
 * The pattern is always the same shape and always invisible to functional
 * tests: something is DECLARED in a place that reads as authoritative — a
 * migration, a worker registry, an event catalogue — and nothing in the running
 * product refers to it. Every test passes. The feature is absent.
 *
 * So this file stops asking "is this table read?" and asks the general
 * question: for each kind of declaration the product makes, does the code that
 * would act on it exist?
 *
 * ── THESE GATES DESCRIBE, THEY DO NOT ASPIRE ────────────────────────────────
 *
 * Each allowance below names a specific thing that is deliberately unwired, and
 * says why. Adding a name is a claim someone has to defend in review; removing
 * one is what building the thing looks like. A list that grows is the gate
 * being routed around, so each has a size ceiling.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");

const jsFiles = (function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".js")) acc.push(p);
  }
  return acc;
})(SRC);
const allSrc = jsFiles.map((p) => fs.readFileSync(p, "utf8")).join("\n");

/* ── Workers ──────────────────────────────────────────────────────────────── */

describe("every registered worker has a producer", () => {
  const workers = fs.readFileSync(path.join(SRC, "jobs/workers.js"), "utf8");
  const names = [...workers.matchAll(/name:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);

  /**
   * `scheduled-report` is driven from OUTSIDE the app.
   *
   * Its handler's own header says so: "the periodic trigger (an app
   * scheduled-task or external cron) enqueues one job per live tenant, or
   * POST /reports/scheduled/run-due drives a single tenant directly." Both of
   * those are real — the route exists — so this is a deployment decision rather
   * than a missing call. It is the only periodic job not registered in
   * `scheduleRecurring()`, which is worth knowing about it.
   */
  const EXTERNALLY_DRIVEN = new Set(["scheduled-report"]);

  test("the registry is readable and has the workers this gate thinks it does", () => {
    expect(names.length).toBeGreaterThan(20);
    expect(names).toContain("mail-ocr-extract");
  });

  test("nothing is registered and never enqueued", () => {
    const orphans = names
      .filter((n) => !EXTERNALLY_DRIVEN.has(n))
      .filter((n) => !new RegExp(`enqueue\\(\\s*\\n?\\s*"${n}"`).test(allSrc));
    // A handler file that no code enqueues is a feature that exists in the tree
    // and not in the product — and `workers.js` is exactly where someone goes to
    // check that a job exists, which is why registration alone reads as done.
    expect(orphans).toEqual([]);
  });

  test("the externally-driven list stays short and stays honest", () => {
    expect(EXTERNALLY_DRIVEN.size).toBeLessThanOrEqual(2);
    for (const n of EXTERNALLY_DRIVEN) {
      // If one of these acquires an in-app producer, it should leave the list
      // rather than sit here claiming a deployment dependency it no longer has.
      expect(new RegExp(`enqueue\\(\\s*\\n?\\s*"${n}"`).test(allSrc)).toBe(false);
      expect(names).toContain(n);
    }
  });
});

/* ── Event types ──────────────────────────────────────────────────────────── */

describe("every event type the mail programme seeds is emitted", () => {
  const MIGRATIONS = path.join(ROOT, "migrations/tenant");
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^107\d\d_/.test(f));
  const sql = files
    .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), "utf8"))
    // The `-- DOWN` block lists the same keys in a DELETE. Reading it would
    // make every retired key look seeded.
    .map((s) => s.split(/^-- DOWN\s*$/m)[0])
    .join("\n");

  const keys = [...new Set(
    [...sql.matchAll(/'((?:mail|email|document|signature)\.[a-z_.]+)'/g)].map((m) => m[1]),
  )].sort();

  /**
   * `document.share` is a SEND POINT key, not an event type — it lives in
   * `mail_send_point`, and `mail-send-point-wiring.test.js` is the gate that
   * holds it to account. It matches the pattern here only because send points
   * and events share a dotted vocabulary.
   */
  const NOT_AN_EVENT = new Set(["document.share"]);

  test("the migrations really do seed the keys this gate thinks they do", () => {
    expect(keys.length).toBeGreaterThan(20);
    expect(keys).toContain("email.thread.replied");
  });

  test("no key is seeded, described, and emitted by nothing", () => {
    const dead = keys
      .filter((k) => !NOT_AN_EVENT.has(k))
      .filter((k) => !allSrc.includes(k));
    // Each of these ships with an English and a French description that appears
    // in the tenant's event catalogue and in the notification-rule builder. A
    // key an administrator can select and that never fires is a rule that
    // silently never runs.
    expect(dead).toEqual([]);
  });

  test("the not-an-event list stays short", () => {
    expect(NOT_AN_EVENT.size).toBeLessThanOrEqual(2);
  });
});

/* ── The three sweeps know about each other ───────────────────────────────── */

describe("the sweeps cover the declaration kinds this codebase has", () => {
  test.each([
    ["tables", "mail-orphan-sweep.test.js"],
    ["send points", "mail-send-point-wiring.test.js"],
    ["feature flags", "mail-feature-gating.test.js"],
  ])("%s are swept by %s", (_kind, file) => {
    // Named rather than assumed, so deleting one of them is a visible act.
    expect(fs.existsSync(path.join(__dirname, file))).toBe(true);
  });
});
