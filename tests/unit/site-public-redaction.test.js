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

/* ── the lifecycle gate (Decision Q1, CE-27) ────────────────────────────────
 *
 * `public_enabled = true` alone used to publish an entity whatever its
 * lifecycle state, so a DEACTIVATED company stayed on the About page and kept
 * serving its cover. The fix is a predicate in the SQL — and a stub that
 * hands rows back unconditionally would test nothing, because the WHERE
 * clause never runs against a stub.
 *
 * So this client APPLIES THE PREDICATES THE SQL CARRIES: it filters the
 * configured rows by `public_enabled` and `registration_status` exactly when
 * (and only when) the query text asserts them. Drop the lifecycle predicate
 * from `publicEntities` and the stub stops filtering — the excluded row
 * reappears in the serialised body below and the test fails, which is the
 * property that makes these tests a gate rather than a tautology.
 */
function lifecycleClient({ entities, addresses = [], leaders = [] }) {
  const sql = [];
  return {
    sql,
    async query(text, params) {
      const q = String(text);
      sql.push(q);
      if (/\bcorporate_entity\b/.test(q) && /public_enabled/.test(q)) {
        const enabledOnly = /public_enabled\s*=\s*true/.test(q);
        const activeOnly = /registration_status\s*=\s*'ACTIVE'/.test(q);
        return {
          rows: entities.filter(
            (e) =>
              (!enabledOnly || e.public_enabled === true) &&
              (!activeOnly || e.registration_status === "ACTIVE"),
          ),
        };
      }
      if (/\bentity_address\b/.test(q)) {
        const wanted = Array.isArray(params && params[0]) ? params[0] : [];
        return { rows: addresses.filter((a) => wanted.includes(a.entity_id)) };
      }
      if (/\bsite_leader\b/.test(q)) return { rows: leaders };
      if (/\bdocument_vault\b/.test(q)) return { rows: [] };
      return { rows: [] };
    },
  };
}

describe("GET /public/site/entities — the lifecycle gate (Q1, CE-27)", () => {
  // One row per state, every one of them with the switch ON. That is the
  // defect's exact shape: an operator deactivates a company and nobody thinks
  // to revisit the marketing switch.
  const STATES = ["DRAFT", "PENDING_REVIEW", "SUSPENDED", "DEACTIVATED", "ARCHIVED"];
  const rowsOf = (registration_status) => ({
    entity_id: "e1",
    code: "SLAS",
    legal_name: `Smart Logistics (${registration_status})`,
    trading_name: "Smart Logistics",
    country_code: "CM",
    address: null,
    public_enabled: true,
    registration_status,
    public_summary_fr: "Transitaire à Douala.",
    public_summary_en: "Freight forwarder in Douala.",
    public_coverage: [],
    public_focus: [],
    public_cover_vault_id: null,
  });

  test.each(STATES)(
    "a %s entity with public_enabled on is absent from the serialised body",
    async (state) => {
      const client = lifecycleClient({ entities: [rowsOf(state)] });
      const body = JSON.stringify(await service.publicEntities(client));
      expect(body).toBe("[]");
      expect(body).not.toContain(`Smart Logistics (${state})`);
    },
  );

  test("an ACTIVE entity with the switch on is published", async () => {
    const client = lifecycleClient({ entities: [rowsOf("ACTIVE")] });
    const [entity] = await service.publicEntities(client);
    expect(entity.legal_name).toBe("Smart Logistics (ACTIVE)");
  });

  test("the switch still gates on its own — ACTIVE but unpublished stays out", async () => {
    const client = lifecycleClient({
      entities: [{ ...rowsOf("ACTIVE"), public_enabled: false }],
    });
    expect(await service.publicEntities(client)).toEqual([]);
  });

  test("the SQL itself carries both predicates, so the stub has something to apply", async () => {
    // The legible twin of the filtering above: when one of these fails, the
    // message names the missing predicate rather than a leaked row.
    const client = lifecycleClient({ entities: [] });
    await service.publicEntities(client);
    const entitySelect = client.sql.find((q) => /FROM corporate_entity/.test(q));
    expect(entitySelect).toMatch(/public_enabled\s*=\s*true/);
    expect(entitySelect).toMatch(/registration_status\s*=\s*'ACTIVE'/);
  });
});

/* ── the public address (Decision Q2, CE-28) ───────────────────────────────
 *
 * The registered office is published — resolved by the LETTERHEAD's own
 * precedence, not a copy of it — and a second address only through the
 * explicit marker and label. The rows below deliberately carry fields the
 * payload must not echo (`address_id`, `type`, `is_active`) so the key
 * assertions catch a widening allow-list, not just a missing value.
 */
describe("GET /public/site/entities — the public address (Q2, CE-28)", () => {
  const entity = {
    entity_id: "e1",
    code: "SLAS",
    legal_name: "Smart Logistics & Services Ltd",
    trading_name: "Smart Logistics",
    country_code: "CM",
    address: null,
    public_enabled: true,
    registration_status: "ACTIVE",
    public_summary_fr: "Transitaire à Douala.",
    public_summary_en: "Freight forwarder in Douala.",
    public_coverage: [],
    public_focus: [],
    public_cover_vault_id: null,
  };
  const REGISTERED = {
    entity_id: "e1",
    address_id: "a-reg",
    type: "REGISTERED",
    line1: "1030 Avenue Douala Manga Bell",
    line2: null,
    city: "Douala",
    region: "Littoral",
    postal_code: "00237",
    country_code: "CM",
    po_box: "PO Box 5120",
    is_primary: false,
    is_active: true,
    is_public: false,
    public_label_fr: null,
    public_label_en: null,
  };

  test("publishes the canonical registered address, composed as the letterhead composes it", async () => {
    const client = lifecycleClient({
      entities: [entity],
      addresses: [
        REGISTERED,
        // A TRADING row that is primary: the REGISTERED one must still win,
        // because that is the precedence the letterhead prints.
        { ...REGISTERED, address_id: "a-trade", type: "TRADING", is_primary: true, line1: "Port Zone" },
      ],
    });
    const [row] = await service.publicEntities(client);
    expect(row.registered_address).toBe(
      "1030 Avenue Douala Manga Bell, PO Box 5120, 00237 Douala, Littoral, CM",
    );
  });

  test("falls back to the legacy free-text column when there is no structured row", async () => {
    const client = lifecycleClient({
      entities: [{ ...entity, address: "Rue Njo-Njo, Bali\nDouala" }],
      addresses: [],
    });
    const [row] = await service.publicEntities(client);
    // Trimmed, but NOT re-wrapped: the tenant's own lines are their own lines.
    expect(row.registered_address).toBe("Rue Njo-Njo, Bali\nDouala");
  });

  test("does not publish a second address nobody marked public", async () => {
    const client = lifecycleClient({
      entities: [entity],
      addresses: [
        REGISTERED,
        { ...REGISTERED, address_id: "a-whs", type: "WAREHOUSE", line1: "Zone Industrielle" },
      ],
    });
    const [row] = await service.publicEntities(client);
    expect(row.other_addresses).toEqual([]);
    const body = JSON.stringify(row);
    expect(body).not.toContain("Zone Industrielle");
  });

  test("publishes a marked second address with its label, and nothing but label and line", async () => {
    const client = lifecycleClient({
      entities: [entity],
      addresses: [
        REGISTERED,
        {
          ...REGISTERED,
          address_id: "a-ops",
          type: "TRADING",
          line1: "12 Rue de la Gare",
          po_box: null,
          city: "Yaoundé",
          is_public: true,
          public_label_fr: "Bureau opérationnel",
          public_label_en: "Operations desk",
        },
      ],
    });
    const [row] = await service.publicEntities(client);
    expect(row.other_addresses).toEqual([
      {
        label: { fr: "Bureau opérationnel", en: "Operations desk" },
        line: "12 Rue de la Gare, 00237 Yaoundé, Littoral, CM",
      },
    ]);
    // The row's own internals never travel with it.
    const body = JSON.stringify(row);
    expect(body).not.toMatch(/"address_id"|"is_public"|"public_label_fr"|"public_label_en"|"type"/);
  });

  test("does not publish the registered row twice when it is also marked public", async () => {
    const client = lifecycleClient({
      entities: [entity],
      addresses: [
        { ...REGISTERED, is_public: true, public_label_fr: "Siège", public_label_en: "Head office" },
      ],
    });
    const [row] = await service.publicEntities(client);
    expect(row.registered_address).toContain("1030 Avenue Douala Manga Bell");
    expect(row.other_addresses).toEqual([]);
  });

  test("an inactive row is never published, however it is marked", async () => {
    const client = lifecycleClient({
      entities: [entity],
      addresses: [
        { ...REGISTERED, is_active: false },
        {
          ...REGISTERED,
          address_id: "a-old",
          type: "TRADING",
          line1: "Ancien bureau",
          is_active: false,
          is_public: true,
          public_label_fr: "Ancien bureau",
        },
      ],
    });
    const [row] = await service.publicEntities(client);
    // No active structured row → the legacy column; and no marked row either.
    expect(row.registered_address).toBeNull();
    expect(row.other_addresses).toEqual([]);
  });

  test("a label-less marker is skipped — the belt behind the database's braces", async () => {
    // The table's CHECK (13963) makes this row impossible; this asks what the
    // READ does if the constraint were dropped or bypassed by a repair script,
    // and the answer has to be "nothing reaches the page" — the same question
    // publicPartners asks of 13782.
    const client = lifecycleClient({
      entities: [entity],
      addresses: [
        REGISTERED,
        { ...REGISTERED, address_id: "a-ops", type: "TRADING", line1: "12 Rue de la Gare", is_public: true },
      ],
    });
    const [row] = await service.publicEntities(client);
    expect(row.other_addresses).toEqual([]);
    expect(JSON.stringify(row)).not.toContain("12 Rue de la Gare");
  });
});

/* ── the service focus (Decision Q8, CE-23) ─────────────────────────────────
 *
 * A focus line classified against the catalogue carries a stable
 * `service_type_key`, and its transport mode is DERIVED from that key by the
 * one derivation the whole app shares — never trusted from the stored value.
 */
describe("GET /public/site/entities — the service focus (Q8, CE-23)", () => {
  const entity = {
    entity_id: "e1",
    code: "SLAS",
    legal_name: "Smart Logistics & Services Ltd",
    trading_name: null,
    country_code: "CM",
    address: null,
    public_enabled: true,
    registration_status: "ACTIVE",
    public_summary_fr: null,
    public_summary_en: null,
    public_coverage: [],
    public_focus: [
      { label_fr: "Fret maritime", label_en: "Sea freight", service_type_key: "SEA_FREIGHT_IMPORT", mode: "air" },
      { label_fr: "Entreposage", label_en: "Warehousing", service_type_key: "WAREHOUSE_STORAGE", mode: null },
      { label_fr: "Groupage routier", label_en: "Road groupage", mode: "road" },
    ],
    public_cover_vault_id: null,
  };

  test("derives the mode from the catalogue key and ignores a stale stored mode", async () => {
    const client = lifecycleClient({ entities: [entity] });
    const [row] = await service.publicEntities(client);
    expect(row.focus).toEqual([
      // 'air' above is the defect being guarded: a hand-edited row cannot
      // repaint a sea service.
      { service_type_key: "SEA_FREIGHT_IMPORT", label_fr: "Fret maritime", label_en: "Sea freight", mode: "sea" },
      // WAREHOUSE has no lane colour — the four hues are the four ways cargo
      // MOVES, and painting storage road-orange would state a leg it has not.
      { service_type_key: "WAREHOUSE_STORAGE", label_fr: "Entreposage", label_en: "Warehousing", mode: null },
      // A keyless row keeps its legacy mode: the key is the upgrade, not a
      // requirement, and pre-catalogue content must not change under it.
      { service_type_key: null, label_fr: "Groupage routier", label_en: "Road groupage", mode: "road" },
    ]);
  });
});

/* ── the catalogue is enforced on WRITE, not just offered by the picker ───── */
describe("PUT /site-settings/entities/:id/story — focus keys are validated server-side", () => {
  const before = {
    entity_id: "e1",
    public_enabled: true,
    public_summary_fr: null,
    public_summary_en: null,
    public_coverage: [],
    public_focus: [],
    public_cover_vault_id: null,
  };

  /**
   * A client that answers the three shapes the story write uses: the row read,
   * the catalogue lookup, and the audited UPDATE. `public_focus` is the FIRST
   * bound parameter of the UPDATE (`SET public_focus = $1::jsonb`), so the
   * captured `saved` is exactly what would be persisted.
   */
  function storyClient(catalogueRows) {
    const client = {
      saved: null,
      async query(text, params) {
        const q = String(text);
        if (/\bservice_type\b/.test(q)) return { rows: catalogueRows };
        if (/UPDATE corporate_entity/.test(q)) {
          client.saved = JSON.parse(params[0]);
          return { rows: [before] };
        }
        if (/FROM corporate_entity/.test(q)) return { rows: [before] };
        return { rows: [] };
      },
    };
    return client;
  }

  test("refuses a key that is not in the catalogue", async () => {
    await expect(
      service.updateEntityStory(storyClient([]), {
        entityId: "e1",
        patch: { public_focus: [{ label_fr: "Fret", service_type_key: "NOT_A_SERVICE" }] },
        actor: { user_id: "u1" },
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining("NOT_A_SERVICE"),
    });
  });

  test("refuses a key the tenant retired, and says what to do", async () => {
    await expect(
      service.updateEntityStory(storyClient([{ key: "OLD_RAIL", is_active: false }]), {
        entityId: "e1",
        patch: { public_focus: [{ label_fr: "Fret ferroviaire", service_type_key: "OLD_RAIL" }] },
        actor: { user_id: "u1" },
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining("Re-classify"),
    });
  });

  test("accepts a current key and stores the derived mode beside it", async () => {
    const client = storyClient([{ key: "SEA_FREIGHT_IMPORT", is_active: true }]);
    await service.updateEntityStory(client, {
      entityId: "e1",
      patch: { public_focus: [{ label_fr: "Fret maritime", service_type_key: "SEA_FREIGHT_IMPORT" }] },
      actor: { user_id: "u1" },
    });
    expect(client.saved).toEqual([
      { label_fr: "Fret maritime", service_type_key: "SEA_FREIGHT_IMPORT", mode: "sea" },
    ]);
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

/* ── the write side of the public-address marker (13963, Decision Q2) ───────
 *
 * The read-side tests above prove an unlabelled marker is never PUBLISHED.
 * These prove it cannot be WRITTEN either — in the place the rule actually
 * lives now. The first draft of 13963 carried a table CHECK; the house rule
 * pinned by migration-constraint-ordering.test.js forbids constraining a
 * pre-existing table above 13791 (it aborts provisioning a fresh tenant in
 * the sandbox pass), so the rule moved to code:
 *
 *   CREATE  `@praxis/shared` addressCreate — the label must ride in the body.
 *   UPDATE  `rowRules` on the addresses spec in nested.js — checked against
 *           the row the patch lands on, because that is the only place "the
 *           row already has a label" can be known. Same merge semantics the
 *           withdrawn CHECK had.
 *   READ    `otherPublicAddresses` skips a label-less marker (tested above).
 *
 * The UPDATE cases drive the REAL `service.update` through a stub client that
 * hands back the current row — not `rowRules` directly — so the test also
 * proves the wiring: a rule nobody calls is decoration.
 */
describe("the public-address marker's write side (13963, Q2)", () => {
  const { entityCommon } = require("@praxis/shared");
  const {
    buildResource,
    entityResourceSpecs,
  } = require("../../src/modules/master/_shared/nested");

  const spec = () => entityResourceSpecs().find((r) => r.seg === "addresses");

  /** The resource exactly as `mountEntityNested` builds it — same cfg keys,
   *  so what is under test is the wiring the real router uses, not a
   *  hand-rolled approximation of it. */
  const resource = () => {
    const r = spec();
    return buildResource({
      table: r.table, pk: r.pk, parentCol: "entity_id",
      parentTable: "corporate_entity", parentPk: "entity_id",
      moduleKey: "master", label: r.table,
      writable: r.writable, touch: r.touch, isDocument: r.isDocument,
      numberingKey: r.numberingKey, immutable: r.immutable,
      primaryScope: r.primaryScope, rowRules: r.rowRules,
    });
  };

  /** A client whose `entity_address` row is `row`; every statement is
   *  recorded so a refusal can be proven to have written nothing. */
  function clientWith(row) {
    const statements = [];
    return {
      statements,
      async query(text) {
        statements.push(String(text));
        if (/SELECT .* FROM entity_address WHERE/i.test(String(text))) {
          return { rows: [row] };
        }
        return { rows: [row] };
      },
    };
  }

  it("the addresses spec carries the row-aware rule (a moved rule is a deleted rule)", () => {
    // If `rowRules` vanishes from the spec, the UPDATE cases below would fail
    // on wiring — but this says it in one readable line for whoever greps.
    expect(typeof spec().rowRules).toBe("function");
  });

  it("CREATE refuses a marker with no label in the body", () => {
    const parsed = entityCommon.addressCreate.safeParse({
      type: "TRADING",
      is_public: true,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.flatten())).toContain("public_label_fr");
    }
    // The label in ONE language is enough; the other may wait.
    const ok = entityCommon.addressCreate.safeParse({
      type: "TRADING",
      is_public: true,
      public_label_fr: "Bureau opérationnel",
    });
    expect(ok.success ? null : ok.error.flatten().fieldErrors).toBeNull();
  });

  it("UPDATE refuses to set the marker on a row with no label — writing nothing", async () => {
    const { service: addressService } = resource();
    const client = clientWith({
      address_id: "a1",
      entity_id: "e1",
      is_public: false,
      public_label_fr: null,
      public_label_en: null,
    });
    await expect(
      addressService.update(client, { parentId: "e1", id: "a1", patch: { is_public: true }, actor: {} }),
    ).rejects.toMatchObject({ code: "PUBLIC_ADDRESS_NEEDS_LABEL" });
    // Refused before any transaction opened: only the row read happened.
    expect(client.statements.filter((s) => /BEGIN/i.test(s))).toHaveLength(0);
  });

  it("UPDATE accepts the marker on a row that already carries a label", async () => {
    const { service: addressService } = resource();
    const client = clientWith({
      address_id: "a1",
      entity_id: "e1",
      is_public: false,
      public_label_fr: "Bureau opérationnel",
      public_label_en: null,
    });
    // The write proceeds past the rule (the stub absorbs the UPDATE itself).
    const row = await addressService.update(client, {
      parentId: "e1",
      id: "a1",
      patch: { is_public: true },
      actor: {},
    });
    expect(row).toMatchObject({ address_id: "a1" });
    expect(client.statements.some((s) => /UPDATE entity_address/i.test(s))).toBe(true);
  });

  it("UPDATE refuses to clear the labels while the marker stands", async () => {
    const { service: addressService } = resource();
    const client = clientWith({
      address_id: "a1",
      entity_id: "e1",
      is_public: true,
      public_label_fr: "Bureau opérationnel",
      public_label_en: "Operations desk",
    });
    await expect(
      addressService.update(client, {
        parentId: "e1",
        id: "a1",
        patch: { public_label_fr: null, public_label_en: null },
        actor: {},
      }),
    ).rejects.toMatchObject({ code: "PUBLIC_ADDRESS_NEEDS_LABEL" });
  });

  it("an unrelated edit, and unticking the marker, are nobody's business", async () => {
    const { service: addressService } = resource();
    const client = clientWith({
      address_id: "a1",
      entity_id: "e1",
      is_public: true,
      public_label_fr: "Bureau opérationnel",
      public_label_en: null,
    });
    await expect(
      addressService.update(client, { parentId: "e1", id: "a1", patch: { city: "Douala" }, actor: {} }),
    ).resolves.toBeTruthy();
    await expect(
      addressService.update(client, {
        parentId: "e1",
        id: "a1",
        patch: { is_public: false, public_label_fr: null, public_label_en: null },
        actor: {},
      }),
    ).resolves.toBeTruthy();
  });
});
