#!/usr/bin/env node
/**
 * DATA 2.4 — prevention, not just repair.
 *
 * ~60 tenant columns are `REFERENCES app_user(user_id)`. Identity is pinned to
 * the LIVE schema, while business writes go to whichever schema the request
 * selected — so storing a perfectly valid live user id beside SANDBOX business
 * data raises 23503 and fails the operation.
 *
 * `emit.js` guards its own actor columns with a sub-select, and exports
 * `resolveActorId` as the reusable form. The audit's finding was not that the
 * guard is wrong — it is that the guard is APPLIED INCONSISTENTLY, which is a
 * class of defect that repairs itself back into existence the next time
 * somebody adds an `_by` column.
 *
 * So this is the CI half of that fix: a raw `<something>_by: actor.user_id`
 * anywhere under src/modules fails the build with the reason and the remedy.
 *
 * Exits 1 on any violation. Wired into .github/workflows/ci.yaml alongside
 * check-migration-numbers.js.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "src", "modules");

/**
 * A raw actor write: an FK-to-app_user column assigned straight from the
 * request's actor, with no `resolveActorId` in the expression.
 *
 * Deliberately narrow. It matches the idiom that actually occurs
 * (`issued_by: actor.user_id || null`) rather than trying to understand
 * assignment in general — a check that is easy to read and easy to satisfy is
 * worth more here than one that is exhaustive and mistrusted.
 */
const RAW = /\b(\w*_by)\s*:\s*(actor\??\.\s*user_id)(?!\s*\))/g;

/** `resolveActorId(...)` on the same line means the guard is already applied. */
const GUARDED = /resolveActorId\s*\(/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) out.push(full);
  }
  return out;
}

function main() {
  const violations = [];

  for (const file of walk(ROOT)) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (GUARDED.test(line)) return;
      RAW.lastIndex = 0;
      let m;
      while ((m = RAW.exec(line)) !== null) {
        violations.push({
          file: path.relative(path.join(__dirname, ".."), file),
          line: i + 1,
          column: m[1],
          text: line.trim().slice(0, 100),
        });
      }
    });
  }

  if (violations.length === 0) {
    console.warn("Actor-FK guard OK — every *_by write goes through resolveActorId.");
    return 0;
  }

  console.error(
    `\n${violations.length} unguarded actor write(s) (DATA 2.4).\n\n` +
      "These columns are REFERENCES app_user(user_id). Identity lives in the LIVE\n" +
      "schema; this write may land in SANDBOX, where that user does not exist, and\n" +
      "Postgres will raise 23503 and fail the whole operation.\n\n" +
      "Fix: await resolveActorId(client, actor.user_id)\n" +
      "     const { resolveActorId } = require(\"…/shared/events/emit\");\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.column}\n      ${v.text}`);
  }
  console.error("");
  return 1;
}

process.exit(main());
