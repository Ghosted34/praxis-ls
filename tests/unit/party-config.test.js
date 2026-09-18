"use strict";
/** Configurable field-requirements (spec §5) — the runtime validator. */
const { partyConfig } = require("@praxis/shared");

describe("defaultsFor", () => {
  it("seeds `name` (+ the client phone, review #26) as the required set", () => {
    // Review #26 / migration 13900: a client must carry a company-level phone
    // by default. Suppliers are unchanged — the ask was client creation.
    const clientRequired = partyConfig
      .defaultsFor("CLIENT")
      .filter((c) => c.is_required)
      .map((c) => c.field_key);
    expect(clientRequired).toEqual(["name", "phone"]);

    const supplierRequired = partyConfig
      .defaultsFor("SUPPLIER")
      .filter((c) => c.is_required)
      .map((c) => c.field_key);
    expect(supplierRequired).toEqual(["name"]);
  });
});

describe("checkRequired", () => {
  it("passes the seeded default when name + phone are provided (no setup needed — gate 7)", () => {
    expect(
      partyConfig.checkRequired(
        { name: "Acme", phone: "+237 699 00 00 00" },
        partyConfig.defaultsFor("CLIENT"),
      ),
    ).toEqual({ ok: true, missing: [] });
  });
  it("flags the missing client phone (review #26)", () => {
    const r = partyConfig.checkRequired(
      { name: "Acme" },
      partyConfig.defaultsFor("CLIENT"),
    );
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["phone"]);
  });
  it("flags a blank required field", () => {
    const r = partyConfig.checkRequired(
      { name: "   " },
      partyConfig.defaultsFor("CLIENT"),
    );
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("name");
  });
  it("enforces a tenant that has toggled a field to required", () => {
    const cfg = [
      { field_key: "name", is_required: true, is_visible: true },
      { field_key: "niu", is_required: true, is_visible: true },
    ];
    expect(partyConfig.checkRequired({ name: "Acme" }, cfg).missing).toEqual([
      "niu",
    ]);
    expect(
      partyConfig.checkRequired({ name: "Acme", niu: "P123" }, cfg),
    ).toEqual({ ok: true, missing: [] });
  });
  it("ignores a required-but-hidden field (a form cannot fill it)", () => {
    const cfg = [{ field_key: "niu", is_required: true, is_visible: false }];
    expect(partyConfig.checkRequired({}, cfg)).toEqual({
      ok: true,
      missing: [],
    });
  });
  it("resolves a structural key against a nested collection", () => {
    const cfg = [
      { field_key: "bank_accounts", is_required: true, is_visible: true },
    ];
    expect(
      partyConfig.checkRequired({ bank_accounts: [] }, cfg).missing,
    ).toEqual(["bank_accounts"]);
    expect(
      partyConfig.checkRequired({ bank_accounts: [{ iban: "x" }] }, cfg).ok,
    ).toBe(true);
  });
});

describe("effectiveConfig", () => {
  it("falls back to seeded defaults when the tenant has no rows", () => {
    expect(partyConfig.effectiveConfig("CLIENT", []).length).toBe(
      partyConfig.defaultsFor("CLIENT").length,
    );
    expect(partyConfig.effectiveConfig("CLIENT", null).length).toBeGreaterThan(
      0,
    );
  });
  it("uses the tenant rows when present", () => {
    const rows = [{ field_key: "name", is_required: true, is_visible: true }];
    expect(partyConfig.effectiveConfig("CLIENT", rows)).toBe(rows);
  });
});
