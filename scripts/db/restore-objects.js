#!/usr/bin/env node
/**
 * WS-B2 — restore a tenant's DOCUMENTS from the offsite copy.
 *
 * The inverse of `backup-tenant.js --objects`, and for a long time it did not
 * exist: files were copied offsite nightly and there was no way to copy them
 * back. That made the object backup an untested assertion about some bytes,
 * which is the exact thing §3.2 refuses to call a backup.
 *
 *   node scripts/db/restore-objects.js --slug=acme --dry-run
 *       What WOULD be restored. Writes nothing. Run this first — always.
 *
 *   node scripts/db/restore-objects.js --slug=acme
 *       Restore every document the database expects and primary storage is
 *       missing. Files that are already present are left alone.
 *
 *   node scripts/db/restore-objects.js --slug=acme --doc=<id> [--doc=<id>…]
 *       Just these. The usual case: one document someone deleted.
 *
 *   node scripts/db/restore-objects.js --slug=acme --force
 *       Overwrite files that ARE present with the offsite copy. Only for a
 *       known corruption — otherwise it replaces good files with older ones.
 *
 * ORDER: THE DATABASE COMES FIRST.
 *
 *   This reads the tenant's tables to learn which files should exist and what
 *   they should hash to, so it is step 3 of a recovery, not step 1:
 *
 *     1. restore-tenant.js --into=… --i-am-recovering   (the database)
 *     2. point the tenant at it, run outstanding migrations
 *     3. THIS                                            (the documents)
 *     4. backup-tenant.js --scan                         (prove it landed)
 *
 * Exit 1 if anything was missing offsite, failed a hash check, or could not be
 * written — those are the outcomes a person must not scroll past.
 */
"use strict";

const objects = require("../../src/services/platform/object-backup.service");
const registry = require("../../src/services/tenant/registry.service");
const platformDb = require("../../src/services/platform/db");

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => {
  const hit = argv.find((a) => a.startsWith(`--${f}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
};
/** Repeatable flag: --doc=a --doc=b. */
const vals = (f) =>
  argv.filter((a) => a.startsWith(`--${f}=`)).map((a) => a.split("=").slice(1).join("="));
const JSON_OUT = has("--json");

(async () => {
  try {
    const slug = val("slug");
    if (!slug) {
      console.warn(
        "usage: --slug=<tenant> [--dry-run] [--doc=<id> …] [--force] [--limit=<n>] [--json]",
      );
      process.exitCode = 2;
      return;
    }

    const metas = await registry.listActiveTenants();
    const meta = metas.find((t) => t.slug === slug);
    if (!meta) throw new Error(`no live tenant "${slug}"`);

    const docIds = vals("doc");
    const result = await objects.restoreTenantObjects(meta, {
      dryRun: has("--dry-run"),
      force: has("--force"),
      docIds: docIds.length ? docIds : null,
      limit: val("limit"),
    });

    if (JSON_OUT) {
      console.warn(JSON.stringify(result, null, 2));
    } else {
      console.warn(`\n${result.ok ? "OK" : "PROBLEMS"} — ${slug}${result.dry_run ? " (dry run — nothing written)" : ""}`);
      console.warn(`  documents considered : ${result.considered ?? 0}`);
      console.warn(`  restored             : ${result.restored}`);
      console.warn(`  already present      : ${result.skipped}`);
      if (result.unverified) {
        console.warn(`  restored unverified  : ${result.unverified} (no hash was ever recorded for these)`);
      }
      for (const m of result.missing_offsite || []) {
        console.warn(`  MISSING OFFSITE  ${m.source} ${m.storage_path} — no copy exists anywhere`);
      }
      for (const m of result.mismatched || []) {
        console.warn(`  HASH MISMATCH    ${m.source} ${m.storage_path} — offsite copy is corrupt, NOT restored`);
      }
      for (const m of result.failed || []) {
        console.warn(`  WRITE FAILED     ${m.storage_path} — ${m.error}`);
      }
      if (result.error) console.warn(`  error: ${result.error}`);
      if (result.ok && !result.dry_run) {
        console.warn("\nNow run: npm run db:objects:scan   (confirms every row has its file back)");
      }
    }

    process.exitCode = result.ok ? 0 : 1;
  } catch (err) {
    console.warn(`error: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await registry.closeAll().catch(() => {});
    await platformDb.close().catch(() => {});
  }
})();
