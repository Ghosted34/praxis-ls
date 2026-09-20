"use strict";

/**
 * PR-04 — the MOD-01 tax/registration-number boundary (Decision Q3).
 *
 * The audit's selected policy separates THREE audiences, and these tests pin
 * the middle one and its edges:
 *
 *   public site        explicit allow-list, no statutory identifiers at all;
 *   MOD-01 view        full tax/registration numbers and renewal labels,
 *                      consistently across every surface that can name them;
 *   everyone else      no numbers, no tax-number-containing labels — the row
 *                      keeps its kind/country/dates so the compliance story
 *                      still renders.
 *
 * Documents, vault references and the cap table stay behind the harder
 * governance (UPDATE) grant exactly as before; PR-04 moves only the NUMBERS
 * to the view boundary, and the SERIALIZER enforces it — asserted here by
 * calling the serializers directly with a caller who has edit but NOT view,
 * which no route can produce today and therefore only the serializer can
 * catch if it regresses.
 *
 * ── WHY THESE ASSERT ON THE SERIALISED BODY ────────────────────────────────
 *
 * Same reason as site-public-redaction.test.js: checking the returned object's
 * keys passes forever and protects nothing. Every denial assertion stringifies
 * the WHOLE response and searches the text for a value that must never appear,
 * so a leak anywhere in the tree, at any depth, through any refactor, fails.
 * The secrets are deliberately distinctive so a match cannot be a coincidence.
 */

let MOCK_GRANTS_BY_MODULE = {};

jest.mock("../../src/shared/cache/identity-cache", () => ({
  getGrants: async (_client, { module }) => MOCK_GRANTS_BY_MODULE[module] || [],
  getUserScopeClosure: async () => [],
}));

/*
 * The repo, mocked at module level so every consumer (dossier, service,
 * nested routes) reads the SAME rows a real tenant would return. Dates are
 * computed relative to load time so the expiry fixtures always sit inside the
 * renewals windows no matter when the suite runs.
 */
jest.mock("../../src/modules/master/corporate_entity/corporate_entity.repo", () => {
  const soon = (days) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const entity = {
    entity_id: "e1",
    code: "SLAS",
    legal_name: "Smart Logistics and Services Ltd",
    legal_form: "SARL",
    share_capital: 100000000,
    share_capital_currency: "XAF",
    default_currency: "XAF",
    default_language: "en",
    email: "info@slas.cm",
    country_code: "CM",
    niu: "P012345678901X",
    rccm: "RCCM/CM/DLA/2021/B/9999",
    address: "123 Rue de la Gare, Douala",
    bank_block: {
      bank_name: "Afriland First Bank",
      account_number: "10005000123456789012",
      iban: "CM2110003000010020045678941",
      swift: "CCEICMCX",
    },
  };
  const registrations = [
    { registration_id: "r1", entity_id: "e1", kind: "NIU", number: "P012345678901X", country_code: "CM", is_primary: true, expires_on: soon(30) },
    { registration_id: "r2", entity_id: "e1", kind: "VAT", number: "FR40123456789", country_code: "FR", is_primary: false, expires_on: soon(45) },
  ];
  const taxRegistrations = [
    {
      tax_registration_id: "t1", entity_id: "e1", jurisdiction_id: null, jurisdiction_name: "France",
      country_code: "FR", tax_kind: "VAT", tax_number: "FR40123456789", regime: "STANDARD",
      filing_frequency: "MONTHLY", filing_due_day: 20, currency: "EUR",
      is_withholding_agent: false, reverse_charge_applies: false,
      registered_on: "2024-01-01", deregistered_on: soon(40), is_primary: true, is_active: true,
      responsible_name: "Awa Fiscal", notes: null,
    },
  ];
  const documents = [
    {
      document_id: "d1", entity_id: "e1", document_type_id: "dt1",
      document_type_code: "TAX_CLEARANCE", document_type_name: "Tax clearance certificate",
      title: null, document_number: "MOD01-DOC-2026-0042", issuing_authority: "DGI",
      issued_on: soon(-335), expires_on: soon(20), country_code: "CM",
      vault_id: "v1", storage_path: "tenant_x/entity/d1.pdf", vault_hash: "abc123",
      physical_ref: "Filing cabinet 2", notes: "Original in Douala office",
      renewal_lead_days: null, type_renewal_lead_days: null, default_severity: "WARN",
      is_active: true, scan_status: "SCANNED", verification_status: "PENDING",
    },
  ];
  const taxObligations = [
    {
      tax_calendar_id: "c1", entity_id: "e1", obligation: "VAT return",
      period_code: "2026-09", due_on: soon(15), status: "PENDING",
      tax_registration_id: "t1", tax_kind: "VAT", country_code: "FR", tax_number: "FR40123456789",
    },
  ];
  const addresses = [
    { address_id: "a1", entity_id: "e1", type: "REGISTERED", line1: "123 Rue de la Gare", line2: null, city: "Douala", region: null, postal_code: null, po_box: "BP 5120", country_code: "CM", is_primary: true, is_active: true },
  ];
  const collections = () => ({
    people: [], contacts: [], addresses, registrations, establishments: [],
  });
  return {
    WRITABLE: [], LETTERHEAD_WRITABLE: [],
    get: async () => entity,
    getByCode: async () => null,
    first: async () => entity,
    list: async () => [entity],
    collections,
    children: async () => [],
    ancestors: async () => [],
    usage: async () => ({ journal_entries: 0, employees: 0, treasury_accounts: 0, subsidiaries: 0 }),
    treasuryAccounts: async () => [
      { treasury_account_id: "ta1", kind: "BANK", label: "Main", bank_name: "Afriland First Bank", account_number: "10005000123456789012", iban: "CM2110003000010020045678941", swift_bic: "CCEICMCX", currency: "XAF", is_active: true, is_primary: true, show_on_documents: true },
    ],
    documentsAndTax: async () => ({ documents, tax_registrations: taxRegistrations, letterhead: null }),
    taxObligations: async () => taxObligations,
    letterheadLines: async () => [],
    // Exposed for the tests' own assertions (the real repo has no such member;
    // this mock is only ever required by test code that knows it is a mock).
    __fixtures: { entity, registrations, taxRegistrations, documents, taxObligations },
  };
});

const dossierService = require("../../src/modules/master/entity-360.service");
const entityService = require("../../src/modules/master/corporate_entity/corporate_entity.service");
const renewalRules = require("../../src/modules/master/corporate_entity/corporate_entity.renewals");
const { canSeeRegistrations } = require("../../src/modules/master/_shared/confidential");
const { mountEntityNested } = require("../../src/modules/master/_shared/nested");
const { publicEntities } = require("../../src/modules/site/site_settings/site_settings.service");
const { resolveContext, buildWorkbook } = require("../../src/services/spreadsheet");
const entityCards = require("../../src/services/ai/knowledge/entity-cards");
const repo = require("../../src/modules/master/corporate_entity/corporate_entity.repo");

const express = require("express");
const request = require("supertest");
require("../../src/shared/http/async-safe");
const { errorHandler, notFoundHandler } = require("../../src/middleware/error-handler");

/*
 * Distinctive values, never a substring of one another, so `body.includes`
 * cannot cross-match (the RCCM deliberately embeds a different tail from the
 * VAT number, and the document number is its own shape).
 */
const SECRETS = {
  niu: "P012345678901X",
  rccm: "RCCM/CM/DLA/2021/B/9999",
  vat: "FR40123456789",
  documentNumber: "MOD01-DOC-2026-0042",
  accountNumber: "10005000123456789012",
};

const soon = (days) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** The tenant db client — never queried: the repo is mocked at module level. */
const NO_CLIENT = { query: async () => ({ rows: [], rowCount: 0 }) };

const VIEWER_CAPS = { view: true, edit: false, approve: false, public_story: false };
const EDITOR_CAPS = { view: true, edit: true, approve: true, public_story: true };
// No route can produce this caller today (view is the floor of every read
// gate); it exists to prove the SERIALIZER, not the route, is the authority.
const EDIT_WITHOUT_VIEW = { view: false, edit: true, approve: true, public_story: true };

const makeReq = (user, grants = {}) => ({
  user,
  identityDb: (fn) => fn(NO_CLIENT),
  tenantDb: (fn) => fn(NO_CLIENT),
  ...grants,
});

const USER = { user_id: "u1", role_ids: ["r1"], is_ceo: false };

beforeEach(() => {
  MOCK_GRANTS_BY_MODULE = {};
});

/* ── The capability itself ────────────────────────────────────────────────── */

describe("canSeeRegistrations — MOD-01 view, on its own", () => {
  it("is exactly the can_read column the /360 bundle reports as capabilities.view", async () => {
    MOCK_GRANTS_BY_MODULE = { "MOD-01": [{ can_read: true }] };
    const caps = await dossierService.capabilitiesFor(makeReq(USER));
    expect(await canSeeRegistrations(makeReq(USER))).toBe(true);
    expect(caps.view).toBe(true);
  });

  it("denies a caller whose only grant is MOD-01 update (the serializer's case)", async () => {
    MOCK_GRANTS_BY_MODULE = { "MOD-01": [{ can_update: true }] };
    expect(await canSeeRegistrations(makeReq(USER))).toBe(false);
  });

  it("denies with no grants, no user, no identityDb — fail closed", async () => {
    expect(await canSeeRegistrations(makeReq(USER))).toBe(false);
    expect(await canSeeRegistrations({ identityDb: (fn) => fn(NO_CLIENT) })).toBe(false);
    expect(await canSeeRegistrations({ user: USER })).toBe(false);
    expect(await canSeeRegistrations(null)).toBe(false);
  });

  it("the CEO sees them without a lookup", async () => {
    expect(await canSeeRegistrations(makeReq({ ...USER, is_ceo: true }))).toBe(true);
  });

  it("is not the financials grant — bank visibility is a different question", async () => {
    MOCK_GRANTS_BY_MODULE = { "MOD-09": [{ can_read: true }] };
    expect(await canSeeRegistrations(makeReq(USER))).toBe(false);
    expect(await dossierService.canSeeFinancials(makeReq(USER))).toBe(true);
  });
});

/* ── GET /entities/:id/360 — the dossier serializer ───────────────────────── */

describe("GET /entities/:id/360 — serialized tax boundary", () => {
  it("MOD-01 view: full tax/registration numbers on every surface that names them", async () => {
    const data = await dossierService.dossier(NO_CLIENT, "e1", {
      governance: false, financials: false, capabilities: VIEWER_CAPS, tax: true,
    });

    // The collections carry the numbers.
    expect(data.registrations.find((r) => r.kind === "NIU").number).toBe(SECRETS.niu);
    expect(data.tax_registrations[0].tax_number).toBe(SECRETS.vat);
    expect(data.tax_obligations[0].tax_number).toBe(SECRETS.vat);
    // So does the entity row's legacy spelling...
    expect(data.entity.niu).toBe(SECRETS.niu);
    expect(data.entity.rccm).toBe(SECRETS.rccm);
    // ...the letterhead source and its rendered preview...
    expect(data.letterhead_source.niu).toBe(SECRETS.niu);
    expect(data.letterhead_source.rccm).toBe(SECRETS.rccm);
    expect(data.letterhead_source.vat_number).toBe(SECRETS.vat);
    expect(data.letterhead_preview.identifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "NIU", number: SECRETS.niu }),
        expect.objectContaining({ kind: "VAT", number: SECRETS.vat }),
      ]),
    );
    expect(data.letterhead_preview.footer.identifier_line).toContain(SECRETS.vat);
    // ...the renewal labels...
    expect(data.renewals.items.find((i) => i.kind === "TAX_REGISTRATION").label)
      .toBe(`VAT ${SECRETS.vat}`);
    expect(data.renewals.items.find((i) => i.kind === "REGISTRATION").label)
      .toBe(`NIU ${SECRETS.niu}`);
    // ...and the expiring list.
    expect(data.expiring_registrations.find((r) => r.kind === "NIU").number).toBe(SECRETS.niu);
  });

  it("MOD-01 view keeps the DOCUMENT redaction — the governance gate is untouched", async () => {
    const data = await dossierService.dossier(NO_CLIENT, "e1", {
      governance: false, financials: false, capabilities: VIEWER_CAPS, tax: true,
    });
    const body = JSON.stringify(data);
    expect(body).not.toContain(SECRETS.documentNumber);
    expect(data.documents[0].redacted).toBe(true);
  });

  it("MOD-01 edit/approve: numbers AND unredacted documents together", async () => {
    const data = await dossierService.dossier(NO_CLIENT, "e1", {
      governance: true, financials: true, capabilities: EDITOR_CAPS, tax: true,
    });
    const body = JSON.stringify(data);
    for (const s of [SECRETS.niu, SECRETS.rccm, SECRETS.vat, SECRETS.documentNumber]) {
      expect(body).toContain(s);
    }
    expect(data.documents[0].redacted).toBeUndefined();
    expect(data.can_see_governance).toBe(true);
  });

  it("no MOD-01 view: the serialized body carries no tax/registration number, anywhere", async () => {
    // The AI-read shape: no capabilities resolved, tax not asserted.
    const data = await dossierService.dossier(NO_CLIENT, "e1", {});
    const body = JSON.stringify(data);
    for (const s of [SECRETS.niu, SECRETS.rccm, SECRETS.vat, SECRETS.documentNumber]) {
      expect(body).not.toContain(s);
    }
  });

  it("no MOD-01 view: rows keep their shape and mark themselves, so the page explains the gap", async () => {
    const data = await dossierService.dossier(NO_CLIENT, "e1", { tax: false });
    expect(data.registrations[0]).toMatchObject({ kind: "NIU", redacted: true });
    expect(data.registrations[0]).not.toHaveProperty("number");
    expect(data.tax_registrations[0]).toMatchObject({ tax_kind: "VAT", redacted: true });
    expect(data.tax_registrations[0]).not.toHaveProperty("tax_number");
    expect(data.tax_obligations[0]).not.toHaveProperty("tax_number");
    expect(data.entity.niu).toBeNull();
    expect(data.entity.rccm).toBeNull();
    expect(data.entity.registrations_redacted).toBe(true);
  });

  it("no MOD-01 view: renewal labels degrade to the kind, and the advisory posture survives", async () => {
    const data = await dossierService.dossier(NO_CLIENT, "e1", { tax: false });
    const tax = data.renewals.items.find((i) => i.kind === "TAX_REGISTRATION");
    const reg = data.renewals.items.find((i) => i.kind === "REGISTRATION");
    // Still listed — an operator without the grant still learns the VAT
    // registration lapses; they just are not handed the identifier.
    expect(tax.label).toBe("VAT");
    expect(reg.label).toBe("NIU");
    expect(tax.state).toBeTruthy();
    expect(data.expiring_registrations.find((r) => r.kind === "NIU").number).toBeNull();
  });;

  it("no MOD-01 view: the letterhead source and preview lose the identifiers without breaking", async () => {
    const data = await dossierService.dossier(NO_CLIENT, "e1", { tax: false });
    expect(data.letterhead_source).toMatchObject({
      niu: null, rccm: null, vat_number: null, eori: null,
    });
    expect(data.letterhead_source.other_registrations).toEqual([]);
    expect(data.letterhead_preview.identifiers).toEqual([]);
    expect(data.letterhead_preview.footer.identifier_line).toBeNull();
  });

  it("the SERIALIZER is the authority: edit-without-view gets documents but not numbers", async () => {
    // A caller no route can produce — capabilities.view false while the
    // governance grant holds. If the boundary lived only in the route gates,
    // this shape would leak; the serializer must not.
    const data = await dossierService.dossier(NO_CLIENT, "e1", {
      governance: true, financials: false, capabilities: EDIT_WITHOUT_VIEW, tax: false,
    });
    const body = JSON.stringify(data);
    expect(body).toContain(SECRETS.documentNumber);
    for (const s of [SECRETS.niu, SECRETS.rccm, SECRETS.vat]) {
      expect(body).not.toContain(s);
    }
  });

  it("PR-10 / A0: the Banking tab and payment block follow MOD-01 view, NOT the financials grant", async () => {
    // The owner's binding decision: bank_name / account_number / holder are
    // visible on the Entity-360 Banking & treasury tab and the letterhead
    // payment block to every caller with MOD-01 view — the financials
    // (MOD-09 read) grant no longer narrows these two surfaces. The legacy
    // `bank_block` on the MASTER RECORD stays masked (asserted below), and the
    // Treasury module's own dossier keeps gate 14 — only these two surfaces
    // opened. Full coverage: tests/unit/entity-primary-account.test.js.
    const noFinancials = await dossierService.dossier(NO_CLIENT, "e1", { tax: true, financials: false, capabilities: { view: true, edit: false, approve: false, public_story: false } });
    // The treasury rows and the letterhead preview's payment block carry the
    // real numbers, unmasked, for this MOD-01 viewer…
    expect(noFinancials.treasury_accounts[0].account_number).toBe(SECRETS.accountNumber);
    expect(noFinancials.treasury_accounts[0].masked).toBeUndefined();
    expect(noFinancials.letterhead_preview.payment_block.accounts[0].account_number).toBe(SECRETS.accountNumber);
    // …while the master record's legacy bank_block stays masked for this
    // caller — the relaxation is scoped to the two surfaces, not the row.
    expect(noFinancials.entity.bank_block.account_number).toBe("••••9012");
    expect(noFinancials.entity.bank_block.masked).toBe(true);
  });
});

/* ── GET /entities/:id/renewals ───────────────────────────────────────────── */

describe("GET /entities/:id/renewals — serialized labels", () => {
  it("MOD-01 view: labels name the number", async () => {
    const out = await entityService.renewals(NO_CLIENT, "e1", soon(0), { governance: false, tax: true });
    const body = JSON.stringify(out);
    expect(body).toContain(`NIU ${SECRETS.niu}`);
    expect(body).toContain(`VAT ${SECRETS.vat}`);
    expect(body).not.toContain(SECRETS.documentNumber);
  });

  it("no MOD-01 view: labels are kind-only", async () => {
    const out = await entityService.renewals(NO_CLIENT, "e1", soon(0), { governance: false, tax: false });
    const body = JSON.stringify(out);
    expect(body).not.toContain(SECRETS.niu);
    expect(body).not.toContain(SECRETS.vat);
    expect(out.items.find((i) => i.kind === "TAX_REGISTRATION").label).toBe("VAT");
  });

  it("defaults fail closed: a call site that asserts nothing gets redacted rows", async () => {
    const out = await entityService.renewals(NO_CLIENT, "e1", soon(0));
    const body = JSON.stringify(out);
    expect(body).not.toContain(SECRETS.niu);
    expect(body).not.toContain(SECRETS.vat);
    expect(body).not.toContain(SECRETS.documentNumber);
  });

  it("current-row rule composes with redaction: the selected row is chosen from the REDACTED rows", async () => {
    // doc/CORPORATE_ENTITY_REGISTRATION_CURRENT_ROW.md, consumed here (PR-03 →
    // PR-04): renewals monitor the selected registration per (country, kind).
    // Selection reads is_primary/country/kind — all of which survive PR-04
    // redaction (only the number is deleted) — so the serializer boundary and
    // the lifecycle boundary stack instead of interfering.
    const redacted = [
      dossierService.redactRegistration({ registration_id: "r-old", kind: "NIU", number: "P0OLD", country_code: "CM", is_primary: false, expires_on: soon(5) }),
      dossierService.redactRegistration({ registration_id: "r1", kind: "NIU", number: SECRETS.niu, country_code: "CM", is_primary: true, expires_on: soon(30) }),
    ];
    const { selected, ambiguous } = renewalRules.selectedRegistrations(redacted);
    expect(selected.map((r) => r.registration_id)).toEqual(["r1"]);
    expect(ambiguous).toEqual([]);
    expect(selected[0].redacted).toBe(true);
    expect(selected[0]).not.toHaveProperty("number");

    // And the full rule output over those rows: the superseded row's sooner
    // expiry contributes nothing — not even a label — at any grant level.
    const out = renewalRules.renewals({ registrations: redacted }, soon(0));
    expect(out.items).toHaveLength(1);
    expect(out.items[0].id).toBe("r1");
    expect(out.items[0].label).toBe("NIU");
  });
});

/* ── GET /entities/:id/letterhead ─────────────────────────────────────────── */

describe("GET /entities/:id/letterhead — source and preview", () => {
  it("MOD-01 view: the identifier line prints the registrations", async () => {
    const out = await entityService.letterhead(NO_CLIENT, "e1", "en", { tax: true });
    expect(out.preview.en.identifiers).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "NIU", number: SECRETS.niu })]),
    );
    expect(out.preview.en.footer.identifier_line).toContain(SECRETS.niu);
    expect(out.preview.en.footer.identifier_line).toContain(SECRETS.vat);
  });

  it("no MOD-01 view: no identifier anywhere in the bundle, layout intact", async () => {
    const out = await entityService.letterhead(NO_CLIENT, "e1", "en", { tax: false });
    const body = JSON.stringify(out);
    for (const s of [SECRETS.niu, SECRETS.rccm, SECRETS.vat]) {
      expect(body).not.toContain(s);
    }
    // The letterhead itself still renders — company line, address, contact.
    expect(out.preview.en.header.company_line).toContain("Smart Logistics and Services Ltd");
    expect(out.preview.en.header.address_line).toContain("123 Rue de la Gare");
  });

  it("defaults fail closed", async () => {
    const body = JSON.stringify(await entityService.letterhead(NO_CLIENT, "e1", "en"));
    for (const s of [SECRETS.niu, SECRETS.rccm, SECRETS.vat]) {
      expect(body).not.toContain(s);
    }
  });
});

/* ── Nested child routes — /entities/:id/registrations, /tax-registrations ── */

describe("nested child routes — registrations and tax-registrations", () => {
  function nestedApp(req) {
    const app = express();
    app.use((req_, _res, next) => {
      Object.assign(req_, req);
      next();
    });
    const router = express.Router();
    mountEntityNested(router, { moduleKey: "MOD-01", parentTable: "corporate_entity", parentPk: "entity_id" });
    app.use("/entities", router);
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
  }

  /** A req whose tenantDb answers the two child collections under test. */
  const nestedReq = (user) => ({
    user,
    identityDb: (fn) => fn(NO_CLIENT),
    tenantDb: (fn) => fn({
      query: async (sql) => {
        const text = String(sql);
        if (/\bentity_tax_registration\b/.test(text)) return { rows: repo.__fixtures.taxRegistrations, rowCount: 1 };
        if (/\bentity_registration\b/.test(text)) return { rows: repo.__fixtures.registrations, rowCount: 2 };
        return { rows: [], rowCount: 0 };
      },
    }),
  });

  it("MOD-01 view obtains the numbers through the child routes", async () => {
    MOCK_GRANTS_BY_MODULE = { "MOD-01": [{ can_read: true }] };
    const app = nestedApp(nestedReq(USER));
    const reg = await request(app).get("/entities/e1/registrations");
    expect(reg.status).toBe(200);
    expect(JSON.stringify(reg.body)).toContain(SECRETS.niu);
    const tax = await request(app).get("/entities/e1/tax-registrations");
    expect(tax.status).toBe(200);
    expect(JSON.stringify(tax.body)).toContain(SECRETS.vat);
  });

  it("a caller without MOD-01 view cannot obtain them — the route refuses", async () => {
    MOCK_GRANTS_BY_MODULE = {}; // no MOD-01 grant at all
    const app = nestedApp(nestedReq(USER));
    expect((await request(app).get("/entities/e1/registrations")).status).toBe(403);
    expect((await request(app).get("/entities/e1/tax-registrations")).status).toBe(403);
  });

  it("the serializer holds when the route gate is not the thing that stopped the caller", async () => {
    // MOD-01 create+update but NOT read: the route's `view` gate happens to
    // refuse this caller today, so this exercises the redaction branch the
    // way a future weaker gate would — the rows must come back without the
    // numbers even though the caller holds harder grants.
    MOCK_GRANTS_BY_MODULE = { "MOD-01": [{ can_create: true, can_update: true }] };
    const canSee = await canSeeRegistrations(makeReq(USER));
    expect(canSee).toBe(false);
    const rows = repo.__fixtures.registrations.map(dossierService.redactRegistration);
    expect(JSON.stringify(rows)).not.toContain(SECRETS.niu);
    expect(rows[0].redacted).toBe(true);
  });
});;

/* ── Exports — the branded workbook cover ─────────────────────────────────── */

describe("exports — the branded cover follows the same boundary", () => {
  function exportClient({ entity }) {
    return {
      query: async (sql) => {
        const text = String(sql);
        if (text.includes("FROM setting")) return { rows: [], rowCount: 0 };
        if (text.includes("FROM corporate_entity")) return { rows: entity ? [entity] : [], rowCount: entity ? 1 : 0 };
        return { rows: [], rowCount: 0 };
      },
    };
  }

  const entityRow = {
    entity_id: "e1",
    legal_name: "Smart Logistics and Services Ltd",
    rccm: SECRETS.rccm,
    niu: SECRETS.niu,
    address: "123 Rue de la Gare, Douala",
    default_language: "en",
    timezone: "Africa/Douala",
  };

  it("resolveContext omits the identifiers unless the caller holds MOD-01 view", async () => {
    const denied = await resolveContext(exportClient({ entity: entityRow }), {});
    expect(denied.entity.legal_name).toBe("Smart Logistics and Services Ltd");
    expect(denied.entity.rccm).toBeNull();
    expect(denied.entity.niu).toBeNull();

    const allowed = await resolveContext(exportClient({ entity: entityRow }), { registrationNumbers: true });
    expect(allowed.entity.rccm).toBe(SECRETS.rccm);
    expect(allowed.entity.niu).toBe(SECRETS.niu);
  });

  it("the built workbook's cover carries the numbers only when permitted", async () => {
    const sheets = [{ name: "T", columns: [{ header: "A", key: "a" }], rows: [] }];
    const coverText = async (opts) => {
      const context = await resolveContext(exportClient({ entity: entityRow }), opts);
      const buf = await buildWorkbook({ sheets, context, cover: true });
      const ExcelJS = require("exceljs");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      let text = "";
      wb.worksheets[0].eachRow((row) => row.eachCell((cell) => { text += ` ${JSON.stringify(cell.value)}`; }));
      return text;
    };
    const denied = await coverText({});
    expect(denied).toContain("Smart Logistics and Services Ltd");
    expect(denied).not.toContain(SECRETS.rccm);
    expect(denied).not.toContain(SECRETS.niu);
    const allowed = await coverText({ registrationNumbers: true });
    expect(allowed).toContain(SECRETS.rccm);
    expect(allowed).toContain(SECRETS.niu);
  });
});

/* ── AI reads ─────────────────────────────────────────────────────────────── */

describe("AI reads — knowledge cards name the registration, never the number", () => {
  const builder = (key) => entityCards.BUILDERS.find((b) => b.key === key);

  it("the entity_registration card grounds the fact without the identifier", () => {
    const card = builder("entity_registration").card({
      kind: "NIU", number: SECRETS.niu, country_code: "CM",
      issuing_authority: "DGI", is_primary: true,
      entity_code: "SLAS", legal_name: "Smart Logistics and Services Ltd",
    });
    expect(card.text).toContain("holds NIU in CM");
    expect(card.text).toContain("primary for that country");
    expect(card.text).not.toContain(SECRETS.niu);
  });

  it("the corporate_entity card never selected the identifiers to begin with", () => {
    const card = builder("corporate_entity").card({
      code: "SLAS", legal_name: "Smart Logistics and Services Ltd",
      country_code: "CM", registration_status: "ACTIVE", is_active: true,
    });
    expect(card.text).not.toContain(SECRETS.niu);
    expect(card.text).not.toContain(SECRETS.rccm);
  });

  it("the exact values come from the permission-gated tools, which demand MOD-01 view or above", () => {
    const ai = require("../../src/modules/master/corporate_entity/corporate_entity.ai");
    const keyed = Object.fromEntries(ai.reads.map((r) => [r.key, r]));
    for (const key of ["get_entity", "get_entity_360", "get_entity_renewals", "get_entity_letterhead"]) {
      const perm = keyed[key].permission;
      expect(perm.module).toBe("MOD-01");
      expect(["view", "edit"]).toContain(perm.action);
    }
  });
});

/* ── The anonymous public site ────────────────────────────────────────────── */

describe("the anonymous public site — allow-list, no regression", () => {
  // The primary guard for this surface is tests/unit/site-public-redaction.test.js;
  // this mirrors its assertion so PR-04's own suite states the full boundary.
  function stubClient(tables) {
    return {
      query: async (sql) => {
        const text = String(sql);
        for (const [table, rows] of Object.entries(tables)) {
          if (new RegExp(`\\b${table}\\b`).test(text)) return { rows, rowCount: rows.length };
        }
        return { rows: [], rowCount: 0 };
      },
    };
  }

  it("public entity JSON never carries a statutory identifier, at any depth", async () => {
    const client = stubClient({
      corporate_entity: [{
        entity_id: "e1", code: "SLAS",
        legal_name: "Smart Logistics and Services Ltd",
        trading_name: "Smart Logistics", country_code: "CM",
        rccm: SECRETS.rccm, niu: SECRETS.niu,
        public_summary_fr: "Transitaire à Douala.",
        public_summary_en: "Freight forwarder in Douala.",
        public_coverage: [{ country_code: "CM", label_en: "Cameroon" }],
        public_focus: [{ label_en: "Sea freight", mode: "sea" }],
        public_cover_vault_id: null,
      }],
      site_leader: [],
    });
    const body = JSON.stringify(await publicEntities(client));
    expect(body).toContain("Smart Logistics");
    for (const s of [SECRETS.rccm, SECRETS.niu, SECRETS.vat]) {
      expect(body).not.toContain(s);
    }
  });
});
