"use strict";

/**
 * "Describe it in your own words" — the portal quote wizard's fill.
 *
 * The rules reader always runs; the model only where the tenant's AI gate
 * allows it, and its answer is kept field by field, so a bad value costs that
 * field and never puts an invalid mode or incoterm into the wizard.
 */

let mockGate = { allowed: true };
let mockAnswer = null;
let mockCalled = 0;

jest.mock("../../src/services/ai/llm.service", () => ({
  chat: async () => {
    mockCalled += 1;
    return { text: mockAnswer, provider: "test", model: "m", usage: { prompt_tokens: 10, completion_tokens: 5 } };
  },
}));
jest.mock("../../src/modules/ai/governance/governance.service", () => ({
  canUseFeature: async () => mockGate,
  recordUsage: async () => {},
}));

const { fill, rules } = require("../../src/modules/portal/portal_quote_fill.service");

const client = {};

beforeEach(() => {
  mockGate = { allowed: true };
  mockAnswer = null;
  mockCalled = 0;
});

describe("the rules reader", () => {
  it("reads an English description", () => {
    expect(rules("2x40HC of ceramic tiles from Shanghai to Douala, FOB, about 48 tonnes")).toMatchObject({
      mode: "SEA", origin: "Shanghai", destination: "Douala", incoterm: "FOB", weight_kg: 48000, containers: "2×40HC",
    });
  });

  it("reads a French one, place names and all", () => {
    expect(rules("Import de 3 conteneurs de 20 pieds de riz de Bangkok à Douala, CIF, 75 t")).toMatchObject({
      mode: "SEA", direction: "IMPORT", origin: "Bangkok", destination: "Douala", incoterm: "CIF", weight_kg: 75000,
    });
  });

  it("leaves what it cannot read empty rather than guessing", () => {
    const out = rules("We need a price for some goods");
    expect(out).toMatchObject({ mode: null, origin: null, destination: null, incoterm: null, weight_kg: null });
  });
});

describe("with the model", () => {
  it("fills the gaps the rules left, one validated field at a time", async () => {
    mockAnswer = JSON.stringify({
      mode: "SEA", direction: "IMPORT", origin: null, destination: "Kribi", incoterm: "FOB",
      cargo: "Industrial machinery", weight_kg: 12000, containers: null,
    });
    const out = await fill(client, { text: "Machinery, about 12 tonnes, FOB, coming into Kribi" });
    expect(out.source).toBe("ai");
    expect(out.fields).toMatchObject({ mode: "SEA", destination: "Kribi", cargo: "Industrial machinery", weight_kg: 12000 });
  });

  it("drops a value that is not one of ours, and keeps the rest", async () => {
    mockAnswer = JSON.stringify({ mode: "TELEPORT", incoterm: "XYZ", destination: "Douala" });
    const out = await fill(client, { text: "Some goods by air to Douala" });
    expect(out.fields.mode).toBe("AIR"); // the rules' reading, not the model's invention
    expect(out.fields.incoterm).toBeNull();
    expect(out.fields.destination).toBe("Douala");
  });

  it("never calls the model when the tenant's AI is off, or outside live data", async () => {
    mockGate = { allowed: false };
    expect((await fill(client, { text: "from Shanghai to Douala by sea" })).source).toBe("rules");
    mockGate = { allowed: true };
    expect((await fill(client, { text: "from Shanghai to Douala by sea", env: "sandbox" })).source).toBe("rules");
    expect(mockCalled).toBe(0);
  });

  it("falls back to the rules when the answer is not JSON", async () => {
    mockAnswer = "Sure! Here is your quote…";
    const out = await fill(client, { text: "from Shanghai to Douala by sea, FOB" });
    expect(out).toMatchObject({ source: "rules", fields: { origin: "Shanghai", incoterm: "FOB" } });
  });
});
