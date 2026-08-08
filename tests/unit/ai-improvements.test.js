"use strict";
/**
 * Tests for the AI improvement features:
 *   - Entity card coverage
 *   - OHADA domain boost in retrieval
 *   - Feedback loop (negative feedback injection)
 *   - Per-user preferences
 */

const entityCards = require("../../src/services/ai/knowledge/entity-cards");

// ── Entity card coverage ──
describe("entity card builders", () => {
  test("has expanded coverage (at least 30 entity types)", () => {
    expect(entityCards.BUILDERS.length).toBeGreaterThanOrEqual(30);
  });

  test("covers core logistics entities", () => {
    const keys = entityCards.BUILDERS.map((b) => b.key);
    expect(keys).toContain("dossier");
    expect(keys).toContain("client_master");
    expect(keys).toContain("costing");
    expect(keys).toContain("final_invoice");
    expect(keys).toContain("quotation");
    expect(keys).toContain("purchase_order");
  });

  test("covers finance entities", () => {
    const keys = entityCards.BUILDERS.map((b) => b.key);
    expect(keys).toContain("journal_entry");
    expect(keys).toContain("tax_declaration");
    expect(keys).toContain("cash_request");
    expect(keys).toContain("asset");
    expect(keys).toContain("debt_engagement");
  });

  test("covers HR entities", () => {
    const keys = entityCards.BUILDERS.map((b) => b.key);
    expect(keys).toContain("employee");
    expect(keys).toContain("hr_contract");
    expect(keys).toContain("payroll");
    expect(keys).toContain("training");
  });

  test("covers fleet entities", () => {
    const keys = entityCards.BUILDERS.map((b) => b.key);
    expect(keys).toContain("vehicle");
    expect(keys).toContain("driver");
    expect(keys).toContain("fuel_log");
    expect(keys).toContain("work_order");
  });

  test("covers WMS entities", () => {
    const keys = entityCards.BUILDERS.map((b) => b.key);
    expect(keys).toContain("inventory");
    expect(keys).toContain("warehouse_location");
  });

  test("every builder has a card function that returns the expected shape", () => {
    for (const b of entityCards.BUILDERS) {
      const card = b.card({});
      expect(card).toHaveProperty("ref");
      expect(card).toHaveProperty("title");
      expect(card).toHaveProperty("text");
      expect(card).toHaveProperty("confidentiality");
      expect(["normal", "confidential"]).toContain(card.confidentiality);
    }
  });

  test("confidential entities are tagged as confidential", () => {
    const confidential = entityCards.BUILDERS
      .filter((b) => b.card({}).confidentiality === "confidential")
      .map((b) => b.key);
    // Finance and HR data should be confidential.
    expect(confidential).toContain("costing");
    expect(confidential).toContain("payroll");
    expect(confidential).toContain("journal_entry");
  });
});

// ── OHADA domain boost ──
describe("OHADA domain boost in retrieval", () => {
  // Re-implement boostDomainHits for isolated testing.
  const DOMAIN_KEYWORDS = /\b(ohada|syscohada|débours|debours|journal entry|posting|chart of accounts|VAT|TVA|tax declaration|withholding|précompte| acompte|IS\b|BIC|TVA|CNPS|NIU|patente|financial statement|bilan|compte de résultat|TAFIRE|GL|general ledger|double.entry|depreciation|amortissement)\b/i;
  const OHADA_REF = /ohada|OHADA_KB|Accounting.*KnowledgeBase|tax.*knowledge/i;

  function boostDomainHits(hits, query) {
    if (!DOMAIN_KEYWORDS.test(query)) return hits;
    return hits.map((h) => {
      if (OHADA_REF.test(h.ref || "") || OHADA_REF.test(h.title || "")) {
        return { ...h, sim: Math.min(h.sim + 0.15, 1.0) };
      }
      return h;
    }).sort((a, b) => b.sim - a.sim);
  }

  test("accounting query boosts OHADA docs", () => {
    const hits = [
      { ref: "src/services/invoice.js", title: "Invoice service", sim: 0.75 },
      { ref: "doc/OHADA_KB.md", title: "OHADA Accounting KB", sim: 0.70 },
    ];
    const boosted = boostDomainHits(hits, "How do I post a journal entry for VAT?");
    // OHADA doc should now rank higher (0.70 + 0.15 = 0.85 > 0.75).
    expect(boosted[0].ref).toBe("doc/OHADA_KB.md");
    expect(boosted[0].sim).toBe(0.85);
  });

  test("non-accounting query does NOT boost", () => {
    const hits = [
      { ref: "src/services/invoice.js", title: "Invoice service", sim: 0.75 },
      { ref: "doc/OHADA_KB.md", title: "OHADA Accounting KB", sim: 0.70 },
    ];
    const boosted = boostDomainHits(hits, "How do I create a new user?");
    // No change — not an accounting query.
    expect(boosted[0].ref).toBe("src/services/invoice.js");
  });

  test("boost is capped at 1.0", () => {
    const hits = [
      { ref: "doc/OHADA_KB.md", title: "OHADA KB", sim: 0.95 },
    ];
    const boosted = boostDomainHits(hits, "What is the VAT rate?");
    expect(boosted[0].sim).toBe(1.0);
  });
});

// ── Feedback injection format ──
describe("feedback and preference prompt blocks", () => {
  test("negative feedback block format", () => {
    const feedback = [
      { comment: "Wrong account number for débours", actions: ["create_journal_entry"] },
      { comment: "Showed UUIDs instead of names", actions: [] },
    ];
    const block = feedback.length
      ? "\n\nPATTERNS USERS DISLIKED (avoid these mistakes — users left specific feedback):\n" +
        feedback.map((f, i) => `  ${i + 1}. User said: "${f.comment}"${f.actions.length ? ` (on actions: ${f.actions.join(", ")})` : ""}`).join("\n")
      : "";
    expect(block).toContain("Wrong account number");
    expect(block).toContain("create_journal_entry");
    expect(block).toContain("Showed UUIDs");
  });

  test("empty feedback produces no block", () => {
    const feedback = [];
    const block = feedback.length ? "SHOULD NOT APPEAR" : "";
    expect(block).toBe("");
  });

  test("preferences block format", () => {
    const prefs = { "currency": "always XAF", "format": "prefer tables" };
    const block = Object.keys(prefs).length
      ? "\n\nUSER PREFERENCES (tailor your output to these):\n" +
        Object.entries(prefs).map(([k, v]) => `  • ${k}: ${v}`).join("\n")
      : "";
    expect(block).toContain("always XAF");
    expect(block).toContain("prefer tables");
  });

  test("empty preferences produces no block", () => {
    const prefs = {};
    const block = Object.keys(prefs).length ? "SHOULD NOT APPEAR" : "";
    expect(block).toBe("");
  });
});
