#!/usr/bin/env node
/**
 * Workbook gate — the committed HTML is what its source builds, and the
 * third-party code inside it is the version the manifest declares.
 *
 *   node doc/workbook/check-workbook.mjs
 *
 * WHY THIS EXISTS. doc/PRAXIS_ENGINEERING_WORKBOOK.html is a 1.2 MB build
 * output committed next to the sources that produce it. That is a reasonable
 * trade — a new engineer is handed one file they open in Chrome, with no build
 * step and no network — but it has the failure mode every checked-in artefact
 * has: someone edits a chapter in src/, forgets `node doc/workbook/build.mjs`,
 * and the file everyone actually reads silently stops matching the file
 * everyone edits. Nothing about that is visible in review; the diff just does
 * not mention the HTML, which looks normal.
 *
 * This repo has already decided how it feels about that class of bug. The
 * frontend guide is gated by client/scripts/check-docs.mjs for exactly the same
 * reason — "a document nobody can check is exactly what produced the original
 * defect: it read authoritative, it was wrong, and it stayed wrong for months
 * because being wrong cost nothing." A generated workbook is a document with the
 * same property and one extra hazard: it looks freshly built even when stale,
 * because it always has a plausible date and 113 tidy pages.
 *
 * TWO ASSERTIONS.
 *
 *   1. REBUILD AND COMPARE. Runs the real build into a temp file and diffs it
 *      against the committed HTML byte for byte. The build is deterministic —
 *      no timestamps, no counters — so any difference is a real drift.
 *
 *   2. THE VENDORED VERSIONS MATCH THE MANIFEST. src/vendor.mjs inlines
 *      html2canvas and jspdf as strings, each behind a `/* pkg@version *​/`
 *      banner. Those two libraries are declared in the root package.json purely
 *      so Dependabot and `npm audit` can see them. If Dependabot bumps one and
 *      nobody regenerates, the manifest says one version while the workbook
 *      still ships the old code — the bump would be cosmetic and the CVE it was
 *      raised for would still be in the file. This fails that.
 *
 * Deliberately does NOT regenerate src/vendor.mjs: that needs `npm pack` and a
 * network, and a gate that needs the network is a gate that goes red for
 * reasons unrelated to the change under review.
 *
 * Exit 0 = the workbook everyone reads is the workbook this source builds.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const BUILT = resolve(REPO, "doc", "PRAXIS_ENGINEERING_WORKBOOK.html");

const fail = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

/* ── 1. the committed HTML is what the source builds ──────────────────────── */

/*
 * No `existsSync` before the read, and no temp-file copy of the committed
 * bytes. Both were in the first version of this script and CodeQL was right
 * about both:
 *
 *   · The backup file did nothing. `committed` is already the whole file in
 *     memory and the restore below reads from that variable — the temp copy
 *     was written, never read, then deleted. It bought a predictable name in a
 *     directory every process on the box can write to, plus an
 *     existsSync/unlink race, in exchange for nothing at all.
 *   · `existsSync(x)` followed by reading x is a check the read already makes,
 *     and makes atomically. Asking twice only adds a window where the answer
 *     changes between the two.
 *
 * So: read and let the failure tell us it is missing, and restore in a
 * `finally` so there is exactly one place that puts the tracked file back.
 */
let committed;
try {
  committed = readFileSync(BUILT, "utf8");
} catch (err) {
  if (err.code === "ENOENT") {
    fail(
      "doc/PRAXIS_ENGINEERING_WORKBOOK.html is missing.\n" +
        "  Build it:  node doc/workbook/build.mjs",
    );
  }
  throw err;
}

let rebuilt;
let buildError;
try {
  execFileSync("node", [join(HERE, "build.mjs")], { cwd: REPO, stdio: "pipe" });
  rebuilt = readFileSync(BUILT, "utf8");
} catch (err) {
  buildError = err;
} finally {
  // Whatever happened, the tracked file goes back exactly as committed. This is
  // a check, not a build step, and a gate that quietly rewrites the artefact it
  // is inspecting hides the very drift it exists to report.
  writeFileSync(BUILT, committed, "utf8");
}

if (buildError) {
  fail(
    "the workbook build itself failed:\n" +
      (buildError.stderr?.toString() || buildError.message),
  );
}

if (rebuilt !== committed) {
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  fail(
    "doc/PRAXIS_ENGINEERING_WORKBOOK.html is STALE — it does not match what\n" +
      `  doc/workbook/src/ builds today (committed ${kb(committed.length)}, ` +
      `rebuilt ${kb(rebuilt.length)}).\n\n` +
      "  Someone edited a chapter without rebuilding. Fix it with:\n" +
      "      node doc/workbook/build.mjs\n" +
      "  then commit the regenerated HTML in the same change.",
  );
}

/* ── 2. the inlined libraries are the versions the manifest declares ──────── */

const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
const vendorSrc = readFileSync(join(HERE, "src", "vendor.mjs"), "utf8");

for (const name of ["html2canvas", "jspdf"]) {
  const declared = pkg.devDependencies?.[name];
  if (!declared) {
    fail(
      `${name} is inlined into the workbook but is not in the root package.json\n` +
        "  devDependencies, so Dependabot and `npm audit` cannot see it.\n" +
        '  Add it with an exact version — see the "//workbook-vendor" note there.',
    );
  }
  // The banner make-vendor.mjs writes ahead of each inlined library.
  if (!vendorSrc.includes(`${name}@${declared}`)) {
    const found = vendorSrc.match(new RegExp(`${name}@([\\d.]+)`))?.[1] ?? "none";
    fail(
      `doc/workbook/src/vendor.mjs carries ${name}@${found}, but the root\n` +
        `  package.json declares ${name}@${declared}.\n\n` +
        "  The workbook still ships the OLD code, so a version bump raised for a\n" +
        "  security fix has not actually reached the file anyone opens.\n" +
        "  Regenerate and commit both:\n" +
        "      npm install\n" +
        "      node doc/workbook/tools/make-vendor.mjs\n" +
        "      node doc/workbook/build.mjs",
    );
  }
}

const pages = (committed.match(/class="[^"]*\bpage\b/g) || []).length;
console.log(
  `\nWorkbook — HTML matches its source${pages ? ` (${pages} pages)` : ""}, ` +
    `vendored html2canvas@${pkg.devDependencies.html2canvas} and ` +
    `jspdf@${pkg.devDependencies.jspdf} match the manifest\n`,
);
