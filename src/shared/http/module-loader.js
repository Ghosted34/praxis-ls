/**
 * Auto-discovers tenant feature modules and mounts them on the tenant router,
 * feature-gated. Two supported layouts (module folders are snake_case):
 *   nested  : src/modules/<group>/<module>/<module>.routes.js
 *   flat    : src/modules/<module>/<module>.routes.js   (standalone module)
 * A dir with module SUBFOLDERS is a group (its own <dir>.routes.js is ignored);
 * a dir with no module subfolders but a matching <dir>.routes.js is a standalone
 * module. Each routes file exports { basePath, feature, router }. A module whose
 * require() throws is skipped with a warning so one bad module can't crash boot.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { requireFeature } = require("../../middleware/feature-gate");
const { logger } = require("../../config/logger");
const { idParamGuard } = require("./validate");

const MODULES_DIR = path.resolve(__dirname, "../../modules");
const GROUP_SKIP = new Set(["platform"]);
const NAME_RE = /^[a-z][a-z0-9_]*$/;

const exists = (p) => fs.existsSync(p);
const subdirs = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && NAME_RE.test(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
};

function discover() {
  const found = [];
  for (const top of subdirs(MODULES_DIR)) {
    if (GROUP_SKIP.has(top)) continue;
    const groupDir = path.join(MODULES_DIR, top);
    // nested modules under a group
    let nested = false;
    for (const mod of subdirs(groupDir)) {
      const rf = path.join(groupDir, mod, `${mod}.routes.js`);
      if (exists(rf)) {
        found.push({ group: top, module: mod, routesFile: rf });
        nested = true;
      }
    }
    // standalone (flat) module: only when the dir has no nested modules
    if (!nested) {
      const rf = path.join(groupDir, `${top}.routes.js`);
      if (exists(rf)) found.push({ group: "(standalone)", module: top, routesFile: rf });
    }
  }
  return found;
}

/**
 * Recover the mount path of a nested sub-router from its layer regexp, so a
 * module that composes several routers (app_user mounts /users and /auth)
 * reports its real URLs rather than the sub-paths alone.
 */
function mountPathOf(layer) {
  const s = layer.regexp && layer.regexp.source;
  if (!s || s === "^\\/?(?=\\/|$)") return "";
  const m = s.match(/^\^\\\/(.*?)\\\/\?\(\?=\\\/\|\$\)$/);
  return m ? "/" + m[1].replace(/\\\//g, "/") : "";
}

/** Every `METHOD /path` a router serves, relative to its basePath. */
function routeKeys(router, prefix = "") {
  const out = [];
  for (const layer of (router && router.stack) || []) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods || {})) {
        out.push(`${method.toUpperCase()} ${prefix}${layer.route.path}`);
      }
    } else if (layer.handle && layer.handle.stack) {
      out.push(...routeKeys(layer.handle, prefix + mountPathOf(layer)));
    }
  }
  return out;
}

/**
 * API F-16. Bind the id guard to every router a module mounts, including nested
 * ones (app_user composes /users and /auth).
 *
 * `router.param` is the only public Express hook that fires between "the route
 * matched" and "the handler runs" and knows the parameter value. It does NOT
 * cascade from a parent router to a child, which is why this walks the stack
 * rather than being registered once on the tenant router.
 *
 * A module opts out with `idParam: "text"` when its id genuinely is not a uuid
 * or a number — chart_of_accounts is addressed by account code, currency by
 * ISO code, feature_state by feature key.
 */
function bindIdGuard(router, seen = new Set()) {
  if (!router || typeof router.param !== "function" || seen.has(router)) return;
  seen.add(router);
  for (const name of ID_PARAM_NAMES) router.param(name, idParamGuard);
  for (const layer of router.stack || []) {
    if (layer.handle && layer.handle.stack) bindIdGuard(layer.handle, seen);
  }
}

/**
 * Path parameters that name a row. Deliberately NOT :slug, :code, :key,
 * :section, :provider, :docType or :vendor — those are legitimately free text
 * and guarding them would reject valid requests.
 */
const ID_PARAM_NAMES = ["id", "userId", "dossierId", "messageId", "stepId", "lineId",
  "attendeeId", "applicantId", "siteId", "itemId", "entryId"];

/**
 * The last mount result, for the readiness probe and the CI manifest check.
 * @type {{ mounted: string[], skipped: Array<{module: string, error: string}> }}
 */
let lastMount = { mounted: [], skipped: [] };

/** What the loader actually mounted on the most recent call. */
function mountReport() {
  return lastMount;
}

function mountTenantModules(tenantRouter) {
  const mounted = [];
  const skipped = [];
  const byRoute = new Map();

  for (const m of discover()) {
    const name = `${m.group}/${m.module}`;
    let def;
    try {
      // dynamic require: module path is discovered at runtime (trusted, local)
      def = require(m.routesFile);
    } catch (err) {
      // API F-19 (2026-08-04): this used to warn and continue, silently. A typo
      // in one module's dependency chain removed its ENTIRE route family from a
      // running deployment, and consumers got 404 NOT_FOUND — indistinguishable
      // from "you got the URL wrong". The rationale (one bad module must not
      // crash boot) is sound and is kept; the missing half was that nothing
      // recorded the loss. It is now recorded, surfaced on /api/health/ready,
      // and logged at ERROR rather than WARN, because a missing module IS an
      // outage of that module.
      logger.error({ module: name, err: err.message }, "SKIPPED MODULE (load error) — its routes are absent from this process");
      skipped.push({ module: name, error: err.message });
      continue;
    }
    if (!def || !def.router) continue;

    const basePath = def.basePath || `/${m.module}`;

    // API F-6 (2026-08-04): `sales/inbound_intake` and `wms/inbound` BOTH
    // declared basePath "/inbound". Express mounts each in discovery order and
    // falls through from the first router to the second, so it worked purely
    // because their path sets happened to be disjoint — while enforcing
    // different permission modules (MOD-25 vs MOD-33) and different feature
    // gates (feature:null vs feature:"wms") on one namespace. The day either
    // module adds a route the other already has, one silently shadows the other.
    //
    // The check is on the RESOLVED URL, not on basePath.
    //
    // A shared basePath is not by itself a bug: three modules legitimately mount
    // at "/" (app_user → /users + /auth, workflow → /workflows,
    // treasury_account → /treasury-accounts) and their URLs never overlap. The
    // audit records this as API F-9. An earlier version of this guard rejected
    // any duplicate basePath, which meant boot threw on those three and the
    // container never came up — a self-inflicted outage in the name of
    // preventing one.
    //
    // What actually matters is two modules answering the SAME method+path,
    // because then one silently shadows the other under a different permission
    // module. That is what is rejected here, and it would still have caught
    // /inbound the moment the two path sets overlapped.
    for (const key of routeKeys(def.router, basePath === "/" ? "" : basePath)) {
      const prior = byRoute.get(key);
      if (prior) {
        throw new Error(
          `Duplicate tenant route "${key}": mounted by both ${prior} and ${name}. ` +
            "Whichever the module loader reaches first wins and the other is dead code, " +
            "enforcing a different permission module on the same URL. Give one of them a " +
            "distinct path.",
        );
      }
      byRoute.set(key, name);
    }

    // API F-16: a malformed id used to reach Postgres and come back as a
    // 22P02 mapped to `400 INVALID_VALUE` with no `fields` and no indication
    // the problem was in the path. Now it is a 422 that names the parameter.
    if (def.idParam !== "text") bindIdGuard(def.router);

    const chain = def.feature ? [requireFeature(def.feature)] : [];
    tenantRouter.use(basePath, ...chain, def.router);
    mounted.push(name);
    logger.info({ group: m.group, module: m.module, basePath }, "mounted tenant module");
  }

  if (skipped.length) {
    logger.error(
      { skipped: skipped.map((s) => s.module), count: skipped.length },
      "one or more tenant modules failed to load — this process is serving an INCOMPLETE API",
    );
  }

  lastMount = { mounted, skipped };
  return mounted;
}

module.exports = {
  discover,
  mountTenantModules,
  mountReport,
  routeKeys,
  MODULES_DIR,
};
