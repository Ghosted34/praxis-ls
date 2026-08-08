#!/usr/bin/env node
/**
 * Shared-schema gate — a schema must be used by BOTH sides, or it is not shared.
 *
 * `check:shared` already proves the package RESOLVES, parses, and gives both
 * halves one Zod instance. It cannot see the failure this catches, which is
 * organisational rather than mechanical:
 *
 *   - a schema lands in `packages/shared` and only the API imports it, so the
 *     client keeps its `canSubmit` boolean and the drift F12 describes carries
 *     on with an extra file to maintain;
 *   - or only the CLIENT imports it, and the API keeps validating with its own
 *     copy — the worse direction, because now two definitions disagree AND one
 *     of them is the one that decides what gets written;
 *   - or a module's validator is migrated, someone later adds a rule back into
 *     the Express file, and the shared schema silently stops being the truth.
 *
 * That last one is the reason this is a build gate rather than a code review
 * item. `packages/shared` existed for two phases with exactly one domain in it,
 * and nothing anywhere said so.
 *
 * WHAT IT ASSERTS
 *
 *   1. Every domain exported from `packages/shared/index.js` is imported by the
 *      API somewhere under `src/`.
 *   2. …and by the client somewhere under `client/src/`.
 *   3. No API validator that has been migrated still declares its own `z.object`
 *      — a migrated file is an adapter, and a `z.object` in it means the rules
 *      came back.
 *
 * Rule 3 has an escape hatch (`ALLOW_LOCAL_SCHEMA`) for a validator that
 * genuinely needs a local shape — a query-string parser, say — and each entry
 * carries its reason.
 *
 *   node scripts/check-schemas.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const require = createRequire(import.meta.url);

/* ── what the package offers ──────────────────────────────────────────────── */

const shared = require(join(repoRoot, "packages", "shared", "index.js"));
/** `common` is primitives, consumed by the other schemas rather than directly. */
const INTERNAL = new Set(["common"]);
const domains = Object.keys(shared).filter((k) => !INTERNAL.has(k));

/* ── who imports it ───────────────────────────────────────────────────────── */

function filesUnder(dir, re) {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", dir], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter((f) => f && re.test(f) && existsSync(join(repoRoot, f)));
}

const apiFiles = filesUnder("src", /\.js$/);
const clientFiles = filesUnder("client/src", /\.tsx?$/).filter((f) => !/\.test\.tsx?$/.test(f));

/** Which domains a file names, from its `@praxis/shared` / `@shared` import. */
function importedDomains(text) {
  const found = new Set();

  /*
   * Form 1 — property access: `require("@praxis/shared").pwaDesign`.
   *
   * Usually written as `const { a, b } = require("@praxis/shared").pwaDesign`,
   * which reaches PAST the domain to destructure its members. That form is why
   * this branch exists: matching only the braces harvested `effectivePwa` and
   * `iconLayout` as though they were domains, and reported the domain that IS
   * imported — pwaDesign — as used by nobody. A gate that reports a false
   * failure gets an exemption added to shut it up, and then it is worth nothing.
   */
  for (const m of text.matchAll(/require\(\s*["']@(?:praxis\/)?shared["']\s*\)\s*\.\s*(\w+)/g)) found.add(m[1]);

  /*
   * Form 2 — destructuring the package root: `const { ledger } = require(…)`,
   * `import { journalEntry } from "@shared"`. The negative lookahead excludes
   * form 1, whose braces name members rather than domains.
   */
  const re =
    /(?:const|import)\s*\{([^}]*)\}\s*(?:=\s*require\(|from\s*)["']@(?:praxis\/)?shared["'](?!\s*\)\s*\.)/g;
  for (const m of text.matchAll(re)) {
    for (const part of m[1].split(",")) {
      // `{ journalEntry: schemas }` and `{ ledger as rules }` both name the
      // domain on the LEFT. Split on a real `:` or a whole-word `as` — an
      // earlier version used the character class `[:as]`, which also split
      // inside identifiers ("journalEntry" contains an "a") and reported every
      // domain as unused. A leading `type` is TypeScript's inline type import.
      const name = part.trim().replace(/^type\s+/, "").split(/\s*(?::|\bas\b)\s*/)[0].trim();
      if (name) found.add(name);
    }
  }
  return found;
}

const apiUses = new Set();
const clientUses = new Set();
for (const f of apiFiles) importedDomains(readFileSync(join(repoRoot, f), "utf8")).forEach((d) => apiUses.add(d));
for (const f of clientFiles) importedDomains(readFileSync(join(repoRoot, f), "utf8")).forEach((d) => clientUses.add(d));

/* ── rule 3: a migrated validator must not re-declare rules ───────────────── */

/** Validators allowed to keep a local `z.object`, each with the reason. */
const ALLOW_LOCAL_SCHEMA = {
  // (none yet — add `"src/modules/x/x.validator.js": "why"` when one earns it)
};

const migratedValidators = apiFiles.filter(
  (f) => /\.validator\.js$/.test(f) && /@praxis\/shared/.test(readFileSync(join(repoRoot, f), "utf8")),
);
const regressed = migratedValidators.filter((f) => {
  if (ALLOW_LOCAL_SCHEMA[f]) return false;
  const text = readFileSync(join(repoRoot, f), "utf8")
    // Comments quote the pattern by design — this file's own header does.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
  return /z\.object\s*\(/.test(text);
});

/* ── report ───────────────────────────────────────────────────────────────── */

const oneSided = domains
  .map((d) => ({ d, api: apiUses.has(d), client: clientUses.has(d) }))
  .filter((r) => !r.api || !r.client);

console.warn(`\nShared schemas — ${domains.length} domain(s): ${domains.join(", ")}\n`);
for (const d of domains) {
  const api = apiUses.has(d) ? "API ✓" : "API ✗";
  const cl = clientUses.has(d) ? "client ✓" : "client ✗";
  console.warn(`  ${apiUses.has(d) && clientUses.has(d) ? "PASS" : "FAIL"}  ${d.padEnd(16)} ${api}   ${cl}`);
}

let failed = 0;

if (oneSided.length) {
  failed += oneSided.length;
  console.error(`\n✗ ${oneSided.length} domain(s) are in packages/shared but not shared:\n`);
  for (const r of oneSided) {
    const missing = !r.api ? "the API still validates with its own copy" : "the client still has its own rules";
    console.error(`    ${r.d} — ${missing}`);
  }
  console.error(
    "\n  A schema only one side imports is a THIRD definition, not a shared one.\n" +
      "  Either wire up the other side or move it back into that module.\n",
  );
}

if (regressed.length) {
  failed += regressed.length;
  console.error(`\n✗ ${regressed.length} migrated validator(s) declare their own schema again:\n`);
  for (const f of regressed) console.error(`    ${relative(".", f)}`);
  console.error(
    "\n  A migrated validator is an ADAPTER: it maps the shared schema's result\n" +
      "  onto this API's error shape. A `z.object(...)` in it means a rule was\n" +
      "  added on one side only, which is the drift the package exists to stop.\n" +
      "  Put the rule in packages/shared, or add an ALLOW_LOCAL_SCHEMA entry with\n" +
      "  the reason.\n",
  );
}

if (failed) process.exit(1);
console.warn(`\n✓ Every shared domain is consumed by both sides; ${migratedValidators.length} validator(s) are adapters.\n`);
