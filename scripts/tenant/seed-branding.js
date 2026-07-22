#!/usr/bin/env node
/**
 * Seed a tenant's appearance (white-label branding) with the Lovable /
 * SmartLS reference palette — orange #F5821F, Playfair Display + Montserrat —
 * so a fresh tenant paints the reference look instead of the FE's teal
 * fallback (branding-context DEFAULT_PRIMARY).
 *
 *   node scripts/tenant/seed-branding.js --slug=smartls [--name="Smart Logistics"] [--force]
 *
 * Writes `setting` rows (section='appearance') in BOTH schemas (live +
 * sandbox) so LIVE and TEST render identically. By default only keys that are
 * NOT already set are written (a tenant's own customisations are never
 * clobbered); pass --force to overwrite.
 *
 * Deliberately NOT seeded: secondary / accent (raw *surface* tokens in
 * index.css — writing brand colours there tints panel backgrounds), info (no
 * consumer), fontMono (stylesheet default), logos (uploaded via Appearance).
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
  console.error("usage: node scripts/tenant/seed-branding.js --slug=<tenant-slug> [--name=<display name>] [--force]");
  process.exit(1);
}
const force = args.force === true;

// The Lovable reference tokens (client/src/index.css is the source of truth;
// hex here because theme.ts converts hex → "R G B" triplets for the pill vars).
const APPEARANCE = {
  primary_color: "#F5821F",       // SmartLS orange (245 130 31)
  primary_foreground: "#FFFFFF",
  accent_deep: "#D06410",         // --brand-orange-deep (208 100 16)
  success: "#28945E",             // --ok  (40 148 94)
  warn: "#B08018",                // --warn (176 128 24)
  danger: "#D2443A",              // --bad  (210 68 58)
  font_display: '"Playfair Display", Georgia, serif',
  font_body: '"Montserrat", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  radius: "0.9rem",
  brand_theme: "light",
};

(async () => {
  const cli = m.client(m.tenantDbName(slug), { superuser: true });
  await cli.connect();
  try {
    const entries = { ...APPEARANCE };
    if (args.name) entries.display_name = String(args.name);

    for (const schema of ["live", "sandbox"]) {
      const { rows } = await cli.query(
        `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
        [schema],
      );
      if (!rows.length) { console.warn(`[praxis-db] schema '${schema}' missing — skipped`); continue; }
      await cli.query(`SET search_path = ${schema}, public`);
      let wrote = 0;
      for (const [key, value] of Object.entries(entries)) {
        // eslint-disable-next-line no-await-in-loop
        const res = await cli.query(
          force
            ? `INSERT INTO setting (section, key, value)
                 VALUES ('appearance', $1, $2::jsonb)
               ON CONFLICT (section, key) DO UPDATE
                 SET value = EXCLUDED.value, updated_at = now(), version = setting.version + 1`
            : `INSERT INTO setting (section, key, value)
                 VALUES ('appearance', $1, $2::jsonb)
               ON CONFLICT (section, key) DO NOTHING`,
          [key, JSON.stringify(value)],
        );
        wrote += res.rowCount || 0;
      }
      console.warn(`[praxis-db] ${schema}: ${wrote}/${Object.keys(entries).length} appearance keys ${force ? "written" : "written (existing kept)"}`);
    }
    console.warn(`[praxis-db] Lovable branding seeded for tenant '${slug}' ✓ (users see it on next page load)`);
  } finally {
    await cli.end();
  }
})()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[praxis-db] branding seed FAILED:", (e.message || e.code || String(e)) + (e && e.errors ? " — " + e.errors.map((x) => x.message || x.code).join("; ") : ""));
    process.exit(1);
  });
