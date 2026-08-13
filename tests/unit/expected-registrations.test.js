"use strict";
/** expectedRegistrations — the shared "which tax/legal IDs are expected" helper
 *  (PR3 §2.2). Pure; the same union the form renders and the API validates.
 *  Imported by file path: the helper is a ready module in packages/shared but is
 *  not re-exported from the shared index until PR3-B wires both consumers (see
 *  the note in packages/shared/index.js and the `check:schemas` gate). */
const {
  expectedRegistrations,
  expectedKinds,
} = require("../../packages/shared/data/registrations");

const kindsOf = (list) => list.map((r) => r.kind).sort();

describe("expectedRegistrations — country requirements", () => {
  it("returns NIU + RCCM for an OHADA country (CM)", () => {
    expect(
      kindsOf(expectedRegistrations({ country: "CM", kind: "client" })),
    ).toEqual(["NIU", "RCCM"]);
  });

  it("returns VAT (+ EORI) for an EU country and NOT NIU/RCCM", () => {
    const kinds = expectedKinds({ country: "FR", kind: "client" });
    expect(kinds).toContain("VAT");
    expect(kinds).not.toContain("NIU");
    expect(kinds).not.toContain("RCCM");
  });

  it("returns EIN for the US", () => {
    expect(expectedKinds({ country: "US", kind: "client" })).toContain("EIN");
  });

  it("returns an empty set for a country with no defined profile", () => {
    expect(expectedRegistrations({ country: "ZW", kind: "client" })).toEqual(
      [],
    );
  });

  it("marks each country-sourced entry with source 'country'", () => {
    expect(
      expectedRegistrations({ country: "CM", kind: "client" }).every(
        (r) => r.source === "country",
      ),
    ).toBe(true);
  });
});

describe("expectedRegistrations — role/category union (§2.1: adds, never removes)", () => {
  it("adds EORI (required) for a customs-broker supplier on top of the country set", () => {
    const cm = expectedRegistrations({
      country: "CM",
      kind: "supplier",
      category: "CUSTOMS_BROKER",
    });
    expect(kindsOf(cm)).toEqual(["EORI", "NIU", "RCCM"]);
    // The country-mandated IDs are still there and still required.
    expect(cm.find((r) => r.kind === "NIU").required).toBe(true);
    expect(cm.find((r) => r.kind === "EORI").required).toBe(true);
    expect(cm.find((r) => r.kind === "EORI").source).toBe("category");
  });

  it("does not add customs IDs for a non-customs supplier", () => {
    expect(
      expectedKinds({
        country: "CM",
        kind: "supplier",
        category: "WATER_SUPPLIER",
      }),
    ).toEqual(["NIU", "RCCM"]);
  });

  it("an EU supplier gets EORI even without the customs-broker category, merged with the country VAT", () => {
    const fr = expectedRegistrations({
      country: "FR",
      kind: "supplier",
      category: "SERVICE_PROVIDER",
    });
    const eori = fr.find((r) => r.kind === "EORI");
    expect(eori).toBeTruthy();
    // FR's country profile already lists EORI (optional); the EU-supplier rule
    // promotes it to required and marks the entry as coming from both sources.
    expect(eori.required).toBe(true);
    expect(eori.source).toBe("both");
  });

  it("ignores unknown extra option keys (forward-compat with the form payload)", () => {
    expect(
      kindsOf(
        expectedRegistrations({
          country: "CM",
          kind: "client",
          category: "SHIPPER",
          docTypes: [{ code: "OTHER" }],
        }),
      ),
    ).toEqual(["NIU", "RCCM"]);
  });
});
