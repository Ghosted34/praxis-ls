#!/usr/bin/env node
/** Create + migrate the PLATFORM database and seed the catalogue.
 *  Thin CLI wrapper over the provisioning service (terminal-only infra op).
 *  Usage: npm run db:migrate:platform */
"use strict";
const { migratePlatform } = require("../../src/services/platform/provisioning.service");
migratePlatform()
  .then((r) => { console.warn(`[praxis-db] platform migrated (${r.applied} files) ✓`); process.exit(0); })
  .catch((e) => {
    // AggregateError (multi-address connect failures) has an EMPTY .message —
    // print the real causes or the whole error, never a blank line.
    const causes = e && e.errors ? " — " + e.errors.map((x) => x.message || x.code).join("; ") : "";
    console.error("[praxis-db] platform migration FAILED:", (e.message || e.code || String(e)) + causes);
    process.exit(1);
  });
