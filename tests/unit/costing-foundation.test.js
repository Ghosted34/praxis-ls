"use strict";

/**
 * Costing foundation (migration 12766) — the pure halves of PR 1.
 *
 * Three things are pinned here, all of which were reachable only through the
 * database before and therefore untested:
 *
 *   1. `computeCosting`'s débours VAT — the Maersk case. 12768: a disbursement's
 *      net is in HT and the supplier's VAT is BUDGETED into the VAT total and
 *      TTC (a costing is a cash budget). `upstream_vat_total` names how much of
 *      the VAT is the supplier's. Getting that wrong is a wrong figure on the
 *      sheet.
 *   2. `diffLines` — what an approver reads after an unlock. Its whole value is
 *      that it is short and correct; a diff that reports fourteen changed lines
 *      when one moved is worse than no diff.
 *   3. The suggest builder's quantity drivers and price cascade, which decide
 *      what lands on a blank worksheet.
 *
 * DB-free throughout: the rules are pure, and the suggest builder is driven
 * through a stub client so the branching asserted here is the branching that
 * runs in production.
 */

const fs = require("fs");
const path = require("path");

jest.mock("../../src/config/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const rules = require("../../src/modules/costing/costing/costing.rules");
const suggest = require("../../src/modules/costing/costing/costing.suggest");

const DOSSIER = "22222222-2222-2222-2222-222222222222";
const ITEM_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ITEM_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const TYPE_45 = "44444444-4444-4444-4444-444444444444";
const TYPE_40 = "40404040-4040-4040-4040-404040404040";

/* ══════════════════ 1. Totals, and the upstream-VAT disclosure ══════════════ */

describe("computeCosting", () => {
  test("VAT comes from each line's own tax code, never a hardcoded rate", () => {
    const t = rules.computeCosting([
      { qty: 2, unit_cost: 100, tax_rate_percent: 19.25 },
      { qty: 1, unit_cost: 100, tax_rate_percent: 0 },
      { qty: 1, unit_cost: 100 },
    ]);
    expect(t.total_ht).toBe(400);
    expect(t.vat_total).toBe(38.5);
    expect(t.total_ttc).toBe(438.5);
  });

  test("a disbursement is never taxed, whatever rate rides on the row", () => {
    // The DB refuses a tax code on a disbursement (chk_disbursement_no_tax);
    // this is the arithmetic agreeing with that rule rather than relying on it.
    const t = rules.computeCosting([
      { qty: 1, unit_cost: 1000, is_disbursement: true, tax_rate_percent: 19.25 },
    ]);
    expect(t.vat_total).toBe(0);
    expect(t.disbursement_total).toBe(1000);
    expect(t.total_ttc).toBe(1000);
  });

  test("the Maersk case: net in HT, the supplier's VAT budgeted into the total (12768)", () => {
    // Maersk invoices demurrage 100,000 + 19,250 VAT. The net is the débours
    // cost (in HT); the 19,250 we hand the carrier is cash the budget must
    // account for, so on this costing it counts toward the VAT and the TTC —
    // marked (PT), and named by `upstream_vat_total` as the part that is the
    // supplier's. (A costing is a budget, not a fiscal invoice.)
    const t = rules.computeCosting([
      { qty: 1, unit_cost: 100000, is_disbursement: true, upstream_vat_amount: 19250 },
    ]);
    expect(t.total_ht).toBe(100000);
    expect(t.vat_total).toBe(19250);
    expect(t.total_ttc).toBe(119250);
    // A memo now, inside vat_total: how much of the VAT is the supplier's on PT.
    expect(t.upstream_vat_total).toBe(19250);
  });

  test("upstream VAT on a service line is ignored — it would be double counting", () => {
    // Our own service VAT lives in the line's tax code. A number in this column
    // on a service line is a caller mistake and must not reach a total.
    const t = rules.computeCosting([
      { qty: 1, unit_cost: 1000, tax_rate_percent: 19.25, upstream_vat_amount: 500 },
    ]);
    expect(t.upstream_vat_total).toBe(0);
    expect(t.vat_total).toBe(192.5);
  });
});

describe("toXaf", () => {
  test("converts at the sheet's own rate — the one its approver saw", () => {
    expect(rules.toXaf(1000, 600)).toBe(600000);
  });
  test("a missing, zero or nonsense rate falls back to identity, never to zero", () => {
    // Multiplying by a null rate would silently erase the sheet from every
    // aggregate that reads this column.
    for (const bad of [null, undefined, 0, -1, "abc"]) {
      expect(rules.toXaf(1000, bad)).toBe(1000);
    }
  });
});

/* ══════════════════ 2. The amendment diff ═══════════════════════════════════ */

describe("diffLines", () => {
  const approved = rules.snapshotLines([
    { dictionary_item_id: ITEM_A, container_type_ref_id: TYPE_45, label: "Demurrage", qty: 1, unit_cost: 450000 },
    { dictionary_item_id: ITEM_B, label: "File Opening", qty: 1, unit_cost: 25000 },
  ]);

  test("the demurrage case: one changed line, one added, the rest counted", () => {
    const d = rules.diffLines(approved, [
      { dictionary_item_id: ITEM_A, container_type_ref_id: TYPE_45, label: "Demurrage", qty: 1, unit_cost: 780000 },
      { dictionary_item_id: ITEM_B, label: "File Opening", qty: 1, unit_cost: 25000 },
      { dictionary_item_id: "cccccccc-cccc-cccc-cccc-cccccccccccc", label: "Storage", qty: 3, unit_cost: 40000 },
    ]);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].label).toBe("Demurrage");
    expect(d.changed[0].was_amount).toBe(450000);
    expect(d.changed[0].amount).toBe(780000);
    expect(d.changed[0].delta).toBe(330000);
    expect(d.added).toHaveLength(1);
    expect(d.added[0].delta).toBe(120000);
    expect(d.removed).toHaveLength(0);
    // The unchanged line is COUNTED, not listed — the point of the block is
    // that an approver reads three rows, not fourteen.
    expect(d.unchanged_count).toBe(1);
    expect(d.delta_ht).toBe(450000);
    expect(d.has_changes).toBe(true);
  });

  test("a line is identified by charge AND container type, so per-box lines do not collide", () => {
    // Demurrage on a 45'HC and demurrage on a 40'HC share a dictionary item.
    // Keying on the item alone would report the second as a change to the first.
    const before = rules.snapshotLines([
      { dictionary_item_id: ITEM_A, container_type_ref_id: TYPE_45, label: "Demurrage", qty: 1, unit_cost: 95000 },
      { dictionary_item_id: ITEM_A, container_type_ref_id: TYPE_40, label: "Demurrage", qty: 1, unit_cost: 78000 },
    ]);
    const d = rules.diffLines(before, [
      { dictionary_item_id: ITEM_A, container_type_ref_id: TYPE_45, label: "Demurrage", qty: 1, unit_cost: 95000 },
      { dictionary_item_id: ITEM_A, container_type_ref_id: TYPE_40, label: "Demurrage", qty: 2, unit_cost: 78000 },
    ]);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].container_type_ref_id).toBe(TYPE_40);
    expect(d.unchanged_count).toBe(1);
  });

  test("re-saving an untouched sheet reports nothing", () => {
    // replaceLines deletes and re-inserts with fresh uuids, so a diff keyed on
    // costing_line_id would report every line as removed-and-added on save.
    const d = rules.diffLines(approved, [
      { dictionary_item_id: ITEM_A, container_type_ref_id: TYPE_45, label: "Demurrage", qty: 1, unit_cost: 450000 },
      { dictionary_item_id: ITEM_B, label: "File Opening", qty: 1, unit_cost: 25000 },
    ]);
    expect(d.has_changes).toBe(false);
    expect(d.unchanged_count).toBe(2);
    expect(d.delta_ht).toBe(0);
  });

  test("a removed line is reported with a negative delta", () => {
    const d = rules.diffLines(approved, [
      { dictionary_item_id: ITEM_A, container_type_ref_id: TYPE_45, label: "Demurrage", qty: 1, unit_cost: 450000 },
    ]);
    expect(d.removed).toHaveLength(1);
    expect(d.removed[0].label).toBe("File Opening");
    expect(d.removed[0].delta).toBe(-25000);
    expect(d.delta_ht).toBe(-25000);
  });

  test("a re-keyed line costing the same is not a change", () => {
    // 1 × 800,000 became 2 × 400,000. The money did not move, and an approver
    // looking for what changed should not be shown this.
    const before = rules.snapshotLines([{ dictionary_item_id: ITEM_A, label: "Freight", qty: 1, unit_cost: 800000 }]);
    const d = rules.diffLines(before, [{ dictionary_item_id: ITEM_A, label: "Freight", qty: 2, unit_cost: 400000 }]);
    expect(d.has_changes).toBe(false);
    expect(d.unchanged_count).toBe(1);
  });

  test("a free-typed line falls back to its label, so renaming reads as swap", () => {
    const before = rules.snapshotLines([{ label: "Port handling", qty: 1, unit_cost: 100 }]);
    const d = rules.diffLines(before, [{ label: "Port handling fee", qty: 1, unit_cost: 100 }]);
    expect(d.added).toHaveLength(1);
    expect(d.removed).toHaveLength(1);
  });
});

/* ══════════════════ 3. Suggest ══════════════════════════════════════════════ */

/**
 * A client that answers the six reads the builder makes. Each is matched on the
 * table it names, so the SQL asserted here is the SQL that runs.
 */
function stubClient({
  file = {},
  items = [],
  containers = [],
  rates = [],
  vat = null,
} = {}) {
  const state = { queries: [] };
  state.query = async (text, params) => {
    state.queries.push({ text, params });
    if (/FROM dossier_visible d/i.test(text)) {
      return {
        rows: file === null ? [] : [{
          dossier_id: DOSSIER, ref: "SLAS-2026-0001", entity_id: "e1", client_id: "c1",
          service_type_id: "st1", service_type_key: "SEA_FREIGHT_IMPORT",
          service_name_en: "Sea Freight Import", client_name: "FMA Services",
          rate_provider_id: "rp-msc", rate_provider_name: "MSC",
          gross_weight: 53266, weight_unit: "kg", package_count: 976, volume_cbm: 120,
          ...file,
        }],
      };
    }
    if (/FROM service_type_dictionary_item/i.test(text)) return { rows: items };
    if (/FROM dossier_container_line/i.test(text)) return { rows: containers };
    if (/FROM expense_rate/i.test(text)) return { rows: rates };
    if (/FROM entity_tax_registration/i.test(text)) return { rows: vat ? [vat] : [] };
    return { rows: [] };
  };
  return state;
}

const item = (over = {}) => ({
  dictionary_item_id: ITEM_A, code: "#E014", label_en: "Ocean Freight", label_fr: "Fret maritime",
  direction: "EXPENSE", category: "service", subcategory: "OCEAN_FREIGHT",
  unit_of_measure: "UNIT", is_disbursement: false, is_billable: true,
  varies_by_equipment: false, disbursement_vat_transparent: true,
  default_price: null, currency: "XAF", tier: "BASIC", sort_order: 101,
  ...over,
});

const box = (refId, code, qty) => ({
  container_type_ref_id: refId, qty, seq: 1,
  container_type_code: code, container_type_en: code, container_type_fr: code,
  container_type_extra: {},
});

const flat = (result) => result.bands.flatMap((b) => b.lines);

describe("suggest — the equipment expansion", () => {
  test("your file: one demurrage pick becomes one line per container type", async () => {
    // 01*45'HC, 01*40'HC — the marks string is generated from these same rows.
    const c = stubClient({
      items: [item({ varies_by_equipment: true, label_en: "Demurrage", unit_of_measure: "DAY" })],
      containers: [box(TYPE_45, "45'HC", 1), box(TYPE_40, "40'HC", 1)],
      rates: [
        { expense_rate_id: "r1", dictionary_item_id: ITEM_A, rate_provider_id: "rp-msc", container_type_ref_id: TYPE_45, rate: 95000, currency: "XAF", effective_from: "2026-07-01", effective_to: null },
        { expense_rate_id: "r2", dictionary_item_id: ITEM_A, rate_provider_id: "rp-msc", container_type_ref_id: TYPE_40, rate: 78000, currency: "XAF", effective_from: "2026-07-01", effective_to: null },
      ],
    });
    const out = await suggest.build(c, { dossierId: DOSSIER, tier: "FULL", onDate: "2026-09-03" });
    const lines = flat(out);
    expect(lines).toHaveLength(2);
    expect(lines[0].container_type_code).toBe("45'HC");
    expect(lines[0].unit_cost).toBe(95000);
    expect(lines[1].container_type_code).toBe("40'HC");
    expect(lines[1].unit_cost).toBe(78000);
    // Quantity is the BOX COUNT, and says so — a per-day charge still needs a
    // human to say how many days, which is a separate correction on the sheet.
    expect(lines.every((l) => l.qty === 1 && l.qty_basis === "CONTAINERS")).toBe(true);
    // Each names the box it was priced for, so the two are never confusable.
    expect(lines[0].rate_scope).toBe("CARRIER_AND_TYPE");
  });

  test("a container-blind charge is one line and never sees the expansion", async () => {
    const c = stubClient({
      items: [item({ label_en: "File Opening", unit_of_measure: "DOSSIER" })],
      containers: [box(TYPE_45, "45'HC", 1), box(TYPE_40, "40'HC", 1)],
    });
    const lines = flat(await suggest.build(c, { dossierId: DOSSIER }));
    expect(lines).toHaveLength(1);
    expect(lines[0].container_type_ref_id).toBeNull();
    expect(lines[0].qty).toBe(1);
  });

  test("an equipment charge on a file with no boxes yet is flagged, not dropped", async () => {
    const c = stubClient({ items: [item({ varies_by_equipment: true })], containers: [] });
    const lines = flat(await suggest.build(c, { dossierId: DOSSIER }));
    expect(lines).toHaveLength(1);
    expect(lines[0].needs_equipment).toBe(true);
    expect(lines[0].qty_basis).toBe("TYPED");
  });
});

describe("suggest — quantity drivers", () => {
  const file = { gross_weight: 53266, volume_cbm: 120, package_count: 976 };
  test.each([
    ["KG", 53266, "GROSS_WEIGHT"],
    ["TON", 53.27, "GROSS_WEIGHT"],
    ["CBM", 120, "VOLUME"],
    ["UNIT", 976, "PACKAGES"],
    ["BL", 1, "DEFAULT"],
    ["DOSSIER", 1, "DEFAULT"],
  ])("%s reads the file and says where it came from", (unit, qty, basis) => {
    expect(suggest.qtyFromUnit(unit, file)).toBe(qty);
    expect(suggest.qtyBasis(unit, qty)).toBe(basis);
  });

  test("DAY is left blank — nothing on the file knows how long the box will sit", () => {
    // A plausible wrong number here gets approved. A blank does not.
    expect(suggest.qtyFromUnit("DAY", file)).toBeNull();
    expect(suggest.qtyBasis("DAY", null)).toBe("TYPED");
  });

  test("a weight-priced charge on a file with no weight is blank, not zero", () => {
    expect(suggest.qtyFromUnit("KG", { gross_weight: 0 })).toBeNull();
  });
});

describe("suggest — the price cascade", () => {
  const ctx = { date: "2026-09-03", rateProviderId: "rp-msc", containerTypeRefId: null };

  test("a carrier rate wins over the catalogue default", () => {
    const p = suggest.priceLine(
      item({ default_price: 50000 }),
      [{ expense_rate_id: "r1", rate_provider_id: "rp-msc", container_type_ref_id: null, rate: 42000, currency: "XAF", effective_from: "2026-01-01", effective_to: null }],
      ctx,
    );
    expect(p.unit_cost).toBe(42000);
    expect(p.price_source).toBe("EXPENSE_RATE");
    expect(p.rate_scope).toBe("CARRIER");
  });

  test("no matching rate falls through to the catalogue default", () => {
    const p = suggest.priceLine(item({ default_price: 50000 }), [], ctx);
    expect(p.unit_cost).toBe(50000);
    expect(p.price_source).toBe("CATALOGUE_DEFAULT");
  });

  test("neither leaves the line blank and badged, never zero", () => {
    // Zero is a price. Blank is an admission, and it is what makes the
    // "needs a price" count on the wizard truthful.
    const p = suggest.priceLine(item({ default_price: null }), [], ctx);
    expect(p.unit_cost).toBeNull();
    expect(p.price_source).toBe("NONE");
  });

  test("an unscoped rate is labelled DEFAULT, not as this carrier's price", () => {
    const p = suggest.priceLine(
      item(),
      [{ expense_rate_id: "r1", rate_provider_id: null, container_type_ref_id: null, rate: 30000, currency: "XAF", effective_from: "2026-01-01", effective_to: null }],
      ctx,
    );
    expect(p.rate_scope).toBe("DEFAULT");
  });

  test("a rate outside its effective window is not used", () => {
    const p = suggest.priceLine(
      item({ default_price: 7 }),
      [{ expense_rate_id: "r1", rate_provider_id: "rp-msc", container_type_ref_id: null, rate: 30000, currency: "XAF", effective_from: "2020-01-01", effective_to: "2020-12-31" }],
      ctx,
    );
    expect(p.price_source).toBe("CATALOGUE_DEFAULT");
  });
});

describe("suggest — nature and VAT come from the catalogue", () => {
  const VAT = { tax_code_id: "tc-std", code: "TVA_STD", rate_percent: 19.25, regime: "REEL" };

  test("a service line gets the entity's VAT code by default", async () => {
    const c = stubClient({ items: [item()], vat: VAT });
    const [line] = flat(await suggest.build(c, { dossierId: DOSSIER }));
    expect(line.tax_code_id).toBe("tc-std");
    expect(line.tax_rate_percent).toBe(19.25);
  });

  test("a disbursement is offered NO VAT, whatever the entity's regime", async () => {
    // Legacy's sample sheet charged 19.25% on customs duty because the box
    // defaulted to ticked. The catalogue knows better, so nothing is offered.
    const c = stubClient({
      items: [item({ is_disbursement: true, label_en: "Customs Duties & Taxes" })],
      vat: VAT,
    });
    const [line] = flat(await suggest.build(c, { dossierId: DOSSIER }));
    expect(line.is_disbursement).toBe(true);
    expect(line.tax_code_id).toBeNull();
    // …and it is flagged for the upstream-VAT disclosure instead.
    expect(line.disbursement_vat_transparent).toBe(true);
  });

  test("a FRANCHISE-regime entity is offered no VAT at all", async () => {
    // The repo filters the regime out, so no code comes back and the default is
    // null — a correct answer, not a failure, and the reason is surfaced.
    const c = stubClient({ items: [item()], vat: null });
    const out = await suggest.build(c, { dossierId: DOSSIER });
    expect(flat(out)[0].tax_code_id).toBeNull();
    expect(out.defaults.tax_code_id).toBeNull();
  });
});

describe("suggest — the bands", () => {
  test("tiers nest and are banded, so no charge appears twice", async () => {
    const c = stubClient({
      items: [
        item({ tier: "BASIC", code: "#E001" }),
        item({ dictionary_item_id: ITEM_B, tier: "ADVANCED", code: "#E077", label_en: "Demurrage" }),
      ],
    });
    const out = await suggest.build(c, { dossierId: DOSSIER, tier: "ADVANCED" });
    expect(out.bands.map((b) => b.tier)).toEqual(["BASIC", "ADVANCED"]);
    expect(out.counts.total).toBe(2);
    // The rank the SQL filters on — ADVANCED pulls BASIC + ADVANCED.
    const q = c.queries.find((x) => /service_type_dictionary_item/i.test(x.text));
    expect(q.params[1]).toBe(2);
  });

  test("the counts tell the wizard what still needs a human", async () => {
    const c = stubClient({
      items: [
        item({ unit_of_measure: "DAY" }),
        item({ dictionary_item_id: ITEM_B, default_price: 1000, unit_of_measure: "BL" }),
      ],
    });
    const out = await suggest.build(c, { dossierId: DOSSIER });
    expect(out.counts.total).toBe(2);
    expect(out.counts.needs_price).toBe(1);
    expect(out.counts.needs_quantity).toBe(1);
    expect(out.counts.priced).toBe(1);
  });

  test("a file with no service type is refused with the field to go and fill", async () => {
    const c = stubClient({ file: { service_type_id: null } });
    await expect(suggest.build(c, { dossierId: DOSSIER })).rejects.toMatchObject({
      code: "NO_SERVICE_TYPE",
      status: 422,
    });
  });

  test("a missing file is a 404, not a crash", async () => {
    const c = stubClient({ file: null });
    await expect(suggest.build(c, { dossierId: DOSSIER })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

/* ══════════════════ 4. The migration's own promises ═════════════════════════ */

describe("migration 12766", () => {
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "..", "migrations", "tenant", "12766_costing_foundation.sql"),
    "utf8",
  );

  test("one live costing per file, and REJECTED never blocks its replacement", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_costing_one_live_per_dossier/);
    expect(sql).toMatch(/WHERE status <> 'REJECTED'/);
  });

  test("upstream VAT is constrained to pass-through lines", () => {
    expect(sql).toMatch(/chk_costing_line_upstream_vat/);
    expect(sql).toMatch(/is_disbursement = true AND upstream_vat_amount >= 0/);
  });

  test("the new constraint is NOT VALID, so the rewrite cannot fail on old rows", () => {
    expect(sql).toMatch(/chk_costing_line_upstream_vat[\s\S]{0,220}NOT VALID/);
  });

  test("line_no is backfilled, so no existing sheet reorders on deploy", () => {
    expect(sql).toMatch(/UPDATE costing_line cl/);
    expect(sql).toMatch(/row_number\(\) OVER \(PARTITION BY costing_id ORDER BY costing_line_id\)/);
  });

  test("the totals backfill honours the two rules computeCosting honours", () => {
    // A disbursement carries no VAT, and a service line's rate comes from its
    // own tax code. A backfill that used a hardcoded 19.25 would put a
    // different number in the column than the screen shows.
    expect(sql).toMatch(/CASE WHEN cl\.is_disbursement THEN 0/);
    expect(sql).toMatch(/COALESCE\(tc\.rate_percent, 0\)/);
    expect(sql).not.toMatch(/19\.25/);
  });

  test("it is additive and reversible by declaration", () => {
    expect(sql).toMatch(/-- DOWN/);
    expect(sql).not.toMatch(/^\s*DROP\s+(TABLE|COLUMN)/im);
  });
});

/* ══════════════════ 5. The invoice coupling is gone ═════════════════════════ */

describe("a costing opens no invoice (12766)", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "..", "..", p), "utf8");

  test("the service does not call the final-invoice module at all", () => {
    const svc = read("src/modules/costing/costing/costing.service.js");
    expect(svc).not.toMatch(/require\(.*final_invoice/);
    expect(svc).not.toMatch(/ensureDraftForCosting\(/);
  });

  test("the orchestration backstop is deregistered", () => {
    expect(read("src/orchestration/handlers/index.js")).not.toMatch(
      /register\(require\("\.\/costing-approved-draft-invoice"\)\)/,
    );
  });

  test("the dead function is removed rather than left to be re-wired", () => {
    expect(read("src/modules/finance/final_invoice/final_invoice.service.js"))
      .not.toMatch(/ensureDraftForCosting/);
  });
});
