#!/usr/bin/env node
/**
 * Post-build gate: assert the emitted chunk graph is acyclic.
 *
 * WHY THIS EXISTS. On 2026-08-04 smartls.praxisls.com served a fully blank page.
 * The cause was a circular chunk graph produced by the `manualChunks` config:
 * `vendor` imported `vendor-react` for React, and `vendor-react` imported
 * `vendor` for `scheduler`. The browser evaluated one of them first, re-entered
 * the other before its export bindings were assigned, and TanStack Query's
 * top-level `createContext` call read `undefined`:
 *
 *     Uncaught TypeError: Cannot read properties of undefined (reading 'createContext')
 *
 * That throw happens during module evaluation, before React renders — so no
 * ErrorBoundary can catch it and there is no fallback UI. The page is blank.
 *
 * The build was NOT silent about it. Rollup printed "Circular chunk: vendor ->
 * vendor-react -> vendor" and exited 0, and CI went green. vite.config.ts now
 * turns that warning into a thrown error, and this script is the independent
 * second check: it reads what was actually written to dist/ and re-derives the
 * graph from the emitted `import ... from "./chunk.js"` statements. A cycle
 * Rollup did not report still fails here.
 *
 * Fixing a cycle by adding another manualChunks bucket does not work — see the
 * CHUNKING note in client/vite.config.ts. The rule is one bucket for
 * node_modules, and route-level React.lazy for everything else.
 *
 * Usage: node scripts/check-bundle.mjs   (npm run check:bundle, after a build)
 */
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(dirname, "../dist/assets");

/**
 * Static `import`/`export ... from` specifiers only. A DYNAMIC import() is not
 * an edge for this purpose: it resolves after the importing module has finished
 * evaluating, so a cycle through one cannot produce the undefined-binding read
 * this script exists to catch. Route-level code splitting relies on exactly that
 * property, and flagging those edges would make the gate unusable.
 */
const STATIC_IMPORT = /(?:^|[;}\s])(?:import|export)\s*(?:[\w*{},\s$]*?\s*from\s*)?["'](\.\/[^"']+\.js)["']/g;

function findCycle(graph) {
  const state = new Map(); // unvisited | visiting | done
  const stack = [];

  function walk(node) {
    if (state.get(node) === "done") return null;
    if (state.get(node) === "visiting") return [...stack.slice(stack.indexOf(node)), node];

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
    console.error(`✗ ${path.relative(process.cwd(), ASSETS)} not found — run \`npm run build\` first.`);
    process.exit(1);
  }

  const files = (await readdir(ASSETS)).filter((f) => f.endsWith(".js"));
  if (files.length === 0) {
    console.error("✗ No JS chunks in dist/assets — the build produced nothing to check.");
    process.exit(1);
  }

  const graph = new Map();
  for (const file of files) {
    const source = await readFile(path.join(ASSETS, file), "utf8");
    const edges = new Set();
    for (const [, specifier] of source.matchAll(STATIC_IMPORT)) {
      const target = path.basename(specifier);
      if (target !== file && files.includes(target)) edges.add(target);
    }
    graph.set(file, edges);
  }

  const cycle = findCycle(graph);
  if (cycle) {
    console.error("✗ Circular chunk graph in dist/assets — this ships a blank page.\n");
    console.error(`    ${cycle.join("\n  → ")}\n`);
    console.error("  One chunk in this cycle reads another's exports before they are assigned,");
    console.error("  which throws during module evaluation — before React renders, so no");
    console.error("  ErrorBoundary catches it and the user sees nothing at all.");
    console.error("\n  Do NOT resolve this by adding a manualChunks bucket. See the CHUNKING");
    console.error("  note in client/vite.config.ts.");
    process.exit(1);
  }

  const edgeCount = [...graph.values()].reduce((n, e) => n + e.size, 0);
  console.log(`✓ Chunk graph is acyclic — ${graph.size} chunks, ${edgeCount} static edges.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
