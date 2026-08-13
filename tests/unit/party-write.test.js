"use strict";
/** Country-first create/edit write helpers (PR3-B §2). */
const partyWrite = require("../../src/modules/master/_shared/party-write.service");

describe("normalizeName", () => {
  it("lower-cases, trims and collapses whitespace; prefers the legal name", () => {
    expect(partyWrite.normalizeName({ name: "  Acme   SA " })).toBe("acme sa");
    expect(
      partyWrite.normalizeName({
        name: "Trade",
        legal_name: "Acme  Holdings SA",
      }),
    ).toBe("acme holdings sa");
    expect(partyWrite.normalizeName({})).toBeNull();
  });
});

describe("niuRccmMirror", () => {
  it("mirrors only NIU and RCCM from a registrations array", () => {
    const regs = [
      { kind: "NIU", number: "P0123456789A" },
      { kind: "RCCM", number: "RC/DLA/2020/B/1234" },
      { kind: "VAT", number: "FR12345678901" },
    ];
    expect(partyWrite.niuRccmMirror(regs)).toEqual({
      niu: "P0123456789A",
      rccm: "RC/DLA/2020/B/1234",
    });
  });
  it("is empty when there are no OHADA IDs", () => {
    expect(
      partyWrite.niuRccmMirror([{ kind: "EIN", number: "12-3456789" }]),
    ).toEqual({});
    expect(partyWrite.niuRccmMirror([])).toEqual({});
  });
});

describe("validateRegistrations", () => {
  it("rejects a badly-formatted supplied ID against the country's regex", () => {
    expect(() =>
      partyWrite.validateRegistrations({
        registrations: [{ kind: "NIU", number: "SHORT" }],
        country: "CM",
        kind: "client",
      }),
    ).toThrow(/registration format/i);
  });
  it("accepts a well-formatted ID", () => {
    expect(() =>
      partyWrite.validateRegistrations({
        registrations: [{ kind: "NIU", number: "P0123456789A" }],
        country: "CM",
        kind: "client",
      }),
    ).not.toThrow();
  });
  it("does NOT reject a MISSING required ID — an incomplete draft is an onboarding gap, not a create failure", () => {
    expect(() =>
      partyWrite.validateRegistrations({
        registrations: [],
        country: "CM",
        kind: "client",
      }),
    ).not.toThrow();
    expect(() =>
      partyWrite.validateRegistrations({
        registrations: undefined,
        country: "CM",
        kind: "client",
      }),
    ).not.toThrow();
  });
  it("ignores an unknown extra ID kind (no regex to check)", () => {
    expect(() =>
      partyWrite.validateRegistrations({
        registrations: [{ kind: "LEI", number: "anything-goes" }],
        country: "CM",
        kind: "client",
      }),
    ).not.toThrow();
  });
});

describe("writeChildren", () => {
  function mockClient() {
    const calls = [];
    return {
      calls,
      query: async (sql, vals) => {
        calls.push({ sql: String(sql), vals });
        return { rows: [{ ok: true }] };
      },
    };
  }
  const tablesWritten = (calls) =>
    calls
      .filter((c) => /INSERT INTO/i.test(c.sql))
      .map((c) => (c.sql.match(/INSERT INTO\s+"?(\w+)"?/i) || [])[1]);

  it("writes registration, contact and address rows for the parent kind", async () => {
    const c = mockClient();
    await partyWrite.writeChildren(c, {
      kind: "client",
      partyId: "cid-1",
      registrations: [
        { kind: "NIU", number: "P0123456789A", country_code: "CM" },
      ],
      primary_contact: { name: "Awa", email: "awa@x.cm" },
      primary_address: { line1: "Akwa", city: "Douala", country_code: "CM" },
    });
    const tables = tablesWritten(c.calls);
    expect(tables).toEqual(
      expect.arrayContaining([
        "party_registration",
        "client_contact",
        "client_address",
      ]),
    );
  });

  it("skips a contact with no name and an empty address", async () => {
    const c = mockClient();
    await partyWrite.writeChildren(c, {
      kind: "supplier",
      partyId: "sid-1",
      registrations: [],
      primary_contact: { email: "x@y.z" },
      primary_address: {},
    });
    expect(tablesWritten(c.calls)).toHaveLength(0);
  });
});
