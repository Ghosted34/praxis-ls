#!/usr/bin/env node
/**
 * Guard against duplicate migration numbers.
 *
 * WHY THIS EXISTS (2026-08-01). Two streams work this repo in parallel and both
 * have landed same-numbered tenant migrations:
 *   0470_regie_doc_number.sql   +  0470_seed_ai_vendors.sql
 *   0475_hr_discipline_and_avatar.sql + 0475_master_email.sql
 *
 * Those two pairs are harmless as they stand — each pair touches different
 * objects, and `services/platform/migrator.js` tracks applied files BY FILENAME
 * (not by number) and sorts alphabetically, so both members of a pair apply, in a
 * stable order. The danger is the next collision, where two files with the same
 * number touch the SAME object: apply order would then depend on the alphabetical
 * accident of the descriptive suffix, and could differ from the order the authors
 * assumed. That is the class of bug that only shows up on a fresh provision, long
 * after both files merged.
 *
 * NOTE ON REPAIR: do NOT "fix" the existing collisions by renaming. Because the
 * ledger keys on filename, a rename makes the migrator treat the file as new and
 * re-run it — and tenant migrations are not written to be idempotent (23 files use
 * a bare `CREATE TRIGGER`, which fails 42710 on a second run). Renaming an applied
 * migration is therefore a live-database hazard, not a tidy-up. Prevention only.
 *
 * Exit 0 = clean or pre-existing-only. Exit 1 = a NEW collision.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "migrations");
const SCOPES = ["platform", "tenant", "seeds"];

/**
 * Collisions that already exist and are known-safe (see the header). Listed so the
 * guard can pass on today's tree while still failing on anything new. Remove an
 * entry only if the underlying files are genuinely renumbered — which, per the
 * header, should essentially never happen once applied.
 */
const GRANDFATHERED = new Set(["tenant/0470", "tenant/0475"]);

const NUMBERED = /^(\d+)[_-]/;

function scan(scope) {
  const dir = path.join(ROOT, scope);
  if (!fs.existsSync(dir)) return [];
  const byNumber = new Map();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".sql")) continue;
    const m = NUMBERED.exec(file);
    if (!m) {
      console.warn(`  ! ${scope}/${file} — no leading number, cannot order deterministically`);
      continue;
    }
    const key = m[1];
    if (!byNumber.has(key)) byNumber.set(key, []);
    byNumber.get(key).push(file);
  }
  const out = [];
  for (const [number, files] of byNumber) {
    if (files.length > 1) out.push({ scope, number, files: files.sort() });
  }
  return out;
}

function main() {
  const all = SCOPES.flatMap(scan);
  const fresh = all.filter((c) => !GRANDFATHERED.has(`${c.scope}/${c.number}`));
  const known = all.filter((c) => GRANDFATHERED.has(`${c.scope}/${c.number}`));

  if (known.length) {
    console.warn("Known (grandfathered) migration-number collisions:");
    known.forEach((c) => console.warn(`  · ${c.scope}/${c.number} → ${c.files.join(", ")}`));
  }

  if (!fresh.length) {
    console.warn(`Migration numbering OK — no new collisions across ${SCOPES.join(", ")}.`);
    return 0;
  }

  console.error("\nDUPLICATE MIGRATION NUMBER(S) — these must be renumbered BEFORE merging:\n");
  fresh.forEach((c) => {
    console.error(`  ${c.scope}/${c.number}`);
    c.files.forEach((f) => console.error(`      ${f}`));
  });
  console.error(
    "\nPick the next free number for the file that has NOT been applied anywhere yet,\n" +
      "and `git mv` it. Never renumber a migration that has already run against a\n" +
      "database — the migrator keys on filename and would re-apply it.\n",
  );
  return 1;
}

process.exit(main());
