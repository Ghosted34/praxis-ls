"use strict";
/**
 * Service type 360° aggregation (MOD-29).
 *
 * The aggregator composes six repo sub-queries into one payload; these tests
 * pin the four things a manual smoke test would not catch:
 *
 *   1. A brand-new service type renders — every collection defaults to `[]`
 *      and every figure to `0`, so the page after "New service type" is a
 *      working page rather than an error (same rule as party-360 / entity-360).
 *   2. Money is masked to zeros for a caller without finance visibility, and
 *      the `money.masked` flag is `true` so the UI can say so instead of
 *      silently rendering zeros.
 *   3. `readiness.has_active_template` reflects the templates collection,
 *      because the whole point of this screen is to make the "no chain" trap
 *      visible.
 *   4. `readiness.ever_billed` is `null` when finance is masked — the banner
 *      must not read "no revenue" from a masked view.
 */
const service_360 = require("../../src/modules/operations/service_type/service_type_360.service");
const repo = require("../../src/modules/operations/service_type/service_type.repo");

/** A tenant client whose query() returns whatever the test loads into it. Not
 *  routed by SQL — the repo functions themselves are stubbed. */
function fakeClient() {
  return { query: () => Promise.resolve({ rows: [] }) };
}

const ROW = {
  service_type_id: "st-1",
  key: "SEA_FREIGHT_IMPORT",
  name_fr: "Fret maritime import",
  name_en: "Sea freight import",
  territory: "INTERNATIONAL_IMPORT",
  is_system: false,
  is_active: true,
  created_at: "2026-08-01T00:00:00Z",
};

/**
 * Replace each repo method with a stub returning the given value; return a
 * restore fn that puts the originals back. Direct assignment rather than
 * jest.spyOn, because the repo exports are the `{...base, ...local}` spread
 * from `makeRepo` and spyOn refuses to swap them.
 *
 * THE ASSERTION BELOW IS THE POINT, AND ITS ABSENCE IS WHY A BUG SHIPPED.
 *
 * This stubbed `repo.get`. `repo.get` does not exist — `makeRepo` returns
 * `findById`, and only a SERVICE exposes `get` (shared/crud/resource.js:196).
 * Because direct assignment CREATES a missing key rather than failing on it,
 * the stub invented the method, all six tests passed, and
 * `service_type_360.service.js` shipped calling `repo.get(...)`. Production
 * answered `TypeError: repo.get is not a function` on every request to
 * `GET /api/tenant/service-types/:id/360` — ×6 before anyone noticed.
 *
 * A mock that can conjure the API it is testing is not a test of that API. The
 * guard makes the shape a precondition: stub something the repo does not
 * export and the suite fails here, loudly, instead of going green against a
 * fiction.
 */
function stubRepo({
  findById = ROW,
  templates = [],
  dictionary = { scoped: [], generic: [] },
  dossiers = [],
  margin = [],
  invoices = [],
  money = { planned: [], billed: [], actual_total: 0 },
  stats = {},
} = {}) {
  const original = {};
  const replacements = {
    findById: () => Promise.resolve(findById),
    templatesWithStages: () => Promise.resolve(templates),
    dictionaryItemsFor: () => Promise.resolve(dictionary),
    dossiersFor: () => Promise.resolve(dossiers),
    marginSimulationsFor: () => Promise.resolve(margin),
    invoicesFor: () => Promise.resolve(invoices),
    moneyRollup: () => Promise.resolve(money),
    stats: () => Promise.resolve(stats),
  };
  for (const k of Object.keys(replacements)) {
    // Refuse to stub a method the repo does not actually have. See the header.
    if (typeof repo[k] !== "function") {
      throw new Error(
        `stubRepo: service_type.repo has no \`${k}\` to stub. `
        + "Assigning it would invent the method and test a fiction — which is exactly "
        + "how `repo.get` reached production. Check shared/crud/resource.js for what "
        + "makeRepo actually returns (findById, not get).",
      );
    }
    original[k] = repo[k];
    repo[k] = replacements[k];
  }
  return () => {
    for (const k of Object.keys(replacements)) repo[k] = original[k];
  };
}

describe("service_type_360.dossier", () => {
  afterEach(() => jest.restoreAllMocks());

  test("brand-new service type renders — every collection empty, every figure zero", async () => {
    const restore = stubRepo();
    try {
      const out = await service_360.dossier(fakeClient(), "st-1", { canSeeFinancials: true });

      expect(out.service_type).toEqual(ROW);
      expect(out.templates).toEqual([]);
      expect(out.dictionary_items).toEqual([]);
      expect(out.dictionary_items_generic).toEqual([]);
      expect(out.dossiers).toEqual([]);
      expect(out.dossiers_more).toBe(0);
      expect(out.margin_simulations).toEqual([]);
      expect(out.margin_simulations_more).toBe(0);
      // stats fills in the zero defaults for every count when the repo returned {}.
      expect(out.stats.dossiers_total).toBe(0);
      expect(out.stats.template_versions).toBe(0);
      expect(out.stats.active_template_version).toBeNull();
      // readiness is all-false for a fresh row — the trap banner is what the UI
      // should render.
      expect(out.readiness.has_active_template).toBe(false);
      expect(out.readiness.has_dictionary_line).toBe(false);
      expect(out.readiness.ever_used).toBe(false);
    } finally {
      restore();
    }
  });

  test("readiness.has_active_template flips true when a template is active, and carries its version", async () => {
    const restore = stubRepo({
      templates: [
        { milestone_template_id: "t1", version: 2, is_active: true, stages: [] },
        { milestone_template_id: "t0", version: 1, is_active: false, stages: [] },
      ],
      stats: { template_versions: 2 },
    });
    try {
      const out = await service_360.dossier(fakeClient(), "st-1", { canSeeFinancials: true });
      expect(out.readiness.has_active_template).toBe(true);
      expect(out.readiness.active_template_version).toBe(2);
    } finally {
      restore();
    }
  });

  test("money is masked to zeros AND readiness.ever_billed is null when caller has no finance visibility", async () => {
    const restore = stubRepo({
      money: {
        planned: [{ currency: "XAF", planned_total: 100, planned_debours: 20 }],
        billed: [{ currency: "XAF", billed_ttc: 500, revenue_ht: 400, invoice_count: 3 }],
        actual_total: 42,
      },
      // invoicesFor won't even be called by the aggregator when canSee=false,
      // but the stub is here in case that changes.
      invoices: [{ invoice_id: "i1" }],
    });
    try {
      const out = await service_360.dossier(fakeClient(), "st-1", { canSeeFinancials: false });
      expect(out.money.masked).toBe(true);
      expect(out.money.planned).toEqual([]);
      expect(out.money.billed).toEqual([]);
      expect(out.money.actual_total).toBe(0);
      // The invoices list is fetched only for callers who can see them —
      // aggregator skipped it, so nothing leaks even though the stub had rows.
      expect(out.invoices).toEqual([]);
      // ever_billed is null (not false) so the UI does not imply "no revenue"
      // from a masked view.
      expect(out.readiness.ever_billed).toBeNull();
    } finally {
      restore();
    }
  });

  test("finance-visible caller sees billed money and readiness.ever_billed", async () => {
    const restore = stubRepo({
      money: {
        planned: [],
        billed: [{ currency: "XAF", billed_ttc: 500, revenue_ht: 400, invoice_count: 3 }],
        actual_total: 42,
      },
      invoices: [{ invoice_id: "i1", doc_number: "INV-1" }],
    });
    try {
      const out = await service_360.dossier(fakeClient(), "st-1", { canSeeFinancials: true });
      expect(out.money.masked).toBe(false);
      expect(out.money.billed).toEqual([{ currency: "XAF", billed_ttc: 500, revenue_ht: 400, invoice_count: 3 }]);
      expect(out.money.actual_total).toBe(42);
      expect(out.readiness.ever_billed).toBe(true);
      expect(out.invoices).toHaveLength(1);
    } finally {
      restore();
    }
  });

  test("dossiers_more counts the remainder past the 25-row window", async () => {
    const restore = stubRepo({
      dossiers: [{ dossier_id: "d1" }, { dossier_id: "d2" }],
      stats: { dossiers_total: 30 },
    });
    try {
      const out = await service_360.dossier(fakeClient(), "st-1", { canSeeFinancials: true });
      expect(out.dossiers_more).toBe(28);
    } finally {
      restore();
    }
  });

  test("scoped and generic dictionary items are returned as separate collections", async () => {
    const restore = stubRepo({
      dictionary: {
        scoped: [{ dictionary_item_id: "s1", code: "SEA_HANDLING", is_active: true }],
        generic: [{ dictionary_item_id: "g1", code: "ADMIN_FEE", is_active: true }],
      },
    });
    try {
      const out = await service_360.dossier(fakeClient(), "st-1", { canSeeFinancials: true });
      expect(out.dictionary_items).toEqual([{ dictionary_item_id: "s1", code: "SEA_HANDLING", is_active: true }]);
      expect(out.dictionary_items_generic).toEqual([{ dictionary_item_id: "g1", code: "ADMIN_FEE", is_active: true }]);
      expect(out.readiness.has_dictionary_line).toBe(true);
    } finally {
      restore();
    }
  });

  test("throws NOT_FOUND when the service type does not exist", async () => {
    const restore = stubRepo({ findById: null });
    try {
      await expect(service_360.dossier(fakeClient(), "st-missing")).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
      });
    } finally {
      restore();
    }
  });
});
