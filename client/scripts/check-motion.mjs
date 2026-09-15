#!/usr/bin/env node
/**
 * Motion budget gate (Phase 5, audit F17).
 *
 * WHAT IT HOLDS, and why it is worth a gate at all.
 *
 * F17's sharpest finding was not a colour or a typeface — it was that
 * `.animate-fade-up` ran `translateY(12px) → 0` over **500ms on every card and
 * table mount**. A dispatcher who opens the shipments table forty times a day
 * waited twenty seconds a day for a decoration, and it made a fast backend look
 * like a slow one. Phase 1 took it to 120ms.
 *
 * Nothing stops it coming back. A 500ms fade is one character's difference from
 * a 50ms one, it looks fine in a screenshot, it looks fine in review, and the
 * person who notices is the operator on their three-hundredth use. That is
 * exactly the class of regression a gate exists for and code review does not
 * catch — the same argument the palette gate makes in Phase 4.
 *
 * THE BUDGET. 250ms for anything in the application. The enterprise convention
 * for an entrance is 120-180ms; Linear's whole proposition is sub-100ms
 * response. 250ms leaves room for a drawer slide (the shell's is 240ms) and
 * refuses anything that reads as waiting.
 *
 * WHAT IS ALLOWED PAST IT, by selector and with a reason each time:
 *
 *   - **The front door.** `.landing-*` and `.login-*` are the marketing surface
 *     and the sign-in card: seen once per session, before any work starts, and
 *     the only place in this product where "impression" is the job. F17's
 *     objection is about the workstation, not the doorway. Their long motion
 *     (a 26s Ken Burns, a 0.7-0.9s rise) stays.
 *   - **Motion that carries meaning.** The Control Tower's lane dashes are a
 *     marching-ants stroke on a shipping route: the animation IS the direction
 *     of travel. An infinite loop is legitimate when it is data.
 *
 * IT ALSO ASSERTS THE REDUCED-MOTION UMBRELLA. A budget is not a substitute for
 * honouring the platform preference, and the global kill in index.css is one
 * `!important` away from silently not applying. This checks it is still there,
 * still covers BOTH animation and transition, and still reaches pseudo-elements
 * — where the split-pane rule and every ::before affordance live.
 *
 *   node scripts/check-motion.mjs
 *
 * Exit 0 = within budget. Exit 1 = something got slower, or reduced motion
 * stopped being honoured.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, "..");
const cssPath = join(clientRoot, "src", "index.css");
const twPath = join(clientRoot, "tailwind.config.ts");
const css = readFileSync(cssPath, "utf8");

/**
 * ── EVERY STYLESHEET, NOT JUST index.css — O-13 ────────────────────────────
 *
 * This gate read one file, and `client/src/fonts/brittany-signature.css` is
 * proof that one file is not where the CSS lives. A timed declaration in any
 * other sheet was a silent pass — established by putting a 3000ms transition in
 * a sibling and watching this gate report "within budget", not by inspection.
 *
 * Discovered rather than listed, for the reason the finding itself
 * demonstrates: a hand-maintained list of stylesheets goes stale the first time
 * somebody adds one, and it goes stale silently.
 *
 * `index.css` keeps its own binding above — the reduced-motion umbrella is a
 * property of that file specifically, and is asserted against it by name.
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
const SHEETS = stylesheets(join(clientRoot, "src"))
  .sort()
  .map((file) => ({ file: relative(clientRoot, file), text: readFileSync(file, "utf8") }));
const tw = readFileSync(twPath, "utf8");

/** Every .ts/.tsx under client/src. Walked rather than globbed so this stays a
 *  dependency-free script like the other gates. */
function clientSources(dir = join(clientRoot, "src")) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...clientSources(full));
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

/** Anything in the app must land within this, in milliseconds. */
const BUDGET_MS = 250;

/**
 * Selector prefixes exempt from the budget, each with the reason it is exempt.
 * Adding an entry here is a decision someone can review; raising BUDGET_MS is
 * not, which is why the escape hatch is shaped this way.
 */
const EXEMPT = [
  [
    /^\.landing/,
    "marketing front door — seen once per session, before any work",
  ],
  [/^\.login/, "sign-in card — same surface, same reason"],
  [
    /^\.splash/,
    "boot splash — the door, not the workstation: shown once per session before any work, and it is the surface a tenant designs in Settings › App & PWA",
  ],
];

/** Tailwind `animation` entries that may loop forever, and why. */
const INFINITE_OK = {
  "lane-sea":
    "marching-ants stroke on a shipping lane — the motion IS direction of travel",
  "lane-road": "as above",
  "lane-air": "as above",
  "lane-rail": "as above",
};

/**
 * FRAMEWORK animations — `animate-*` utilities the app uses that Tailwind ships
 * in its own base theme.
 *
 * THIS SECTION EXISTS BECAUSE THE GATE COULD NOT SEE THEM. Everything above
 * reads `index.css` and the `animation` block in `tailwind.config.ts`, which is
 * every animation this codebase DECLARES. Tailwind's built-ins are declared in
 * neither, so `animate-pulse` — a two-second loop, eight times the budget, on
 * the skeleton that now paints the whole application shell on a cold start —
 * was outside the gate entirely. A budget with a hole that size in it is a
 * budget that will eventually be quoted as proof of something it never checked.
 *
 * So: any `animate-<name>` used under `src/` that is not a project animation
 * must be listed here with the reason it is allowed. The reasons are printed
 * with the rest of the exemptions, and adding one is a decision a reviewer can
 * see — the same shape of escape hatch as EXEMPT above, for the same reason.
 *
 * Both entries below are genuinely exempt rather than grandfathered:
 *
 *   pulse  A LOADING PLACEHOLDER. The budget's argument is about entrance
 *          motion on a screen opened dozens of times a day — motion the user
 *          waits through before they can work. A skeleton's shimmer is the
 *          opposite: it is what is on screen WHILE they wait for something
 *          else, and it must last exactly as long as the wait does, which is
 *          not a duration this file can bound. Capping it at 250ms would mean a
 *          placeholder that animates once and then sits frozen, which reads as
 *          a hung page rather than a loading one.
 *   spin   The same argument, for the same reason, on the inline spinner and
 *          the Button's loading state.
 *   ping   THE LIVE MICROPHONE, and the only one of the three that is not about
 *          waiting. The halo around the composer's mic while dictation is
 *          recording is the same class of motion as the shipping-lane dash in
 *          INFINITE_OK: it is not decoration on an entrance, it is the state
 *          itself. A recording indicator that animates once and stops is a
 *          recording indicator that says "finished" while the microphone is
 *          still open — on a device that is listening to a room, that is the
 *          one failure mode worth spending an exemption to avoid. It exists
 *          only while `listening` is true, so it cannot loop on an idle screen.
 *

 * Both are neutralised by the reduced-motion kill asserted in section 4 — it is
 * a `*` rule with `!important`, so it reaches framework utilities exactly as it
 * reaches ours. That is what makes the exemption safe rather than merely
 * declared.
 */
const FRAMEWORK_OK = {
  pulse:
    "loading skeleton — it must last as long as the wait, which no fixed budget can express; frozen after 250ms reads as a hung page",
  spin: "inline spinner and the Button loading state — same argument as pulse",
  ping: "live-microphone halo while dictation records — the motion IS the state, and it exists only while listening",
};

/* ── helpers ──────────────────────────────────────────────────────────────── */

const toMs = (t) => (t.endsWith("ms") ? parseFloat(t) : parseFloat(t) * 1000);

/** Strip comments so a duration quoted in prose is not read as a declaration. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Walk the file tracking the innermost selector, so a failure can name the rule
 * rather than a line number. Good enough for a stylesheet written by hand; it
 * does not try to be a CSS parser.
 */
function declarations(source) {
  const out = [];
  let selector = "";
  const lines = stripComments(source).split("\n");
  const stack = [];

  lines.forEach((line, i) => {
    const open = line.indexOf("{");
    if (open !== -1) {
      const head = line.slice(0, open).trim();
      if (
        head &&
        !head.startsWith("@media") &&
        !head.startsWith("@layer") &&
        !head.startsWith("@supports")
      ) {
        stack.push(head);
        selector = head;
      } else {
        stack.push(selector);
      }
    }
    const m = line.match(
      /* `{` and `;` beside whitespace: `.x{transition:opacity 3s}` on one line
         matched nothing, so a compact or generated stylesheet read as a pass.
         The same blind spot as public-web's copy, found the same way. */
      /(?:^|[\s{;])(transition|animation)(?:-duration)?\s*:\s*([^;]+);/,
    );
    if (m) out.push({ prop: m[1], value: m[2], selector, line: i + 1 });
    if (line.includes("}")) {
      stack.pop();
      selector = stack[stack.length - 1] ?? "";
    }
  });
  return out;
}

/** Every time value in a shorthand. `animation-delay` counts: it is wall time too. */
function durations(value) {
  return (value.match(/(?<![\w.])\d*\.?\d+m?s/g) || []).map(toMs);
}

const exemptFor = (selector) => EXEMPT.find(([re]) => re.test(selector.trim()));

/* ── 1. the budget ────────────────────────────────────────────────────────── */

const failures = [];
const exempted = [];
let checked = 0;

for (const sheet of SHEETS)
for (const d of declarations(sheet.text).map((d) => ({ ...d, file: sheet.file }))) {
  const worst = Math.max(0, ...durations(d.value));
  if (worst === 0) continue;
  checked++;
  if (worst <= BUDGET_MS) continue;

  const ex = exemptFor(d.selector);
  if (ex) {
    exempted.push({ ...d, worst, reason: ex[1] });
    continue;
  }
  failures.push({ ...d, worst });
}

/* ── 2. animation-delay, which is wall time the user also waits ───────────── */

for (const m of stripComments(css).matchAll(
  /^([^{}\n]+)\{[^}]*animation-delay:\s*([^;]+);/gm,
)) {
  const worst = Math.max(0, ...durations(m[2]));
  if (worst > BUDGET_MS && !exemptFor(m[1])) {
    failures.push({
      prop: "animation-delay",
      value: m[2],
      selector: m[1].trim(),
      worst,
    });
  }
}

/* ── 3. the tailwind animation scale ──────────────────────────────────────── */

const twAnimations = tw.match(/animation:\s*\{([\s\S]*?)\n\s{6}\}/);
if (!twAnimations) {
  failures.push({
    selector: "tailwind.config.ts",
    prop: "animation",
    value: "block not found",
    worst: NaN,
  });
} else {
  for (const m of stripComments(twAnimations[1]).matchAll(
    /"([\w-]+)":\s*"([^"]+)"/g,
  )) {
    const [, name, decl] = m;
    const worst = Math.max(0, ...durations(decl));
    checked++;
    if (decl.includes("infinite")) {
      if (!INFINITE_OK[name]) {
        failures.push({
          selector: `tailwind animation.${name}`,
          prop: "animation",
          value: decl,
          worst,
          infinite: true,
        });
      } else {
        exempted.push({
          selector: `tailwind animation.${name}`,
          prop: "animation",
          value: decl,
          worst,
          reason: INFINITE_OK[name],
        });
      }
      continue;
    }
    if (worst > BUDGET_MS)
      failures.push({
        selector: `tailwind animation.${name}`,
        prop: "animation",
        value: decl,
        worst,
      });
  }
}

/* ── 3b. framework animations the two files above cannot see ──────────────── */

/**
 * Every `animate-<name>` used in the client, minus the ones this project
 * declares. Whatever is left came from Tailwind's base theme and needs a stated
 * reason in FRAMEWORK_OK.
 */
const declaredAnimations = new Set([
  // …from the Tailwind scale (`animation: { "fade-in": … }`)…
  ...(twAnimations
    ? [...stripComments(twAnimations[1]).matchAll(/"([\w-]+)":/g)].map(
        (m) => m[1],
      )
    : []),
  // …and from index.css, where a couple are written as plain classes
  // (`.animate-fade-up { animation: … }`) rather than through the config.
  // Both are already measured by sections 1 and 3; the point here is only to
  // recognise them as OURS so they are not reported as framework built-ins.
  ...[...stripComments(css).matchAll(/\.animate-([\w-]+)\s*\{/g)].map(
    (m) => m[1],
  ),
]);

const used = new Map();
for (const file of clientSources()) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/\banimate-([a-z][\w-]*)\b/g)) {
    if (declaredAnimations.has(m[1])) continue;
    if (!used.has(m[1])) used.set(m[1], relative(clientRoot, file));
  }
}

for (const [name, where] of used) {
  checked++;
  if (FRAMEWORK_OK[name]) {
    exempted.push({
      selector: `tailwind base .animate-${name}`,
      prop: "animation",
      value: "(framework)",
      worst: NaN,
      reason: FRAMEWORK_OK[name],
    });
  } else {
    failures.push({
      selector: `.animate-${name} (${where})`,
      prop: "animation",
      value: "Tailwind base theme — duration not declared in this repo",
      worst: NaN,
      framework: true,
    });
  }
}

/* ── 4. the reduced-motion umbrella ───────────────────────────────────────── */

const reducedMotion = [];

/**
 * ── F-3: THIS CHECK COULD BE MASKED, IN TWO WAYS ──────────────────────────
 *
 * `public-web`'s gate found both holes in this one and fixed them there; this
 * is the port back, which F-3 said was worth its own change and is overdue.
 *
 *   1. `css.match(…)` takes the FIRST reduced-motion block in the file. A
 *      stylesheet with several — this one has more than one — leaves every
 *      later block uninspected, so breaking one of them is invisible.
 *   2. `([\s\S]*?)\}` stops at the first `}`, which is the first NESTED
 *      close, not the block's own. Where a reduced-motion block opens with an
 *      inner rule the captured "body" is that inner rule and the universal
 *      selector underneath is never read at all.
 *
 * Both are fixed the way `public-web/scripts/check-motion.mjs` fixes them:
 * count braces rather than match non-greedily, and hold EVERY block that claims
 * the universal selector to the whole rule on its own.
 */
function reducedMotionBlocks(source) {
  const out = [];
  const opener = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{/g;
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

const rmBlocks = reducedMotionBlocks(css);
const globalBlocks = rmBlocks.filter(hasUniversalSelector);

if (rmBlocks.length === 0) {
  reducedMotion.push("There is no `prefers-reduced-motion: reduce` block at all.");
} else if (globalBlocks.length === 0) {
  reducedMotion.push(
    "No reduced-motion block uses the universal selector — the kill only reaches the rules someone remembered to name.",
  );
} else {
  globalBlocks.forEach((block, i) => {
    const label = globalBlocks.length > 1 ? ` (global block ${i + 1})` : "";
    if (!/animation(?:-duration)?:\s*[^;]*!important/.test(block)) {
      reducedMotion.push(`Global block does not kill \`animation\` with !important${label}.`);
    }
    if (!/transition(?:-duration)?:\s*[^;]*!important/.test(block)) {
      reducedMotion.push(`Global block does not kill \`transition\` with !important${label}.`);
    }
    // BOTH pseudo-elements, not either. A kill that reaches `::before` and not
    // `::after` leaves every `::after` affordance animating, and this
    // stylesheet's focus underlines and arrow affordances are `::after`.
    for (const pseudo of ["*::before", "*::after"]) {
      if (!block.includes(pseudo)) {
        reducedMotion.push(
          `Global block does not reach \`${pseudo}\`${label} — those affordances keep animating.`,
        );
      }
    }
  });
}

/* ── report ───────────────────────────────────────────────────────────────── */

console.warn(`\nMotion budget — ${BUDGET_MS}ms in-app\n`);

for (const e of exempted) {
  // `NaN` is a framework animation whose duration is not declared in this repo,
  // so there is no number to print — the reason is the whole point of the line.
  const at = Number.isNaN(e.worst)
    ? "      —"
    : `${String(Math.round(e.worst)).padStart(6)}ms`;
  console.warn(`  ALLOW ${at}  ${e.selector}  — ${e.reason}`);
}
console.warn(
  `\n  ${checked} declaration(s) checked, ${exempted.length} exempt.`,
);

if (reducedMotion.length) {
  console.error("\n✗ prefers-reduced-motion is no longer honoured globally:");
  for (const r of reducedMotion) console.error(`    ${r}`);
} else {
  console.warn(
    "  prefers-reduced-motion: global kill present, covers animation + transition + pseudo-elements.",
  );
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} motion declaration(s) over budget:\n`);
  for (const f of failures) {
    const why = f.infinite
      ? "loops forever with no entry in INFINITE_OK"
      : f.framework
        ? "a framework animation with no entry in FRAMEWORK_OK — this file cannot read its duration, so it must be reasoned about by hand"
        : `${Math.round(f.worst)}ms > ${BUDGET_MS}ms`;
    console.error(
      `    ${f.selector}  { ${f.prop}: ${f.value.trim()} }  — ${why}` +
        (f.file ? `\n      ${f.file}` : ""),
    );
  }
  console.error(
    "\n  Entrance motion on a screen opened dozens of times a day should be\n" +
      "  imperceptible. If this surface genuinely is the exception, add it to\n" +
      "  EXEMPT in scripts/check-motion.mjs with the reason — do not raise the\n" +
      "  budget.\n",
  );
}

process.exit(failures.length || reducedMotion.length ? 1 : 0);
