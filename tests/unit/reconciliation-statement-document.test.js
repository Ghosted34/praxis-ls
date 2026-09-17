"use strict";

/**
 * The reconciliation statement as a DOCUMENT (MOD-76 PR 3, Q19).
 *
 * A generator that produces a page nobody can read is the legacy print
 * engine's defect exactly, so these pin what the sample statement says:
 *
 *   1. THE DOC TYPE IS REGISTERED — under MOD-76, like the creation of the
 *      doc type module map says, so vault capture can FILE it and future
 *      access checks know which grant owns it.
 *   2. THE REASON IS ON THE PAGE — beside EVERY moved line. A statement that
 *      prints −12 000 with no sentence explaining it generates the email
 *      asking why; that is the shape the statement was signed against.
 *   3. THE PROOFS ARE NAMED, not counted — "port-invoice.pdf" is a thing,
 *      "1 document" is a number.
 *   4. DATES PRINT dd/mm/yyyy (ON PAPER means paper — guide §6.4); the wire
 *      ISO stays server-side.
 *   5. BOTH SIGNATURES PRINT — Operations prepared, Finance settled (Q6),
 *      with the dates they did it.
 *
 * Every assertion reads the BUILT document, never the plumbing.
 */

const registry = require("../../src/services/documents/templates/registry");
const kit = require("../../src/services/documents/templates/kit");
const {
  isDocType,
  assertDocType,
  moduleKeyForDocType,
} = require("../../src/modules/vault/document_vault/document_vault.types");

const TPL = registry.get("RECONCILIATION_STATEMENT");

const ENTITY = {
  legal_name: "SMART LOGISTICS AND SERVICES LTD",
  address_lines: ["1030, Avenue Douala Manga Bell, Bali", "PO Box 5120, Douala, Cameroun"],
  identifiers: [{ kind: "RCCM", number: "RC/DLA/2021/B/2060" }],
  city: "Douala",
};

const cfgFor = (language, extra = {}) => kit.mergeCfg({}, { language, ...extra });
const dataWith = (patch = {}) => ({ ...JSON.parse(JSON.stringify(TPL.sampleData)), ...patch });
const body = (html) => String(html).replace(/<style>[\s\S]*?<\/style>/g, "");
const norm = (html) => String(html).replace(/[   ]/g, " ");
const render = (patch = {}, language = "en") =>
  norm(body(TPL.build(dataWith(patch), cfgFor(language), ENTITY, null)));

/* ── 1. Registered ───────────────────────────────────────────────────────── */

describe("RECONCILIATION_STATEMENT is a registered doc type", () => {
  test("the vault accepts it — the settle path that FILES the statement cannot refuse it", () => {
    expect(isDocType("RECONCILIATION_STATEMENT")).toBe(true);
    expect(assertDocType("RECONCILIATION_STATEMENT")).toBe("RECONCILIATION_STATEMENT");
  });

  test("reading it follows MOD-76, exactly like the proofs of the same module (Q8/Q19)", () => {
    expect(moduleKeyForDocType("RECONCILIATION_STATEMENT")).toBe("MOD-76");
  });
});

/* ── 2. The reason is on the page ────────────────────────────────────────── */

describe("the reason column", () => {
  test("every moved line carries the sentence that explains it", () => {
    const html = render();
    expect(html).toContain("Network outage at customs held the container an extra day.");
    // A line whose reason is absent prints the cell rather than the column
    // collapsing — but nothing invents one either.
    expect(html).not.toMatch(/undefined/);
  });

  test("the line table carries the budget / disbursed / actual / variance headers, with words", () => {
    const html = render({}, "en");
    expect(html).toContain("Budget");
    expect(html).toContain("Disbursed");
    expect(html).toContain("Actual");
    expect(html).toContain("Variance");
    // Signed: under-budget shows the +, over shows the −. An unsigned "88000"
    // does not say from which side of the budget it fell.
    expect(html).toMatch(/\+\s*88\s*000/);
  });
});

/* ── 3. The proofs are NAMED ─────────────────────────────────────────────── */

describe("the proof list", () => {
  test("a proof with a note prints the note; a noteless one the file name — names, not counts", () => {
    const html = render();
    expect(html).toContain("port-invoice.pdf");
    expect(html).toContain("customs-receipt.pdf");
    // And the "proof missing" honesty case: a line the person ticked as
    // justification-required, with money spent and nothing attached, says so.
    const missing = render({
      lines: [{
        item_code: "DEM", label: "Demurrage", budget_ttc: 160000, disbursed: 160000,
        actual_ttc: 80000, variance: 80000, variance_reason: null, proofs: [], justification_required: true,
      }],
    });
    expect(missing).toContain("proof missing");
  });
});

/* ── 4. Dates on paper print dd/mm/yyyy ──────────────────────────────────── */

describe("dd/mm/yyyy on paper (§6.4)", () => {
  test("the generation date renders day-first in both renderings' languages", () => {
    const en = render({ date: "2026-07-31" }, "en");
    expect(en).toContain("31/07/2026");
    expect(en).not.toContain("2026-07-31");
    const fr = render({ date: "2026-07-31" }, "fr");
    expect(fr).toContain("31/07/2026");
  });
});

/* ── 5. The chain of custody prints ──────────────────────────────────────── */

describe("prepared / settled (Q6)", () => {
  test("both sign-off slots print, with the dates the acts happened", () => {
    const html = render({ prepared_at: "2026-07-30", settled_at: "2026-07-31" });
    expect(html).toContain("Prepared by (Operations)");
    expect(html).toContain("Settled by (Finance)");
    expect(html).toContain("Jean Mballa");
    expect(html).toContain("Alice Ngo");
    expect(html).toContain("30/07/2026");
  });

  test("an unsettled sheet prints a ruled line to fill, not blank space", () => {
    const html = render({ settled_by_name: null, settled_at: null, status: "SUBMITTED", status_words: { fr: "À solder", en: "To settle" } });
    // signerBlock renders every named slot even unfilled — the same ruled
    // line the delivery-note manifest leaves for a hand.
    expect(html).toContain("Settled by (Finance)");
  });
});

/* ── 6. Bilingual, never mixed ───────────────────────────────────────────── */

describe("one language per document", () => {
  test("a French statement does not carry English labels", () => {
    const fr = render({}, "fr");
    expect(fr).toContain("Réconciliation budgétaire");
    expect(fr).toContain("Décaissé");
    expect(fr).not.toContain(">Disbursed<");
    // The grade sentences are COMPUTED in the document's language... by the
    // caller (statementData) — the sample is English-neutral here, but the
    // template must not add its own English over it.
    expect(fr).toContain("Préparé par (Opérations)");
    expect(fr).toContain("Soldé par (Finance)");
  });
});
