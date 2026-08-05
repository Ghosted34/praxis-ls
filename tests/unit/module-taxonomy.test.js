"use strict";

/**
 * The module catalogue is the single source of truth for the application shell's
 * six ribbon tabs, and this pins the two ways that can silently stop being true.
 *
 * WHY A TEST AND NOT JUST THE MIGRATION'S GUARD. The migration checks the
 * DATABASE at the moment it runs. The seed files are what a fresh install and
 * every CI run build from, and they are edited far more often than migrations —
 * a module added to `9100_seed_platform_catalogue.sql` with `group_key = 'hr'`
 * would pass every existing check, install cleanly, and then be invisible in the
 * ribbon because no tab renders that group. Nobody would find it until someone
 * asked where a screen went.
 *
 * The second failure is subtler and already happened once: `MOD-64` was named
 * "File Repository (Vault)" in the catalogue while `smartcomm.routes.js` gated
 * Smart Comms on it. The permission matrix reads the catalogue, so an
 * administrator granting the Vault was in fact granting chat. That is what the
 * key-agreement test below is for — a module key used in code with no catalogue
 * row, or with a name describing something else, is a permission whose label
 * lies.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const SEED_DIR = path.join(ROOT, "migrations", "seeds");

/** The six workflow verbs. Changing this list is changing the app's IA, so it
 *  should be a deliberate edit with this test as the reminder. */
const VERBS = ["monitor", "engage", "fulfill", "transact", "empower", "configure"];

/** Every ('MOD-xx','group',…) tuple across every seed that catalogues modules. */
function catalogueRows() {
  const rows = [];
  for (const file of fs.readdirSync(SEED_DIR).filter((f) => f.endsWith(".sql"))) {
    const sql = fs.readFileSync(path.join(SEED_DIR, file), "utf8");
    // Only the module_catalogue inserts — the feature catalogue also mentions
    // MOD keys but in a different shape (feature_key first).
    if (!/module_catalogue/i.test(sql)) continue;
    for (const m of sql.matchAll(/\('(MOD-[0-9A-Za-z]+)',\s*'([a-z_]+)',\s*'([^']*)'/g)) {
      rows.push({ key: m[1].toUpperCase(), group: m[2], name: m[3], file });
    }
  }
  return rows;
}

describe("module catalogue — the ribbon's source of truth", () => {
  const rows = catalogueRows();

  it("catalogues every module the app ships", () => {
    // Guards the parser itself: a change to the seed's INSERT shape that made
    // this regex miss everything would otherwise turn every assertion below
    // into a vacuous pass.
    expect(rows.length).toBeGreaterThan(70);
  });

  it("files every module under one of the six verbs", () => {
    const strays = rows.filter((r) => !VERBS.includes(r.group));
    // Named individually — "3 modules are wrong" sends someone hunting; this
    // says which, and which file to open.
    expect(strays.map((r) => `${r.key} '${r.group}' (${r.file})`)).toEqual([]);
  });

  it("leaves no verb empty, so the ribbon never renders a dead tab", () => {
    const used = new Set(rows.map((r) => r.group));
    expect(VERBS.filter((v) => !used.has(v))).toEqual([]);
  });

  it("gives no module two different groups across seed files", () => {
    // MOD-71 and MOD-72 are catalogued in their own files rather than the main
    // seed, which is exactly how one of them could drift.
    const byKey = new Map();
    for (const r of rows) {
      const seen = byKey.get(r.key);
      if (seen && seen.group !== r.group) {
        throw new Error(`${r.key} is '${seen.group}' in ${seen.file} and '${r.group}' in ${r.file}`);
      }
      byKey.set(r.key, r);
    }
    expect(byKey.size).toBe(new Set(rows.map((r) => r.key)).size);
  });
});

describe("module keys used in code have a catalogue row that describes them", () => {
  /** `const M = "MOD-xx"` — how a routes file declares the permission it gates on. */
  function keysUsedInCode() {
    const found = new Map();
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith(".js")) {
          const src = fs.readFileSync(full, "utf8");
          for (const m of src.matchAll(/const M = "(MOD-[0-9A-Za-z]+)"/g)) {
            found.set(m[1].toUpperCase(), path.relative(ROOT, full));
          }
        }
      }
    };
    walk(path.join(ROOT, "src", "modules"));
    return found;
  }

  it("has a catalogue row for every key a route gates on", () => {
    // A key with no row is a permission that cannot be granted through the IAM
    // matrix, because that screen renders from the catalogue.
    const catalogued = new Set(catalogueRows().map((r) => r.key));
    const missing = [...keysUsedInCode()].filter(([key]) => !catalogued.has(key));
    expect(missing.map(([key, file]) => `${key} (${file})`)).toEqual([]);
  });

  it("names MOD-64 for what it actually gates", () => {
    // The regression this suite exists for. Smart Comms is gated on MOD-64;
    // the catalogue used to call it the Vault, so the permission matrix offered
    // administrators the wrong thing under the wrong name.
    const row = catalogueRows().find((r) => r.key === "MOD-64");
    expect(row).toBeDefined();
    expect(row.name).toMatch(/comms/i);
    expect(row.name).not.toMatch(/vault/i);
    expect(row.group).toBe("monitor");
  });

  it("still catalogues the Vault's file repository under its own key", () => {
    // The correction above freed MOD-64; the Vault needed a key of its own
    // rather than silently losing one.
    const vault = catalogueRows().filter((r) => /vault/i.test(r.name));
    expect(vault.length).toBeGreaterThan(0);
    for (const r of vault) expect(r.group).toBe("configure");
  });
});
