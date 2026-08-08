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

// `portalAuthCheck` is the external portal's authenticator. It used to be an
// anonymous function, which made the whole portal surface read as public — see
// the note in portal_auth.middleware.js. It both authenticates AND checks the
// portal grant, so it counts as `rbac` too: a portal route is not "logged in
// with no permission check", it is gated by the grant.
const IS_AUTH = (n) => /^authMiddleware$|^platformAuth$|^portalAuthCheck$/.test(n);
const IS_RBAC = (n) => /rbacCheck|capabilityCheck|ceoCheck|requireCap|transitionRbac|portalAuthCheck|platformRoleCheck|platformCapCheck/i.test(n);
const IS_VALID = (n) => /^mw$|validat|^zValidate$|deprecationHeaders/i.test(n);

/**
 * API-F23 / SEC-L5 — the walk now carries ROUTER-LEVEL middleware down to the
 * routes it actually protects.
 *
 * THE BUG THIS FIXES, and it is the reason F23 sat open. The old walk read
 * `auth`/`rbac` from each route's OWN stack. Almost every router in this
 * codebase authenticates once at the top:
 *
 *     router.use(authMiddleware);        // applies to everything below
 *     router.get("/mine", controller.mine);   // its own stack: [controller]
 *
 * That `use` layer has no `.route` and its `.handle` has no `.stack`, so the
 * old walk hit neither branch and dropped it on the floor. Result: hundreds of
 * authenticated routes recorded as `auth: false`. A first attempt to publish an
 * access-tier table from those flags produced "713 public, 9 self-scoped"
 * against an audit count of 10 and 61 — a SECURITY document that lied, which is
 * why it was never shipped.
 *
 * `inherited` accumulates IN ORDER, which is also correct rather than merely
 * convenient: Express applies a `use` only to routes registered after it, so a
 * router that mounts a public route before its `authMiddleware` line still
 * reports that route as public. That ordering is the real behaviour, and it is
 * exactly the mistake worth catching.
 */
function walk(router, prefix, out, inherited = []) {
  const carried = [...inherited];
  for (const layer of (router && router.stack) || []) {
    if (layer.route) {
      const names = [...carried, ...chainNames(layer.route)];
      for (const method of Object.keys(layer.route.methods || {})) {
        out.push({
          key: `${method.toUpperCase()} ${prefix}${layer.route.path}`,
          auth: names.some(IS_AUTH),
          rbac: names.some(IS_RBAC),
          validated: names.some(IS_VALID),
        });
      }
    } else if (layer.handle && layer.handle.stack) {
      // A nested router — descend, carrying everything applied above it.
      walk(layer.handle, prefix + mountPathOf(layer), out, carried);
    } else if (layer.handle && typeof layer.handle === "function") {
      // Router-level middleware: `router.use(fn)`. This is the case the old
      // walk ignored, and it is where auth actually lives.
      carried.push(layer.handle.name || "anonymous");
    }
  }
}

/**
 * The access tier of a route — the thing F23 says exists in practice and is
 * declared nowhere.
 *
 *   public       no authentication at all
 *   self-scoped  authenticated, no permission grant required. NOT a gap: these
 *                only ever act on the caller's own data, so there is nothing to
 *                grant. `GET /appraisals/mine` and `POST /sessions/:id/kill`
 *                are the shape — the latter enforces its rule in the SERVICE
 *                (self allowed, otherwise MOD-68 can_update), which is exactly
 *                why "no requirePermission on the route" cannot be read as a
 *                finding on its own.
 *   gated        authenticated and permission-checked
 *
 * Making the tier explicit is the whole point: today the only thing separating
 * "self-scoped by design" from "someone forgot the permission check" is a prose
 * comment, and a convention nobody can query is not a control.
 */
function tierOf(route) {
  if (!route.auth) return "public";
  return route.rbac ? "gated" : "self-scoped";
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
  for (const r of routes) {
    byKey[r.key] = { auth: r.auth, rbac: r.rbac, validated: r.validated, tier: tierOf(r) };
  }

  const report = mountReport();
  const tiers = { public: 0, "self-scoped": 0, gated: 0 };
  for (const v of Object.values(byKey)) tiers[v.tier] += 1;

  return {
    generated_by: "scripts/check-api-contract.js",
    api_version: require("../src/middleware/api-version").CURRENT,
    modules_mounted: report.mounted.length,
    route_count: Object.keys(byKey).length,
    // API-F23 — the access tiers, counted. Published so a wrong number is
    // visible in a diff rather than discovered by a consumer.
    tiers,
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
//
// This was `if (require.main !== module) return;` — a TOP-LEVEL return, which
// node tolerates (a CommonJS module is wrapped in a function) and babel does
// not. Jest transforms every required file through babel, so the moment
// tests/unit/api-contract.test.js required this for `diffSurface`, the whole
// suite failed to parse with "'return' outside of function". The script itself
// worked perfectly from the CLI, which is why nothing noticed.
function main() {

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
    console.warn(
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
    console.warn(`${added.length} route(s) added (not a failure):`);
    for (const k of added.slice(0, 20)) console.warn(`   + ${k}`);
    if (added.length > 20) console.warn(`   … and ${added.length - 20} more`);
    console.warn("");
  }

  if (breaking === 0) {
    console.warn(
      `API contract: ${surface.route_count} routes, no removals and no weakened gates` +
        `${added.length ? ` (${added.length} added)` : ""}.`,
    );
    if (added.length) {
      console.warn("Run with --update to record the additions.");
    }
    process.exit(0);
  }

  console.warn("API CONTRACT REGRESSION\n");
  if (removed.length) {
    console.warn(`${removed.length} route(s) REMOVED — every existing consumer of these breaks:`);
    for (const k of removed) console.warn(`   - ${k}`);
    console.warn("");
  }
  if (weakened.length) {
    console.warn(`${weakened.length} route(s) LOST A SECURITY GATE:`);
    for (const w of weakened) console.warn(`   ! ${w}`);
    console.warn("");
  }
  console.warn(`If this is deliberate, say so explicitly:

      node scripts/check-api-contract.js --update

  and put the reason in the commit message. A removed route needs a deprecation
  window first — middleware/api-version.js exports deprecate({ sunset, replacement })
  for exactly that (API F-18).`);
  process.exit(1);
}

if (require.main === module) main();
