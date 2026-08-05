#!/usr/bin/env node
/**
 * Seed a tenant's appearance (white-label branding) with the Lovable /
 * SmartLS reference palette — orange #F5821F, Montserrat display + Inter body —
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
 * consumer), logos (uploaded via Appearance).
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
  // Seeded from the shipped font library (client/src/lib/fonts.ts) — these must
  // be stacks the app can actually render. The previous pair could not be:
  // Playfair Display is not bundled at all, and neither was Montserrat, so a
  // seeded tenant got Georgia and system-ui while every editor and preview
  // confidently reported the names above. Montserrat's wide geometric caps are
  // what carried the reference look, so it keeps the display slot; body goes to
  // Inter, which is the app default and is built for long-form UI text in a way
  // Montserrat is not.
  font_display: '"Montserrat Variable", "Montserrat", sans-serif',
  font_body: '"Inter Variable", "Inter", sans-serif',
  font_mono: '"JetBrains Mono Variable", "JetBrains Mono", monospace',
  radius: "0.9rem",
  brand_theme: "light",
};

// Login/landing hero (section='login'). The Lovable reference's cinematic
// landing is tenant-authored content — a fresh tenant has NONE, so it falls
// back to bare generic copy and looks nothing like the reference. Seed a
// presentable default: dark navy mesh with orange+blue glows as an inline SVG
// (self-contained — no asset upload, replace any time in Settings → Appearance).
const HERO_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='900'>" +
  "<defs>" +
  "<linearGradient id='base' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='#071324'/><stop offset='100%' stop-color='#0D1F38'/></linearGradient>" +
  "<radialGradient id='glow1' cx='82%' cy='-4%' r='70%'><stop offset='0%' stop-color='#F5821F' stop-opacity='0.38'/><stop offset='100%' stop-color='#071324' stop-opacity='0'/></radialGradient>" +
  "<radialGradient id='glow2' cx='8%' cy='95%' r='80%'><stop offset='0%' stop-color='#1C9BD7' stop-opacity='0.30'/><stop offset='100%' stop-color='#071324' stop-opacity='0'/></radialGradient>" +
  "</defs>" +
  "<rect width='1600' height='900' fill='url(#base)'/>" +
  "<rect width='1600' height='900' fill='url(#glow1)'/>" +
  "<rect width='1600' height='900' fill='url(#glow2)'/>" +
  "</svg>";
const LOGIN = {
  headline: "Your operations, one command center",
  subtext: "Dossiers, finance, fleet and compliance — orchestrated in a single OHADA-ready workspace.",
  layout: "split",
  show_logo: true,
  background_url: "data:image/svg+xml;base64," + Buffer.from(HERO_SVG).toString("base64"),
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
      const sections = [["appearance", entries], ["login", LOGIN]];
      const total = Object.keys(entries).length + Object.keys(LOGIN).length;
      for (const [section, kv] of sections) {
        for (const [key, value] of Object.entries(kv)) {
          // eslint-disable-next-line no-await-in-loop
          const res = await cli.query(
            force
              ? `INSERT INTO setting (section, key, value)
                   VALUES ($1, $2, $3::jsonb)
                 ON CONFLICT (section, key) DO UPDATE
                   SET value = EXCLUDED.value, updated_at = now(), version = setting.version + 1`
              : `INSERT INTO setting (section, key, value)
                   VALUES ($1, $2, $3::jsonb)
                 ON CONFLICT (section, key) DO NOTHING`,
            [section, key, JSON.stringify(value)],
          );
          wrote += res.rowCount || 0;
        }
      }
      console.warn(`[praxis-db] ${schema}: ${wrote}/${total} appearance+login keys ${force ? "written" : "written (existing kept)"}`);
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
