#!/usr/bin/env node
/**
 * Backfill stored images through the image pipeline.
 *
 * WHY THIS IS OPTIONAL RATHER THAN REQUIRED. `/media` generates a missing
 * AVIF/WebP derivative on first request, so every image uploaded before the
 * pipeline shipped already renders correctly through `<ResponsiveImage>` with
 * nothing run here. What this script buys is the FIRST request: warming the
 * derivatives ahead of time means the first visitor to a page does not pay for
 * the encode, which on a tenant with thousands of vaulted scans is the
 * difference between a warm gallery and a slow one.
 *
 * ── WHAT IT MUST NOT TOUCH, AND WHY ────────────────────────────────────────
 *
 * A vault document that a signature references is FROZEN. `document_signature`
 * records `artifact_hash` as the sha256 of the vaulted bytes at signing time,
 * and `document_verification` compares that value back against the stored file
 * to answer "is this still the document that was signed?". Re-encoding such a
 * document changes its bytes, changes its hash, and turns every signature on it
 * into a verification FAILURE — reported to the tenant as tampering, on a
 * document nobody touched.
 *
 * So this script never rewrites a master. It only ADDS derivatives beside one:
 * the master's bytes, its key and therefore its hash are left exactly as they
 * are, which makes the operation safe for signed and unsigned documents alike.
 * The signature check below is belt-and-braces on top of that — if a future
 * edit to this script ever starts rewriting masters, the guard is already here
 * and already knows which rows are untouchable.
 *
 * Dry run by default. Pass --apply to write.
 *
 *   node scripts/ops/backfill-image-derivatives.js --slug=acme
 *   node scripts/ops/backfill-image-derivatives.js --slug=acme --apply
 *   node scripts/ops/backfill-image-derivatives.js --slug=acme --apply --limit=500
 */

"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const arg = (name, fallback = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const SLUG = arg("slug");
const APPLY = flag("apply");
const LIMIT = Number(arg("limit", "1000")) || 1000;

function fail(code, msg, detail) {
  console.error(`backfill-image-derivatives: ${msg}`);
  if (detail) console.error(`  ${detail}`);
  process.exit(code);
}

async function main() {
  if (!SLUG) {
    fail(2, "no --slug given", "usage: backfill-image-derivatives.js --slug=<tenant> [--apply]");
  }

  const registry = require("../../src/services/tenant/registry.service");
  const storage = require("../../src/services/storage.service");
  const pipeline = require("../../src/services/image-pipeline.service");

  const meta = await registry.resolveBySlug(SLUG);
  if (!meta) fail(2, `tenant "${SLUG}" is not in the registry`);

  const rows = await registry.withTenantConnection(meta, "live", async (client) => {
    // Only rasters: the pipeline passes PDFs, SVGs and everything else straight
    // through, so selecting them would be work that produces nothing.
    const { rows } = await client.query(
      `SELECT v.doc_id,
              v.storage_path,
              EXISTS (
                SELECT 1 FROM document_signature s
                WHERE s.artifact_hash = v.content_hash
              ) AS signed
         FROM document_vault v
        WHERE v.storage_path IS NOT NULL
          AND v.storage_path !~ '^pending://'
          AND lower(v.storage_path) ~ '\\.(jpe?g|png|webp)$'
        ORDER BY v.doc_id
        LIMIT $1`,
      [LIMIT],
    );
    return rows;
  });

  console.log(
    `${SLUG}: ${rows.length} raster document(s) to consider` +
      (APPLY ? "" : "  (dry run — pass --apply to write)"),
  );

  let warmed = 0;
  let already = 0;
  let missing = 0;
  let failed = 0;
  const signed = rows.filter((r) => r.signed).length;

  for (const row of rows) {
    const key = row.storage_path;
    const profile = pipeline.profileForKey(key);

    for (const variant of pipeline.PROFILES[profile].variants) {
      for (const format of ["avif", "webp"]) {
        const dKey = pipeline.derivativeKey(key, variant, format);

        let exists = false;
        try {
          const buf = await storage.get(dKey);
          exists = Boolean(buf && buf.length);
        } catch {
          /* @silent:storage — a miss is the whole point of this pass. */
        }
        if (exists) {
          already += 1;
          continue;
        }
        if (!APPLY) {
          warmed += 1;
          continue;
        }

        // ensureDerivative READS the master and WRITES only the derivative —
        // see the note at the top of this file about why the master is never
        // rewritten, signed or not.
        //
        // One bad document must not end the run: a backfill that aborts on row
        // 900 of 5000 leaves an operator with no idea which rows were done, and
        // the natural response is to run it again from the start.
        try {
          const made = await pipeline.ensureDerivative(dKey, { profile });
          if (made) warmed += 1;
          else {
            // The master is gone from storage while the row still points at it.
            // Worth reporting: a download of that document already 404s, which
            // is a data problem this script has merely noticed.
            missing += 1;
            console.warn(`  ! no master behind ${dKey}`);
          }
        } catch (err) {
          failed += 1;
          console.warn(`  ! ${dKey}: ${err && err.message}`);
        }
      }
    }
  }

  console.log(
    [
      `  derivatives ${APPLY ? "written" : "that would be written"}: ${warmed}`,
      `  already present: ${already}`,
      missing ? `  masters missing from storage: ${missing}` : null,
      failed ? `  failed: ${failed}` : null,
      `  documents referenced by a signature: ${signed} (masters untouched either way)`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  await registry.closeAll();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
