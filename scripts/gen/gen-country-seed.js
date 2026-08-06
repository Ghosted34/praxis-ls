#!/usr/bin/env node
/**
 * Regenerate the country_profile seed rows from the canonical list.
 *
 * packages/shared/data/countries.js is the ONE source of truth for "what
 * countries exist, what they dial, and what they trade in" — the API, the
 * client's picker and the DB seed all draw from it. The seed inside
 * migrations/tenant/0511_party_master_rich.sql was produced by this script so
 * the table cannot silently diverge from the module the UI renders.
 *
 * The 0511 migration is already applied, so its embedded rows are frozen (you do
 * not edit an applied migration — see scripts/db/check-migration-numbers.js). Use
 * this when adding a NEW country-profile migration, or to diff the module against
 * what a fresh seed would produce:
 *
 *   node scripts/gen/gen-country-seed.js            # print the VALUES rows
 *
 * It emits only the `(...),` rows — wrap them in an
 * `INSERT INTO country_profile (...) VALUES … ON CONFLICT (code) DO NOTHING;`.
 */
"use strict";

const { CATALOGUE, requirementsFor } = require("../../packages/shared/data/countries");

const esc = (s) => String(s).replace(/'/g, "''");

const rows = CATALOGUE.map((c) => {
  const reqs = esc(JSON.stringify(requirementsFor(c.code)));
  return `  ('${c.code}', '${esc(c.name)}', '${c.phone}', '${c.currency}', '${reqs}'::jsonb, ${c.sort_order})`;
});

process.stdout.write(rows.join(",\n") + "\n");
