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
 * That design has three ways to fail, and none of them breaks the build:
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
 *   3. AN UNBOUNDED DEFERRED PAYLOAD. The opposite mistake, and the one a
 *      capability-gated set piece invites: move the weight behind a dynamic
 *      import and the first-paint number stays green while the page grows a
 *      300 kB scene. Deferred is not free — a visitor who scrolls to the band
 *      downloads it. See DEFERRED_BUDGET_KB.
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
const ROOT = path.resolve(dirname, "..");
const DIST = path.join(ROOT, "dist");

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
  const cfg = readFileSync(path.join(ROOT, "vite.config.ts"), "utf8");
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
 * = 113.3 kB. The cap was 128 kB — about 15 % of headroom, which is deliberately
 * small: it absorbs a dependency patch release or one new shared component, and
 * it cannot absorb a router, a query library or an icon pack. That is the point;
 * a budget with room to spare is a budget nobody will ever consult.
 *
 * ── RAISED ONCE, 128 → 131, AND WHAT THE STRANGER GETS FOR IT ─────────────
 *
 * The site header was rebuilt as a scroll- and pointer-reactive object: the
 * utility strip erodes through a dot mask instead of sliding, the bar deepens
 * its blur and casts a shadow as it condenses, one piece of ink travels between
 * nav items instead of seven backgrounds cross-fading, and the bottom hairline
 * became the page's reading position. It cost **2.4 kB gzip** — 1.2 kB of CSS
 * and 1.2 kB of JS — against 1.5 kB of headroom.
 *
 * This is the raise the header of this file warns about, so here is the working
 * rather than a number that quietly moved:
 *
 *   · IT IS NOT DRIFT. Failure mode 2 above is a route that stopped being lazy.
 *     The chunk graph is unchanged and every route is still split; this is new
 *     code, deliberately written, on a surface every single page renders.
 *   · WHAT WAS TRIED FIRST. The services panel — the largest new piece — is
 *     `React.lazy`, which returned 0.7 kB. Its stylesheet was measured
 *     separately at 335 bytes gzip and left in `index.css` on purpose: moving
 *     it to its own file would take it out of `check:contrast`, `check:motion`
 *     and `check:palette`, all three of which read that one file, and 335 bytes
 *     is not worth a hole in three gates. Its bespoke button, link and eyebrow
 *     rules were deleted in favour of `.btn-primary`, `.more-link` and
 *     `.micro`, which is a saving worth having for its own sake (guide §3.5)
 *     and returned very little here.
 *   · WHAT IS LEFT IS THE FEATURE. Cutting to fit would mean deleting about
 *     half of it. That is a product decision and not a budget one.
 *
 * 131 rather than 130: it restores roughly the 1.5 kB of headroom that existed
 * before, so the next person to add a shared component is refused by their own
 * change rather than by this one. Note the ratio this is defending is still
 * ~87 % vendor-and-framework — the next real win on this number is a dependency,
 * not another 300 bytes of stylesheet.
 *
 * ── THE HOLE THAT BULLET DESCRIBES IS CLOSED (O-13) ───────────────────────
 *
 * That second bullet is why this budget was raised rather than paid for, and it
 * was a correct call against the gates as they then were. It no longer holds:
 * `check:motion` and `check:contrast` walk every `.css` under `src/` now,
 * discovered rather than listed, so a stylesheet moved out of `index.css` stays
 * inside both. (`check:palette` was never in this hole — it walks `git ls-files`
 * and has always read every tracked `.css` in the app. Two gates, not three.)
 *
 * 335 bytes is small. What was blocked on it is not: per-route CSS splitting is
 * now unblocked, and that is the lever the next raise should be spent looking at
 * rather than on the budget.
 *
 * ── WHERE THE NEXT 8.4 kB IS, MEASURED RATHER THAN GUESSED (F-39) ─────────
 *
 * The entry carries BOTH translation dictionaries. Building with `fr` aliased to
 * `en` takes index from 52.7 to 44.3 kB gzip, so every visitor pays 8.4 kB — more
 * than 6 % of this whole budget, and nearly three times what the header cost —
 * for the language they are not reading.
 *
 * It is deliberately not done here, because splitting it naively LOSES. Await
 * the resolved dictionary in `main.tsx` and the saving becomes a serial request
 * the entry did not have before: about 8 kB against one round trip, which on the
 * connections this budget exists for is a wash at best. It pays only with a
 * `<link rel="modulepreload">` for the right dictionary in the server-rendered
 * head (`src/shared/http/public-head.js` already builds it and already knows the
 * request's language), so the two chunks are fetched in parallel. That is the
 * work; the measurement above is the reason it is worth doing, and it is where
 * the next raise should be refused and sent instead.
 */
const FIRST_PAINT_BUDGET_KB = 131;

/**
 * The DEFERRED budget — §5.6, and the thing that keeps a WebGL set piece honest
 * instead of unbounded.
 *
 * ── WHY THIS DID NOT EXIST UNTIL PR 3 ──────────────────────────────────────
 *
 * §5.6 specified it as PR 1 work and PR 1 did not ship it (see the guide's
 * §3.4, F-14). The omission mattered the moment §7.5 arrived: the whole
 * argument for a deferred, capability-gated scene is that it costs a visitor
 * who never sees it nothing, and "deferred" without a number is how a marketing
 * page acquires 300 kB of three.js that only ever loads on somebody else's
 * laptop.
 *
 * WHAT IS COUNTED: every emitted chunk that is NOT in the first-paint set.
 * That is deliberately the whole of the rest rather than a hand-maintained list
 * of "homepage" chunks — a list is a thing that goes stale silently, and the
 * budget is far enough above today's total that counting the portal and the
 * careers form too costs nothing and closes the loophole where a chunk is
 * excused by not being named.
 */
const DEFERRED_BUDGET_KB = 220;

/**
 * What ONE route adds to the first paint: its own lazy chunk, plus everything
 * that chunk statically imports which the entry has not already loaded.
 *
 * ── WHY THE ROUTE'S OWN COST AND NOT THE TOTAL — F-18 ─────────────────────
 *
 * A visitor waits for the SUM: React cannot commit a lazy route until the route
 * chunk has arrived too, so the total is the honest number and it is the one
 * printed. It is the wrong thing to put a budget on, because it is already
 * budgeted — every kilobyte the entry gains shows up in all twelve route totals
 * at once, so a single entry regression would redden twelve rows and none of
 * them would be the cause. FIRST_PAINT_BUDGET_KB owns that failure.
 *
 * What nothing owned, which is exactly what F-18 said, is the route's own
 * contribution. `marketing-page` went from 5.5 kB to 11.9 kB across PR 3 with
 * every gate green. So the delta is what is capped here, and the two budgets
 * are then independent: one number moves for one reason.
 *
 * ── THE NUMBER ────────────────────────────────────────────────────────────
 *
 * The worst route today is `marketing-page` at 12.3 kB — the homepage, which
 * legitimately carries the most. 16 kB is about 30 % over that: enough for a
 * band or a form, not enough for a library.
 *
 * It is calibrated against a real defect rather than picked. Turning this check
 * on found `services-page` at 16.3 kB, because it imported the whole quote
 * wizard statically for a form two screens below the fold — so this budget
 * fails on the bug it was written for, and passes at 10.0 kB once
 * `quote-band.tsx` defers it.
 */
const ROUTE_OWN_BUDGET_KB = 16;

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

  /* ── 2b. the CRITICAL PATH PER ROUTE — F-18 ──────────────────────────────
   *
   * The number above counts the entry, its static imports and the CSS. That is
   * correct as far as it goes and it is not what a visitor waits for: every
   * page here is a `React.lazy` route, so React cannot commit anything until
   * that route's chunk — and everything IT statically imports — has also
   * arrived. The route chunk is the last link of the critical chain.
   *
   * F-18 measured the consequence: PR 3 took `marketing-page` from 5.5 kB to
   * 11.9 kB on the wire while the reported first paint stayed comfortably
   * green. A route chunk could grow without limit and nothing said so.
   *
   * ── THE ROUTES ARE READ FROM THE ROUTER, NOT GUESSED FROM CHUNK NAMES ────
   *
   * The build emits shared chunks too (`card`, `pill`, `corridor-webgl`), and
   * counting each as "a route" would be noise around the handful of numbers
   * that mean something. `router.tsx`'s own `import("@/features/…")` specifiers
   * are the list — derived, so a route added tomorrow is measured, which is the
   * same rule `route-entrances.test.tsx` follows for the same reason.
   */
  const routerSrc = await readFile(
    path.join(ROOT, "src", "app", "router.tsx"),
    "utf8",
  );
  const routeStems = [
    ...new Set(
      [...routerSrc.matchAll(/import\(\s*["']@\/features\/[^"']*?\/([\w-]+)["']\s*\)/g)].map(
        (m) => m[1],
      ),
    ),
  ];

  /**
   * Routes that are NOT a stranger's first paint, with the reason.
   *
   * The budget is a statement about what a visitor who followed a link waits
   * for, on a phone, on a metered connection. The portal is a signed-in
   * application behind a login: its audience has already decided to be here,
   * and holding it to a first-impression budget measures the wrong thing.
   */
  const NOT_FIRST_PAINT = {
    "portal-app": "a signed-in application behind a login, not a stranger's first paint",
  };

  /** A route's own chunk plus everything it statically imports that the entry
   *  has not already loaded. */
  function routeCost(stem) {
    const head = files.find(
      (f) => f.startsWith(`${stem}-`) && f.endsWith(".js") && !upFront.has(f),
    );
    if (!head) return null;
    const seen = new Set();
    const queue = [head];
    while (queue.length) {
      const name = queue.shift();
      if (seen.has(name) || upFront.has(name)) continue;
      seen.add(name);
      const src = sources.get(name);
      if (!src) continue;
      for (const [, spec] of src.matchAll(STATIC_IMPORT)) {
        const target = path.basename(spec);
        if (files.includes(target) && !upFront.has(target)) queue.push(target);
      }
    }
    return { head, chunks: seen };
  }

  const criticalRows = [];
  const over = [];
  let worst = { name: null, own: 0, critical: 0 };
  for (const stem of routeStems.sort()) {
    const cost = routeCost(stem);
    if (!cost) continue;
    let own = 0;
    for (const name of cost.chunks) {
      const full = path.join(ASSETS, name);
      if (existsSync(full)) own += gz(await readFile(full));
    }
    const critical = total + own;
    const exempt = NOT_FIRST_PAINT[stem];
    criticalRows.push(
      `    ${stem.padEnd(20)} ${String(cost.chunks.size).padStart(2)} chunk(s) ` +
        `${KB(own).padStart(9)} own → ${KB(critical).padStart(9)} critical` +
        (exempt ? `  — exempt: ${exempt}` : ""),
    );
    if (exempt) continue;
    if (own > worst.own) worst = { name: stem, own, critical };
    if (own > ROUTE_OWN_BUDGET_KB * 1024) over.push({ stem, own });
  }

  console.log(
    "\nPer route — what the route ADDS, and what the visitor therefore waits for:",
  );
  console.log(criticalRows.join("\n"));
  if (worst.name) {
    console.log(
      `    ${"WORST".padEnd(20)} ${" ".repeat(11)}${KB(worst.own).padStart(9)} own` +
        ` → ${KB(worst.critical).padStart(9)} critical` +
        `  (${worst.name}, budget ${ROUTE_OWN_BUDGET_KB} kB own)`,
    );
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

  /* Both budget checks report before either exits, so one run tells you
     everything that is over rather than the first thing. */
  let overBudget = false;

  const routeBudget = ROUTE_OWN_BUDGET_KB * 1024;
  for (const { stem, own } of over) {
    console.error(
      `\n✗ The ${stem} route adds ${KB(own)} to the first paint — ` +
        `${KB(own - routeBudget)} over the ${ROUTE_OWN_BUDGET_KB} kB budget.\n` +
        "  F-18: React cannot commit a lazy route until that route's chunk and\n" +
        "  everything it statically imports have arrived, so this is time a visitor\n" +
        "  spends looking at nothing — on top of the entry, not instead of it.\n" +
        "  The usual cause is a static import of something below the fold: check\n" +
        "  what this route imports that the page does not need to render. See\n" +
        "  `components/site/quote-band.tsx` for the shape of the fix, or say in the\n" +
        "  commit message what the stranger gets for the extra kilobytes.",
    );
    overBudget = true;
  }

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
    overBudget = true;
  }

  if (overBudget) process.exit(1);

  // ── 3. the deferred payload ──
  const deferred = files.filter((f) => !upFront.has(f));
  const deferredRows = [];
  let deferredTotal = 0;
  for (const name of deferred) {
    const g = gz(await readFile(path.join(ASSETS, name)));
    deferredTotal += g;
    deferredRows.push([name, g]);
  }
  deferredRows.sort((a, b) => b[1] - a[1]);

  console.log(`\nDeferred (${deferred.length} chunks, none on the first-paint path):`);
  for (const [name, g] of deferredRows.slice(0, 8)) {
    console.log(`    ${name.padEnd(34)} ${KB(g).padStart(9)} gzip`);
  }
  if (deferredRows.length > 8) {
    console.log(`    ${`… and ${deferredRows.length - 8} smaller`.padEnd(34)}`);
  }
  console.log(
    `    ${"TOTAL".padEnd(34)} ${KB(deferredTotal).padStart(9)} gzip  (budget ${DEFERRED_BUDGET_KB} kB)`,
  );

  if (deferredTotal > DEFERRED_BUDGET_KB * 1024) {
    console.error(
      `\n✗ Deferred payload over budget by ${KB(deferredTotal - DEFERRED_BUDGET_KB * 1024)}.`,
    );
    console.error(
      "  A chunk being lazy is not the same as it being free: a visitor who reaches",
    );
    console.error(
      "  the band that loads it still downloads it, usually on the connection this",
    );
    console.error(
      "  app's budget exists for. The usual cause is a rendering or animation",
    );
    console.error(
      "  library pulled in for one set piece — check what the newest dynamic",
    );
    console.error("  import() drags with it before raising this number.");
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
