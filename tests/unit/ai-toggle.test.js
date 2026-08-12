"use strict";
/**
 * Guards the per-tenant AI toggle (doc/AI_READINESS.md Rule 4): AI features are
 * seeded OFF by default, and the assistant runtime route is feature-gated. If
 * someone flips a default to 'on' or drops the gate, this fails.
 */
const fs = require("fs");
const path = require("path");

const AI_FLAGS = ["ai.assistant", "ai.assistant.backend", "ai.vectorization"];
const seeds = [
  "migrations/seeds/9100_seed_platform_catalogue.sql",
  "migrations/seeds/9110_seed_platform_features.sql",
];

describe("AI is off by default (per-tenant EMV toggle)", () => {
  for (const seed of seeds) {
    const text = fs.readFileSync(
      path.resolve(__dirname, "../../", seed),
      "utf8",
    );
    for (const flag of AI_FLAGS) {
      it(`${seed}: '${flag}' is seeded 'off'`, () => {
        const line = text.split("\n").find((l) => l.includes(`'${flag}'`));
        expect(line).toBeDefined();
        expect(line).toMatch(/'off'/);
      });
    }
  }
});

describe("assistant runtime route is feature-gated", () => {
  it("declares feature ai.assistant.backend", () => {
    const routes = require("../../src/modules/ai/assistant/assistant.routes");
    expect(routes.feature).toBe("ai.assistant.backend");
  });
});
