/**
 * Read-only module catalogue for tenant-side screens (the permission
 * grant-matrix needs the full MOD-xx list with names + groups). The catalogue
 * lives in the PLATFORM db (platform.module_catalogue), not the tenant db, and
 * it's tenant-agnostic reference data — so this reads it via the platform pool
 * rather than req.tenantDb. Exposed read-only, gated (MOD-67 view).
 */
"use strict";

const platformDb = require("../../services/platform/db");

async function listModules() {
  const { rows } = await platformDb.query(
    `SELECT module_key, group_key, name, sort_order
       FROM platform.module_catalogue
      ORDER BY sort_order, module_key`,
  );
  return rows;
}

module.exports = { listModules };
