/**
 * Read-only module catalogue for tenant-side screens (the permission
 * grant-matrix needs the full MOD-xx list with names + groups). SQL lives in
 * catalogue.repo (reads platform.module_catalogue via the platform pool).
 */
"use strict";

const repo = require("./catalogue.repo");

module.exports = { listModules: () => repo.listModules() };
