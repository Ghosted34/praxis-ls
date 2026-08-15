"use strict";
/**
 * The operation-file reference generator.
 *
 * WHAT THESE PIN, and why a format test is not the trivial thing it looks like:
 * every property below is one a reasonable-looking implementation gets wrong.
 *
 *   - A core built from a sequence, a timestamp or the dossier's own UUID would
 *     produce a perfectly well-formed reference and be trivially enumerable.
 *     "Two allocations do not form a sequence" is the assertion that separates
 *     this from the numbering it replaces.
 *   - `Math.random()` also produces a well-formed core. Nothing about the OUTPUT
 *     distinguishes it from `crypto.randomBytes` at these sample sizes, so the
 *     source is pinned by watching the call rather than by testing the values.
 *   - A `% 32` over a 30-character alphabet is uniform; a `% 30` over 256 is
 *     not, and quietly costs bits. The distribution check is coarse on purpose —
 *     it catches a folded alphabet, not a biased CSPRNG.
 */
const crypto = require("crypto");
const opsRef = require("../../src/services/documents/operation-reference");

const {
  randomCore,
  formatOperationReference,
  displayOperationReference,
  parseOperationReference,
  normaliseReference,
  classifyReference,
  ALPHABET,
  CORE_LENGTH,
} = opsRef;

describe("the random core", () => {
  it("is the configured length, in the Crockford alphabet, every time", () => {
    for (let i = 0; i < 200; i += 1) {
      const core = randomCore();
      expect(core).toHaveLength(CORE_LENGTH);
      expect(core).toMatch(/^[0-9A-HJKMNP-TV-Z]+$/);
    }
  });

  it("has at least 60 bits of entropy", () => {
    // 32 symbols = 5 bits each. The design floor is 60; anything less and a
    // reference stops being non-enumerable at SaaS scale.
    expect(ALPHABET).toHaveLength(32);
    expect(CORE_LENGTH * Math.log2(ALPHABET.length)).toBeGreaterThanOrEqual(60);
  });

  it("never emits I, L, O or U — the characters people mistype off a document", () => {
    const seen = new Set();
    for (let i = 0; i < 500; i += 1) for (const ch of randomCore()) seen.add(ch);
    for (const ambiguous of ["I", "L", "O", "U"]) expect(seen.has(ambiguous)).toBe(false);
    // And the sample is wide enough for that to mean something.
    expect(seen.size).toBe(32);
  });

  it("comes from crypto.randomBytes, not Math.random", () => {
    const rand = jest.spyOn(crypto, "randomBytes");
    const mathRandom = jest.spyOn(Math, "random");
    try {
      randomCore();
      expect(rand).toHaveBeenCalled();
      expect(mathRandom).not.toHaveBeenCalled();
    } finally {
      rand.mockRestore();
      mathRandom.mockRestore();
    }
  });

  it("uses every symbol roughly evenly — no modulo bias toward the alphabet's head", () => {
    const counts = new Map();
    const draws = 32 * 400;
    for (let i = 0; i < draws / CORE_LENGTH; i += 1) {
      for (const ch of randomCore()) counts.set(ch, (counts.get(ch) || 0) + 1);
    }
    const expected = draws / 32;
    for (const ch of ALPHABET) {
      // Wide bounds: this is a folded-alphabet detector (which would leave some
      // symbols at zero and double others), not a randomness test.
      expect(counts.get(ch) || 0).toBeGreaterThan(expected * 0.5);
      expect(counts.get(ch) || 0).toBeLessThan(expected * 1.5);
    }
  });

  it("does not repeat itself", () => {
    const seen = new Set();
    for (let i = 0; i < 2000; i += 1) seen.add(randomCore());
    expect(seen.size).toBe(2000);
  });
});

describe("the canonical format", () => {
  const ref = () => formatOperationReference({ prefix: "SL", core: randomCore(), code: "SM" });

  it("is prefix + core + code, with no separators", () => {
    expect(formatOperationReference({ prefix: "SL", core: "7Z3K9QW2M4XB", code: "SM" })).toBe(
      "SL7Z3K9QW2M4XBSM",
    );
    expect(ref()).toMatch(new RegExp(`^SL[0-9A-HJKMNP-TV-Z]{${CORE_LENGTH}}SM$`));
  });

  it("puts the entity prefix first and the service code last", () => {
    const parsed = parseOperationReference(
      formatOperationReference({ prefix: "BC", core: randomCore(), code: "HT" }),
    );
    expect(parsed.prefix).toBe("BC");
    expect(parsed.code).toBe("HT");
    expect(parsed.core).toHaveLength(CORE_LENGTH);
  });

  it("embeds no year, no date and no identifier from the record", () => {
    const year = String(new Date().getUTCFullYear());
    const uuid = crypto.randomUUID().replace(/-/g, "").toUpperCase();
    for (let i = 0; i < 300; i += 1) {
      const core = parseOperationReference(ref()).core;
      expect(core).not.toContain(year);
      // Any six consecutive characters of the entity/dossier uuid would be a
      // giveaway that the core was derived from it rather than generated.
      for (let j = 0; j + 6 <= uuid.length; j += 1) {
        expect(core).not.toContain(uuid.slice(j, j + 6));
      }
    }
  });

  it("does not form a sequence — the whole point of replacing SLAS-OPS-2026-0142", () => {
    const a = parseOperationReference(ref()).core;
    const b = parseOperationReference(ref()).core;
    expect(a).not.toBe(b);
    // Consecutive allocations differ in most positions. Two sequential values
    // would differ in one or two at the tail.
    const differing = [...a].filter((ch, i) => ch !== b[i]).length;
    expect(differing).toBeGreaterThan(CORE_LENGTH / 2);
  });

  it("groups for display without changing what is stored", () => {
    expect(displayOperationReference("SL7Z3K9QW2M4XBSM")).toBe("SL-7Z3K9QW2M4XB-SM");
    // And the display form normalises straight back to the stored one, which is
    // what makes pasting a reference off an email into the search box work.
    expect(normaliseReference("sl-7z3k9qw2m4xb-sm")).toBe("SL7Z3K9QW2M4XBSM");
    expect(normaliseReference("  SL 7Z3K9QW2M4XB SM ")).toBe("SL7Z3K9QW2M4XBSM");
  });

  it("leaves a value it cannot parse alone rather than mangling it", () => {
    expect(displayOperationReference("SLAS-OPS-2026-0142")).toBe("SLAS-OPS-2026-0142");
    expect(parseOperationReference("SLAS-OPS-2026-0142")).toBeNull();
    expect(parseOperationReference("")).toBeNull();
    expect(parseOperationReference(null)).toBeNull();
  });
});

/**
 * Three schemes coexist permanently — the legacy PHP references, the sequential
 * ones this replaces, and the new opaque ones. Support has to be able to say
 * which is which without a column recording it.
 */
describe("telling the three schemes apart", () => {
  it("recognises a legacy reference", () => {
    expect(classifyReference("SL6721864SM")).toBe("LEGACY_RANDOM");
    expect(classifyReference("SL3503324HT")).toBe("LEGACY_RANDOM");
    expect(classifyReference("SL7291678EF")).toBe("LEGACY_RANDOM");
  });

  it("recognises the sequential references already issued", () => {
    expect(classifyReference("SLAS-OPS-2026-0142")).toBe("MODERN_SEQUENTIAL");
    expect(classifyReference("SMLS-OPS-2025-0001")).toBe("MODERN_SEQUENTIAL");
  });

  it("recognises the new opaque references", () => {
    for (let i = 0; i < 50; i += 1) {
      const value = formatOperationReference({ prefix: "SL", core: randomCore(), code: "SM" });
      expect(classifyReference(value)).toBe("MODERN_OPAQUE");
    }
  });

  it("calls a wizard placeholder what it is, and refuses to guess at nonsense", () => {
    expect(classifyReference("DRAFT-8f14e45f-ea6b-4c1f-9a2e-1d0c2b3a4e5f")).toBe("DRAFT");
    expect(classifyReference("")).toBeNull();
    expect(classifyReference(null)).toBeNull();
    expect(classifyReference("nope")).toBeNull();
  });
});
