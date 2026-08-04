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
 * basePaths that more than one module is allowed to share.
 *
 * EMPTY, and it should stay that way. It exists so that if a collision is ever
 * a deliberate design decision, it has to be written down here with a reason
 * rather than discovered in production.
 *
 * "/inbound" was grandfathered here for part of 2026-08-04 while
 * sales/inbound_intake and wms/inbound both claimed it (audit API F-6). Sales
 * has since moved to "/intake" and the entry is gone. Adding one back should
 * feel like a decision, because it is.
 */
const ALLOWED_SHARED_BASEPATHS = new Set();

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
  const byBasePath = new Map();

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
    // Fail at boot, not in production. A collision is a five-second fix while
    // you are looking at it and a very expensive one six months later.
    const prior = byBasePath.get(basePath);
    if (prior && !ALLOWED_SHARED_BASEPATHS.has(basePath)) {
      throw new Error(
        `Duplicate tenant basePath "${basePath}": ${prior} and ${name} both mount it. ` +
          "Two modules on one namespace shadow each other's routes and enforce different " +
          "permissions on the same URL. Give one of them its own basePath, or add the path " +
          "to ALLOWED_SHARED_BASEPATHS with a reason.",
      );
    }
    byBasePath.set(basePath, name);

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
  ALLOWED_SHARED_BASEPATHS,
  MODULES_DIR,
};
