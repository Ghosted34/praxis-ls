"use strict";
/**
 * Enforces the AI-readiness build rules (doc/AI_READINESS.md): the UI screen
 * registry is well-formed, the knowledge walker ingests the UI, and every
 * <module>.ai.js manifest in the repo is valid. DB-free.
 */
const fs = require("fs");
const path = require("path");
const registry = require("../../client/src/app/screen-registry.json");
const codebase = require("../../src/services/ai/knowledge/codebase");

describe("UI screen registry", () => {
  it("is a versioned, non-empty list", () => {
    expect(registry.version).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(registry.screens)).toBe(true);
    expect(registry.screens.length).toBeGreaterThan(0);
  });

  it("every screen has id, title, route, purpose", () => {
    for (const s of registry.screens) {
      expect(typeof s.id).toBe("string");
      expect(s.id).not.toHaveLength(0);
      expect(typeof s.title).toBe("string");
      expect(s.route.startsWith("/")).toBe(true);
      expect(typeof s.purpose).toBe("string");
      expect(s.purpose.length).toBeGreaterThan(3);
    }
  });

  it("ids and routes are unique", () => {
    const ids = registry.screens.map((s) => s.id);
    const routes = registry.screens.map((s) => s.route);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(routes).size).toBe(routes.length);
  });

  /**
   * `actions[]` is read in both directions, and the second one is load-bearing.
   *
   * screen->actions grounds the assistant ("where do I raise an invoice?"). The
   * INVERSION, action->route, is what `src/services/ai/answer-sources.js` turns
   * the executed reads into citations with. An action missing here is an answer
   * that cannot say where it read from — and that failure is silent: the
   * grounding footer just does not appear.
   */
  it("declares every manifest action on exactly one screen", () => {
    const owner = new Map();
    const duplicated = [];
    for (const s of registry.screens) {
      for (const a of s.actions || []) {
        if (owner.has(a)) duplicated.push(`${a} (${owner.get(a)} and ${s.id})`);
        else owner.set(a, s.id);
      }
    }
    expect(duplicated).toEqual([]);

    const undeclared = [];
    for (const file of manifestFiles()) {
      // dynamic require of a discovered manifest path (trusted, local)
      const m = require(file);
      for (const a of [...(m.reads || []), ...(m.writes || [])]) {
        if (!owner.has(a.key))
          undeclared.push(`${a.key} (${path.relative(process.cwd(), file)})`);
      }
    }
    expect(undeclared).toEqual([]);
  });
});

/** Every `<module>.ai.js` in the repo. */
function manifestFiles(
  dir = path.resolve(__dirname, "../../src/modules"),
  out = [],
) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) manifestFiles(full, out);
    else if (e.name.endsWith(".ai.js")) out.push(full);
  }
  return out;
}

describe("AI knowledge walker ingests the UI", () => {
  const items = codebase.collect();
  it("emits one ui-screen card per registry screen", () => {
    const cards = items.filter((i) => i.kind === "ui-screen");
    expect(cards.length).toBe(registry.screens.length);
    expect(cards[0].content).toMatch(/Route:/);
  });
  it("includes client/src UI files (kind ui)", () => {
    expect(items.some((i) => i.kind === "ui")).toBe(true);
  });
});

describe("every <module>.ai.js manifest is well-formed", () => {
  const manifests = manifestFiles();

  it("finds at least the exemplar", () => {
    expect(manifests.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * A declared permission is only worth anything if `action-authz` can parse
   * it. `parseRequirement` returns null for an unknown verb — "list", "get",
   * "run" all look reasonable in a manifest and all resolve to nothing, which
   * fails closed exactly like declaring no permission at all. So the vocabulary
   * is asserted against the production COLUMN map rather than a copy of it.
   */
  // Read the verb vocabulary out of action-authz's own COLUMN map rather than
  // requiring the module (it pulls in identity-cache -> ioredis, and this suite
  // is DB-free by design) and rather than copying the list here (a copy drifts
  // silently, which is the same class of bug this test exists to catch).
  const AUTHZ_SRC = fs.readFileSync(
    path.join(__dirname, "../../src/services/ai/action-authz.js"),
    "utf8",
  );
  const COLUMN_BLOCK = AUTHZ_SRC.match(/const COLUMN = \{([\s\S]*?)\n\};/);
  const KNOWN_ACTIONS = new Set(
    [...(COLUMN_BLOCK ? COLUMN_BLOCK[1] : "").matchAll(/^\s*(\w+)\s*:/gm)].map(
      (m) => m[1],
    ),
  );

  it("could read the authz verb vocabulary (guards the regex above)", () => {
    expect(COLUMN_BLOCK).not.toBeNull();
    expect(KNOWN_ACTIONS.size).toBeGreaterThanOrEqual(7);
    expect(KNOWN_ACTIONS.has("view")).toBe(true);
  });

  // Mirrors parseRequirement: unknown verb -> null -> denied at execution.
  const assertResolves = (a, kind) => {
    const action = String(a.permission.action || "").toLowerCase();
    expect(
      KNOWN_ACTIONS.has(action)
        ? null
        : `${kind} "${a.key}" declares action "${a.permission.action}", which action-authz cannot map to a grant column (known: ${[...KNOWN_ACTIONS].join(", ")}) — it would be denied at execution`,
    ).toBeNull();
  };

  it.each(manifests)("%s has valid entity/reads/writes", (file) => {
    // dynamic require of a discovered manifest path (trusted, local)
    const m = require(file);
    expect(typeof m.entity).toBe("string");
    expect(Array.isArray(m.reads)).toBe(true);
    expect(Array.isArray(m.writes)).toBe(true);
    for (const r of m.reads) {
      expect(typeof r.key).toBe("string");
      expect(typeof r.service).toBe("function");
      // A READ NEEDS A PERMISSION FOR THE SAME REASON A WRITE DOES.
      //
      // This gate asked for one on writes and not on reads, and the result was
      // 190 read actions across 79 manifests declaring none. That was never a
      // leak — `action-authz.assertAllowed` runs on reads too (SEC H1) and
      // FAILS CLOSED, refusing any action whose `required_permission` is null.
      // It was the opposite failure: every one of those reads was dead on
      // arrival, denied with "declares no required permission", so most of the
      // app was unreachable by the assistant and the denial looked like a
      // permissions problem rather than a missing declaration.
      expect(r.permission).toBeDefined();
      expect(typeof r.permission.module).toBe("string");
      expect(typeof r.permission.action).toBe("string");
      assertResolves(r, "read");
    }
    for (const w of m.writes) {
      expect(typeof w.key).toBe("string");
      expect(typeof w.service).toBe("function");
      expect(w.schema).toBeDefined();
      expect(typeof w.permission.module).toBe("string");
      expect(typeof w.permission.action).toBe("string");
      assertResolves(w, "write");
      expect(typeof w.confirm).toBe("boolean");
    }
  });

  /**
   * EVERY UUID-ISH FIELD IN THE LIVE CATALOGUE DECLARES ITS FORMAT.
   * Review 16 Sep 2026 #17, generalised.
   *
   * The specific bug — `owner_user_id: z.string().uuid()` reaching the model as
   * a bare `{ type: "string" }`, so it sent a person's name and the rejection
   * landed after the user had confirmed — is pinned against `create_lead` in
   * `ai-tool-contract-fidelity.test.js`. THIS is the sweep: if any shipped
   * manifest still advertises a bare string where the validator wants a uuid,
   * the model can be misled the same way on that action.
   *
   * ── WHY IT LIVES HERE AND NOT BESIDE ITS SIBLINGS ───────────────────────────
   *
   * `registrar.buildCatalogue()` requires every `*.ai.js` in the repo —
   * ~1820 modules, ~50 MB retained. This file ALREADY walks and requires that
   * same set, so running the sweep here costs one extra pass over an
   * in-memory catalogue. Run from its own suite it is a second full load in a
   * second worker, and under `--coverage` (which instruments all 1820) two
   * workers doing it concurrently is what killed CI:
   *
   *     A jest worker process was terminated by another process:
   *     signal=SIGKILL — i.e. the OOM killer, on GitHub's 7 GB runner.
   *
   * Note the shape of that failure: the suite it killed was this one, which had
   * not changed. `maxWorkers: 2` above is already there for memory pressure on
   * small runners; this keeps the heaviest fixture in the product to a single
   * copy rather than raising that ceiling again.
   */
  it("every uuid-ish field in the live catalogue declares its format", () => {
    const registrar = require("../../src/services/ai/action-registrar");
    // Allowance: a few id-suffixed fields are legitimately free text (external
    // references, provider-side ids). Listed rather than pattern-matched, so
    // adding one is a deliberate act with a name on it.
    //
    // `provider_place_id` is the geocoder's own handle for a suggestion —
    // `geoapify.service.js` reads it straight off `hit.place_id` and caps it at
    // 300 chars, the column is `text` (0674), and the validator says
    // `z.string().trim().min(1).max(300)`. Advertising `format: "uuid"` on it
    // would be the INVERSE of the bug this rule exists to catch: the contract
    // would promise a shape the validator does not want and the provider does
    // not issue, and a model that obediently invented a uuid would be refused
    // by the service's own `results.find(c => c.provider_place_id === id)`.
    const FREE_TEXT_IDS = new Set([
      "external_id", "external_message_id", "message_id", "thread_id",
      "provider_id", "provider_place_id", "tx_id", "transaction_id",
      "reference_id", "batch_id",
    ]);
    const offenders = [];
    for (const row of registrar.buildCatalogue()) {
      const props = (row.payload_schema && row.payload_schema.properties) || {};
      for (const [key, prop] of Object.entries(props)) {
        if (!key.endsWith("_id") || FREE_TEXT_IDS.has(key)) continue;
        if (prop.type === "string" && !prop.format && !prop.pattern && !prop.enum) {
          offenders.push(`${row.action_key}.${key}`);
        }
      }
    }
    // Reported in full: a count tells whoever broke it nothing about where.
    expect(offenders).toEqual([]);
  });
});
