"use strict";
/**
 * Step 2 — the AI's write reach equals the app's (AI_ARCHITECTURE §0), and tenant
 * ingestion honours the ai.vectorization toggle (AI_READINESS Rule 4).
 */

// Mock the costing service so we can drive an AI write end-to-end without a DB.
jest.mock("../../src/modules/costing/costing/costing.service", () => ({
  createDraft: jest.fn(async (_client, { data, actor }) => ({ costing_id: "c-1", _data: data, _actor: actor })),
}));
const costing = require("../../src/modules/costing/costing/costing.service");
const { registry } = require("../../src/services/ai/action-registry");
const { buildCatalogue, buildExecutorMap } = require("../../src/services/ai/action-registrar");

describe("AI write surface is wired (not just cataloged)", () => {
  it("enables a money-path set of write actions, not just one", () => {
    const enabled = buildCatalogue().filter((r) => r.is_write && r.ai_enabled).map((r) => r.action_key);
    // Was 1 (create_client) before this step; now the create path across the cycle.
    expect(enabled.length).toBeGreaterThanOrEqual(8);
    expect(enabled).toEqual(expect.arrayContaining([
      "create_client", "open_dossier", "create_costing", "draft_quotation",
      "draft_final_invoice", "draft_purchase_order", "draft_supplier_invoice", "draft_cash_request",
    ]));
  });

  it("every ai_enabled write has a real executor in the map", () => {
    const map = buildExecutorMap();
    const enabled = buildCatalogue().filter((r) => r.is_write && r.ai_enabled);
    for (const r of enabled) expect(typeof map[r.action_key]).toBe("function");
  });

  it("executes an AI-proposed write through the module service (propose→confirm→record)", async () => {
    const r = await registry.create_costing({ client: {}, user: { user_id: "u1" }, payload: { dossier_id: "d1", margin_percent: 20 } });
    expect(costing.createDraft).toHaveBeenCalledWith({}, { data: { dossier_id: "d1", margin_percent: 20 }, actor: { user_id: "u1" } });
    expect(r.entity_ref).toBe("costing:c-1");
  });
});

describe("ingest honours the ai.vectorization toggle", () => {
  const ingest = require("../../src/services/ai/ingest.service");
  const flag = (state) => ({ query: jest.fn().mockResolvedValue({ rows: state ? [{ state }] : [] }) });

  it("isVectorizationOn: on→true, off/absent→false", async () => {
    expect(await ingest.isVectorizationOn(flag("on"))).toBe(true);
    expect(await ingest.isVectorizationOn(flag("off"))).toBe(false);
    expect(await ingest.isVectorizationOn(flag(null))).toBe(false);
  });

  it("ingestTenantCards skips embedding when the flag is off", async () => {
    const client = flag("off");
    const r = await ingest.ingestTenantCards(client, [{ ref: "dossier:X", text: "hi" }]);
    expect(r).toEqual({ cards: 0, skipped: "ai.vectorization off" });
    // Only the feature_state read happened — no INSERT into ai_document.
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it("reembedEntity is a no-op when the flag is off", async () => {
    const r = await ingest.reembedEntity(flag("off"), { entityRef: "dossier:X" });
    expect(r.reembedded).toBe(0);
    expect(r.skipped).toBe("ai.vectorization off");
  });
});
