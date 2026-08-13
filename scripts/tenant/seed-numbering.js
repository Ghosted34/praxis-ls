#!/usr/bin/env node
/**
 * Seed a tenant's document-numbering schemes (setting section='numbering',
 * key=<module_key>) so issued documents render human numbers with a meaningful
 * prefix — INV-2026-0001, PO-2026-0007 — instead of the generic fallback the
 * numbering service uses when no scheme is configured (DOC-<mod>-<year>-nnnn,
 * see services/documents/numbering.service.js DEFAULTS + schemeFor()).
 *
 *   node scripts/tenant/seed-numbering.js --slug=smartls            # SANDBOX only
 *   node scripts/tenant/seed-numbering.js --slug=smartls --live     # + live schema
 *   node scripts/tenant/seed-numbering.js --slug=smartls --force    # overwrite existing
 *
 * SANDBOX-ONLY by default so a TEST run never rewrites the numbering a live
 * tenant already customised. Idempotent: by default only keys NOT already set
 * are written (a tenant's own schemes are never clobbered); --force overwrites.
 *
 * Each scheme sets code:"" on purpose — schemeFor() defaults `code` to the raw
 * module number, and formatNumber() emits prefix→code→year→seq; leaving code
 * non-empty would yield "INV-51-2026-0001". Empty code → "INV-2026-0001".
 * padding/reset are shape-checked by security/setting/setting.rules.js.
 */
"use strict";

const m = require("../../src/services/platform/migrator");

const args = Object.fromEntries(
  process.argv.slice(2).map((s) => {
    const mm = s.match(/^--([^=]+)=(.*)$/);
    return mm ? [mm[1], mm[2]] : [s.replace(/^--/, ""), true];
  }),
);

const slug = args.slug;
if (!slug) {
  console.error("usage: node scripts/tenant/seed-numbering.js --slug=<tenant-slug> [--live] [--force]");
  process.exit(1);
}
const force = args.force === true;
const schemas = args.live === true || args.all === true ? ["sandbox", "live"] : ["sandbox"];

// module_key → scheme. Defaults below fill in the rest (yearly reset, pad 4, "-").
// Keys mirror the moduleKey each issuer passes to numbering.allocate().
const DEFAULTS = { code: "", padding: 4, reset: "yearly", separator: "-" };
const SCHEMES = {
  "MOD-29":    { prefix: "DOS",  label: "Dossier / operations file" },
  "MOD-30":    { prefix: "TO",   label: "Transit order" },
  "MOD-32":    { prefix: "DN",   label: "Delivery note" },
  "MOD-27":    { prefix: "QUO",  label: "Quotation" },
  "MOD-23":    { prefix: "PRP",  label: "Proposal" },
  "MOD-50":    { prefix: "PRF",  label: "Proforma / customer advance" },
  "MOD-51":    { prefix: "INV",  label: "Final invoice" },
  "MOD-51-CN": { prefix: "CN",   label: "Credit note (own sequence, shares MOD-51 perms)" },
  "MOD-52":    { prefix: "RCT",  label: "Payment receipt" },
  "MOD-60":    { prefix: "PO",   label: "Purchase order" },
  "MOD-62":    { prefix: "PR",   label: "Purchase request" },
  "MOD-61":    { prefix: "SINV", label: "Supplier invoice" },
  "MOD-49":    { prefix: "CASH", label: "Cash request + régie advance (shared MOD-49 sequence)" },
  "MOD-04":    { prefix: "SUP",  reset: "never", label: "Supplier code" },
  "MOD-03":    { prefix: "CLI",  reset: "never", label: "Client code" },
  "MOD-01-DOC": { code: "DOC", label: "Corporate entity document" },
  "MOD-03-DOC": { prefix: "CLI", code: "DOC", label: "Client KYC document" },
  "MOD-04-DOC": { prefix: "SUP", code: "DOC", label: "Supplier KYC document" },
};

(async () => {
  const cli = m.client(m.tenantDbName(slug), { superuser: true });
  await cli.connect();
  try {
    const total = Object.keys(SCHEMES).length;
    for (const schema of schemas) {
       
      const { rows } = await cli.query(
        "SELECT 1 FROM information_schema.schemata WHERE schema_name = $1",
        [schema],
      );
      if (!rows.length) { console.warn(`[praxis-db] schema '${schema}' missing — skipped`); continue; }
       
      await cli.query(`SET search_path = ${schema}, public`);
      let wrote = 0;
      for (const [key, def] of Object.entries(SCHEMES)) {
        const value = { ...DEFAULTS, ...def };
        delete value.label; // `label` documents the key; it is not part of the stored scheme
         
        const res = await cli.query(
          force
            ? `INSERT INTO setting (section, key, value)
                 VALUES ('numbering', $1, $2::jsonb)
               ON CONFLICT (section, key) DO UPDATE
                 SET value = EXCLUDED.value, updated_at = now(), version = setting.version + 1`
            : `INSERT INTO setting (section, key, value)
                 VALUES ('numbering', $1, $2::jsonb)
               ON CONFLICT (section, key) DO NOTHING`,
          [key, JSON.stringify(value)],
        );
        wrote += res.rowCount || 0;
      }
      console.warn(`[praxis-db] ${schema}: ${wrote}/${total} numbering schemes ${force ? "written" : "written (existing kept)"}`);
    }
    console.warn(`[praxis-db] numbering schemes seeded for tenant '${slug}' ✓`);
  } finally {
    await cli.end();
  }
})()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[praxis-db] numbering seed FAILED:", e.message || String(e));
    process.exit(1);
  });
