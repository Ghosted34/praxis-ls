#!/usr/bin/env node
/**
 * Fail CI when a write route accepts a body that nothing validates.
 *
 * Audit SEC H3 (High) asked for exactly this: "Add a lint rule or test
 * forbidding `passthrough` on any write route."
 *
 * WHY A GUARD AND NOT JUST THE FIX
 *
 * The runtime damage is already contained: `query-helpers` validates and quotes
 * every identifier, and the eight control-plane repos declare a `writable`
 * allow-list. But both of those are things a future module has to opt into or
 * inherit, and the original defect was not that anyone chose badly — it was
 * that `passthrough` LOOKED like a validator. It is named like one, it is
 * imported from `shared/http/validate`, and it sits in the slot a validator
 * sits in. The next person adding a module will reach for it for the same
 * reason the last ten did.
 *
 * WHAT IS CHECKED
 *
 * A module fails if it mounts a POST/PUT/PATCH route whose handler chain
 * contains no validator middleware, AND its repo does not declare `writable`.
 * Either one is sufficient protection: a zod schema strips unknown keys, and an
 * allow-list rejects them. Requiring both would be noise.
 *
 * Bodyless writes are the common false positive — `POST /:id/publish`,
 * `POST /:id/lift` — so a route is only flagged when the handler it actually
 * dispatches to reads `req.body`. See handlerReadsBody: resolution is per
 * route, not per file, because the per-file version flagged 41 routes and a
 * guard that cries wolf forty times gets deleted.
 *
 *   node scripts/check-write-route-validators.js
 *
 * Exit 1 on any violation.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MODULES = path.join(ROOT, "src", "modules");

/** `router.post("/x", a, b, controller.y)` — capture method, path, chain. */
const ROUTE_RE = /\b(\w+)\.(post|put|patch)\(\s*(['"`])(.*?)\3\s*,([^;]*?)\)\s*;/gs;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".routes.js")) out.push(p);
  }
  return out;
}

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");

/**
 * Does the named controller export read `req.body`?
 *
 * Per-ROUTE, not per-module. A first version asked whether the controller FILE
 * mentioned `req.body` anywhere and flagged 41 routes, nearly all of them
 * bodyless actions — `POST /read-all`, `POST /:id/clock-out`,
 * `POST /tenants/:slug/suspend`. A guard that cries wolf 40 times gets deleted,
 * so it has to resolve the actual handler.
 *
 * Controllers here are written as object properties or `const` bindings:
 *
 *   clockOut: asyncHandler(async (req, res) => …),
 *   const settingTest = asyncHandler(async (req, res) => …);
 *
 * Both are matched by scanning from the name to the start of the next
 * top-level binding. Crude, but it fails SAFE: if the handler cannot be found,
 * the route is treated as reading a body and gets flagged, so an unparseable
 * controller produces noise rather than silence.
 */
function handlerReadsBody(controllerSrc, fnName) {
  if (!fnName) return true;
  const patterns = [
    new RegExp(`\\b${fnName}\\s*:\\s*`),
    new RegExp(`\\bconst\\s+${fnName}\\s*=`),
    new RegExp(`\\bfunction\\s+${fnName}\\s*\\(`),
  ];
  for (const re of patterns) {
    const m = re.exec(controllerSrc);
    if (!m) continue;
    const rest = controllerSrc.slice(m.index);
    // Stop at the next top-level binding so we do not read the whole file.
    const nextIdx = rest.slice(1).search(/\n(?:const |function |\s{2}\w+: )/);
    const bodyText = nextIdx === -1 ? rest : rest.slice(0, nextIdx + 1);
    return /req\.body/.test(bodyText);
  }
  return true; // handler not found — fail safe
}

/**
 * Strip comments before matching routes.
 *
 * `ROUTE_RE` ends with `([^;]*?)\)\s*;` — the middleware chain, which may not
 * contain a semicolon, because a semicolon is where the statement ends. That is
 * right for code and wrong for prose, and a route whose chain carries an
 * explanatory comment containing a `;` cannot be parsed at all: the engine fails
 * at the semicolon, backtracks, and expands the ROUTE PATH group past its
 * closing quote until some later text happens to parse. The route is then
 * reported under a garbled path with its validator outside the captured chain —
 * a FALSE POSITIVE naming a route that is correctly validated.
 *
 * `mail/assist/assist.routes.js` hit exactly this. `POST /assist/compose` has a
 * full zod body schema, and a comment above one of its fields ends "...metering
 * buckets on it;". One semicolon, in prose, in the file where this guard had the
 * most to check.
 *
 * Stripped rather than the `[^;]` bound relaxed, because that bound is what
 * stops a chain running away into the rest of the file. Replaced with spaces
 * rather than deleted so every byte offset, and so every line number in a
 * report, still points where it did.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

const violations = [];

for (const routesFile of walk(MODULES)) {
  const dir = path.dirname(routesFile);
  const name = path.basename(routesFile).replace(".routes.js", "");
  const src = stripComments(read(routesFile));

  const repoSrc = read(path.join(dir, `${name}.repo.js`));
  if (/\bwritable\s*:\s*\[/.test(repoSrc)) continue;

  const controllerSrc = read(path.join(dir, `${name}.controller.js`));

  for (const m of src.matchAll(ROUTE_RE)) {
    const [, , method, , routePath, chain] = m;
    const chainText = chain.replace(/\s+/g, " ");

    const looksValidated =
      /\b(validator|validate|v)\.\w+/.test(chainText) ||
      /\bvalidate\(/.test(chainText) ||
      // A bare `validateSomething` identifier. preference.routes.js mounts
      // `validateAppearance`, a real zod validator, and the member-access
      // patterns above did not see it — a FALSE NEGATIVE in this checker, not a
      // gap in that route. Requires the camelCase suffix so it cannot match
      // `passthrough`, which is the no-op this whole guard exists to catch.
      /\bvalidate[A-Z]\w*\b/.test(chainText) ||
      // `params(` and `query(` alongside `body(`, because the failure message
      // this guard prints names all three ("give the route a zod validator
      // (src/shared/http/validate.js: body/query/params)") and only `body` was
      // ever accepted. A route with no body — `POST /extractions/:id/dismiss`
      // — cannot be fixed the way it is told to fix it, so the advice sends you
      // in a circle and the honest response looks indistinguishable from
      // ignoring the guard.
      /\b(params|query)\(/.test(chainText) ||
      /\bbody\(/.test(chainText);
    const isPassthrough = /\b(passthrough|noop)\b/.test(chainText);
    if (looksValidated && !isPassthrough) continue;

    // Inline handler defined in the routes file itself.
    if (/req\.body/.test(chainText)) {
      violations.push({ file: path.relative(ROOT, routesFile), route: `${method.toUpperCase()} ${routePath}` });
      continue;
    }
    // Otherwise resolve `controller.foo` / `c.foo` to the controller export.
    const handler = [...chainText.matchAll(/\b(?:controller|c|ctrl)\.(\w+)/g)].pop();
    const fnName = handler ? handler[1] : null;
    if (!handlerReadsBody(controllerSrc, fnName)) continue;

    violations.push({ file: path.relative(ROOT, routesFile), route: `${method.toUpperCase()} ${routePath}` });
  }
}

if (violations.length === 0) {
  console.warn("Write-route validators: every body-reading write route is validated or allow-listed.");
  process.exit(0);
}

console.warn(`${violations.length} write route(s) accept an unvalidated body:\n`);
const byFile = new Map();
for (const v of violations) {
  if (!byFile.has(v.file)) byFile.set(v.file, []);
  byFile.get(v.file).push(v.route);
}
for (const [file, routes] of byFile) {
  console.warn(`  ${file}`);
  for (const r of routes) console.warn(`      ${r}`);
}
console.warn(`
Fix either way:
  - give the route a zod validator (src/shared/http/validate.js: body/query/params), or
  - declare \`writable: [...]\` on the module's makeRepo config, which rejects
    any key outside the list.

SEC H3: without one of those, request-body keys reach insertOne/updateOne as
column identifiers. The identifier guard in query-helpers stops the injection
half; only a schema or an allow-list stops mass assignment.`);
process.exit(1);
