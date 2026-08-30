#!/usr/bin/env node
/**
 * Post-build gate: the emitted chunk graph is acyclic, and the first-paint
 * payload is inside budget.
 *
 * ── WHY BOTH CHECKS LIVE IN ONE FILE ───────────────────────────────────────
 *
 * They are the two halves of the same decision. `vite.config.ts` keeps ONE
 * `manualChunks` bucket and splits everything else by route, because this app's
 * reason to exist as a third codebase is what a stranger downloads: a visitor who
 * came to check one shipment reference should not pay for the portal's three
 * terminal screens, and a portal user should not pay for the careers form.
 *
 * That design has exactly two ways to fail, and neither one breaks the build:
 *
 *   1. A CYCLE. On 2026-08-04 the ERP shipped a circular chunk graph; one chunk
 *      read another's export before the binding was assigned, a top-level
 *      `createContext` threw during module evaluation — before React rendered —
 *      and production served a blank `<div id="root">`. Rollup WARNED and exited
 *      0. The fix that must not be attempted is a second manual bucket: two
 *      buckets import each other by construction. So the cycle check and the
 *      chunking strategy are asserted in the same gate, on the same file, so a
 *      change to one is reviewed next to the other.
 *   2. BUDGET DRIFT. A route that quietly stops being lazy (a static import of
 *      `portal-app` from the header, say) adds tens of kB to every first paint
 *      and looks identical in review. The number is the only thing that moves.
 *
 * ── WHAT IS MEASURED ──────────────────────────────────────────────────────
 *
 * The gzipped bytes of the files `dist/index.html` actually loads up-front: the
 * entry chunk, whatever it statically imports (which is how a lazy route ends up
 * in the payload by accident, and why the HTML's own link tags are the source of
 * truth rather than a filename pattern), and the stylesheet. Font files are
 * reported and NOT counted — they are subset per unicode-range and fetched
 * lazily, and folding them in would let a font swap hide a JS regression.
 *
 * Usage: node scripts/check-bundle.mjs   (after `npm run build`)
 */
import { readdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(dirname, "../dist");

/**
 * Read from vite.config.ts rather than assumed.
 *
 * This used to be `path.join(DIST, "assets")`. The moment `build.assetsDir` was
 * given a name of this app's own — it has to differ from the ERP's, or the mount
 * in src/server.js cannot claim it without breaking client/dist — this gate
 * started reporting "dist/assets not found" on a build that was perfectly fine,
 * which is the failure mode where a gate teaches people to ignore it.
 */
const ASSETS_DIR = (() => {
  const cfg = readFileSync(path.resolve(dirname, "../vite.config.ts"), "utf8");
  const m = cfg.match(/assetsDir:\s*"([^"]+)"/);
  return m ? m[1] : "assets";
})();
const ASSETS = path.join(DIST, ASSETS_DIR);

/** gzip -9-equivalent, which is what a browser actually receives. */
function gz(bytes) {
  return zlib.gzipSync(bytes, { level: 9 }).length;
}

const KB = (n) => (n / 1024).toFixed(1) + " kB";

/**
 * The budget, in gzipped kB, for the entry payload (JS + CSS).
 *
 * Measured at the time of writing: 40.6 (index) + 60.8 (vendor) + 11.9 (css)
 * = 113.3 kB. The cap is 128 kB — about 15 % of headroom, which is deliberately
 * small: it absorbs a dependency patch release or one new shared component, and
 * it cannot absorb a router, a query library or an icon pack. That is the point;
 * a budget with room to spare is a budget nobody will ever consult.
 */
const FIRST_PAINT_BUDGET_KB = 128;

/**
 * Static `import`/`export ... from` specifiers only. A DYNAMIC import() is not an
 * edge for this purpose: it resolves after the importing module has finished
 * evaluating, so a cycle through one cannot produce the undefined-binding read
 * this check exists to catch. Route-level code splitting relies on exactly that
 * property, and flagging those edges would make the gate unusable.
 */
const STATIC_IMPORT =
  /(?:^|[;}\s])(?:import|export)\s*(?:[\w*{},\s$]*?\s*from\s*)?["'](\.\/[^"']+\.js)["']/g;

function findCycle(graph) {
  const state = new Map();
  const stack = [];

  function walk(node) {
    if (state.get(node) === "done") return null;
    if (state.get(node) === "visiting")
      return [...stack.slice(stack.indexOf(node)), node];
    state.set(node, "visiting");
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const cycle = walk(next);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(node, "done");
    return null;
  }

  for (const node of graph.keys()) {
    const cycle = walk(node);
    if (cycle) return cycle;
  }
  return null;
}

async function main() {
  if (!existsSync(ASSETS)) {
    console.error(
      `✗ ${path.relative(process.cwd(), ASSETS)} not found — run \`npm run build\` first.`,
    );
    process.exit(1);
  }

  const files = (await readdir(ASSETS)).filter((f) => f.endsWith(".js"));
  if (files.length === 0) {
    console.error(
      `✗ No JS chunks in dist/${ASSETS_DIR} — the build produced nothing to check.`,
    );
    process.exit(1);
  }

  // ── 1. the graph ──
  const graph = new Map();
  const sources = new Map();
  for (const file of files) {
    const source = await readFile(path.join(ASSETS, file), "utf8");
    sources.set(file, source);
    const edges = new Set();
    for (const [, specifier] of source.matchAll(STATIC_IMPORT)) {
      const target = path.basename(specifier);
      if (target !== file && files.includes(target)) edges.add(target);
    }
    graph.set(file, edges);
  }

  const cycle = findCycle(graph);
  if (cycle) {
    console.error(
      `✗ Circular chunk graph in dist/${ASSETS_DIR} — this ships a blank page.\n`,
    );
    console.error(`    ${cycle.join("\n  → ")}\n`);
    console.error(
      "  One chunk reads another's exports before they are assigned, which throws",
    );
    console.error(
      "  during module evaluation — before React renders, so no ErrorBoundary",
    );
    console.error("  catches it and the reader sees nothing at all.");
    console.error(
      "\n  Do NOT resolve this by adding a second manualChunks bucket; keep the",
    );
    console.error(
      "  single `vendor` bucket in vite.config.ts and split by route instead.",
    );
    process.exit(1);
  }

  // ── 2. the first-paint payload, from what index.html loads ──
  const html = await readFile(path.join(DIST, "index.html"), "utf8");
  const referenced = new Set(
    [...html.matchAll(/["'/.]*([\w.-]+\.(?:js|css))["']/g)].map((m) => m[1]),
  );
  const entry = [...referenced].filter((f) => f.endsWith(".js"));
  if (!entry.length) {
    console.error(
      "✗ dist/index.html references no JS — the build is not an app.",
    );
    process.exit(1);
  }

  // Follow the entry's STATIC imports transitively: those load in the same tick.
  const upFront = new Set();
  const queue = [...entry];
  while (queue.length) {
    const name = queue.shift();
    if (upFront.has(name)) continue;
    upFront.add(name);
    const src = sources.get(name);
    if (!src) continue;
    for (const [, spec] of src.matchAll(STATIC_IMPORT)) {
      const target = path.basename(spec);
      if (files.includes(target)) queue.push(target);
    }
  }
  const cssFiles = [...referenced].filter((f) => f.endsWith(".css"));

  const rows = [];
  let total = 0;
  for (const name of [...upFront, ...cssFiles]) {
    const p = path.join(ASSETS, name);
    if (!existsSync(p)) continue;
    const bytes = await readFile(p);
    const g = gz(bytes);
    total += g;
    rows.push(`    ${name.padEnd(34)} ${KB(g).padStart(9)} gzip`);
  }

  const fonts = (await readdir(ASSETS)).filter((f) => f.endsWith(".woff2"));
  let fontTotal = 0;
  for (const f of fonts) fontTotal += gz(await readFile(path.join(ASSETS, f)));

  const budget = FIRST_PAINT_BUDGET_KB * 1024;
  console.log("First paint (entry + its static imports + css):");
  console.log(rows.join("\n"));
  console.log(
    `    ${"TOTAL".padEnd(34)} ${KB(total).padStart(9)} gzip  (budget ${FIRST_PAINT_BUDGET_KB} kB)`,
  );
  console.log(
    `    ${"fonts, not counted".padEnd(34)} ${KB(fontTotal).padStart(9)} gzip  (${fonts.length} files, subset by unicode-range)`,
  );

  if (total > budget) {
    console.error(`\n✗ Over budget by ${KB(total - budget)}.`);
    console.error(
      "  Usual causes, in order: a route stopped being lazy (a static import of a",
    );
    console.error(
      "  feature module from a shared component), or a new dependency in the entry",
    );
    console.error(
      "  graph. Check `git diff -- src/app/router.tsx` first; the fix is almost",
    );
    console.error(
      "  never to raise this number, and if it is, say in the commit message what",
    );
    console.error("  the stranger gets for the extra kilobytes.");
    process.exit(1);
  }

  const edgeCount = [...graph.values()].reduce((n, e) => n + e.size, 0);
  console.log(
    `\n✓ ${graph.size} chunks, ${edgeCount} static edges, acyclic; first paint is ${(
      (total / budget) *
      100
    ).toFixed(0)}% of budget.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
