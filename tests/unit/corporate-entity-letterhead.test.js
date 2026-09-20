"use strict";
/**
 * Letterhead assembly and the renewal ladder (MOD-01, 0513).
 *
 * The letterhead tests matter because this one pure function is what the
 * dossier's live preview AND the invoice renderer both call. If they could
 * diverge, the preview would be a lie — so the behaviour is pinned here rather
 * than trusted to two call sites agreeing.
 */
const lh = require("../../src/modules/master/entity-letterhead.service");
const rn = require("../../src/modules/master/corporate_entity/corporate_entity.renewals");

const ENTITY = {
  entity_id: "e1",
  legal_name: "Smart Logistics and Services Ltd",
  legal_form: "SARL",
  share_capital: 100000000,
  share_capital_currency: "XAF",
  default_currency: "XAF",
  default_language: "fr",
  email: "info@slas.cm",
  phone: "+237690000000",
  website: "www.slas.cm",
  niu: "P0123456789A",
  rccm: "RC/DLA/2020/B/1234",
  country_code: "CM",
};

describe("letterhead assembly", () => {
  it("composes the company line from stored facts, not typed text", () => {
    const r = lh.render({ entity: ENTITY });
    expect(r.header.company_line).toBe(
      "Smart Logistics and Services Ltd SARL au capital de 100,000,000 XAF",
    );
  });

  it("switches the capital wording with the language", () => {
    expect(lh.render({ entity: ENTITY }, "en").header.company_line).toBe(
      "Smart Logistics and Services Ltd SARL share capital 100,000,000 XAF",
    );
  });

  it("honours the show_ toggles — statutory mentions differ by country", () => {
    const r = lh.render({
      entity: ENTITY,
      config: { show_share_capital: false, show_legal_form: false },
    });
    expect(r.header.company_line).toBe("Smart Logistics and Services Ltd");
  });

  it("defaults to the entity's own language when none is passed", () => {
    expect(lh.render({ entity: ENTITY }).language).toBe("fr");
    expect(
      lh.render({ entity: { ...ENTITY, default_language: null } }).language,
    ).toBe("en");
  });

  /**
   * `show_establishment` was a stored column with a default and a designer
   * toggle that rendered nothing: switching it on printed no line and did not
   * even report itself as an empty block, so the operator had no way to tell an
   * enabled-but-blank block from a working one. These pin the line's content and
   * the two ways it can legitimately be absent.
   */
  describe("issuing establishment", () => {
    const SITES = [
      {
        name: "Agence de Kribi",
        kind: "AGENCY",
        city: "Kribi",
        tax_office_ref: "CDI-KRI-7",
        is_active: true,
      },
      {
        name: "Siège social",
        kind: "HEAD_OFFICE",
        address_line: "BP 1234",
        city: "Douala",
        tax_office_ref: "CDI-DLA-2",
        is_active: true,
      },
    ];

    it("prints the head office ahead of any other open site", () => {
      const r = lh.render({
        entity: ENTITY,
        config: { show_establishment: true },
        establishments: SITES,
      });
      expect(r.footer.establishment_line).toBe(
        "Siège social · BP 1234, Douala · CDI-DLA-2",
      );
    });

    it("falls back to the first open site when no head office is recorded", () => {
      const r = lh.render({
        entity: ENTITY,
        config: { show_establishment: true },
        establishments: [SITES[0]],
      });
      expect(r.footer.establishment_line).toBe(
        "Agence de Kribi · Kribi · CDI-KRI-7",
      );
    });

    it("never prints a closed or deactivated site on a document issued today", () => {
      const shut = [
        {
          name: "Ancien siège",
          kind: "HEAD_OFFICE",
          city: "Douala",
          closed_on: "2024-01-31",
          is_active: true,
        },
        {
          name: "Entrepôt",
          kind: "WAREHOUSE",
          city: "Bonabéri",
          is_active: false,
        },
      ];
      const r = lh.render({
        entity: ENTITY,
        config: { show_establishment: true },
        establishments: shut,
      });
      expect(r.footer.establishment_line).toBeNull();
      expect(r.empty_blocks).toContain("establishment");
    });

    it("stays off — and out of empty_blocks — when the toggle is off", () => {
      const r = lh.render({ entity: ENTITY, establishments: SITES });
      expect(r.footer.establishment_line).toBeNull();
      expect(r.empty_blocks).not.toContain("establishment");
    });
  });

  describe("registered address", () => {
    it("prefers a REGISTERED row over any other", () => {
      const addresses = [
        {
          type: "TRADING",
          line1: "Zone industrielle",
          city: "Bonabéri",
          country_code: "CM",
        },
        {
          type: "REGISTERED",
          line1: "BP 1234",
          city: "Douala",
          country_code: "CM",
        },
      ];
      expect(lh.registeredAddress(ENTITY, addresses)).toBe(
        "BP 1234, Douala, CM",
      );
    });

    it("falls back to the primary row, then to the legacy free-text column", () => {
      expect(
        lh.registeredAddress(ENTITY, [
          { type: "MAILING", line1: "PO 9", is_primary: true },
        ]),
      ).toBe("PO 9");
      expect(
        lh.registeredAddress({ ...ENTITY, address: "Old free text" }, []),
      ).toBe("Old free text");
    });

    it("ignores deactivated addresses", () => {
      const addresses = [
        { type: "REGISTERED", line1: "Moved out", is_active: false },
      ];
      expect(
        lh.registeredAddress({ ...ENTITY, address: "Current" }, addresses),
      ).toBe("Current");
    });

    it("drops blank parts rather than printing stray commas", () => {
      expect(
        lh.addressLine({
          line1: "BP 1234",
          line2: "",
          city: "Douala",
          region: null,
          country_code: "CM",
        }),
      ).toBe("BP 1234, Douala, CM");
    });
  });

  describe("identifiers", () => {
    it("takes registration rows over the legacy niu/rccm columns", () => {
      const ids = lh.identifiers(ENTITY, [
        { kind: "NIU", number: "NEWER-NIU" },
      ]);
      expect(ids.find((i) => i.kind === "NIU").number).toBe("NEWER-NIU");
    });

    it("still surfaces the legacy columns when no row exists", () => {
      const ids = lh.identifiers(ENTITY, []);
      expect(ids.map((i) => i.kind).sort()).toEqual(["NIU", "RCCM"]);
    });

    /*
     * PR-10 / A3 — the reversal of the old rule, pinned. The VAT number used
     * to be loop-added from the tax registrations; it is a tax-registration
     * fact and no longer appears on the trade-register line at all. Full
     * resolver-level coverage lives in entity-primary-account.test.js; these
     * keep the unit contract visible where the rest of identifiers() is
     * tested.
     */
    it("NEVER pulls the VAT number from the tax registration — trade-register rows only", () => {
      const ids = lh.identifiers(
        { ...ENTITY, niu: null, rccm: null },
        [{ kind: "NIU", number: "N1" }],
      );
      expect(ids).toEqual([{ kind: "NIU", number: "N1" }]);
    });

    it("tax registrations cannot contribute an identifier even when handed one", () => {
      // The old call shape (entity, registrations, taxRegistrations). The
      // third argument is ignored by contract now — a caller still passing it
      // must not get a VAT line back.
      const ids = lh.identifiers(
        { ...ENTITY, niu: null, rccm: null },
        [{ kind: "RCCM", number: "RC/1" }],
        [{ tax_kind: "VAT", tax_number: "FR12345678901", is_active: true }],
      );
      expect(ids).toEqual([{ kind: "RCCM", number: "RC/1" }]);
    });

    it("does not repeat a kind", () => {
      const ids = lh.identifiers(ENTITY, [
        { kind: "NIU", number: "A" },
        { kind: "niu", number: "B" },
      ]);
      expect(ids.filter((i) => i.kind === "NIU")).toHaveLength(1);
    });
  });

  describe("payment block", () => {
    const account = {
      treasury_account_id: "t1",
      label: "Afriland — Main XAF",
      show_on_documents: true,
      is_active: true,
      is_primary: true,
      bank_name: "Afriland First Bank",
      account_number: "1000500012345",
      holder_name: "Smart Logistics and Services Ltd",
      currency: "XAF",
    };

    it("prints the PRIMARY account — the single source the resolver picks", () => {
      const p = lh.paymentBlock(ENTITY, [account]);
      expect(p.source).toBe("treasury");
      expect(p.accounts).toHaveLength(1);
      expect(p.accounts[0].bank_name).toBe("Afriland First Bank");
      expect(p.accounts[0].holder_name).toBe("Smart Logistics and Services Ltd");
    });

    it("the remittance account is the primary; the other accounts do not print beside it", () => {
      const second = {
        ...account,
        treasury_account_id: "t2",
        is_primary: false,
        label: "Second",
        bank_name: "UBA",
      };
      const p = lh.paymentBlock({ ...ENTITY, remittance_account_id: "t2" }, [
        account,
        second,
      ]);
      expect(p.accounts).toHaveLength(1);
      expect(p.accounts[0].label).toBe("Second");
    });

    it("several flagged primaries print nothing — an explicit no_primary state, never a pick", () => {
      const sixPrimaries = [1, 2, 3, 4, 5, 6].map((n) => ({
        ...account, treasury_account_id: `t${n}`, label: `Bank ${n}`,
      }));
      const p = lh.paymentBlock(ENTITY, sixPrimaries);
      expect(p.source).toBe("no_primary");
      expect(p.accounts).toHaveLength(0);
    });

    it("accounts but no primary: no_primary, and no silent legacy fallback", () => {
      const p = lh.paymentBlock(ENTITY, [{ ...account, is_primary: false }]);
      expect(p.source).toBe("no_primary");
      expect(p.accounts).toHaveLength(0);
    });

    it("falls back to the frozen bank_block so existing invoices render unchanged", () => {
      const e = {
        ...ENTITY,
        bank_block: {
          bank_name: "Afriland First Bank",
          account_number: "999",
          swift: "CCEICMCX",
        },
      };
      const p = lh.paymentBlock(e, []);
      expect(p.source).toBe("bank_block_legacy");
      // `swift` in the jsonb, `swift_bic` on the table — the shapes differ and
      // the fallback has to bridge them or the BIC vanishes from the invoice.
      expect(p.accounts[0].swift_bic).toBe("CCEICMCX");
    });

    it("reports none when there is genuinely nothing", () => {
      expect(lh.paymentBlock(ENTITY, []).source).toBe("none");
      expect(lh.paymentBlock({ ...ENTITY, bank_block: {} }, []).source).toBe(
        "none",
      );
      expect(
        lh.paymentBlock({ ...ENTITY, bank_block: { bank_name: "   " } }, [])
          .source,
      ).toBe("none");
    });
  });

  it("lists blocks that are switched on but empty", () => {
    const r = lh.render({ entity: { legal_name: "Untouched Ltd" } });
    expect(r.empty_blocks).toEqual(
      expect.arrayContaining([
        "registered_address",
        "registrations",
        "share_capital",
        "contact",
        "payment_block",
        "legal_form",
      ]),
    );
  });

  it("reports no empty blocks when everything is populated", () => {
    const r = lh.render({
      entity: ENTITY,
      addresses: [{ type: "REGISTERED", line1: "BP 1234", city: "Douala" }],
      treasuryAccounts: [
        {
          treasury_account_id: "t1",
          label: "Main",
          is_active: true,
          is_primary: true,
          bank_name: "Afriland",
        },
      ],
    });
    expect(r.empty_blocks).toEqual([]);
  });

  it("renders for an entity that has only a name", () => {
    expect(() =>
      lh.render({ entity: { legal_name: "Bare Ltd" } }),
    ).not.toThrow();
    expect(
      lh.render({ entity: { legal_name: "Bare Ltd" } }).header.company_line,
    ).toBe("Bare Ltd");
  });

  it("survives a null entity", () => {
    expect(() => lh.render({ entity: null })).not.toThrow();
  });
});

describe("renewal ladder", () => {
  const TODAY = "2026-08-06";
  const doc = (over) => ({
    document_id: "d" + Math.random(),
    title: "Doc",
    ...over,
  });

  it("escalates as a deadline approaches and passes", () => {
    expect(rn.stateOf("2026-12-01", TODAY, 60).state).toBe("OK");
    expect(rn.stateOf("2026-09-20", TODAY, 60).state).toBe("APPROACHING");
    expect(rn.stateOf("2026-08-20", TODAY, 60).state).toBe("DUE");
    expect(rn.stateOf("2026-08-01", TODAY, 60).state).toBe("EXPIRED");
  });

  it("scales the DUE window to the lead time rather than a fixed number of days", () => {
    // A 90-day lead escalates a month out; a 7-day lead only in the last days.
    expect(rn.stateOf("2026-08-30", TODAY, 90).state).toBe("DUE");
    expect(rn.stateOf("2026-08-30", TODAY, 7).state).toBe("OK");
  });

  it("prefers a document's own lead time over its type's", () => {
    const r = rn.renewals(
      {
        documents: [
          doc({
            expires_on: "2026-09-20",
            renewal_lead_days: 5,
            type_renewal_lead_days: 90,
          }),
        ],
      },
      TODAY,
    );
    expect(r.items).toHaveLength(0); // 45 days out, 5-day lead — not yet
  });

  it("falls back to the type's lead time, then the default", () => {
    const byType = rn.renewals(
      {
        documents: [
          doc({ expires_on: "2026-09-20", type_renewal_lead_days: 90 }),
        ],
      },
      TODAY,
    );
    expect(byType.items[0].state).toBe("APPROACHING");
    const byDefault = rn.renewals(
      { documents: [doc({ expires_on: "2027-06-01" })] },
      TODAY,
    );
    expect(byDefault.items).toHaveLength(0);
  });

  it("never emits HARD_BLOCK, even if a document type asks for one", () => {
    const r = rn.renewals(
      {
        documents: [
          doc({ expires_on: "2026-01-01", default_severity: "HARD_BLOCK" }),
        ],
      },
      TODAY,
    );
    expect(r.items[0].severity).toBe("SOFT_BLOCK_RECOMMENDATION");
    expect(rn.hardest("WARN", "HARD_BLOCK")).toBe("WARN");
  });

  it("lets a document type raise the severity of an expiry but not lower it", () => {
    const soft = rn.renewals(
      {
        documents: [
          doc({ expires_on: "2026-01-01", default_severity: "INFO" }),
        ],
      },
      TODAY,
    );
    expect(soft.items[0].severity).toBe("SOFT_BLOCK_RECOMMENDATION");
  });

  it("orders expired before due before approaching, soonest first", () => {
    const r = rn.renewals(
      {
        documents: [
          doc({
            title: "Approaching",
            expires_on: "2026-09-25",
            type_renewal_lead_days: 90,
          }),
          doc({ title: "Expired later", expires_on: "2026-08-05" }),
          doc({ title: "Expired earlier", expires_on: "2026-01-01" }),
          doc({
            title: "Due",
            expires_on: "2026-08-20",
            type_renewal_lead_days: 90,
          }),
        ],
      },
      TODAY,
    );
    expect(r.items.map((i) => i.label)).toEqual([
      "Expired earlier",
      "Expired later",
      "Due",
      "Approaching",
    ]);
    expect(r.items.map((i) => i.state)).toEqual([
      "EXPIRED",
      "EXPIRED",
      "DUE",
      "APPROACHING",
    ]);
    expect(r.counts).toEqual({ expired: 2, due: 1, approaching: 1 });
  });

  it("ignores documents with no expiry and deactivated ones", () => {
    const r = rn.renewals(
      {
        documents: [
          doc({ expires_on: null }),
          doc({ expires_on: "2026-01-01", is_active: false }),
        ],
      },
      TODAY,
    );
    expect(r.items).toEqual([]);
  });

  it("normalises pg Date objects", () => {
    const r = rn.renewals(
      { documents: [doc({ expires_on: new Date("2026-08-01T00:00:00Z") })] },
      TODAY,
    );
    expect(r.items[0].expires_on).toBe("2026-08-01");
    expect(r.items[0].state).toBe("EXPIRED");
  });

  it("warns on a scheduled tax deregistration — invoicing must stop using the number", () => {
    const r = rn.renewals(
      {
        taxRegistrations: [
          {
            tax_registration_id: "t1",
            tax_kind: "VAT",
            tax_number: "FR123",
            deregistered_on: "2026-09-01",
          },
        ],
      },
      TODAY,
    );
    expect(r.items[0].kind).toBe("TAX_REGISTRATION");
    expect(r.items[0].state).toBe("APPROACHING");
  });

  it("monitors only the SELECTED registration per (country, kind) — the current-row rule", () => {
    // A superseded row expiring sooner must not shout over the row that is
    // actually current; the array is history, not a lifecycle.
    const r = rn.renewals(
      {
        registrations: [
          { registration_id: "r-old", kind: "NIU", number: "OLD", country_code: "CM", is_primary: false, expires_on: "2026-08-10" },
          { registration_id: "r-now", kind: "NIU", number: "NEW", country_code: "CM", is_primary: true, expires_on: "2026-10-01" },
        ],
      },
      TODAY,
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0].id).toBe("r-now");
    expect(r.ambiguous_registrations).toEqual([]);
  });

  it("selects a sole row with no primary, and keeps monitoring it after expiry", () => {
    const r = rn.renewals(
      {
        registrations: [
          { registration_id: "r-only", kind: "RCCM", number: "X", country_code: "CM", is_primary: false, expires_on: "2026-01-01" },
        ],
      },
      TODAY,
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ id: "r-only", kind: "REGISTRATION", state: "EXPIRED" });
  });

  it("reports an ambiguous key as a data-quality finding and monitors no row for it", () => {
    const r = rn.renewals(
      {
        registrations: [
          { registration_id: "r-a", kind: "VAT", number: "A", country_code: "FR", expires_on: "2026-08-10" },
          { registration_id: "r-b", kind: "VAT", number: "B", country_code: "FR", expires_on: "2026-09-01" },
        ],
      },
      TODAY,
    );
    expect(r.items).toEqual([]);
    expect(r.ambiguous_registrations).toEqual([
      { country_code: "FR", kind: "VAT", rows: 2, reason: "no_primary_multiple_rows" },
    ]);
  });

  it("treats two primary rows as ambiguous too — selection must be unique", () => {
    const r = rn.renewals(
      {
        registrations: [
          { registration_id: "r-a", kind: "NIU", number: "A", country_code: "CM", is_primary: true, expires_on: "2026-08-10" },
          { registration_id: "r-b", kind: "NIU", number: "B", country_code: "CM", is_primary: true, expires_on: "2026-09-01" },
        ],
      },
      TODAY,
    );
    expect(r.items).toEqual([]);
    expect(r.ambiguous_registrations).toEqual([
      { country_code: "CM", kind: "NIU", rows: 2, reason: "multiple_primary_rows" },
    ]);
  });

  it("groups the current-row key by country and kind, case-insensitively", () => {
    const r = rn.renewals(
      {
        registrations: [
          { registration_id: "r-cm", kind: "NIU", number: "CM-NIU", country_code: "CM", is_primary: true, expires_on: "2026-08-20" },
          { registration_id: "r-fr", kind: "NIU", number: "FR-NIU", country_code: "FR", is_primary: true, expires_on: "2026-08-25" },
        ],
      },
      TODAY,
    );
    // Two DIFFERENT keys — both selected, both monitored.
    expect(r.items.map((i) => i.id).sort()).toEqual(["r-cm", "r-fr"]);
  });

  it("keeps an unverified selected row selected — verification is a gate, not a selector", () => {
    const r = rn.renewals(
      {
        registrations: [
          { registration_id: "r-v", kind: "NIU", number: "N", country_code: "CM", is_primary: true, verified: false, expires_on: "2026-08-20" },
        ],
      },
      TODAY,
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0].id).toBe("r-v");
  });

  it("produces compliance flags that never exceed a recommendation", () => {
    const r = rn.renewals(
      {
        documents: [
          doc({ expires_on: "2026-01-01", default_severity: "HARD_BLOCK" }),
        ],
      },
      TODAY,
    );
    const flags = rn.toComplianceFlags("e1", r);
    expect(flags[0]).toMatchObject({
      rule_key: "entity.document.expired",
      entity_ref: "corporate_entity:e1",
    });
    expect(flags.every((f) => f.severity !== "HARD_BLOCK")).toBe(true);
  });

  it("renders for an entity with nothing to renew", () => {
    const r = rn.renewals({}, TODAY);
    expect(r).toMatchObject({
      items: [],
      counts: { expired: 0, due: 0, approaching: 0 },
    });
  });
});
