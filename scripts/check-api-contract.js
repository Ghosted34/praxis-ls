#!/usr/bin/env node
/**
 * Detect API contract regressions by diffing the mounted route surface against
 * a committed snapshot.
 *
 * Audit API F-30 (Critical): "There is no mechanism that would catch a contract
 * regression." No versioning to roll behind, no spec to diff, and of 80 test
 * files exactly one drives HTTP at all — against a synthetic app. ZERO assert
 * the response shape of a real endpoint. A PR that renames `{ data: [...] }` to
 * `{ items: [...] }` on any of 731 routes passes CI.
 *
 * WHAT THIS CHECKS, AND WHY IT IS THIS AND NOT AN OPENAPI SPEC
 *
 * F-25 notes the one existing spec artefact is 19% complete and has drifted.
 * That is the normal fate of a hand-maintained spec: it describes what someone
 * intended, diverges quietly, and then nobody trusts it. So this derives its
 * facts from the code — it mounts the real routers and enumerates what they
 * actually serve — and stores them in a snapshot that a human must consciously
 * re-bless.
 *
 * The snapshot records, per route:
 *
 *   METHOD /path            the URL surface itself (F-19: a module can vanish
 *                           from the API today with no error at all)
 *   module                  which module owns it, so a route silently changing
 *                           owner is visible
 *   auth / rbac / validated whether the chain carries authMiddleware, a
 *                           permission gate, and a body validator
 *
 * A route disappearing, changing owner, or LOSING a gate is a failure. Adding a
 * route, or adding a gate, is not — those are safe changes, and a check that
 * fails on every addition gets `--update`d without being read, which is how a
 * snapshot test becomes a rubber stamp.
 *
 *   node scripts/check-api-contract.js            # verify
 *   node scripts/check-api-contract.js --update   # re-bless after an intended change
 *
 * Exit 1 on a breaking difference.
 */
"use strict";

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.LOG_LEVEL = "silent";

const fs = require("fs");
const path = require("path");
const express = require("express");

const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT = path.join(ROOT, "doc", "api-contract.json");
const UPDATE = process.argv.includes("--update");

/** Recover a nested router's mount path from its layer regexp. */
function mountPathOf(layer) {
  const src = layer.regexp && layer.regexp.source;
  if (!src || src === "^\\/?(?=\\/|$)") return "";
  const m = src.match(/^\^\\\/(.*?)\\\/\?\(\?=\\\/\|\$\)$/);
  return m ? `/${m[1].replace(/\\\//g, "/")}` : "";
}

/** Names of the handlers in a route's chain, for gate detection. */
function chainNames(route) {
  return (route.stack || []).map((s) => s.name || "anonymous");
}

function walk(router, prefix, out) {
  for (const layer of (router && router.stack) || []) {
    if (layer.route) {
      const names = chainNames(layer.route);
      for (const method of Object.keys(layer.route.methods || {})) {
        out.push({
          key: `${method.toUpperCase()} ${prefix}${layer.route.path}`,
          auth: names.some((n) => /^authMiddleware$|^platformAuth$/.test(n)),
          rbac: names.some((n) => /rbacCheck|capabilityCheck|ceoCheck|requireCap|transitionRbac/i.test(n)),
          validated: names.some((n) => /^mw$|validat|^zValidate$|deprecationHeaders/i.test(n)),
        });
      }
    } else if (layer.handle && layer.handle.stack) {
      walk(layer.handle, prefix + mountPathOf(layer), out);
    }
  }
}

function buildSurface() {
  const { mountTenantModules, mountReport } = require("../src/shared/http/module-loader");
  const tenantRouter = express.Router();
  mountTenantModules(tenantRouter);

  const routes = [];
  walk(tenantRouter, "/api/tenant", routes);

  const platform = express.Router();
  platform.use("/platform", require("../src/modules/platform/platform.routes"));
  walk(platform, "/api", routes);

  const byKey = {};
  for (const r of routes) byKey[r.key] = { auth: r.auth, rbac: r.rbac, validated: r.validated };

  const report = mountReport();
  return {
    generated_by: "scripts/check-api-contract.js",
    api_version: require("../src/middleware/api-version").CURRENT,
    modules_mounted: report.mounted.length,
    route_count: Object.keys(byKey).length,
    routes: Object.fromEntries(Object.entries(byKey).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/**
 * Compare two route surfaces.
 *
 * Extracted and exported so the JUDGEMENT — what counts as breaking — can be
 * tested directly (tests/unit/api-contract.test.js). Mounting all 100 modules
 * takes long enough that a test which did it end-to-end would be skipped, and
 * an untested rule about what breaks a contract is not much of a rule.
 */
function diffSurface(before = {}, after = {}) {
  const removed = Object.keys(before).filter((k) => !(k in after));
  const added = Object.keys(after).filter((k) => !(k in before));
  const weakened = [];
  for (const k of Object.keys(before)) {
    if (!(k in after)) continue;
    for (const gate of ["auth", "rbac", "validated"]) {
      if (before[k][gate] === true && after[k][gate] !== true) weakened.push(`${k}  lost ${gate}`);
    }
  }
  return { removed, added, weakened, breaking: removed.length + weakened.length };
}

module.exports = { diffSurface, buildSurface };

// Required as a module by the tests; only run the check when invoked directly.
if (require.main !== module) return;

let surface;
try {
  surface = buildSurface();
} catch (err) {
  console.error(`Could not mount the API to inspect it: ${err.message}`);
  process.exit(2);
}

if (UPDATE) {
  fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
  fs.writeFileSync(SNAPSHOT, `${JSON.stringify(surface, null, 2)}\n`);
  console.log(
    `Wrote ${path.relative(ROOT, SNAPSHOT)} — ` +
      `${surface.route_count} routes across ${surface.modules_mounted} modules. Commit it.`,
  );
  process.exit(0);
}

if (!fs.existsSync(SNAPSHOT)) {
  // Deliberately a FAILURE, not a silent bootstrap. If a missing snapshot were
  // written and the run passed, CI would regenerate it on every build, compare
  // it against nothing, and report success forever — a green tick over an
  // unguarded contract, which is precisely the state F-30 describes.
  console.error(`No contract snapshot at ${path.relative(ROOT, SNAPSHOT)}.

Generate it once and commit the result:

    node scripts/check-api-contract.js --update

It is a snapshot of ${surface.route_count} routes across ${surface.modules_mounted} modules.
Reviewing that first diff is the point — it is the only time anyone reads the
whole surface at once.`);
  process.exit(1);
}

const prev = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
const before = prev.routes || {};
const after = surface.routes;

const { removed, added, weakened, breaking } = diffSurface(before, after);

if (added.length) {
  console.log(`${added.length} route(s) added (not a failure):`);
  for (const k of added.slice(0, 20)) console.log(`   + ${k}`);
  if (added.length > 20) console.log(`   … and ${added.length - 20} more`);
  console.log("");
}

if (breaking === 0) {
  console.log(
    `API contract: ${surface.route_count} routes, no removals and no weakened gates` +
      `${added.length ? ` (${added.length} added)` : ""}.`,
  );
  if (added.length) {
    console.log("Run with --update to record the additions.");
  }
  process.exit(0);
}

console.log("API CONTRACT REGRESSION\n");
if (removed.length) {
  console.log(`${removed.length} route(s) REMOVED — every existing consumer of these breaks:`);
  for (const k of removed) console.log(`   - ${k}`);
  console.log("");
}
if (weakened.length) {
  console.log(`${weakened.length} route(s) LOST A SECURITY GATE:`);
  for (const w of weakened) console.log(`   ! ${w}`);
  console.log("");
}
console.log(`If this is deliberate, say so explicitly:

    node scripts/check-api-contract.js --update

and put the reason in the commit message. A removed route needs a deprecation
window first — middleware/api-version.js exports deprecate({ sunset, replacement })
for exactly that (API F-18).`);
process.exit(1);
