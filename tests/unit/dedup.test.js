"use strict";
/** Counterparty dedup scoring (PR3-C §5.1) — pure. */
const {
  scoreCandidate,
  rankCandidates,
  normalizeInput,
  jaccard,
  normReg,
} = require("../../src/modules/master/_shared/dedup.service");

const cand = (over) => ({
  id: "x",
  name: "X",
  ref: "R",
  status: "ACTIVE",
  name_norm: "",
  regNumbers: [],
  email_norm: null,
  phone_digits: null,
  bank_last4: [],
  ...over,
});

describe("normalizeInput", () => {
  it("normalizes name, email, phone, and registration numbers", () => {
    const n = normalizeInput({
      legal_name: "  Bolloré   Transport  SA ",
      email: "AP@Bollore.CM",
      phone: "+237 6 99 00 11 22",
      registrations: [{ kind: "NIU", number: "p 012-345/678" }],
    });
    expect(n.name_norm).toBe("bolloré transport sa");
    expect(n.email_norm).toBe("ap@bollore.cm");
    expect(n.phone_digits).toBe("237699001122");
    expect(n.regNumbers).toEqual(["P012345678"]);
  });
  it("keeps only 4-digit bank tails and drops the rest", () => {
    expect(
      normalizeInput({ bank_last4: ["1234", "00007890", "12"] }).bank_last4,
    ).toEqual(["1234", "7890"]);
  });
});

describe("normReg", () => {
  it("upper-cases and strips spaces / slashes / dashes so IDs compare exactly", () => {
    expect(normReg("rc/dla/2020/b/1234")).toBe("RCDLA2020B1234");
    expect(normReg("P0123456789A")).toBe("P0123456789A");
  });
});

describe("scoreCandidate", () => {
  const input = normalizeInput({
    legal_name: "Bolloré Transport SA",
    email: "ap@bollore.cm",
    phone: "237699001122",
    registrations: [{ kind: "NIU", number: "P0123456789A" }],
  });

  it("scores an exact tax-ID match highly", () => {
    const r = scoreCandidate(input, cand({ regNumbers: ["P0123456789A"] }));
    expect(r.score).toBeGreaterThanOrEqual(60);
    expect(r.reasons).toContain("Same tax / legal ID");
  });

  it("scores an identical normalized name, and a fuzzy token-set name", () => {
    expect(
      scoreCandidate(input, cand({ name_norm: "bolloré transport sa" })).score,
    ).toBe(40);
    const fuzzy = scoreCandidate(
      input,
      cand({ name_norm: "bolloré transport" }),
    );
    expect(fuzzy.score).toBeGreaterThan(0);
    expect(fuzzy.reasons.some((x) => /Similar name/.test(x))).toBe(true);
  });

  it("adds email and phone matches", () => {
    expect(
      scoreCandidate(input, cand({ email_norm: "ap@bollore.cm" })).reasons,
    ).toContain("Same email");
    expect(
      scoreCandidate(input, cand({ phone_digits: "237699001122" })).reasons,
    ).toContain("Same phone");
  });

  it("does NOT match an unrelated candidate (no false positive)", () => {
    expect(
      scoreCandidate(
        input,
        cand({ name_norm: "acme water supplies", email_norm: "x@acme.cm" }),
      ).score,
    ).toBe(0);
  });

  it("compares bank last-4 server-side but never leaks the number", () => {
    const withBank = normalizeInput({ legal_name: "X", bank_last4: ["1234"] });
    const r = scoreCandidate(
      withBank,
      cand({ name_norm: "x", bank_last4: ["1234"] }),
    );
    expect(r.reasons).toContain("Matching bank account");
  });
});

describe("rankCandidates", () => {
  const input = normalizeInput({
    legal_name: "Bolloré Transport SA",
    registrations: [{ kind: "NIU", number: "P0123456789A" }],
  });

  it("keeps only >= min, sorts by score desc, caps, and returns ONLY safe fields", () => {
    const candidates = [
      cand({
        id: "a",
        name: "Bolloré Transport SA",
        ref: "S-1",
        name_norm: "bolloré transport sa",
        regNumbers: ["P0123456789A"],
        email_norm: "leak@x.cm",
        bank_last4: ["9999"],
      }),
      cand({ id: "b", name: "Water Co", name_norm: "water co" }), // no signal → dropped
    ];
    const out = rankCandidates(input, candidates, { min: 55 });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a");
    // The payload must carry no compared secrets — only id/name/ref/status/score/reasons.
    expect(Object.keys(out[0]).sort()).toEqual([
      "id",
      "name",
      "reasons",
      "ref",
      "score",
      "status",
    ]);
    expect(JSON.stringify(out[0])).not.toContain("9999");
    expect(JSON.stringify(out[0])).not.toContain("leak@x.cm");
    expect(JSON.stringify(out[0])).not.toContain("P0123456789A");
  });

  it("returns nothing when no candidate crosses the threshold", () => {
    expect(
      rankCandidates(input, [cand({ name_norm: "totally different" })]),
    ).toEqual([]);
  });
});

describe("jaccard", () => {
  it("is 1 for identical token sets and 0 for disjoint", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
    expect(jaccard(new Set(["a"]), new Set(["b"]))).toBe(0);
  });
});
