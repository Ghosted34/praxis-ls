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
  entity_id: "e1", legal_name: "Smart Logistics and Services Ltd", legal_form: "SARL",
  share_capital: 100000000, share_capital_currency: "XAF", default_currency: "XAF",
  default_language: "fr", email: "info@slas.cm", phone: "+237690000000", website: "www.slas.cm",
  niu: "P0123456789A", rccm: "RC/DLA/2020/B/1234", country_code: "CM",
};

describe("letterhead assembly", () => {
  it("composes the company line from stored facts, not typed text", () => {
    const r = lh.render({ entity: ENTITY });
    expect(r.header.company_line).toBe("Smart Logistics and Services Ltd SARL au capital de 100,000,000 XAF");
  });

  it("switches the capital wording with the language", () => {
    expect(lh.render({ entity: ENTITY }, "en").header.company_line)
      .toBe("Smart Logistics and Services Ltd SARL share capital 100,000,000 XAF");
  });

  it("honours the show_ toggles — statutory mentions differ by country", () => {
    const r = lh.render({ entity: ENTITY, config: { show_share_capital: false, show_legal_form: false } });
    expect(r.header.company_line).toBe("Smart Logistics and Services Ltd");
  });

  it("defaults to the entity's own language when none is passed", () => {
    expect(lh.render({ entity: ENTITY }).language).toBe("fr");
    expect(lh.render({ entity: { ...ENTITY, default_language: null } }).language).toBe("en");
  });

  describe("registered address", () => {
    it("prefers a REGISTERED row over any other", () => {
      const addresses = [
        { type: "TRADING", line1: "Zone industrielle", city: "Bonabéri", country_code: "CM" },
        { type: "REGISTERED", line1: "BP 1234", city: "Douala", country_code: "CM" },
      ];
      expect(lh.registeredAddress(ENTITY, addresses)).toBe("BP 1234, Douala, CM");
    });

    it("falls back to the primary row, then to the legacy free-text column", () => {
      expect(lh.registeredAddress(ENTITY, [{ type: "MAILING", line1: "PO 9", is_primary: true }])).toBe("PO 9");
      expect(lh.registeredAddress({ ...ENTITY, address: "Old free text" }, [])).toBe("Old free text");
    });

    it("ignores deactivated addresses", () => {
      const addresses = [{ type: "REGISTERED", line1: "Moved out", is_active: false }];
      expect(lh.registeredAddress({ ...ENTITY, address: "Current" }, addresses)).toBe("Current");
    });

    it("drops blank parts rather than printing stray commas", () => {
      expect(lh.addressLine({ line1: "BP 1234", line2: "", city: "Douala", region: null, country_code: "CM" }))
        .toBe("BP 1234, Douala, CM");
    });
  });

  describe("identifiers", () => {
    it("takes registration rows over the legacy niu/rccm columns", () => {
      const ids = lh.identifiers(ENTITY, [{ kind: "NIU", number: "NEWER-NIU" }]);
      expect(ids.find((i) => i.kind === "NIU").number).toBe("NEWER-NIU");
    });

    it("still surfaces the legacy columns when no row exists", () => {
      const ids = lh.identifiers(ENTITY, []);
      expect(ids.map((i) => i.kind).sort()).toEqual(["NIU", "RCCM"]);
    });

    it("pulls the VAT number from the tax registration, not the trade register", () => {
      const ids = lh.identifiers(ENTITY, [], [{ tax_kind: "VAT", tax_number: "FR12345678901" }]);
      expect(ids.find((i) => i.kind === "VAT").number).toBe("FR12345678901");
    });

    it("ignores deregistered and inactive tax registrations", () => {
      const ids = lh.identifiers({ ...ENTITY, niu: null, rccm: null }, [], [
        { tax_kind: "VAT", tax_number: "OLD", deregistered_on: "2025-01-01" },
        { tax_kind: "WHT", tax_number: "INACTIVE", is_active: false },
      ]);
      expect(ids).toEqual([]);
    });

    it("does not repeat a kind", () => {
      const ids = lh.identifiers(ENTITY, [{ kind: "NIU", number: "A" }, { kind: "niu", number: "B" }]);
      expect(ids.filter((i) => i.kind === "NIU")).toHaveLength(1);
    });
  });

  describe("payment block", () => {
    const account = {
      treasury_account_id: "t1", label: "Afriland — Main XAF", show_on_documents: true,
      bank_name: "Afriland First Bank", account_number: "1000500012345", currency: "XAF",
    };

    it("reads treasury_account when an account is flagged for documents", () => {
      const p = lh.paymentBlock(ENTITY, [account]);
      expect(p.source).toBe("treasury");
      expect(p.accounts[0].bank_name).toBe("Afriland First Bank");
    });

    it("leads with the entity's remittance account", () => {
      const second = { ...account, treasury_account_id: "t2", label: "Second", bank_name: "UBA" };
      const p = lh.paymentBlock({ ...ENTITY, remittance_account_id: "t2" }, [account, second]);
      expect(p.accounts[0].label).toBe("Second");
      expect(p.accounts).toHaveLength(2);
    });

    it("skips accounts not flagged for documents, and inactive ones", () => {
      expect(lh.paymentBlock(ENTITY, [{ ...account, show_on_documents: false }]).source).not.toBe("treasury");
      expect(lh.paymentBlock(ENTITY, [{ ...account, is_active: false }]).source).not.toBe("treasury");
    });

    it("falls back to the frozen bank_block so existing invoices render unchanged", () => {
      const e = { ...ENTITY, bank_block: { bank_name: "Afriland First Bank", account_number: "999", swift: "CCEICMCX" } };
      const p = lh.paymentBlock(e, []);
      expect(p.source).toBe("bank_block_legacy");
      // `swift` in the jsonb, `swift_bic` on the table — the shapes differ and
      // the fallback has to bridge them or the BIC vanishes from the invoice.
      expect(p.accounts[0].swift_bic).toBe("CCEICMCX");
    });

    it("reports none when there is genuinely nothing", () => {
      expect(lh.paymentBlock(ENTITY, []).source).toBe("none");
      expect(lh.paymentBlock({ ...ENTITY, bank_block: {} }, []).source).toBe("none");
      expect(lh.paymentBlock({ ...ENTITY, bank_block: { bank_name: "   " } }, []).source).toBe("none");
    });
  });

  it("lists blocks that are switched on but empty", () => {
    const r = lh.render({ entity: { legal_name: "Untouched Ltd" } });
    expect(r.empty_blocks).toEqual(
      expect.arrayContaining(["registered_address", "registrations", "share_capital", "contact", "payment_block", "legal_form"]),
    );
  });

  it("reports no empty blocks when everything is populated", () => {
    const r = lh.render({
      entity: ENTITY,
      addresses: [{ type: "REGISTERED", line1: "BP 1234", city: "Douala" }],
      treasuryAccounts: [{ treasury_account_id: "t1", label: "Main", show_on_documents: true, bank_name: "Afriland" }],
    });
    expect(r.empty_blocks).toEqual([]);
  });

  it("renders for an entity that has only a name", () => {
    expect(() => lh.render({ entity: { legal_name: "Bare Ltd" } })).not.toThrow();
    expect(lh.render({ entity: { legal_name: "Bare Ltd" } }).header.company_line).toBe("Bare Ltd");
  });

  it("survives a null entity", () => {
    expect(() => lh.render({ entity: null })).not.toThrow();
  });
});

describe("renewal ladder", () => {
  const TODAY = "2026-08-06";
  const doc = (over) => ({ document_id: "d" + Math.random(), title: "Doc", ...over });

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
    const r = rn.renewals({ documents: [doc({ expires_on: "2026-09-20", renewal_lead_days: 5, type_renewal_lead_days: 90 })] }, TODAY);
    expect(r.items).toHaveLength(0);           // 45 days out, 5-day lead — not yet
  });

  it("falls back to the type's lead time, then the default", () => {
    const byType = rn.renewals({ documents: [doc({ expires_on: "2026-09-20", type_renewal_lead_days: 90 })] }, TODAY);
    expect(byType.items[0].state).toBe("APPROACHING");
    const byDefault = rn.renewals({ documents: [doc({ expires_on: "2027-06-01" })] }, TODAY);
    expect(byDefault.items).toHaveLength(0);
  });

  it("never emits HARD_BLOCK, even if a document type asks for one", () => {
    const r = rn.renewals({ documents: [doc({ expires_on: "2026-01-01", default_severity: "HARD_BLOCK" })] }, TODAY);
    expect(r.items[0].severity).toBe("SOFT_BLOCK_RECOMMENDATION");
    expect(rn.hardest("WARN", "HARD_BLOCK")).toBe("WARN");
  });

  it("lets a document type raise the severity of an expiry but not lower it", () => {
    const soft = rn.renewals({ documents: [doc({ expires_on: "2026-01-01", default_severity: "INFO" })] }, TODAY);
    expect(soft.items[0].severity).toBe("SOFT_BLOCK_RECOMMENDATION");
  });

  it("orders expired before due before approaching, soonest first", () => {
    const r = rn.renewals({
      documents: [
        doc({ title: "Approaching", expires_on: "2026-09-25", type_renewal_lead_days: 90 }),
        doc({ title: "Expired later", expires_on: "2026-08-05" }),
        doc({ title: "Expired earlier", expires_on: "2026-01-01" }),
        doc({ title: "Due", expires_on: "2026-08-20", type_renewal_lead_days: 90 }),
      ],
    }, TODAY);
    expect(r.items.map((i) => i.label)).toEqual(["Expired earlier", "Expired later", "Due", "Approaching"]);
    expect(r.items.map((i) => i.state)).toEqual(["EXPIRED", "EXPIRED", "DUE", "APPROACHING"]);
    expect(r.counts).toEqual({ expired: 2, due: 1, approaching: 1 });
  });

  it("ignores documents with no expiry and deactivated ones", () => {
    const r = rn.renewals({
      documents: [doc({ expires_on: null }), doc({ expires_on: "2026-01-01", is_active: false })],
    }, TODAY);
    expect(r.items).toEqual([]);
  });

  it("normalises pg Date objects", () => {
    const r = rn.renewals({ documents: [doc({ expires_on: new Date("2026-08-01T00:00:00Z") })] }, TODAY);
    expect(r.items[0].expires_on).toBe("2026-08-01");
    expect(r.items[0].state).toBe("EXPIRED");
  });

  it("warns on a scheduled tax deregistration — invoicing must stop using the number", () => {
    const r = rn.renewals({ taxRegistrations: [{ tax_registration_id: "t1", tax_kind: "VAT", tax_number: "FR123", deregistered_on: "2026-09-01" }] }, TODAY);
    expect(r.items[0].kind).toBe("TAX_REGISTRATION");
    expect(r.items[0].state).toBe("APPROACHING");
  });

  it("produces compliance flags that never exceed a recommendation", () => {
    const r = rn.renewals({ documents: [doc({ expires_on: "2026-01-01", default_severity: "HARD_BLOCK" })] }, TODAY);
    const flags = rn.toComplianceFlags("e1", r);
    expect(flags[0]).toMatchObject({ rule_key: "entity.document.expired", entity_ref: "corporate_entity:e1" });
    expect(flags.every((f) => f.severity !== "HARD_BLOCK")).toBe(true);
  });

  it("renders for an entity with nothing to renew", () => {
    const r = rn.renewals({}, TODAY);
    expect(r).toMatchObject({ items: [], counts: { expired: 0, due: 0, approaching: 0 } });
  });
});
