#!/usr/bin/env node
/**
 * Prove every gate catches a deliberately introduced regression (Phase 5).
 *
 * Phase 5's validation asks for exactly this: *"CI proven to catch a
 * deliberately introduced regression of each gated class."*
 *
 * WHY IT IS A SCRIPT AND NOT A PARAGRAPH IN A CHECKLIST. Because a gate that has
 * never been seen to fail is a gate nobody knows works. This repo has the
 * evidence: Addendum 4's circular-chunk warning was printed as the FIRST LINE of
 * every build for months and the job exited 0 — "a warning nobody reads is not a
 * gate". Addendum 7 records two gates that were wrong when first written, both
 * found by running them rather than by reasoning about them. And Phase 5's own
 * doc gate passed a reintroduced `<CrudResource>` on its first attempt.
 *
 * Every one of those was caught by DOING this, not by intending to.
 *
 * HOW IT WORKS. For each gate: apply a one-line regression to a real file, run
 * the gate, assert it exits non-zero, restore the file, assert it exits zero
 * again. Files are restored in a `finally`, and the script refuses to start on a
 * dirty tree so an interrupted run cannot be mistaken for an edit.
 *
 *   node scripts/prove-gates.mjs           # every gate
 *   node scripts/prove-gates.mjs contrast  # one, by name
 *
 * Not wired into CI — it deliberately breaks the working tree, and it takes
 * minutes. Run it when a gate changes, and paste the output into the phase
 * record.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const client = join(here, "..");
const repoRoot = join(client, "..");

/* ── safety ───────────────────────────────────────────────────────────────── */

const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).trim();
if (dirty && !process.argv.includes("--allow-dirty")) {
  console.error(
    "\n✗ Working tree is dirty. This script edits real files and restores them;\n" +
      "  starting from a dirty tree makes an interrupted run indistinguishable\n" +
      "  from your own edits. Commit or stash first, or pass --allow-dirty.\n",
  );
  process.exit(2);
}

/* ── the regressions ──────────────────────────────────────────────────────── */

/**
 * Each entry: the gate's command, a file, and a substitution that reintroduces
 * a real defect this audit found. The `defect` line is what makes the output
 * worth reading — it says which finding is being re-tested.
 */
const CASES = [
  {
    name: "contrast",
    defect: "F13 — a status ink that fails AA on its own pill ground",
    cmd: ["npm", ["run", "check:contrast"]],
    file: "src/index.css",
    from: "  --ok: 25 117 73;",
    to: "  --ok: 28 132 82;", // the pre-Phase-5 value: 3.75:1 on the pill
  },
  {
    name: "contrast (fill token as type)",
    defect: "F13 — text-primary is 2.59:1; --primary is a fill",
    cmd: ["npm", ["run", "check:contrast"]],
    file: "src/components/ui/kpi-tile.tsx",
    from: "text-primary-ink",
    to: "text-primary",
  },
  {
    name: "palette",
    defect: "F14 — a raw Tailwind palette colour, breaking white-label",
    cmd: ["npm", ["run", "check:palette"]],
    file: "src/components/ui/pill.tsx",
    from: "import * as React",
    to: 'const REGRESSION = "text-emerald-600";\nexport const _r = REGRESSION;\nimport * as React',
  },
  {
    name: "motion",
    defect: "F17 — the 500ms entrance on every card and table mount",
    cmd: ["npm", ["run", "check:motion"]],
    file: "src/index.css",
    from: "animation: fadeUp 0.12s var(--ease) both;",
    to: "animation: fadeUp 0.5s var(--ease) both;",
  },
  {
    name: "motion (reduced-motion umbrella)",
    defect: "prefers-reduced-motion silently stops being honoured",
    cmd: ["npm", ["run", "check:motion"]],
    file: "src/index.css",
    from: "    transition: none !important;",
    to: "",
  },
  {
    name: "docs",
    defect: "F5 — the guide names a component that does not exist",
    cmd: ["npm", ["run", "check:docs"]],
    file: "../doc/FRONTEND_GUIDE.md",
    from: "| List screen | `<ListPage>`",
    to: "| List screen | `<CrudResource>`",
  },
  {
    name: "docs (supersession)",
    defect: "F15 — a stale plan loses the banner pointing at the guide",
    cmd: ["npm", ["run", "check:docs"]],
    file: "../doc/FE_WIRING_PLAN.md",
    from: "SUPERSEDED",
    to: "Formerly",
  },
  {
    name: "lint (a11y)",
    defect: "F13 — an onClick on a non-interactive element",
    cmd: ["npx", ["eslint", "src/components/ui/panel.tsx"]],
    file: "src/components/ui/panel.tsx",
    from: "import * as React",
    to: 'export const Regression = () => <div onClick={() => {}}>x</div>;\nimport * as React',
  },
  {
    name: "typecheck",
    defect: "a prop that does not exist on ListPage",
    cmd: ["npx", ["tsc", "-b", "--force"]],
    file: "src/components/list-page.tsx",
    from: "  width = \"wide\",",
    to: "  width = 42,",
  },
  {
    name: "unit tests",
    defect: "the density preference stops being applied to <html>",
    cmd: ["npx", ["vitest", "run", "src/lib/density.test.ts"]],
    file: "src/lib/density.ts",
    from: '  document.documentElement.setAttribute("data-density", d);',
    to: "  void d;",
  },
  {
    name: "layout gate (e2e)",
    defect: "F9 — a 36px row-action button puts the row back to 48px",
    cmd: ["npx", ["playwright", "test", "e2e/desktop-layout.spec.ts", "--grep", "default rows"]],
    file: "src/index.css",
    from: "    --row-control-h: 1.25rem;",
    to: "    --row-control-h: 2.25rem;",
    rebuild: true, // the e2e gate runs against dist/
  },
  {
    name: "layout gate (2560px tier)",
    defect: "F2/F3 — the content column stops growing past 1664px",
    cmd: ["npx", ["playwright", "test", "e2e/desktop-layout.spec.ts", "--grep", "2560px"]],
    file: "tailwind.config.ts",
    from: 'wide: "135rem", // 2160',
    to: 'wide: "104rem", // 1664',
    rebuild: true,
  },
];

/* ── runner ───────────────────────────────────────────────────────────────── */

function run([cmd, args]) {
  try {
    execFileSync(cmd, args, { cwd: client, stdio: "pipe" });
    return 0;
  } catch (e) {
    return e.status ?? 1;
  }
}

function build() {
  try {
    execSync("npm run build", { cwd: client, stdio: "pipe" });
    return true;
  } catch {
    return false; // a regression that breaks the build is still a caught regression
  }
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const cases = only.length ? CASES.filter((c) => only.some((o) => c.name.startsWith(o))) : CASES;
if (!cases.length) {
  console.error(`\nNo gate matches ${only.join(", ")}. Known: ${CASES.map((c) => c.name).join(", ")}\n`);
  process.exit(2);
}

console.log(`\nProving ${cases.length} gate(s) catch a deliberately introduced regression.\n`);

let broken = 0;
for (const c of cases) {
  const path = join(client, c.file);
  const original = readFileSync(path, "utf8");
  if (!original.includes(c.from)) {
    console.error(`  ERROR  ${c.name} — anchor not found in ${c.file}. The gate may be fine; this SCRIPT is stale.`);
    broken++;
    continue;
  }

  let clean;
  let regressed;
  try {
    writeFileSync(path, original.replace(c.from, c.to), "utf8");
    if (c.rebuild) build();
    regressed = run(c.cmd);
  } finally {
    writeFileSync(path, original, "utf8");
    if (c.rebuild) build();
  }
  clean = run(c.cmd);

  const ok = regressed !== 0 && clean === 0;
  if (!ok) broken++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${c.name.padEnd(28)} regressed → exit ${regressed}, restored → exit ${clean}`,
  );
  console.log(`        ${c.defect}`);
}

if (broken) {
  console.error(`\n✗ ${broken} gate(s) did not behave as a gate. A gate that cannot fail is documentation.\n`);
  process.exit(1);
}
console.log(`\n✓ All ${cases.length} gates fail on the regression and pass without it.\n`);
