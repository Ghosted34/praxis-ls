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
 * The rule is pure, so it is tested directly rather than through a database.
 */
const { applyDependencies } = require("../../src/services/platform/provisioning.service");

const f = (feature_key, state, depends_on = []) => ({
  feature_key, state, source: "plan", depends_on,
});
const byKey = (rows) => Object.fromEntries(rows.map((r) => [r.feature_key, r]));

describe("applyDependencies", () => {
  it("forces a child off when its parent is off", () => {
    const out = byKey(applyDependencies([
      f("ai.assistant", "off"),
      f("ai.assistant.backend", "on", ["ai.assistant"]),
    ]));
    expect(out["ai.assistant.backend"].state).toBe("off");
  });

  it("marks the source so the console can explain WHY it is off", () => {
    // An unexplained "off" is one an operator will try to toggle, fail to
    // change, and report as a bug — which is how the original gap presented.
    const out = byKey(applyDependencies([
      f("ai.assistant", "off"),
      f("ai.assistant.backend", "on", ["ai.assistant"]),
    ]));
    expect(out["ai.assistant.backend"].source).toBe("dependency");
    expect(out["ai.assistant.backend"].blocked_by).toBe("ai.assistant");
  });

  it("cascades transitively — a grandchild falls with the grandparent", () => {
    const out = byKey(applyDependencies([
      f("sales.crm", "off"),
      f("sales.proposals", "on", ["sales.crm"]),
      f("sales.deep", "on", ["sales.proposals"]),
    ]));
    expect(out["sales.proposals"].state).toBe("off");
    expect(out["sales.deep"].state).toBe("off");
  });

  it("leaves a child alone when its parent is on", () => {
    const out = byKey(applyDependencies([
      f("accounting.core", "on"),
      f("accounting.tax", "on", ["accounting.core"]),
    ]));
    expect(out["accounting.tax"].state).toBe("on");
    expect(out["accounting.tax"].source).toBe("plan");
  });

  it("is one-directional: enabling a child never enables its parent", () => {
    // Entitlement is the plan's business. This only removes the incoherent
    // state, it does not grant anything.
    const out = byKey(applyDependencies([
      f("costing", "off"),
      f("commercial.simulators", "on", ["costing"]),
    ]));
    expect(out.costing.state).toBe("off");
    expect(out["commercial.simulators"].state).toBe("off");
  });

  it("ignores a dependency naming a key that isn't in the catalogue", () => {
    // Unevaluable, so it must not darken the child on bad reference data.
    const out = byKey(applyDependencies([f("x", "on", ["not.in.catalogue"])]));
    expect(out.x.state).toBe("on");
  });

  it("terminates on a cycle instead of spinning the deploy", () => {
    const out = byKey(applyDependencies([
      f("a", "on", ["b"]),
      f("b", "on", ["a"]),
    ]));
    // Mutually-on is self-consistent; the point is that it returns at all.
    expect(out.a.state).toBe("on");
    expect(out.b.state).toBe("on");
  });

  it("handles a null depends_on (the column is nullable)", () => {
    const rows = [{ feature_key: "solo", state: "on", source: "plan", depends_on: null }];
    expect(applyDependencies(rows)[0].state).toBe("on");
  });
});
