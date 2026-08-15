/**
 * The two decisions this module owns, and the ways each of them goes wrong.
 *
 * `classifyAccessChange` is the one that matters. It is the difference between
 * "we threw away what you were typing" and "we did not", so the interesting
 * cases are not the happy ones — they are the near-misses that a naive version
 * gets wrong in the expensive direction: a set that changed order, a casing
 * difference between a cached record and a fresh response, a first paint with
 * nothing to compare against, and a change that both gains and loses.
 *
 * The cache itself is tested for the properties the shell relies on rather than
 * for its serialisation: that it is per-user, that a corrupt record is a miss
 * rather than a crash, and that clearing actually clears — the last of which is
 * what stops the revocation path being an infinite reload loop.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { NavAccess } from "./nav-access";
import {
  accessSignature,
  classifyAccessChange,
  clearCachedAccess,
  readCachedAccess,
  readCachedRibbonPinned,
  writeCachedAccess,
  writeCachedRibbonPinned,
} from "./nav-access-cache";

const access = (
  modules: string[],
  over: Partial<NavAccess> = {},
): NavAccess => ({
  modules,
  groups: ["fulfill"],
  byGroup: { fulfill: modules },
  isCeo: false,
  version: modules.join("|").slice(0, 12),
  ...over,
});

beforeEach(() => localStorage.clear());

describe("classifyAccessChange — a grant and a revocation are not the same event", () => {
  it("calls a lost module a revocation", () => {
    expect(
      classifyAccessChange(access(["MOD-29", "MOD-33"]), access(["MOD-29"])),
    ).toEqual({
      kind: "revoked",
      lost: ["MOD-33"],
      gained: [],
    });
  });

  it("calls a new module a grant", () => {
    expect(
      classifyAccessChange(access(["MOD-29"]), access(["MOD-29", "MOD-33"])),
    ).toEqual({
      kind: "granted",
      gained: ["MOD-33"],
    });
  });

  it("treats a simultaneous gain and loss as a REVOCATION", () => {
    // A role swap is the common shape of this — one module out, another in. The
    // loss is the half with a clock on it, so it decides; the gain rides along
    // on the same reload rather than being announced separately.
    expect(
      classifyAccessChange(
        access(["MOD-29", "MOD-33"]),
        access(["MOD-29", "MOD-51"]),
      ),
    ).toEqual({
      kind: "revoked",
      lost: ["MOD-33"],
      gained: ["MOD-51"],
    });
  });

  it("is not fooled by the order the two sets happen to be in", () => {
    // The server sorts, but a cached record was written by whatever version of
    // this app was deployed at the time. An order-sensitive comparison would
    // hard-refresh a user for nothing.
    expect(
      classifyAccessChange(
        access(["MOD-33", "MOD-29"]),
        access(["MOD-29", "MOD-33"]),
      ).kind,
    ).toBe("same");
  });

  it("is not fooled by casing", () => {
    // Same argument, sharper consequence: a lower-cased cache against an
    // upper-cased response would read as losing EVERY module at once and
    // reload the page on the first revalidation of every session.
    expect(
      classifyAccessChange(
        access(["mod-29", "mod-33"]),
        access(["MOD-29", "MOD-33"]),
      ).kind,
    ).toBe("same");
  });

  it("reports no change when the digest moved but the visible set did not", () => {
    // `version` covers more than the module list, so a module being regrouped
    // mints a new digest over an identical set. That must be adopted silently:
    // it neither exposes nor removes anything.
    const before = access(["MOD-29"], {
      version: "aaaaaaaaaaaa",
      groups: ["fulfill"],
    });
    const after = access(["MOD-29"], {
      version: "bbbbbbbbbbbb",
      groups: ["monitor"],
    });
    expect(classifyAccessChange(before, after).kind).toBe("same");
  });

  it("calls a first paint 'same', not a grant of everything", () => {
    // Nothing to compare against is not the same as having gained it all —
    // otherwise every first login would raise the banner over its own contents.
    expect(classifyAccessChange(null, access(["MOD-29", "MOD-33"])).kind).toBe(
      "same",
    );
  });

  it("calls losing everything a revocation, not a failure to answer", () => {
    // The provider only gets here with a body that parsed, so an empty set is a
    // real answer: this user now sees nothing.
    expect(classifyAccessChange(access(["MOD-29"]), access([]))).toMatchObject({
      kind: "revoked",
      lost: ["MOD-29"],
    });
  });
});

describe("accessSignature — what 'the same change' means to a dismissed banner", () => {
  it("is stable across order and casing", () => {
    expect(accessSignature(access(["MOD-33", "mod-29"]))).toBe(
      accessSignature(access(["MOD-29", "MOD-33"])),
    );
  });

  it("ignores the server's digest, so a regroup does not resurrect a dismissal", () => {
    expect(accessSignature(access(["MOD-29"], { version: "aaa" }))).toBe(
      accessSignature(access(["MOD-29"], { version: "zzz" })),
    );
  });

  it("differs once the set differs", () => {
    expect(accessSignature(access(["MOD-29"]))).not.toBe(
      accessSignature(access(["MOD-29", "MOD-33"])),
    );
  });
});

describe("the cache is per user", () => {
  it("does not serve one user's ribbon to another", () => {
    // A shared dispatch desk is the normal case, not the exotic one. The first
    // frame of the next person's session must not name modules they may have no
    // business knowing exist.
    writeCachedAccess("u-1", access(["MOD-29"]));
    expect(readCachedAccess("u-2")).toBeNull();
    expect(readCachedAccess("u-1")?.modules).toEqual(["MOD-29"]);
  });

  it("reads nothing for an anonymous caller", () => {
    writeCachedAccess("u-1", access(["MOD-29"]));
    expect(readCachedAccess(null)).toBeNull();
    expect(readCachedAccess(undefined)).toBeNull();
  });

  it("writes nothing for an anonymous caller", () => {
    writeCachedAccess(null, access(["MOD-29"]));
    expect(localStorage.length).toBe(0);
  });
});

describe("the cache cannot be the thing that breaks the shell", () => {
  it.each([
    ["a truncated record", '{"modules":["MOD-29"'],
    ["a bare string", '"nope"'],
    ["null", "null"],
    ["an array", "[]"],
  ])("treats %s as a miss rather than throwing", (_label, raw) => {
    localStorage.setItem("praxis.nav-access.1.u-1", raw);
    expect(readCachedAccess("u-1")).toBeNull();
  });

  it("coerces a record written by an older build into the shape the shell indexes", () => {
    // The shell calls `groups.filter` and `Object.entries(byGroup)` on its FIRST
    // render, before any network call can correct a bad record — so a cache that
    // returned this verbatim would be a way to crash the app offline.
    localStorage.setItem(
      "praxis.nav-access.1.u-1",
      JSON.stringify({ modules: ["MOD-29"] }),
    );
    const out = readCachedAccess("u-1");
    expect(out).not.toBeNull();
    expect(out!.groups).toEqual([]);
    expect(out!.byGroup).toEqual({});
    expect(out!.isCeo).toBe(false);
  });

  it("treats an empty module set as a miss", () => {
    // Indistinguishable from a coerced-away corrupt record, and a skeleton is a
    // better first frame than a ribbon that is correctly empty but probably not.
    writeCachedAccess("u-1", access([]));
    expect(readCachedAccess("u-1")).toBeNull();
  });
});

describe("clearing is what stops the revocation path looping", () => {
  it("actually removes the record", () => {
    // If it did not, the reload would paint the revoked ribbon, diff it against
    // the same fresh answer, and reload again — forever.
    writeCachedAccess("u-1", access(["MOD-29"]));
    clearCachedAccess("u-1");
    expect(readCachedAccess("u-1")).toBeNull();
  });

  it("leaves the other user on the machine alone", () => {
    writeCachedAccess("u-1", access(["MOD-29"]));
    writeCachedAccess("u-2", access(["MOD-51"]));
    clearCachedAccess("u-1");
    expect(readCachedAccess("u-2")?.modules).toEqual(["MOD-51"]);
  });
});

describe("the ribbon-pinned mirror", () => {
  it("distinguishes 'collapsed' from 'never chosen'", () => {
    // `false` and `null` are different answers and the ribbon treats them
    // differently: one collapses the band, the other falls through to the
    // default. A boolean-only round trip would lose that.
    expect(readCachedRibbonPinned()).toBeNull();
    writeCachedRibbonPinned(false);
    expect(readCachedRibbonPinned()).toBe(false);
    writeCachedRibbonPinned(true);
    expect(readCachedRibbonPinned()).toBe(true);
  });

  it("survives a revocation clearing the access cache", () => {
    // A revocation is not a reason to forget how somebody likes their chrome.
    writeCachedRibbonPinned(false);
    writeCachedAccess("u-1", access(["MOD-29"]));
    clearCachedAccess("u-1");
    expect(readCachedRibbonPinned()).toBe(false);
  });
});
