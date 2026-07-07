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

function mountTenantModules(tenantRouter) {
  const mounted = [];
  for (const m of discover()) {
    let def;
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      def = require(m.routesFile);
    } catch (err) {
      logger.warn({ module: `${m.group}/${m.module}`, err: err.message }, "skipped module (load error)");
      continue;
    }
    if (!def || !def.router) continue;
    const basePath = def.basePath || `/${m.module}`;
    const chain = def.feature ? [requireFeature(def.feature)] : [];
    tenantRouter.use(basePath, ...chain, def.router);
    mounted.push(`${m.group}/${m.module}`);
    logger.info({ group: m.group, module: m.module, basePath }, "mounted tenant module");
  }
  return mounted;
}

module.exports = { discover, mountTenantModules, MODULES_DIR };
