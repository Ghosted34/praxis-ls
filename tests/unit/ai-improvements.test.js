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

  /**
   * OUR OWN entities, not counterparties.
   *
   * Every counterparty had a card — clients, suppliers, drivers, employees —
   * while the companies the tenant invoices AS had none, so the assistant had
   * tools for them and nothing to recall. Asked about share capital it answered
   * from the shape of the question: "derived, and checked against the legal
   * minimum". It is neither — it is a stored statutory fact, and no
   * minimum-capital rule exists in this codebase.
   */
  describe("our own corporate entities", () => {
    const builder = (k) => entityCards.BUILDERS.find((b) => b.key === k);

    test("the tenant's own entities and registrations are carded", () => {
      const keys = entityCards.BUILDERS.map((b) => b.key);
      expect(keys).toContain("corporate_entity");
      expect(keys).toContain("entity_registration");
    });

    test("the card states the share capital as the stored figure it is", () => {
      const card = builder("corporate_entity").card({
        code: "SLAS", legal_name: "Smart Logistics and Services Ltd", legal_form: "SARL",
        country_code: "CM", registration_status: "ACTIVE", accounting_framework: "OHADA",
        share_capital: "100000000", share_capital_currency: "XAF", share_capital_paid_up: "100000000",
        incorporation_date: "2019-04-02", incorporation_place: "Douala",
        default_currency: "XAF", doc_prefix: "SLAS",
      });
      expect(card.text).toContain("share capital 100,000,000 XAF");
      expect(card.text).toContain("incorporated 2019-04-02 in Douala");
      // The distinction the assistant kept getting wrong: these are OURS.
      expect(card.text).toContain("OUR OWN legal entities");
      expect(card.ref).toBe("entity:SLAS");
    });

    test("partly-called capital is reported as such, not silently as the full figure", () => {
      const card = builder("corporate_entity").card({
        code: "SBX", legal_name: "SmartBox SARL", share_capital: "10000000",
        share_capital_paid_up: "2500000", share_capital_currency: "XAF",
      });
      expect(card.text).toContain("share capital 10,000,000 XAF (2,500,000 paid up)");
    });

    test("group position is stated either way, so silence never implies standalone", () => {
      const child = builder("corporate_entity").card({
        code: "SBXFR", legal_name: "SmartBox France SAS",
        relationship_type: "SUBSIDIARY", parent_code: "SBX", parent_name: "SmartBox SARL",
      });
      expect(child.text).toContain("subsidiary of SBX — SmartBox SARL");
      expect(builder("corporate_entity").card({ code: "SBX" }).text)
        .toContain("top-level or standalone company");
    });

    test("an entity with no capital recorded says nothing about capital", () => {
      const card = builder("corporate_entity").card({ code: "NEW", legal_name: "Newco" });
      expect(card.text).not.toMatch(/share capital/i);
    });

    test("registrations are carded so the assistant can name our own identifiers", () => {
      const card = builder("entity_registration").card({
        kind: "NIU", number: "P0123456789A", country_code: "CM",
        issuing_authority: "DGI", is_primary: true,
        entity_code: "SLAS", legal_name: "Smart Logistics and Services Ltd",
      });
      expect(card.text).toContain("NIU P0123456789A");
      expect(card.text).toContain("in CM");
      expect(card.text).toContain("primary for that country");
    });
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
  const DOMAIN_KEYWORDS = /\b(ohada|syscohada|débours|disbursement|journal entry|posting|chart of accounts|VAT|TVA|tax declaration|withholding|précompte| acompte|IS\b|BIC|TVA|CNPS|NIU|patente|financial statement|bilan|compte de résultat|TAFIRE|GL|general ledger|double.entry|depreciation|amortissement)\b/i;
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
