#!/usr/bin/env node
/**
 * Doc gate (Phase 5) — the frontend guide may not name something that does not
 * exist.
 *
 * THIS IS F5, MADE IMPOSSIBLE TO REINTRODUCE. The audit's root-cause finding is
 * that `doc/FE_DESIGN_RULES.md` §3 — the onboarding path for a new engineer —
 * told them the default list screen was `<ResourceList>` and that write-capable
 * lists used `<CrudResource>`. `crud-resource.tsx` never existed. `ResourceList`
 * existed with zero call sites. The audit is explicit about the consequence:
 *
 *   "So the documented on-ramp points at a deleted component and a dead one.
 *    Every screen instead hand-rolls useList + DataList + a bespoke Modal form.
 *    THIS IS THE ROOT CAUSE OF MOST OTHER FINDINGS IN THIS AUDIT — there is no
 *    paved road, so 24 feature areas each paved their own."
 *
 * Phase 1 corrected the document. Nothing stopped it drifting again, and a
 * document nobody can check is exactly what produced the original defect: it
 * read authoritative, it was wrong, and it stayed wrong for months because being
 * wrong cost nothing.
 *
 * So: every `<Component>` the guide names in its primitives roster and its code
 * examples must be a real export somewhere under `client/src`. Rename a
 * primitive and the build fails until the guide is updated in the same commit.
 *
 * It also asserts the consolidation holds — every superseded frontend doc still
 * carries its banner pointing here. A stale plan with no banner is the thing F15
 * describes.
 *
 *   node scripts/check-docs.mjs
 *
 * Exit 0 = the guide describes the code that exists.
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const GUIDE = join(repoRoot, "doc", "FRONTEND_GUIDE.md");

if (!existsSync(GUIDE)) {
  console.error("\n✗ doc/FRONTEND_GUIDE.md is missing. It is the one frontend document.\n");
  process.exit(1);
}
const guide = readFileSync(GUIDE, "utf8");

/* ── every export the client actually has ─────────────────────────────────── */

function sources() {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "client/src"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter((f) => f && /\.tsx?$/.test(f) && existsSync(join(repoRoot, f)));
}

const EXPORTED = new Set();
for (const file of sources()) {
  const text = readFileSync(join(repoRoot, file), "utf8");
  for (const m of text.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/g)) {
    EXPORTED.add(m[1]);
  }
  // `export { A, B as C }` — the re-export form the barrel files use.
  for (const m of text.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) EXPORTED.add(name);
    }
  }
  for (const m of text.matchAll(/export\s+type\s+([A-Za-z_$][\w$]*)/g)) EXPORTED.add(m[1]);
}

/* ── what the guide claims ────────────────────────────────────────────────── */

/**
 * Component-shaped names the guide names as things you can use: `<Foo>` in prose
 * or a table, and `useFoo()` hooks. Deliberately narrow — this checks the guide's
 * PROMISES, not every identifier it happens to mention.
 */
const claimed = new Map();
const record = (name, why) => {
  if (!claimed.has(name)) claimed.set(name, why);
};

/**
 * BLOCKQUOTES ARE NARRATIVE, NOT PROMISES.
 *
 * The guide has to be able to SAY "`<ResourceList>` and `<CrudResource>` did not
 * exist" — that story is why this gate exists. The first version of this script
 * allowlisted those two names globally, and it was verified by putting
 * `<CrudResource>` back into the primitives table: the gate passed. An allowlist
 * keyed on the NAME excuses the name everywhere, including in the one place that
 * matters, which is precisely the shape of the defect it is meant to prevent.
 *
 * Context is the right key. A `>` blockquote is where this document tells the
 * history; a table row or a code example is where it makes a promise. Same
 * lesson as Addendum 7's palette gate, which "flagged its own evidence" — except
 * the failure mode here is the opposite and worse: silently excusing the bug
 * instead of noisily reporting the fix.
 */
guide.split("\n").forEach((line, i) => {
  if (line.trimStart().startsWith(">")) return;
  for (const m of line.matchAll(/`<([A-Z][A-Za-z0-9]*)[^`]*>`/g)) record(m[1], i + 1);
  for (const m of line.matchAll(/`(use[A-Z][A-Za-z0-9]*)\(/g)) record(m[1], i + 1);
});

const missing = [];
for (const [name, line] of claimed) {
  if (!EXPORTED.has(name)) missing.push({ name, line });
}

/* ── the consolidation holds ──────────────────────────────────────────────── */

const SUPERSEDED = [
  // A redirect stub, kept because the audit and SESSION_HISTORY cite it by name
  // and are historical records — rewriting them would falsify the record.
  "FE_DESIGN_RULES.md",
  "FRONTEND_PLAN.md",
  "LOVABLE_FIDELITY_PLAN.md",
  "UI_DEPTH_OVERHAUL_PLAN.md",
  "FE_IA_HANDOFF.md",
  "FE_IA_BUILD_MAP.md",
  "FE_WIRING_PLAN.md",
];
const unbanded = SUPERSEDED.filter((f) => {
  const p = join(repoRoot, "doc", f);
  if (!existsSync(p)) return false; // deleted is fine; unbanded is not
  const head = readFileSync(p, "utf8").slice(0, 1200);
  // Either a supersession banner or a redirect stub — both point a reader
  // at the guide, which is the property being asserted.
  return !(/SUPERSEDED|Moved →/.test(head) && head.includes("FRONTEND_GUIDE.md"));
});

/* ── report ───────────────────────────────────────────────────────────────── */

console.log(`\nFrontend guide — ${claimed.size} component/hook name(s) checked against ${EXPORTED.size} exports\n`);

if (missing.length) {
  console.error(`✗ doc/FRONTEND_GUIDE.md names ${missing.length} thing(s) that do not exist:\n`);
  for (const m of missing) console.error(`    line ${m.line}:  ${m.name}`);
  console.error(
    "\n  This is F5. The previous version of that document told every new engineer\n" +
      "  to use <ResourceList> and <CrudResource>: one was deleted, the other had\n" +
      "  zero call sites, and the audit names that the ROOT CAUSE of most other\n" +
      "  drift in this frontend. Either the guide is stale or the export was\n" +
      "  renamed — fix whichever it is, in this commit.\n",
  );
}

if (unbanded.length) {
  console.error(`✗ ${unbanded.length} superseded doc(s) no longer point at the guide:\n`);
  for (const f of unbanded) console.error(`    doc/${f}`);
  console.error(
    "\n  F15: six overlapping frontend plans, and \"a new engineer cannot tell which\n" +
      "  is current — and the one that reads most authoritative is the one that's\n" +
      "  wrong\". The banner is what stops that recurring.\n",
  );
}

if (missing.length || unbanded.length) process.exit(1);
console.log("✓ Every component the guide names exists, and every superseded doc points at it.\n");
