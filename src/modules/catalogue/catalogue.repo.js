/**
 * Data access for the module catalogue. Reads from the PLATFORM db
 * (platform.module_catalogue — tenant-agnostic reference data) via the platform
 * pool rather than a tenant client. SQL lives here per CONVENTIONS.md.
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
