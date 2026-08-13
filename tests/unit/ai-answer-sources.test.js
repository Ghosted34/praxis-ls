"use strict";
/**
 * The grounding an answer actually stands on.
 *
 * WHY THIS IS PINNED HARD. Three UI surfaces — the Sources tab, the Record tab
 * and the footer under every reply — render only when `/ai/ask` returns
 * `sources`, and they had never rendered because nothing populated it. A
 * regression here does not throw and does not look broken: the footer simply
 * stops appearing, and an accounting assistant quietly loses the ability to show
 * its working. Same shape of failure `client/src/components/ai/grounding.test.ts`
 * was written to catch on the other side of the wire.
 *
 * DB-free: everything under test is pure, taking the read results the
 * orchestrator already holds.
 */
const fs = require("fs");
const path = require("path");
const src = require("../../src/services/ai/answer-sources");
const registry = require("../../client/src/app/screen-registry.json");

describe("action → route, inverted from the screen registry", () => {
  it("resolves a read to the screen its records live on", () => {
    // Not hard-coded expectations about one module: whatever the registry says
    // is what the citation must point at, because the registry is the contract.
    const declared = registry.screens.find((s) =>
      (s.actions || []).includes("list_final_invoices"),
    );
    expect(declared).toBeDefined();
    expect(src.screenFor("list_final_invoices")).toMatchObject({
      route: declared.route,
      title: declared.title,
    });
  });

  it("resolves nothing for an action no screen declares", () => {
    expect(src.screenFor("list_something_that_does_not_exist")).toBeNull();
  });
});

describe("rows out of a read result", () => {
  it("reads the three shapes the module services return", () => {
    expect(src.rowsOf([{ invoice_id: "1" }, { invoice_id: "2" }])).toHaveLength(
      2,
    );
    expect(src.rowsOf({ rows: [{ invoice_id: "1" }] })).toHaveLength(1);
    expect(src.rowsOf({ invoice_id: "1", doc_number: "INV-1" })).toHaveLength(
      1,
    );
  });

  it("calls a computed view what it is, rather than a one-row read", () => {
    // smart_receivables.ageing: buckets plus a count, no record identity.
    expect(
      src.rowsOf({ d0: 0, d1_30: 4200, d31_60: 0, open_count: 3 }),
    ).toBeNull();
    expect(src.rowsOf(null)).toBeNull();
  });

  it("keeps an unnumbered DRAFT a record — it has an id, just no number yet", () => {
    expect(
      src.rowsOf({
        invoice_id: "d69be65d-1111-4222-8333-444455556666",
        doc_number: null,
      }),
    ).toHaveLength(1);
  });
});

describe("humanRef never shows the user a database identifier", () => {
  it("prefers the reference a person would actually say", () => {
    expect(
      src.humanRef({
        invoice_id: "abc",
        doc_number: "SBX-INV-0001",
        name: "x",
      }),
    ).toBe("SBX-INV-0001");
    expect(src.humanRef({ client_id: "abc", name: "SODECOTON" })).toBe(
      "SODECOTON",
    );
  });

  it("returns null rather than falling back to a UUID", () => {
    expect(
      src.humanRef({ invoice_id: "d69be65d-1111-4222-8333-444455556666" }),
    ).toBeNull();
    // Even when the uuid is sitting in an identity column.
    expect(
      src.humanRef({ ref: "d69be65d-1111-4222-8333-444455556666" }),
    ).toBeNull();
  });
});

describe("buildSources", () => {
  const invoicesRoute = registry.screens.find((s) =>
    (s.actions || []).includes("list_final_invoices"),
  ).route;

  it("cites what was READ, with the record named and the screen linked", () => {
    const [one] = src.buildSources([
      {
        actionKey: "get_final_invoice",
        result: { invoice_id: "u-1", doc_number: "SBX-INV-0031" },
      },
    ]);
    expect(one).toEqual({
      label: "SBX-INV-0031",
      href: invoicesRoute,
      kind: "record",
    });
  });

  it("collapses a list to one chip carrying the count, not N identical chips", () => {
    // The client dedupes on href too (grounding.mergeSources, SourcesView's key),
    // so N chips at one route would collapse arbitrarily anyway. Grouping here
    // means the label is chosen with every row in view.
    const rows = Array.from({ length: 12 }, (_, i) => ({
      invoice_id: `u-${i}`,
      doc_number: `SBX-INV-00${i}`,
    }));
    const out = src.buildSources([
      { actionKey: "list_final_invoices", result: rows },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      label: expect.stringContaining("· 12"),
      href: invoicesRoute,
      kind: "record",
    });
  });

  it("says so when a read matched nothing — an empty answer is still grounded", () => {
    const [one] = src.buildSources([
      { actionKey: "list_final_invoices", result: [] },
    ]);
    expect(one.label).toMatch(/· none$/);
  });

  it("marks a computed view a report, from the RESULT and not from the route", () => {
    // /finance/receivables serves both list_receipts (rows) and receivables_ageing
    // (buckets); only the result can tell the footer which one happened.
    const [one] = src.buildSources([
      {
        actionKey: "receivables_ageing",
        result: { d1_30: 4200, open_count: 3 },
      },
    ]);
    expect(one.kind).toBe("report");
  });

  it("never cites a read that failed or was refused", () => {
    expect(
      src.buildSources([
        {
          actionKey: "list_final_invoices",
          failed: true,
          error: "permission denied",
        },
        { actionKey: "list_final_invoices", result: [{ invoice_id: "u-1" }] },
      ]),
    ).toEqual([
      { label: expect.any(String), href: invoicesRoute, kind: "record" },
    ]);
  });

  it("emits nothing for a read no screen declares, rather than inventing a link", () => {
    expect(
      src.buildSources([{ actionKey: "list_nowhere", result: [{ id: "1" }] }]),
    ).toEqual([]);
  });

  it("never puts a UUID in a chip label", () => {
    const [one] = src.buildSources([
      {
        actionKey: "get_final_invoice",
        result: { invoice_id: "d69be65d-1111-4222-8333-444455556666" },
      },
    ]);
    expect(one.label).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  it("links a route the app can actually route to", () => {
    // A record-suffixed href (/finance/invoices/8f2c) matches no <Route> in
    // app.tsx — the app is hub-based — so it would land on the catch-all
    // redirect to "/" and throw away the user's place.
    const routes = new Set(registry.screens.map((s) => s.route));
    for (const s of src.buildSources([
      { actionKey: "list_final_invoices", result: [{ invoice_id: "u" }] },
    ])) {
      expect(routes.has(s.href)).toBe(true);
    }
  });
});

describe("buildTrace", () => {
  it("reports what ran, what it was filtered by, and what came back", () => {
    const steps = src.buildTrace({
      recalled: 6,
      reads: [
        {
          actionKey: "receivables_ageing",
          payload: {},
          result: { d1_30: 4200 },
        },
        {
          actionKey: "list_final_invoices",
          payload: { status: "OVERDUE", limit: 50 },
          result: [{ invoice_id: "1" }, { invoice_id: "2" }],
        },
      ],
      writes: [{ actionKey: "draft_receipt" }],
    });
    expect(steps).toEqual([
      "Searched the knowledge base — 6 passages recalled",
      "Read receivables ageing — computed",
      "Read final invoices (status: OVERDUE) — 2 records",
      "Proposed draft receipt for your confirmation",
    ]);
  });

  it("drops paging controls — a limit is how the query was bounded, not what was asked", () => {
    const [step] = src.buildTrace({
      reads: [
        {
          actionKey: "list_final_invoices",
          payload: { limit: 50, offset: 0 },
          result: [],
        },
      ],
    });
    expect(step).toBe("Read final invoices — nothing matched");
  });

  it("keeps a UUID filter out of the step, same rule the labels keep", () => {
    const [step] = src.buildTrace({
      reads: [
        {
          actionKey: "list_final_invoices",
          payload: { client_id: "d69be65d-1111-4222-8333-444455556666" },
          result: [],
        },
      ],
    });
    expect(step).toBe("Read final invoices — nothing matched");
  });

  it("says a read was refused rather than letting it read as empty", () => {
    const [step] = src.buildTrace({
      reads: [
        {
          actionKey: "list_final_invoices",
          failed: true,
          error: "permission denied",
        },
      ],
    });
    expect(step).toMatch(/failed: permission denied/);
  });

  it("records the anti-stall nudge, because it is part of how the answer happened", () => {
    const steps = src.buildTrace({
      nudged: true,
      reads: [{ actionKey: "list_final_invoices", result: [] }],
    });
    expect(steps[0]).toMatch(/^Re-prompted/);
  });

  it("is empty when no tool ran — retrieval alone is not a trace", () => {
    // Otherwise every "hello" carries a "Trace · 1 step" disclosure that is
    // never worth opening, which teaches people to ignore it before the turn
    // arrives where it matters.
    expect(src.buildTrace({ recalled: 6, reads: [], writes: [] })).toEqual([]);
  });
});

describe("a missing screen registry costs citations, not answers", () => {
  it("degrades to no sources when the file cannot be read", () => {
    const spy = jest
      .spyOn(fs, "readFileSync")
      .mockImplementation((p, ...rest) => {
        if (
          String(p).endsWith(
            path.join("client", "src", "app", "screen-registry.json"),
          )
        )
          throw new Error("ENOENT");
        return jest.requireActual("fs").readFileSync(p, ...rest);
      });
    src.resetIndex();
    try {
      expect(src.screenFor("list_final_invoices")).toBeNull();
      expect(
        src.buildSources([
          { actionKey: "list_final_invoices", result: [{ invoice_id: "1" }] },
        ]),
      ).toEqual([]);
    } finally {
      spy.mockRestore();
      src.resetIndex();
    }
  });
});
