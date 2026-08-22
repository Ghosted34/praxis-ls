"use strict";

const { legalForms, countries, entityCommon } = require("@praxis/shared");

const iso = () =>
  legalForms.CATALOGUE.filter((form) => form.source === legalForms.SOURCE_ISO);

describe("Phase 1 legal-form catalogue", () => {
  test("contains every active jurisdiction-bound GLEIF v1.6 code", () => {
    expect(legalForms.GLEIF_VERSION).toBe("1.6");
    expect(legalForms.GLEIF_RELEASED_ON).toBe("2026-02-19");
    expect(legalForms.GLEIF_SOURCE_SHA256).toBe(
      "c55edc421e49ce362457f772d6bfa41f5fc63ecaadea74db5735722625506ef4",
    );
    expect(iso()).toHaveLength(3446);
    expect(new Set(iso().map((form) => form.code)).size).toBe(3446);
    expect(iso().every((form) => form.country_code)).toBe(true);
  });

  test("references the shared country library rather than copying country names", () => {
    for (const form of legalForms.CATALOGUE) {
      // XK is GLEIF's accepted Kosovo jurisdiction code but is not an assigned
      // ISO 3166-1 code, so it deliberately has no row in the strict ISO country
      // catalogue. Every selectable country is resolved from @shared countries.
      if (form.country_code === "XK") continue;
      expect(form.country_name).toBe(countries.byCode(form.country_code)?.name);
    }
  });

  test("covers the agreed launch jurisdictions deeply", () => {
    expect(legalForms.forCountry("CM")).toHaveLength(15);
    expect(legalForms.forCountry("NG")).toHaveLength(6);
    expect(legalForms.forCountry("DE")).toHaveLength(31);
    expect(legalForms.forCountry("US")).toHaveLength(729);

    expect(legalForms.matchStored("CM", "SARL")).toMatchObject({
      source: "OHADA",
      code: "SARL",
      abbreviation: "SARL",
    });
    expect(legalForms.matchStored("DE", "Gmbh")).toMatchObject({
      source: "GLEIF_ISO_20275",
      code: "2HBR",
      abbreviation: "GmbH",
    });
    expect(
      legalForms
        .forCountry("US")
        .find(
          (form) =>
            form.jurisdiction_code === "US-DE" &&
            form.name === "Limited Liability Company",
        ),
    ).toMatchObject({ code: "HZEH", abbreviation: "LLC" });
  });

  test("adds the complete common OHADA set to all 17 member countries", () => {
    expect(legalForms.OHADA_MEMBERS).toHaveLength(17);
    for (const country of legalForms.OHADA_MEMBERS) {
      const forms = legalForms.forCountry(country);
      for (const value of [
        "SNC",
        "SCS",
        "SARL",
        "SARLU",
        "SA",
        "SAU",
        "SAS",
        "SASU",
        "GIE",
        "SCOOPS",
        "COOP-CA",
      ]) {
        expect(
          forms.some(
            (form) =>
              form.abbreviation.toUpperCase() === value ||
              form.aliases.some((alias) => alias.toUpperCase() === value),
          ),
        ).toBe(true);
      }
    }
  });

  test("corrects the reversed Nigerian display suffixes without changing ELF codes", () => {
    expect(
      legalForms.forCountry("NG").find((form) => form.code === "FHZY"),
    ).toMatchObject({
      name: "Private company limited by shares",
      abbreviation: "Ltd",
    });
    expect(
      legalForms.forCountry("NG").find((form) => form.code === "PKBG"),
    ).toMatchObject({
      name: "Public company limited by shares",
      abbreviation: "PLC",
    });
  });

  test("never guesses an ambiguous legacy US abbreviation", () => {
    expect(legalForms.matchStored("US", "LLC")).toBeUndefined();
  });
});

describe("corporate entity legal-form boundary", () => {
  const base = {
    legal_name: "Smart Logistics Cameroon",
    country_code: "CM",
  };

  test("accepts a complete catalogue selection", () => {
    const parsed = entityCommon.masterCreate.parse({
      ...base,
      code: "SLCM",
      legal_form: "SARL",
      legal_form_code: "SARL",
      legal_form_source: "OHADA",
      legal_form_jurisdiction: "CM",
    });
    expect(parsed.legal_form_code).toBe("SARL");
  });

  test("rejects a form from another country and partial references", () => {
    expect(
      entityCommon.masterCreate.safeParse({
        ...base,
        code: "BAD1",
        legal_form: "GmbH",
        legal_form_code: "2HBR",
        legal_form_source: "GLEIF_ISO_20275",
        legal_form_jurisdiction: "DE",
      }).success,
    ).toBe(false);
    expect(
      entityCommon.masterCreate.safeParse({
        ...base,
        code: "BAD2",
        legal_form: "SARL",
        legal_form_code: "SARL",
      }).success,
    ).toBe(false);
  });

  test("keeps pre-picker legacy rows writable without inventing a reference", () => {
    expect(
      entityCommon.masterUpdate.safeParse({ legal_form: "SARL" }).success,
    ).toBe(true);
  });
});
