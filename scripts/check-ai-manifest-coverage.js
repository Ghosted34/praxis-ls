#!/usr/bin/env node
/**
 * AI manifest coverage — every module the app exposes is reachable by the AI,
 * or says in writing that it is not.
 *
 * ── WHY THIS IS A GATE ──────────────────────────────────────────────────────
 *
 * `doc/AI_ARCHITECTURE.md` §0 states the thesis the whole AI layer rests on:
 * "the app is the AI's toolbox — the tool catalogue is generated from the
 * modules, so AI capability always equals app capability with zero drift."
 *
 * That was aspirational. The catalogue is derived from `<module>.ai.js`
 * manifests, and NOTHING checked that a module had one. So a module shipped,
 * its screens went live, and the assistant simply could not see it — silently,
 * with no failing test and no red build. The audit measured the result
 * (`doc/PRAXIS_AI_AUDIT.md` I3): 38 of 119 modules with a controller had no
 * manifest, several of them built AFTER Praxis AI shipped. "Everything is
 * connected to AI" was not true, and nothing in the repository could tell.
 *
 * This gate is what makes the thesis enforceable. A module with a public
 * controller must either declare its AI surface or carry an explicit, reviewed
 * opt-out. Both are a decision; neither is a default.
 *
 * ── WHAT COUNTS AS COVERED ──────────────────────────────────────────────────
 *
 *   1. A `<module>.ai.js` manifest in the module folder (AI_ARCHITECTURE §2), OR
 *   2. An `// ai:none <reason>` marker in the module's controller — the opt-out
 *      CLAUDE.md names. The REASON IS REQUIRED: a bare `// ai:none` is rejected,
 *      because the point of the marker is that somebody decided and said why.
 *
 * The opt-out lives in the controller on purpose. The controller is the file
 * that makes a module publicly reachable, so it is the file whose diff should
 * prompt "and the AI?" — and it is the one a reviewer already opens.
 *
 * ── WHAT IS NOT A MODULE ────────────────────────────────────────────────────
 *
 * A folder that merely mounts its children's routers (`src/modules/ai`,
 * `src/modules/platform`) is a router aggregator, not a module: it owns no
 * service and no entity. Requiring a manifest of it would mean writing one for
 * a thing with no AI surface of its own, so those are skipped — but only when
 * they really are aggregators, which is tested rather than assumed: a folder is
 * one when it has sub-module children and no service/repo of its own.
 *
 *   node scripts/check-ai-manifest-coverage.js            # fail on a gap
 *   node scripts/check-ai-manifest-coverage.js --list     # print the state
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MODULES = path.join(ROOT, "src/modules");
const LIST = process.argv.includes("--list");

/** Every folder under src/modules that owns at least one controller. */
function modulesWithControllers(dir = MODULES, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  if (entries.some((e) => e.isFile() && e.name.endsWith(".controller.js"))) out.push(dir);
  for (const e of entries) if (e.isDirectory()) modulesWithControllers(path.join(dir, e.name), out);
  return out;
}

const filesIn = (dir) => fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
const hasChildModules = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).some(
    (e) => e.isDirectory() && fs.readdirSync(path.join(dir, e.name)).some((f) => f.endsWith(".controller.js")),
  );

/**
 * `// ai:none <reason>` in any of the module's controllers. The reason must be
 * real words, not punctuation — `// ai:none -` is the same non-decision as no
 * marker at all, and a gate that accepts it is theatre.
 */
const OPT_OUT = /\/\/\s*ai:none\b[ \t:—-]*(.*)$/m;
function optOut(dir, names) {
  for (const n of names.filter((f) => f.endsWith(".controller.js"))) {
    const m = fs.readFileSync(path.join(dir, n), "utf8").match(OPT_OUT);
    if (m) return { file: n, reason: (m[1] || "").trim() };
  }
  return null;
}

const wired = [], optedOut = [], aggregators = [], offenders = [], unexplained = [];

for (const dir of modulesWithControllers()) {
  const rel = path.relative(MODULES, dir).split(path.sep).join("/");
  const names = filesIn(dir);
  if (names.some((f) => f.endsWith(".ai.js"))) { wired.push(rel); continue; }

  const opt = optOut(dir, names);
  if (opt) {
    if (opt.reason.replace(/[^A-Za-z]/g, "").length < 8) unexplained.push({ rel, file: opt.file });
    else optedOut.push({ rel, reason: opt.reason });
    continue;
  }

  // A router aggregator owns no service or repo and has sub-modules under it.
  const ownsLogic = names.some((f) => f.endsWith(".service.js") || f.endsWith(".repo.js"));
  if (!ownsLogic && hasChildModules(dir)) { aggregators.push(rel); continue; }

  offenders.push(rel);
}

if (LIST) {
  console.warn(`\nAI manifest coverage — ${wired.length} wired, ${optedOut.length} opted out, ${aggregators.length} aggregator(s)\n`);
  for (const r of wired) console.warn(`  ai   ${r}`);
  for (const o of optedOut) console.warn(`  none ${o.rel}  — ${o.reason}`);
  for (const r of aggregators) console.warn(`  ---- ${r}  (router aggregator)`);
  for (const r of offenders) console.warn(`  GAP  ${r}`);
  process.exit(0);
}

if (!offenders.length && !unexplained.length) {
  console.warn(`[ai-coverage] ok — ${wired.length} modules wired, ${optedOut.length} explicitly opted out.`);
  process.exit(0);
}

console.error("\nAI MANIFEST COVERAGE FAILED\n");
if (offenders.length) {
  console.error(`${offenders.length} module(s) have a public controller but no AI surface and no opt-out:\n`);
  for (const r of offenders) console.error(`  · src/modules/${r}`);
  console.error(`
Each one is invisible to Praxis AI: the assistant cannot see it, answer about
it, or act on it. Pick one:

  · Add src/modules/<group>/<module>/<module>.ai.js declaring its reads and
    confirm-gated writes (doc/AI_ARCHITECTURE.md §2). Every write must conform
    to the execution contract — an inline wrapper mapping the AI's snake_case
    payload to the service's real argument shape and forwarding the FULL actor:
        (c, p, actor) => service.create(c, { data: p, actor })

  · Or, if the module genuinely has no AI surface (auth, session, RBAC, the AI
    layer itself, branding, preferences, the audit ledger), put an opt-out at
    the top of its controller WITH a reason:
        // ai:none — session lifecycle; the AI never issues or revokes a session.
`);
}
if (unexplained.length) {
  console.error(`${unexplained.length} opt-out(s) carry no reason:\n`);
  for (const u of unexplained) console.error(`  · src/modules/${u.rel}/${u.file}`);
  console.error("\nAn `// ai:none` with nothing after it records no decision. Say why.\n");
}
process.exit(1);
