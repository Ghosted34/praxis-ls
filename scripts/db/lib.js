/**
 * Back-compat shim. The migration/provisioning logic now lives in
 * src/services/platform/migrator.js (so both the CLI and the dashboard API share
 * it). This file re-exports it to avoid duplication; prefer importing the
 * service directly in new code.
 */
"use strict";
const migrator = require("../../src/services/platform/migrator");
const log = (...a) => console.log("[praxis-db]", ...a); // eslint-disable-line no-console
module.exports = { ...migrator, log };
