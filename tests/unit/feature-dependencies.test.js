"use strict";
/**
 * `feature_catalogue.depends_on` enforcement at projection time.
 *
 * The column has been stored since the catalogue was written and consulted by
 * nothing: projectFeatures() resolved each key in isolation, so a child feature
 * could be ON while its parent was OFF. `feature-report.js` flagged it; nothing
 * fixed it. That is the session-10 bug ("19 modules dark for everyone") one
 * layer up — a feature that looks enabled while the gate above it denies every
 * request underneath.
 *
 * Two behaviours here are easy to get wrong and are pinned deliberately:
 *
 *   · an UNKNOWN dependency counts as unmet. A key that isn't in the catalogue
 *     can never be satisfied, so the safe resolution is off — not "ignore it".
 *   · `source` is PRESERVED. The tenant `feature_state.source` CHECK allows only
 *     plan|override|default, so recording the reason there would violate the
 *     constraint on write. The reason goes to the log instead (projectFeatures).
 *
 * `toDepsArray` is tested directly because `depends_on` is `citext[]`, which
 * node-postgres hands back as a raw string — iterating that character by
 * character once turned every feature off.
 */
const {
  enforceDependencies, toDepsArray,
} = require("../../src/services/platform/provisioning.service");

const f = (feature_key, state, depends_on = []) => ({
  feature_key, state, source: "plan", depends_on,
});
const byKey = (rows) => Object.fromEntries(rows.map((r) => [r.feature_key, r]));

describe("toDepsArray", () => {
  it("passes a real array through", () => {
    expect(toDepsArray(["a", "b"])).toEqual(["a", "b"]);
  });

  it("parses the raw Postgres array literal the citext driver returns", () => {
    expect(toDepsArray("{ai.assistant}")).toEqual(["ai.assistant"]);
    expect(toDepsArray("{a,b}")).toEqual(["a", "b"]);
  });

  it("treats an empty literal as no dependencies — the case that broke everything", () => {
    // "{}" iterated char-by-char yields "{" and "}", neither of which is a
    // feature key, so every feature looked like it had an unmet dependency.
    expect(toDepsArray("{}")).toEqual([]);
  });

  it("strips quoting and tolerates null/undefined", () => {
    expect(toDepsArray('{"a.b","c"}')).toEqual(["a.b", "c"]);
    expect(toDepsArray(null)).toEqual([]);
    expect(toDepsArray(undefined)).toEqual([]);
  });
});

describe("enforceDependencies", () => {
  it("forces a child off when its parent is off", () => {
    const out = byKey(enforceDependencies([
      f("ai.assistant", "off"),
      f("ai.assistant.backend", "on", ["ai.assistant"]),
    ]));
    expect(out["ai.assistant.backend"].state).toBe("off");
  });

  it("preserves `source` — feature_state.source has a CHECK", () => {
    const out = byKey(enforceDependencies([
      f("ai.assistant", "off"),
      f("ai.assistant.backend", "on", ["ai.assistant"]),
    ]));
    expect(out["ai.assistant.backend"].source).toBe("plan");
  });

  it("cascades transitively — a grandchild falls with the grandparent", () => {
    const out = byKey(enforceDependencies([
      f("sales.crm", "off"),
      f("sales.proposals", "on", ["sales.crm"]),
      f("sales.deep", "on", ["sales.proposals"]),
    ]));
    expect(out["sales.proposals"].state).toBe("off");
    expect(out["sales.deep"].state).toBe("off");
  });

  it("leaves a child alone when its parent is on", () => {
    const out = byKey(enforceDependencies([
      f("accounting.core", "on"),
      f("accounting.tax", "on", ["accounting.core"]),
    ]));
    expect(out["accounting.tax"].state).toBe("on");
  });

  it("is one-directional: enabling a child never enables its parent", () => {
    // Entitlement is the plan's business. This only removes the incoherent
    // state; it does not grant anything.
    const out = byKey(enforceDependencies([
      f("costing", "off"),
      f("commercial.simulators", "on", ["costing"]),
    ]));
    expect(out.costing.state).toBe("off");
    expect(out["commercial.simulators"].state).toBe("off");
  });

  it("treats an unknown dependency as unmet", () => {
    const out = byKey(enforceDependencies([f("x", "on", ["not.in.catalogue"])]));
    expect(out.x.state).toBe("off");
  });

  it("leaves a feature with no dependencies alone", () => {
    // The regression toDepsArray exists to prevent: this must stay on whether
    // depends_on arrives as [] or as the literal "{}".
    expect(byKey(enforceDependencies([f("solo", "on", [])])).solo.state).toBe("on");
    expect(byKey(enforceDependencies([f("solo", "on", "{}")])).solo.state).toBe("on");
  });

  it("terminates on a cycle instead of spinning the deploy", () => {
    const out = byKey(enforceDependencies([
      f("a", "on", ["b"]),
      f("b", "on", ["a"]),
    ]));
    // Mutually-on is self-consistent; the point is that it returns at all.
    expect(out.a.state).toBe("on");
    expect(out.b.state).toBe("on");
  });
});
