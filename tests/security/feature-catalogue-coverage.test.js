/**
 * A FLAG A TENANT CANNOT BE GIVEN IS A FEATURE NOBODY HAS.
 *
 * ── THE FINDING ─────────────────────────────────────────────────────────────
 *
 * Migration 10730 seeds fifteen `mail.*` rows into every tenant's
 * `feature_state`, all 'off'. Every mail surface is gated on them —
 * `requireFeature` is mounted in FRONT of each router by `module-loader.js` and
 * has no bypass, not even for the CEO.
 *
 * None of those keys existed in `platform.feature_catalogue`.
 *
 * `provisioning.projectFeatures()` iterates the CATALOGUE, so it never touched
 * them; `plans.service.reprojectPlan` does the same; no tenant-side route
 * writes `feature_state` at all. There was no supported way to turn the mailbox
 * on — not from the console, not from a plan, not from a tenant screen. Four
 * commits of a programme sat behind a hard 403 with no switch.
 *
 * ── WHY THIS KEEPS HAPPENING ────────────────────────────────────────────────
 *
 * The two halves live in different databases and are seeded by different files.
 * A tenant migration can add a flag, gate a router on it, ship, and be complete
 * on its own terms — the flag exists, the gate works, the tests pass. The half
 * that makes it switchable is somebody else's file, in the platform DB, and
 * nothing connects them.
 *
 * 9110's own header records the first occurrence: "nine keys below were flipped
 * 'off' -> 'on' because their modules are built and mounted, and leaving them
 * off made 19 modules unreachable for everyone." That was the same defect with
 * the catalogue row present and its default wrong. This is the version where
 * the row is missing entirely, which the console cannot even show.
 *
 * ── WHAT THIS GATE READS ────────────────────────────────────────────────────
 *
 * Both seed sets, as SQL. No database is involved, because the claim is about
 * what the migrations WILL produce, and the failure is invisible at runtime
 * anyway: a missing catalogue row does not error, it just means a projection
 * that never mentions the key, and a tenant whose flag stays at whatever the
 * tenant-side seed left it.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const TENANT = path.join(ROOT, "migrations/tenant");
const SEEDS = path.join(ROOT, "migrations/seeds");

/** Everything the tenant migrations put into `feature_state`. */
function tenantFlags() {
  const keys = new Set();
  for (const f of fs.readdirSync(TENANT)) {
    const sql = fs.readFileSync(path.join(TENANT, f), "utf8").split(/^-- DOWN\s*$/m)[0];
    const block = sql.match(/INSERT INTO feature_state[\s\S]*?;/g) || [];
    for (const b of block) {
      for (const m of b.matchAll(/\(\s*'([a-z][a-z0-9_.]*)'\s*,\s*'(?:on|off)'/g)) keys.add(m[1]);
    }
  }
  return keys;
}

/** Everything the platform seeds put into `feature_catalogue`, with its default. */
function catalogue() {
  const rows = new Map();
  for (const f of fs.readdirSync(SEEDS)) {
    const sql = fs.readFileSync(path.join(SEEDS, f), "utf8");
    const blocks = sql.match(/INSERT INTO platform\.feature_catalogue[\s\S]*?ON CONFLICT/g) || [];
    for (const b of blocks) {
      for (const m of b.matchAll(/\(\s*'([a-z][a-z0-9_.]*)'\s*,\s*'MOD-[^']*'[\s\S]*?'(on|off)'\s*,\s*'(\{[^}]*\})'/g)) {
        rows.set(m[1], { default_state: m[2], depends_on: m[3].slice(1, -1).split(",").filter(Boolean) });
      }
    }
  }
  return rows;
}

const TENANT_FLAGS = tenantFlags();
const CATALOGUE = catalogue();

describe("the two halves of a feature flag agree", () => {
  test("both seed sets are readable and have what this gate thinks", () => {
    expect(TENANT_FLAGS.size).toBeGreaterThan(10);
    expect(CATALOGUE.size).toBeGreaterThan(20);
    expect(TENANT_FLAGS.has("mail.core")).toBe(true);
  });

  test("EVERY tenant-seeded flag has a catalogue row to switch it", () => {
    const unswitchable = [...TENANT_FLAGS].filter((k) => !CATALOGUE.has(k)).sort();
    // Without a catalogue row the console has nothing to show, the projection
    // never mentions the key, and the tenant keeps whatever the tenant-side
    // seed left — which for `mail.*` was 'off', for all fifteen, forever.
    expect(unswitchable).toEqual([]);
  });

  test("every dependency a catalogue row names is itself in the catalogue", () => {
    // `projectFeatures` treats an unknown dependency as UNMET and forces the
    // feature off, to a fixpoint. A typo in `depends_on` therefore turns a
    // shipped feature off for every tenant, silently, and cascades to its own
    // children.
    const broken = [];
    for (const [key, row] of CATALOGUE) {
      for (const dep of row.depends_on) {
        if (!CATALOGUE.has(dep)) broken.push(`${key} -> ${dep}`);
      }
    }
    expect(broken).toEqual([]);
  });

  test("no dependency cycle, or the fixpoint never settles honestly", () => {
    const seen = new Map();
    const walk = (key, trail) => {
      if (trail.includes(key)) return [...trail, key].join(" -> ");
      if (seen.has(key)) return seen.get(key);
      const row = CATALOGUE.get(key);
      let bad = null;
      for (const dep of (row ? row.depends_on : [])) {
        bad = bad || walk(dep, [...trail, key]);
      }
      seen.set(key, bad);
      return bad;
    };
    const cycles = [...CATALOGUE.keys()].map((k) => walk(k, [])).filter(Boolean);
    expect(cycles).toEqual([]);
  });
});

describe("the mail programme is switchable, and switched on where it is ready", () => {
  const MAIL = [...CATALOGUE.keys()].filter((k) => k.startsWith("mail."));

  test("all fifteen keys are in the catalogue", () => {
    expect(MAIL.length).toBe(15);
  });

  test.each([
    "mail.core", "mail.composer", "mail.binding", "mail.notes", "mail.doc_intake",
    "mail.signatures", "mail.deliverability", "mail.shared_inbox", "mail.followup",
    "mail.secure_links", "mail.archive", "mail.antispoof",
  ])("%s ships on — its chapter is built and mounted", (key) => {
    // 9110: default_state answers "is this module SHIPPABLE?", not "did the
    // customer buy it?". Plan inclusion is the commercial gate.
    expect(CATALOGUE.get(key).default_state).toBe("on");
  });

  test.each(["mail.ai", "mail.ocr", "mail.provider.oauth"])("%s ships off, deliberately", (key) => {
    expect(CATALOGUE.get(key).default_state).toBe("off");
  });

  test("mail.ai depends on the AI backend, so §3.3 is enforced by the projection", () => {
    // "An AI flag is a floor, not a ceiling": mail.ai ON with
    // ai.assistant.backend OFF must mean AI stays OFF. `assist.service` checks
    // this at call time; declaring the dependency means the tenant's flag is
    // never even projected on, which is the cheaper place to be right.
    expect(CATALOGUE.get("mail.ai").depends_on).toContain("ai.assistant.backend");
  });

  test("every mail key hangs off comms, directly or through a parent", () => {
    const reaches = (key, trail = []) => {
      if (trail.includes(key)) return false;
      const row = CATALOGUE.get(key);
      if (!row) return false;
      if (row.depends_on.includes("comms")) return true;
      return row.depends_on.some((d) => reaches(d, [...trail, key]));
    };
    // Turning Smart Comms off takes the mailbox with it, which is the correct
    // reading of a mailbox that lives inside the comms module.
    for (const key of MAIL) expect({ key, reachesComms: reaches(key) }).toEqual({ key, reachesComms: true });
  });
});
