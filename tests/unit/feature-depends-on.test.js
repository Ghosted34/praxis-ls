/**
 * depends_on enforcement at feature projection.
 *
 * `feature_catalogue.depends_on` (platform 0020) says a feature may be 'on' only
 * if every feature it depends on is 'on'. projectFeatures() resolves each
 * feature's state (override → plan default → off) and then must apply this rule
 * before writing feature_state, or a child ends up entitled with its parent off —
 * the session-10 "19 modules were dark" bug one layer up. These cases pin the
 * pure resolver `enforceDependencies`; the DB round-trip around it is untested
 * here by design (no live pool in unit tests).
 */
"use strict";

const { enforceDependencies, toDepsArray } = require("../../src/services/platform/provisioning.service");

/** Build the row shape projectFeatures hands the resolver. */
const f = (feature_key, state, depends_on = []) => ({
  feature_key,
  state,
  source: "plan",
  depends_on,
});

/** state keyed by feature_key, for terse assertions. */
const states = (rows) => Object.fromEntries(rows.map((r) => [r.feature_key, r.state]));

describe("enforceDependencies", () => {
  it("leaves a feature with no dependencies untouched", () => {
    const rows = [f("fleet", "on"), f("wms", "off")];
    expect(states(enforceDependencies(rows))).toEqual({ fleet: "on", wms: "off" });
  });

  it("forces a child off when its parent is off", () => {
    const rows = [
      f("ai.assistant", "off"),
      f("ai.assistant.backend", "on", ["ai.assistant"]),
    ];
    expect(states(enforceDependencies(rows))["ai.assistant.backend"]).toBe("off");
  });

  it("keeps a child on when its parent is on", () => {
    const rows = [
      f("ai.assistant", "on"),
      f("ai.assistant.backend", "on", ["ai.assistant"]),
    ];
    expect(states(enforceDependencies(rows))["ai.assistant.backend"]).toBe("on");
  });

  it("cascades through a chain: C off forces B then A off", () => {
    const rows = [
      f("c", "off"),
      f("b", "on", ["c"]),
      f("a", "on", ["b"]),
    ];
    expect(states(enforceDependencies(rows))).toEqual({ a: "off", b: "off", c: "off" });
  });

  it("treats an unknown dependency as unmet (an unresolvable key is off)", () => {
    const rows = [f("a", "on", ["does.not.exist"])];
    expect(states(enforceDependencies(rows))["a"]).toBe("off");
  });

  it("requires every dependency in the array, not just one", () => {
    const rows = [
      f("b", "on"),
      f("c", "off"),
      f("a", "on", ["b", "c"]),
    ];
    expect(states(enforceDependencies(rows))["a"]).toBe("off");
  });

  it("preserves source while flipping state to off", () => {
    const rows = [
      f("ai.assistant", "off"),
      { feature_key: "ai.vectorization", state: "on", source: "override", depends_on: ["ai.assistant"] },
    ];
    const out = enforceDependencies(rows);
    const child = out.find((r) => r.feature_key === "ai.vectorization");
    expect(child.state).toBe("off");
    expect(child.source).toBe("override");
  });

  it("tolerates a null/absent depends_on", () => {
    const rows = [{ feature_key: "fleet", state: "on", source: "plan", depends_on: null }];
    expect(states(enforceDependencies(rows))["fleet"]).toBe("on");
  });

  // Regression: citext[] comes back from node-postgres as a RAW STRING literal,
  // not a JS array. Iterating the string forced every feature off (prod outage).
  it("does NOT force a no-dependency feature off when depends_on is the string '{}'", () => {
    const rows = [{ feature_key: "accounting.core", state: "on", source: "plan", depends_on: "{}" }];
    expect(states(enforceDependencies(rows))["accounting.core"]).toBe("on");
  });

  it("honours a string-literal depends_on the same as an array", () => {
    const rows = [
      { feature_key: "accounting.core", state: "on", source: "plan", depends_on: "{}" },
      { feature_key: "accounting.statements", state: "on", source: "plan", depends_on: "{accounting.core}" },
      { feature_key: "costing", state: "on", source: "plan", depends_on: "{operations}" }, // operations absent → off
    ];
    const s = states(enforceDependencies(rows));
    expect(s["accounting.core"]).toBe("on");
    expect(s["accounting.statements"]).toBe("on");
    expect(s["costing"]).toBe("off");
  });
});

describe("toDepsArray", () => {
  it("passes a JS array through as strings", () => {
    expect(toDepsArray(["a", "b"])).toEqual(["a", "b"]);
  });
  it("parses an empty Postgres literal to []", () => {
    expect(toDepsArray("{}")).toEqual([]);
  });
  it("parses a single-element literal", () => {
    expect(toDepsArray("{ai.assistant}")).toEqual(["ai.assistant"]);
  });
  it("parses a multi-element literal and strips quotes", () => {
    expect(toDepsArray('{a,"b.c"}')).toEqual(["a", "b.c"]);
  });
  it("treats null/undefined as []", () => {
    expect(toDepsArray(null)).toEqual([]);
    expect(toDepsArray(undefined)).toEqual([]);
  });
});
