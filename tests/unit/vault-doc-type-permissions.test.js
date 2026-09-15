"use strict";
/**
 * Who may OPEN an uploaded master-data scan.
 *
 * `document_vault.routes.js` resolves the grant that governs reading a stored
 * file from the row's `doc_type` (`moduleKeyForDocType`), and its fallback for
 * an unregistered type is MOD-70 — the Settings grant. That fallback is correct
 * as a default (unknown types should be gated conservatively) and wrong for the
 * three types the master-data registers now upload every day: it would mean the
 * operator who administers clients cannot reopen the KYC scan they just
 * attached unless they also administer the application, while every holder of
 * Settings could read every ID document in the tenant.
 *
 * So the mapping is pinned here. If someone drops these registry rows, this
 * fails rather than the permission quietly widening to Settings.
 */
const {
  moduleKeyForDocType,
  isDocType,
} = require("../../src/modules/vault/document_vault/document_vault.types");

describe("vault doc types — master-data scans", () => {
  it("gates each scan on the register it belongs to", () => {
    expect(moduleKeyForDocType("ENTITY_DOCUMENT")).toBe("MOD-01");
    expect(moduleKeyForDocType("CLIENT_DOCUMENT")).toBe("MOD-03");
    expect(moduleKeyForDocType("SUPPLIER_DOCUMENT")).toBe("MOD-04");
  });

  it("registers them, so a capture under one of these codes is accepted", () => {
    expect(isDocType("ENTITY_DOCUMENT")).toBe(true);
    expect(isDocType("CLIENT_DOCUMENT")).toBe(true);
    expect(isDocType("SUPPLIER_DOCUMENT")).toBe(true);
  });

  /**
   * The same failure, found again on the public-site media types.
   *
   * `SUCCESS_STORY_MEDIA` was registered when its upload shipped. `INSIGHT_MEDIA`
   * (12757/13773) and `SERVICE_TYPE_MEDIA` (12755) were not, though all three are
   * the same thing: bytes a tenant uploads to put on their own public page.
   *
   * `createDocument` does not call `assertDocType` — deliberately, because ad-hoc
   * uploads are free-form — so nothing refused the unregistered code and the
   * fallback quietly gated an article cover on SETTINGS. The marketing writer who
   * had just uploaded it could not open it back unless they also administered the
   * workspace, and every Settings holder could read all of them.
   *
   * Pinned here for the same reason as the scans above: dropping a registry row
   * fails this rather than widening a permission in silence.
   */
  it("gates public-site media on the module that owns the page", () => {
    expect(moduleKeyForDocType("INSIGHT_MEDIA")).toBe("MOD-29");
    expect(moduleKeyForDocType("SERVICE_TYPE_MEDIA")).toBe("MOD-29");
    expect(moduleKeyForDocType("SUCCESS_STORY_MEDIA")).toBe("MOD-26");
  });

  it("registers the public-site media types", () => {
    expect(isDocType("INSIGHT_MEDIA")).toBe(true);
    expect(isDocType("SERVICE_TYPE_MEDIA")).toBe(true);
  });

  it("still falls back to Settings for anything unregistered", () => {
    // A party document TYPE code (the master-data registry) is not a vault doc
    // type — passing one through would land on this branch, which is the
    // mistake the client-side control's doc comment warns about.
    expect(moduleKeyForDocType("TAX_CLEARANCE")).toBe("MOD-70");
    expect(moduleKeyForDocType(undefined)).toBe("MOD-70");
  });
});
