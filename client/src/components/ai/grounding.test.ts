/**
 * The grounding derivation is the assistant's most load-bearing piece of pure
 * logic, so it is the piece that gets pinned.
 *
 * WHY IT MATTERS MORE THAN IT LOOKS. Every source chip under an answer, every
 * record the right pane can preview, and the decision to lift an answer onto a
 * canvas all come out of these four functions reading a string. A silent
 * regression here does not throw and does not look broken — the footer simply
 * stops appearing, and an assistant quietly loses the ability to show its
 * working on an accounting product. That is exactly the shape of failure
 * `areas.test.ts` was written to catch for the ribbon.
 */
import { describe, it, expect } from "vitest";
import { artifactTitle, documentBody, extractSources, extractTable, extractTables, isLongForm, kindOf, mergeSources } from "./grounding";

describe("extractSources", () => {
  it("reads the internal links a grounded answer already writes", () => {
    const sources = extractSources(
      "Two are overdue: [INV-2026-0031](/finance/invoices/8f2c) and [INV-2026-0044](/finance/invoices/91ab).",
    );
    expect(sources).toEqual([
      { label: "INV-2026-0031", href: "/finance/invoices/8f2c", kind: "record" },
      { label: "INV-2026-0044", href: "/finance/invoices/91ab", kind: "record" },
    ]);
  });

  it("keeps the first label and one chip per record", () => {
    // A model that mentions the same invoice three times in a paragraph must
    // produce one chip, and it must be the fully-qualified first mention rather
    // than the "it" that follows.
    const sources = extractSources(
      "[INV-2026-0031](/finance/invoices/8f2c) is 42 days late. [it](/finance/invoices/8f2c) was issued in June.",
    );
    expect(sources).toHaveLength(1);
    expect(sources[0].label).toBe("INV-2026-0031");
  });

  it("preserves order of mention, which is already a relevance ranking", () => {
    const sources = extractSources("[B](/b) then [A](/a) then [C](/c)");
    expect(sources.map((s) => s.href)).toEqual(["/b", "/a", "/c"]);
  });

  it("separates reports from records and external references", () => {
    const sources = extractSources(
      "See the [ageing report](/finance/reports/ageing), [invoice](/finance/invoices/1) and [the IMO page](https://imo.org/x).",
    );
    expect(sources.map((s) => s.kind)).toEqual(["report", "record", "external"]);
  });

  it("ignores anchors and mailto — navigation inside a message is not a citation", () => {
    expect(extractSources("[top](#top) and [write to us](mailto:a@b.co)")).toEqual([]);
  });

  it("returns nothing for prose with no links, rather than inventing a citation", () => {
    expect(extractSources("Three invoices are overdue this week.")).toEqual([]);
  });
});

describe("mergeSources", () => {
  it("lets the backend's authoritative source win on the same href", () => {
    const derived = extractSources("[INV-31](/finance/invoices/8f2c)");
    const merged = mergeSources(derived, [
      { label: "INV-2026-0031 · Ndongo Ltd", href: "/finance/invoices/8f2c", kind: "record" },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].label).toBe("INV-2026-0031 · Ndongo Ltd");
  });

  it("keeps a derived source the retrieval layer did not log", () => {
    const merged = mergeSources(extractSources("[A](/a)"), [{ label: "B", href: "/b" }]);
    expect(merged.map((s) => s.href).sort()).toEqual(["/a", "/b"]);
  });

  it("classifies a supplied source that arrived without a kind", () => {
    const [only] = mergeSources([], [{ label: "Ageing", href: "/finance/reports/ageing" }]);
    expect(only.kind).toBe("report");
  });

  it("is a no-op when the backend sends nothing", () => {
    const derived = extractSources("[A](/a)");
    expect(mergeSources(derived, undefined)).toBe(derived);
  });
});

describe("kindOf", () => {
  it("treats anything off-route as external", () => {
    expect(kindOf("https://example.com")).toBe("external");
    expect(kindOf("/finance/invoices/1")).toBe("record");
    expect(kindOf("/finance/statements")).toBe("report");
  });
});

describe("extractTable", () => {
  const md = [
    "Here is the breakdown:",
    "",
    "| Client | Overdue | Days |",
    "| --- | ---: | ---: |",
    "| Ndongo Ltd | 4 500 000 | 42 |",
    "| Sabo SARL | 1 250 000 | 7 |",
    "",
    "Chase Ndongo first.",
  ].join("\n");

  it("lifts a pipe table out of the prose around it", () => {
    expect(extractTable(md)).toEqual({
      title: "Table 1",
      header: ["Client", "Overdue", "Days"],
      rows: [
        ["Ndongo Ltd", "4 500 000", "42"],
        ["Sabo SARL", "1 250 000", "7"],
      ],
    });
  });

  it("returns EVERY table, not just the first", () => {
    // The regression that made the pane lie on a real financial model: seven
    // tables in one answer, one of them shown.
    const many = [
      "### Revenue (from trial balance)",
      "| Account | Amount |",
      "| --- | --- |",
      "| 7064 | 18,000,000 |",
      "",
      "### Receivables (from ageing)",
      "| Bucket | Amount |",
      "| --- | --- |",
      "| Current | 21,465,000 |",
      "| 1-30 days | 2,810,000 |",
      "",
      "**Scenario A — Conservative**",
      "| Month | Revenue |",
      "| --- | --- |",
      "| Aug | 18,000,000 |",
    ].join("\n");
    const tables = extractTables(many);
    expect(tables).toHaveLength(3);
    expect(tables.map((t) => t.title)).toEqual([
      "Revenue (from trial balance)",
      "Receivables (from ageing)",
      "Scenario A — Conservative",
    ]);
    expect(tables[1].rows).toHaveLength(2);
  });

  it("falls back to a positional label when a table has no heading", () => {
    const two = "| A | B |\n| --- | --- |\n| 1 | 2 |\n\n| C | D |\n| --- | --- |\n| 3 | 4 |";
    expect(extractTables(two).map((t) => t.title)).toEqual(["Table 1", "Table 2"]);
  });

  it("does not let one heading label two tables", () => {
    const two = "## Position\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n| C | D |\n| --- | --- |\n| 3 | 4 |";
    expect(extractTables(two).map((t) => t.title)).toEqual(["Position", "Table 2"]);
  });

  it("pads a ragged row rather than dropping it", () => {
    // Losing a row of financial data because the model missed a pipe is the
    // worse of the two failures.
    const ragged = "| A | B |\n| --- | --- |\n| 1 |\n";
    expect(extractTable(ragged)?.rows).toEqual([["1", ""]]);
  });

  it("returns null for a header with no rows under it", () => {
    expect(extractTable("| A | B |\n| --- | --- |\n")).toBeNull();
  });

  it("returns null for prose containing a stray pipe", () => {
    expect(extractTable("Filter on status | priority to see them.")).toBeNull();
  });
});

describe("isLongForm", () => {
  it("leaves a short reply in the thread", () => {
    expect(isLongForm("Three invoices are overdue. Chase Ndongo Ltd first.")).toBe(false);
  });

  it("promotes a sectioned draft — a model writing a document gives it headings", () => {
    expect(isLongForm(`## Proforma advance\n\n${"Terms and conditions apply. ".repeat(20)}`)).toBe(true);
  });

  it("does not promote a short answer merely because it has a heading", () => {
    expect(isLongForm("## Summary\n\nAll clear.")).toBe(false);
  });
});

describe("artifactTitle", () => {
  it("names the artefact from its first heading", () => {
    expect(artifactTitle("## Proforma advance — Ndongo Ltd\n\nBody")).toBe("Proforma advance — Ndongo Ltd");
  });

  it("falls back to the first line, stripped of markdown", () => {
    expect(artifactTitle("**Draft reminder** for [INV-31](/finance/invoices/1)")).toBe("Draft reminder for INV-31");
  });

  it("truncates a title too long to sit in a pane header", () => {
    const title = artifactTitle("x".repeat(200));
    expect(title).toHaveLength(58);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("documentBody", () => {
  // The real shape from a "draft a memo for the finance department" reply.
  const memo = [
    "Here's a draft memo for the finance department based on the financial model.",
    "",
    "---",
    "",
    "## INTERNAL MEMORANDUM",
    "",
    "**TO:** Finance Department **FROM:** Tom Blake **DATE:** 07 August 2026",
    "",
    "### 1. Purpose",
    "",
    "This memo summarizes the H2 2026 financial outlook based on July actuals, the open",
    "sales pipeline, and the current receivables and tax position.",
    "",
    "### 6. Caveats",
    "",
    "- Based on one month of actuals (July); the run-rate is not yet a reliable trend.",
    "- This is a revenue/cash/tax model; operating expenses are not yet included.",
    "",
    "---",
    "",
    "**Prepared by:** Tom Blake **Distribution:** Finance Department",
    "",
    "---",
    "",
    "Would you like me to:",
    "",
    "1. **Add a section on operating expenses** to make this a full P&L?",
    "2. **Adjust the collection-rate assumptions** to a figure you believe is realistic?",
    "",
    "Just let me know.",
  ].join("\n");

  it("drops the hand-over sentence and the trailing offer", () => {
    const body = documentBody(memo);
    expect(body).not.toMatch(/Here's a draft memo/);
    expect(body).not.toMatch(/Would you like me to/);
    expect(body).not.toMatch(/Just let me know/);
  });

  it("keeps the document itself intact, first line to last", () => {
    const body = documentBody(memo);
    expect(body).toMatch(/^## INTERNAL MEMORANDUM/);
    expect(body).toMatch(/Prepared by:\*\* Tom Blake/);
    expect(body).toMatch(/### 1\. Purpose/);
    expect(body).toMatch(/### 6\. Caveats/);
    expect(body).toMatch(/operating expenses are not yet included/);
  });

  it("NEVER truncates when it cannot recognise the shape — the safety property", () => {
    // A document with no hand-over and no offer must come back byte-identical.
    const plain = `## Proforma\n\n${"Terms and conditions apply. ".repeat(30)}`;
    expect(documentBody(plain)).toBe(plain.trim());
  });

  it("leaves a document that merely contains the word 'would' alone", () => {
    const doc = `## Report\n\n${"It would be prudent to collect early. ".repeat(20)}`;
    expect(documentBody(doc)).toContain("would be prudent");
  });

  it("ignores an offer-like phrase near the TOP, which is prose not a wrap-up", () => {
    const doc = `Would you like to know the position?\n\n## Report\n\n${"Body text here. ".repeat(40)}`;
    expect(documentBody(doc)).toContain("Body text here.");
  });

  it("falls back to the full text rather than returning a scrap", () => {
    // Trimming both ends here would leave almost nothing; the guard returns all.
    const tiny = "Here's the note.\n\n---\n\nShort.\n\n---\n\nWould you like me to expand it?";
    expect(documentBody(tiny)).toBe(tiny);
  });
});
