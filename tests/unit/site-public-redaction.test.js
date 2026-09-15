/**
 * What the public website endpoints may say about a tenant — and what they may
 * never say.
 *
 * ── WHY THIS ASSERTS ON THE SERIALISED BODY ────────────────────────────────
 *
 * The natural way to write this test is to check the returned object's keys.
 * That is the version that passes forever and protects nothing: it tests the
 * shape the function happens to build today, and a future refactor that returns
 * the row itself — or spreads it, or adds a field for a legitimate reason and
 * carries a neighbour along — still has the right keys at the top level while
 * leaking through a nested one.
 *
 * So these tests JSON.stringify the whole response and search the TEXT for
 * values that must never appear. A leak anywhere in the tree, at any depth,
 * through any refactor, fails. The strings below are deliberately distinctive
 * so a match cannot be a coincidence.
 *
 * ── WHAT IS BEING PROTECTED, AND WHY EACH ONE ──────────────────────────────
 *
 * RCCM / NIU        statutory identifiers. Public record, so not "secret" — but
 *                   a trade-register number changes no visitor's decision and
 *                   is most of what somebody needs to impersonate a company to
 *                   its own suppliers. Low value out, real value to an
 *                   attacker. See migration 13787's header.
 * permission_note   the internal record of who cleared a third-party
 *                   trademark. Often a person's name and an informal
 *                   conversation; nobody's business but the tenant's.
 * an expired licence a credential past `expires_on` presented as current is the
 *                   single most damaging thing a forwarder can publish.
 * an inactive row   partners default to inactive precisely because they cannot
 *                   be shown before permission is recorded.
 */
"use strict";

const service = require("../../src/modules/site/site_settings/site_settings.service");

/**
 * A client that answers the two shapes these reads use: `repo` helpers go
 * through `client.query(sql, params)`, and the entity read runs its own SELECT.
 * Rows are returned by matching the table name in the SQL, which keeps the stub
 * honest — a query against a table nobody stubbed returns nothing rather than
 * silently reusing the last answer.
 */
function stubClient(tables) {
  return {
    async query(sql) {
      const text = String(sql);
      for (const [table, rows] of Object.entries(tables)) {
        if (new RegExp(`\\b${table}\\b`).test(text)) return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const SECRETS = {
  rccm: "RCCM-CM-DLA-2021-B-9999",
  niu: "NIU-M012345678901X",
  permission: "Verbal OK from Awa at their marketing desk, 3 Feb 2026",
};

describe("GET /public/site/entities", () => {
  const entityRow = {
    entity_id: "e1",
    code: "SLAS",
    legal_name: "Smart Logistics & Services Ltd",
    trading_name: "Smart Logistics",
    country_code: "CM",
    // Present on the row, exactly as the real table has them.
    rccm: SECRETS.rccm,
    niu: SECRETS.niu,
    legal_form: "SARL",
    incorporation_date: "2021-03-04",
    public_summary_fr: "Transitaire à Douala.",
    public_summary_en: "Freight forwarder in Douala.",
    public_coverage: [{ country_code: "CM", label_en: "Cameroon" }],
    public_focus: [{ label_en: "Sea freight", mode: "sea" }],
    public_cover_vault_id: null,
  };

  test("publishes the operational story", async () => {
    const client = stubClient({ corporate_entity: [entityRow], site_leader: [] });
    const [entity] = await service.publicEntities(client);
    expect(entity.legal_name).toBe("Smart Logistics & Services Ltd");
    expect(entity.coverage).toHaveLength(1);
    expect(entity.focus[0].mode).toBe("sea");
  });

  test("never publishes a statutory identifier, at any depth", async () => {
    const client = stubClient({ corporate_entity: [entityRow], site_leader: [] });
    const body = JSON.stringify(await service.publicEntities(client));
    expect(body).not.toContain(SECRETS.rccm);
    expect(body).not.toContain(SECRETS.niu);
    // The KEYS too: an empty `rccm: null` still tells a reader the field exists
    // and invites the next change to populate it.
    expect(body).not.toMatch(/"rccm"|"niu"|"legal_form"|"incorporation_date"/);
  });

  test("attaches only that entity's leaders", async () => {
    const client = stubClient({
      corporate_entity: [entityRow],
      site_leader: [
        { leader_id: "l1", entity_id: "e1", full_name: "Country Manager", is_active: true },
        { leader_id: "l2", entity_id: "other", full_name: "Someone Else", is_active: true },
        { leader_id: "l3", entity_id: null, full_name: "Group CEO", is_active: true },
      ],
    });
    const [entity] = await service.publicEntities(client);
    expect(entity.leaders.map((l) => l.name)).toEqual(["Country Manager"]);
  });
});

describe("GET /public/site/partners", () => {
  const base = {
    partner_id: "p1", name: "GIZ", kind: "client", url: null,
    logo_vault_id: null, permission_note: SECRETS.permission, is_active: true,
  };

  test("never publishes the permission note", async () => {
    const client = stubClient({ site_partner: [base], site_credential: [] });
    const body = JSON.stringify(await service.publicPartners(client));
    expect(body).toContain("GIZ");
    expect(body).not.toContain(SECRETS.permission);
    expect(body).not.toMatch(/"permission_note"/);
  });

  /**
   * §9.7: "Every partner rendered has a `permission_note`. Asserted by a test,
   * not by inspection."
   *
   * The row below is one the DATABASE cannot hold —
   * `ck_site_partner_active_needs_permission` (13782) refuses an active partner
   * with no note. That is the point: this test asks what the READ does if the
   * constraint were ever dropped, relaxed, or bypassed by a repair script, and
   * the answer has to be "nothing reaches the page" rather than "the database
   * would have stopped it".
   */
  test("never renders a partner whose clearance is not recorded", async () => {
    const client = stubClient({
      site_partner: [
        { ...base, partner_id: "cleared", name: "GIZ" },
        { ...base, partner_id: "no-note", name: "CMA CGM", permission_note: null },
        { ...base, partner_id: "blank-note", name: "AGL", permission_note: "   " },
      ],
      site_credential: [],
    });
    const { partners } = await service.publicPartners(client);
    expect(partners.map((p) => p.name)).toEqual(["GIZ"]);
  });

  test("omits inactive partners", async () => {
    // Inactive is the default, and it is what an uncleared mark stays.
    const client = stubClient({
      site_partner: [{ ...base, is_active: false }],
      site_credential: [],
    });
    const { partners } = await service.publicPartners(client);
    expect(partners).toEqual([]);
  });

  test("omits an expired credential and keeps a live one", async () => {
    const past = "2020-01-01";
    const future = "2999-01-01";
    const client = stubClient({
      site_partner: [],
      site_credential: [
        { credential_id: "c1", name: "Lapsed licence", expires_on: past, is_active: true },
        { credential_id: "c2", name: "Current licence", expires_on: future, is_active: true },
        { credential_id: "c3", name: "Never expires", expires_on: null, is_active: true },
      ],
    });
    const { credentials } = await service.publicPartners(client);
    expect(credentials.map((c) => c.name)).toEqual(["Current licence", "Never expires"]);
  });
});

describe("GET /public/site/about", () => {
  test("publishes the group story and only group-level leaders", async () => {
    const client = stubClient({
      site_about: [{
        headline_fr: "Votre partenaire", mission_en: "To move cargo well.",
        principles: [{ label_en: "Excellence" }], esg: { environment: { text_en: "Routes." } },
        timeline: [{ year: 2021, label_en: "Founded" }], founded_year: 2021, headquarters: "Douala",
      }],
      site_leader: [
        { leader_id: "l1", entity_id: null, full_name: "Timothee MASSOMBA", role_en: "CEO", is_active: true },
        { leader_id: "l2", entity_id: "e1", full_name: "Country Manager", is_active: true },
        { leader_id: "l3", entity_id: null, full_name: "Retired Director", is_active: false },
      ],
    });
    const about = await service.publicAbout(client);
    expect(about.founded_year).toBe(2021);
    expect(about.esg.environment.text_en).toBe("Routes.");
    // Group tier only, and only the active ones.
    expect(about.leaders.map((l) => l.name)).toEqual(["Timothee MASSOMBA"]);
  });
});

describe("GET /public/site/theme", () => {
  test("serves a complete, accessible palette derived from the tenant's colours", async () => {
    const client = stubClient({
      site_theme: [{
        primary_hex: "#ff5a00", secondary_hex: "#1884c4", tertiary_hex: null,
        font_display: "archivo", font_body: "inter", font_mono: "jetbrains-mono",
        radius_px: 10, default_mode: "light",
      }],
    });
    const theme = await service.publicTheme(client);
    expect(theme.light["--primary"]).toBeTruthy();
    expect(theme.dark["--primary"]).toBeTruthy();
    expect(theme.fonts).toEqual({ display: "archivo", body: "inter", mono: "jetbrains-mono" });
    // The corrections travel with the palette so the settings preview can
    // explain, in words, why a tenant's orange is not the colour of their text.
    expect(Array.isArray(theme.corrections)).toBe(true);
  });

  test("a font the public site cannot render falls back rather than shipping a dead stack", async () => {
    // The ERP offers seventeen families; public-web self-hosts four. A stack
    // naming a family no @font-face declares falls silently through to the
    // generic — invisible to anyone with the font installed.
    const client = stubClient({
      site_theme: [{
        primary_hex: "#ff5a00", font_display: "montserrat", font_body: "lora",
        font_mono: "cascadia-code", radius_px: 10, default_mode: "light",
      }],
    });
    const theme = await service.publicTheme(client);
    expect(theme.fonts).toEqual({ display: "archivo", body: "inter", mono: "jetbrains-mono" });
  });
});
