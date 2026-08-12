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
const { moduleKeyForDocType, isDocType } = require("../../src/modules/vault/document_vault/document_vault.types");

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

  it("still falls back to Settings for anything unregistered", () => {
    // A party document TYPE code (the master-data registry) is not a vault doc
    // type — passing one through would land on this branch, which is the
    // mistake the client-side control's doc comment warns about.
    expect(moduleKeyForDocType("TAX_CLEARANCE")).toBe("MOD-70");
    expect(moduleKeyForDocType(undefined)).toBe("MOD-70");
  });
});
