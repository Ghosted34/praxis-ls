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
        if (!owner.has(a.key)) undeclared.push(`${a.key} (${path.relative(process.cwd(), file)})`);
      }
    }
    expect(undeclared).toEqual([]);
  });
});

/** Every `<module>.ai.js` in the repo. */
function manifestFiles(dir = path.resolve(__dirname, "../../src/modules"), out = []) {
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

  it.each(manifests)("%s has valid entity/reads/writes", (file) => {
    // dynamic require of a discovered manifest path (trusted, local)
    const m = require(file);
    expect(typeof m.entity).toBe("string");
    expect(Array.isArray(m.reads)).toBe(true);
    expect(Array.isArray(m.writes)).toBe(true);
    for (const r of m.reads) {
      expect(typeof r.key).toBe("string");
      expect(typeof r.service).toBe("function");
    }
    for (const w of m.writes) {
      expect(typeof w.key).toBe("string");
      expect(typeof w.service).toBe("function");
      expect(w.schema).toBeDefined();
      expect(typeof w.permission.module).toBe("string");
      expect(typeof w.permission.action).toBe("string");
      expect(typeof w.confirm).toBe("boolean");
    }
  });
});
