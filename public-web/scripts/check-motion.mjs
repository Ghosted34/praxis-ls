#!/usr/bin/env node
/**
 * Motion budget gate for `public-web`.
 *
 * ── WHY THIS APP HAS ITS OWN, AND A DIFFERENT NUMBER ───────────────────────
 *
 * `client/scripts/check-motion.mjs` holds the ERP to 250ms, and its reasoning
 * is right for the ERP: a dispatcher opens the shipments table forty times a
 * day, and a 500ms entrance was costing them twenty seconds a day for a
 * decoration. That gate also carves out an exception, in its own words:
 *
 *   "The front door. `.landing-*` and `.login-*` are the marketing surface and
 *    the sign-in card: seen once per session, before any work starts, and the
 *    only place in this product where 'impression' is the job."
 *
 * This whole app IS that surface. So the exception becomes the rule here — and
 * it is written down and gated rather than left to whoever edits the stylesheet
 * next, because "the marketing site may be expressive" degrades into "nobody
 * checks the marketing site" within about two pull requests.
 *
 * ── TWO BUDGETS, BECAUSE THEY ARE TWO JOBS ─────────────────────────────────
 *
 *   RESPONSE (200ms) — what happens when a person ACTS. A hover, a press, a
 *   focus ring, a toggle. This must feel like the interface reacting. It is
 *   TIGHTER than the ERP's 250ms, deliberately: on a marketing page the reader
 *   is scanning, and a hover that takes a quarter of a second to acknowledge
 *   them reads as a slow site no matter how beautiful the rest is.
 *
 *   NARRATIVE (600ms) — what happens when a person ARRIVES. A band revealing,
 *   a headline staging in, a diagram assembling. This is the budget the express
 *   exception buys, and it exists on no other surface in this product.
 *
 * A selector is RESPONSE unless it is named in NARRATIVE. That default is the
 * important half: a new transition someone adds without thinking is held to the
 * strict number, and relaxing it is an edit a reviewer can see.
 *
 * ── AND THE REDUCED-MOTION UMBRELLA, WHICH IS THE REAL ASSERTION ───────────
 *
 * A budget is not a substitute for honouring the platform preference. The
 * global kill in index.css is one `!important` away from silently not applying,
 * and nothing in a test suite would notice. This checks it is still there,
 * still covers BOTH animation and transition, and still reaches
 * pseudo-elements.
 *
 *   node scripts/check-motion.mjs   (npm run check:motion)
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const cssPath = join(appRoot, "src", "index.css");
const twPath = join(appRoot, "tailwind.config.ts");
const css = readFileSync(cssPath, "utf8");
const tw = readFileSync(twPath, "utf8");

/**
 * ── EVERY STYLESHEET, NOT JUST index.css — O-13 ────────────────────────────
 *
 * This gate read one file. `index.css` is where the motion is TODAY, which is
 * why nobody noticed, and it is not where the motion is DEFINED: `main.tsx`
 * imports three stylesheets, and any component may add a fourth. A
 * `transition: opacity 3000ms` in `fonts.css` passed this gate silently —
 * verified by putting one there, which is the only way to establish a gate's
 * blind spot rather than assume its absence.
 *
 * The rule is every `.css` under `src/`, discovered rather than listed. A list
 * is a thing that goes stale in exactly the way that produced this finding, and
 * a stylesheet in the app's own tree is either shipped or dead — scanning a dead
 * one costs a millisecond and misses nothing.
 *
 * `index.css` keeps its own binding above: the reduced-motion umbrella and the
 * `@layer` structure are properties OF that file, so §3 asserts against it by
 * name. Only the timing budget is graph-wide, because a slow transition is slow
 * wherever it is declared.
 */
function stylesheets(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...stylesheets(full));
    else if (e.name.endsWith(".css")) out.push(full);
  }
  return out;
}
const SHEETS = stylesheets(join(appRoot, "src"))
  .sort()
  .map((file) => ({ file: relative(appRoot, file), text: readFileSync(file, "utf8") }));

const RESPONSE_MS = 200;
const NARRATIVE_MS = 600;

/**
 * Selectors held to the NARRATIVE budget instead of RESPONSE, each with the
 * reason. An entrance is motion a reader watches once on arrival; anything they
 * trigger themselves does not belong here however pretty it is.
 */
const NARRATIVE = [
  [/^\.staged-word/, "headline staging in on arrival — watched once, never re-run"],
  [/^\.band-enter/, "a marketing band revealing as it enters the viewport"],
  [/^\.hero/, "the hero's arrival — the one composition a visitor watches settle"],
  [/^\.reveal/, "the shared scroll reveal; unobserve-on-fire, so it happens once"],
];

/**
 * Unbounded, by exemption only. Continuous and scroll-linked motion has no
 * duration this file can bound — a scrub's "duration" is how long the reader
 * scrolls — so the exemption is the honest mechanism rather than a large number.
 */
const EXEMPT = [
  [/^\.weight-scrub/, "scroll-linked: the reader's scroll position IS the timeline"],
  [/^\.lane-/, "marching-ants stroke on a shipping lane — the motion IS direction of travel"],
  [/^\.ambient/, "continuous atmosphere on a set piece; paused off-screen and under reduced motion"],
  [
    /^\.hero-word-light/,
    "the headline catching the pass: each word turns to the tenant's accent and back as the beam reaches it, on the same --beam-cycle with a per-word delay. Both endpoints are measured colours on an unchanged ground (--hero-foreground 12.1:1, --primary 6.33:1 on carbon), so unlike a blend it spends no contrast. Paused unless the band is on screen, and it declares no fill-mode, so under the reduced-motion umbrella a word reverts to its inherited resting colour",
  ],
  [
    /^\.hero-beam/,
    "the hero's pass: one raked beam every --beam-cycle and the plate edge that catches it as it leaves — one event, two selectors, one token. Paused unless the band reports itself on screen (data-live, useInView), and both declare a BASE style that is already the settled state — beam parked off-screen at zero opacity, ring at zero — so the reduced-motion umbrella's single unfilled 0.001ms iteration leaves the band correct rather than mid-flash. The focus-hold on the same element is the reader's own state and replaces the pass rather than overlapping it",
  ],
];

/** Tailwind `animation` entries that may loop forever, and why. */
const INFINITE_OK = {
  "lane-sea": "marching-ants stroke on a shipping lane — the motion IS direction of travel",
  "lane-road": "as above",
  "lane-air": "as above",
  "lane-rail": "as above",
};

/* ── helpers ──────────────────────────────────────────────────────────────── */

const toMs = (t) => (t.endsWith("ms") ? parseFloat(t) : parseFloat(t) * 1000);
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Custom-property values, so `transition: … var(--dur) …` can be measured.
 *
 * WITHOUT THIS THE GATE IS DECORATIVE. Nearly every transition in this
 * stylesheet is written against a token — that is the whole point of having
 * tokens — and a regex looking for `0.15s` finds none of them. The first run of
 * this gate reported four timed declarations in a file with more than twenty,
 * and passed. A gate that passes by not looking is worse than no gate, because
 * it gets quoted as evidence.
 *
 * Resolution is recursive (`--dur: var(--dur-response)`) with a depth cap, so a
 * token that references itself cannot hang the build.
 */
function customProperties(source) {
  const map = new Map();
  for (const m of stripComments(source).matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
    // Later definitions win, which matches the cascade for the dark-theme block
    // — and the dark block does not redefine a duration, so this is stable.
    map.set(m[1], m[2].trim());
  }
  return map;
}

function resolveVars(value, props, depth = 0) {
  if (depth > 6 || !value.includes("var(")) return value;
  const next = value.replace(/var\((--[\w-]+)(?:\s*,\s*([^()]*))?\)/g, (_, name, fallback) =>
    props.has(name) ? props.get(name) : (fallback ?? ""),
  );
  return next === value ? next : resolveVars(next, props, depth + 1);
}

/**
 * Walk the file tracking the innermost selector, so a failure names the rule
 * rather than a line number. Multi-line declarations are joined before they are
 * matched: this stylesheet writes its transitions one property per line, and
 * the ERP's line-by-line version of this gate silently skips every one of them.
 */
function declarations(source) {
  const out = [];
  let selector = "";
  const stack = [];
  const lines = stripComments(source).split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const open = line.indexOf("{");
    if (open !== -1) {
      const head = line.slice(0, open).trim();
      if (
        head &&
        !head.startsWith("@media") &&
        !head.startsWith("@layer") &&
        !head.startsWith("@supports") &&
        !head.startsWith("@keyframes")
      ) {
        stack.push(head);
        selector = head;
      } else {
        stack.push(selector);
      }
    }

    /* `{` and `;` are in the class beside whitespace, and that is a second
       blind spot rather than tidiness. `.x{transition:opacity 3s}` — one line,
       no space after the brace — matched nothing at all, so the gate's answer
       for a compact or generated stylesheet was a silent pass. Found by probing
       this gate with a real violation instead of trusting it. */
    const start = line.match(
      /(?:^|[\s{;])(transition|animation)(?:-duration|-delay)?\s*:(.*)$/,
    );
    if (start) {
      let value = start[2];
      let j = i;
      // Join until the declaration actually terminates.
      while (!value.includes(";") && j + 1 < lines.length && j - i < 12) {
        j += 1;
        value += " " + lines[j];
      }
      out.push({
        prop: start[1],
        value: value.split(";")[0].trim(),
        selector,
        line: i + 1,
      });
    }

    if (line.includes("}")) {
      stack.pop();
      selector = stack[stack.length - 1] ?? "";
    }
  }
  return out;
}

/** Every time value in a shorthand. A delay is wall time the reader waits too. */
const durations = (value) =>
  (value.match(/(?<![\w.])\d*\.?\d+m?s/g) || []).map(toMs);

const match = (list, selector) => list.find(([re]) => re.test(selector.trim()));

/* ── 1. the two budgets ───────────────────────────────────────────────────── */

const failures = [];
const relaxed = [];
const exempted = [];
let checked = 0;
/* Custom properties resolve across the whole graph: a duration token declared
   in one sheet and used in another is one `var()` the resolver must follow, and
   the alternative is a "0ms" reading that looks like a pass. */
const props = new Map();
for (const sheet of SHEETS) {
  for (const [name, value] of customProperties(sheet.text)) props.set(name, value);
}

for (const sheet of SHEETS)
for (const d of declarations(sheet.text).map((d) => ({ ...d, file: sheet.file }))) {
  const worst = Math.max(0, ...durations(resolveVars(d.value, props)));
  if (worst === 0) continue;
  checked += 1;

  const ex = match(EXEMPT, d.selector);
  if (ex) {
    exempted.push({ ...d, worst, reason: ex[1] });
    continue;
  }

  const nar = match(NARRATIVE, d.selector);
  const budget = nar ? NARRATIVE_MS : RESPONSE_MS;
  if (nar) relaxed.push({ ...d, worst, reason: nar[1] });

  if (worst > budget) {
    failures.push({ ...d, worst, budget, kind: nar ? "narrative" : "response" });
  }
}

/* ── 2. the tailwind animation scale ──────────────────────────────────────── */

const animBlock = tw.match(/animation:\s*\{([\s\S]*?)\n\s{4}\}/);
if (animBlock) {
  for (const m of animBlock[1].matchAll(/"?([\w-]+)"?:\s*"([^"]+)"/g)) {
    const [, name, value] = m;
    const worst = Math.max(0, ...durations(value));
    if (/infinite/.test(value)) {
      if (!INFINITE_OK[name]) {
        failures.push({
          prop: "animation (tailwind)",
          value,
          selector: `animation.${name}`,
          worst,
          budget: NARRATIVE_MS,
          kind: "infinite, unlisted",
        });
      }
      continue;
    }
    if (worst > NARRATIVE_MS) {
      failures.push({
        prop: "animation (tailwind)",
        value,
        selector: `animation.${name}`,
        worst,
        budget: NARRATIVE_MS,
        kind: "narrative",
      });
    }
  }
}

/* ── 3. the reduced-motion umbrella ───────────────────────────────────────── */

const umbrella = [];

/**
 * Checked PER BLOCK, not across all of them joined.
 *
 * The first version of this check concatenated every reduced-motion block and
 * asked whether the text contained the declarations. This stylesheet has two
 * such blocks, so breaking one of them left the other to satisfy the search and
 * the gate passed — proven by deliberately removing an `!important` and
 * watching it go green. Every block that claims the universal selector is now
 * held to the whole rule on its own.
 */
/**
 * Blocks extracted by COUNTING BRACES, not by a non-greedy regex.
 *
 * `[\s\S]*?` up to the first `}` stops at the first NESTED close. The umbrella
 * at the top of index.css opens with an `html { … }` rule, so a non-greedy
 * match captured only that and never saw the universal selector underneath —
 * which meant removing an `!important` from the app's main reduced-motion kill
 * left this gate perfectly green. Proven by doing exactly that and watching it
 * pass.
 */
function blocksAfter(source, opener) {
  const out = [];
  for (const m of source.matchAll(opener)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") depth -= 1;
      i += 1;
    }
    out.push(source.slice(start, i - 1));
  }
  return out;
}

const rmBlocks = blocksAfter(
  stripComments(css),
  /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g,
);

/**
 * Does this block hold the UNIVERSAL umbrella — a bare `*` selector?
 *
 * ── WHY A REGEX OVER THE BLOCK IS NOT ENOUGH ──────────────────────────────
 *
 * The obvious test, `/(^|[\s,{])\*[\s,{]/`, matches `.landing-content > *`,
 * which is a CHILD selector and not an umbrella at all. `client/src/index.css`
 * has exactly that inside a reduced-motion block, so the obvious test reported
 * the landing-page block as a broken global kill and named four faults in a
 * rule that was never claiming to be one.
 *
 * So the selector lists are parsed: the text before each `{`, split on commas,
 * and a block qualifies only when one of its selectors is exactly `*`.
 */
function hasUniversalSelector(block) {
  // Selector lists are the runs of text that precede a `{`.
  for (const m of block.matchAll(/(^|[};])([^{}]*)\{/g)) {
    const selectors = m[2].split(",").map((sel) => sel.trim());
    if (selectors.some((sel) => sel === "*")) return true;
  }
  return false;
}

const globalBlocks = rmBlocks.filter(hasUniversalSelector);

if (rmBlocks.length === 0) {
  umbrella.push("there is no `prefers-reduced-motion: reduce` block at all");
} else if (globalBlocks.length === 0) {
  umbrella.push(
    "no reduced-motion block uses the universal selector — the kill only reaches the rules someone remembered to name",
  );
} else {
  globalBlocks.forEach((block, i) => {
    const label = globalBlocks.length > 1 ? ` (global block ${i + 1})` : "";
    if (!/animation-duration:\s*[^;]*!important/.test(block)) {
      umbrella.push(`the kill does not force \`animation-duration\` with !important${label}`);
    }
    if (!/transition-duration:\s*[^;]*!important/.test(block)) {
      umbrella.push(`the kill does not force \`transition-duration\` with !important${label}`);
    }
    // BOTH, not either. The ERP's version of this check accepts one of the two,
    // which passes a block that reaches ::before and silently lets every
    // ::after affordance keep animating — and this stylesheet's split-pane
    // rule, focus underlines and arrow affordances are ::after.
    for (const pseudo of ["*::before", "*::after"]) {
      if (!block.includes(pseudo)) {
        umbrella.push(
          `the kill does not reach \`${pseudo}\`${label} — those affordances would keep animating`,
        );
      }
    }
  });
}

/* ── 4. hooks must not animate in JavaScript ──────────────────────────────── */
/**
 * The one thing a CSS gate cannot see: a component animating with setInterval
 * or a hand-rolled rAF tween, which honours neither the budget nor the reduced
 * motion preference and which no stylesheet mentions. The motion primitives use
 * rAF to WRITE a custom property — legitimate, and the reason this looks for a
 * timer driving style directly rather than for rAF itself.
 */
const jsFailures = [];
function sources(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}
for (const file of sources(join(appRoot, "src"))) {
  const text = stripComments(readFileSync(file, "utf8"));
  if (/setInterval\s*\([^)]*\)[\s\S]{0,400}?\.style\./.test(text)) {
    jsFailures.push(relative(appRoot, file));
  }
}

/* ── report ───────────────────────────────────────────────────────────────── */

console.warn(
  `\npublic-web motion — ${checked} timed declaration(s) across ${SHEETS.length} stylesheet(s)` +
    ` · response ${RESPONSE_MS}ms · narrative ${NARRATIVE_MS}ms\n`,
);

if (relaxed.length) {
  console.warn("  Held to the narrative budget:");
  for (const r of relaxed) {
    console.warn(`    ${r.selector.padEnd(26)} ${String(r.worst).padStart(5)}ms  — ${r.reason}`);
  }
  console.warn("");
}
if (exempted.length) {
  console.warn("  Exempt (continuous or scroll-linked):");
  for (const e of exempted) {
    console.warn(`    ${e.selector.padEnd(26)} ${String(e.worst).padStart(5)}ms  — ${e.reason}`);
  }
  console.warn("");
}

if (failures.length) {
  console.error(`✗ ${failures.length} declaration(s) over budget:\n`);
  for (const f of failures) {
    console.error(
      `    ${f.selector}  (${f.prop}: ${f.value.trim()})\n` +
        `      ${f.file} — ${f.worst}ms against the ${f.kind} budget of ${f.budget}ms\n`,
    );
  }
  console.error(
    "  Either bring it inside the budget, or — if it is genuinely an entrance or\n" +
      "  a scroll-linked set piece — add it to NARRATIVE or EXEMPT in this file\n" +
      "  WITH A REASON. The reason is the point: it is what makes the decision\n" +
      "  reviewable instead of a number someone quietly raised.\n",
  );
}

if (umbrella.length) {
  console.error("✗ the reduced-motion umbrella in src/index.css is not intact:\n");
  for (const u of umbrella) console.error(`    ${u}`);
  console.error(
    "\n  Reduced motion renders the SETTLED state, not a faster animation. This is\n" +
      "  the one rule in this app that has no exception (guide §1.2).\n",
  );
}

if (jsFailures.length) {
  console.error("✗ motion driven by setInterval, which no budget can reach:\n");
  for (const f of jsFailures) console.error(`    ${f}`);
  console.error(
    "\n  Animate in CSS against a custom property, as src/lib/motion.ts does.\n",
  );
}

if (failures.length || umbrella.length || jsFailures.length) process.exit(1);
console.warn("✓ Within budget, and reduced motion is still honoured.\n");
