"use strict";

/**
 * `GET /permissions/mine` — what the navigation shell is allowed to render.
 *
 * THE FAILURE THIS EXISTS TO PREVENT is not "the wrong tab appears". It is the
 * shell disagreeing with `rbac.js`, in either direction:
 *
 *   Shows more than the API allows → a user clicks a destination and gets a
 *   403. Annoying, and it makes the product look broken rather than restricted.
 *
 *   Shows less than the API allows → the CEO case below. `requirePermission`
 *   grants the CEO everything regardless of the permission table, so resolving
 *   the shell from grant rows alone would hand a CEO with no explicit rows an
 *   empty ribbon over an application that lets them do anything. That is the
 *   bug a naive implementation ships, and it is invisible to any test that only
 *   checks a normal user.
 *
 * The other thing pinned here is the SHAPE OF `version`. The client renders its
 * cached ribbon immediately and revalidates in the background, so this digest is
 * the entire cache-invalidation mechanism: stable when nothing changed, and
 * different the moment the visible set does.
 */

const CATALOGUE = [
  {
    module_key: "MOD-00A",
    group_key: "monitor",
    name: "Dashboard",
    sort_order: 0,
  },
  {
    module_key: "MOD-29",
    group_key: "fulfill",
    name: "Operation files",
    sort_order: 29,
  },
  {
    module_key: "MOD-33",
    group_key: "fulfill",
    name: "Warehouse",
    sort_order: 33,
  },
  {
    module_key: "MOD-51",
    group_key: "transact",
    name: "Invoicing",
    sort_order: 51,
  },
  { module_key: "MOD-67", group_key: "configure", name: "IAM", sort_order: 67 },
];

/** The same module, filed under a different verb. Everything else identical —
 *  which is precisely the edit the digest used to be blind to. */
function regrouped(moduleKey, verb) {
  return CATALOGUE.map((m) =>
    m.module_key === moduleKey ? { ...m, group_key: verb } : m,
  );
}

function load({ granted = [], catalogue = CATALOGUE } = {}) {
  jest.resetModules();
  jest.doMock("../../src/modules/catalogue/catalogue.repo", () => ({
    listModules: async () => catalogue,
  }));
  // Spread the REAL repo rather than replacing it: permission.service builds a
  // CRUD service from `repo.cfg`, so a bare object leaves the module unable to
  // load and every assertion below fails for a reason unrelated to what it
  // tests.
  jest.doMock("../../src/modules/security/permission/permission.repo", () => ({
    ...jest.requireActual(
      "../../src/modules/security/permission/permission.repo",
    ),
    visibleModuleKeys: async () => granted,
  }));
  jest.doMock("../../src/shared/events/emit", () => ({
    audit: jest.fn(),
    emit: jest.fn(),
  }));
  return require("../../src/modules/security/permission/permission.service");
}

const CLIENT = {};

afterEach(() => jest.resetModules());

describe("navAccess — the shell agrees with the enforcement path", () => {
  it("returns only the modules the caller can read", async () => {
    const svc = load({ granted: ["MOD-29", "MOD-33"] });
    const out = await svc.navAccess(CLIENT, {
      user_id: "u1",
      role_ids: ["r1"],
    });
    expect(out.modules).toEqual(["MOD-29", "MOD-33"]);
    expect(out.isCeo).toBe(false);
  });

  it("resolves the ribbon's tabs from the catalogue, not from the client", async () => {
    // Both grants are `fulfill`, so this is ONE tab — the collapse happens here,
    // where the taxonomy lives, rather than in a second mapping in the browser.
    const svc = load({ granted: ["MOD-29", "MOD-33"] });
    const out = await svc.navAccess(CLIENT, { role_ids: ["r1"] });
    expect(out.groups).toEqual(["fulfill"]);
  });

  it("orders tabs by the catalogue's sort order, so every user sees the same sequence", async () => {
    const svc = load({ granted: ["MOD-51", "MOD-00A", "MOD-29"] });
    const out = await svc.navAccess(CLIENT, { role_ids: ["r1"] });
    expect(out.groups).toEqual(["monitor", "fulfill", "transact"]);
  });

  it("gives the CEO everything, because rbac.js does", async () => {
    // No grant rows at all. `requirePermission` still lets a CEO through every
    // module, so a shell resolved from grants alone would show an empty ribbon
    // over an app that permits everything.
    const svc = load({ granted: [] });
    const out = await svc.navAccess(CLIENT, { role_ids: [], is_ceo: true });
    expect(out.modules).toHaveLength(CATALOGUE.length);
    expect(out.groups).toEqual(["monitor", "fulfill", "transact", "configure"]);
    expect(out.isCeo).toBe(true);
  });

  it("returns nothing for a user with no roles, rather than falling open", async () => {
    const svc = load({ granted: [] });
    const out = await svc.navAccess(CLIENT, { role_ids: [] });
    expect(out.modules).toEqual([]);
    expect(out.groups).toEqual([]);
  });

  /**
   * `groups` says which tabs exist; `byGroup` says what goes under one. The
   * ribbon's second row needs the second, and the only alternative to shipping
   * it is a copy of the taxonomy in the browser that nothing keeps honest.
   */
  it("spells out which modules belong to each tab", async () => {
    const svc = load({ granted: ["MOD-29", "MOD-33", "MOD-51"] });
    const out = await svc.navAccess(CLIENT, { role_ids: ["r1"] });
    expect(out.byGroup).toEqual({
      fulfill: ["MOD-29", "MOD-33"],
      transact: ["MOD-51"],
    });
  });

  it("keeps byGroup and groups describing the same set", async () => {
    // Two views of one partition. A refactor that filters one and not the other
    // produces a tab with nothing under it — the exact state the shell is meant
    // to be incapable of rendering.
    const svc = load({ granted: ["MOD-00A", "MOD-51"] });
    const out = await svc.navAccess(CLIENT, { role_ids: ["r1"] });
    expect(Object.keys(out.byGroup)).toEqual(out.groups);
    expect(Object.values(out.byGroup).flat().sort()).toEqual(out.modules);
    expect(Object.values(out.byGroup).every((keys) => keys.length > 0)).toBe(
      true,
    );
  });

  it("ignores a granted key the catalogue does not know", async () => {
    // A stale grant against a retired module must not invent a tab. It stays in
    // `modules` (it is a real grant) but contributes no group, because there is
    // no catalogue row to say which verb it belongs to.
    const svc = load({ granted: ["MOD-29", "MOD-999"] });
    const out = await svc.navAccess(CLIENT, { role_ids: ["r1"] });
    expect(out.groups).toEqual(["fulfill"]);
    expect(out.byGroup).toEqual({ fulfill: ["MOD-29"] });
  });
});

describe("navAccess — `version` is the client's cache key", () => {
  const forRoles = (granted) =>
    load({ granted }).navAccess(CLIENT, { role_ids: ["r1"] });

  it("is stable across calls when nothing changed", async () => {
    expect((await forRoles(["MOD-29", "MOD-33"])).version).toBe(
      (await forRoles(["MOD-29", "MOD-33"])).version,
    );
  });

  it("ignores the order the database returned rows in", async () => {
    // Otherwise every request could look like a permission change and the
    // client would revalidate — or hard-refresh — on a whim.
    expect((await forRoles(["MOD-33", "MOD-29"])).version).toBe(
      (await forRoles(["MOD-29", "MOD-33"])).version,
    );
  });

  it("changes when a module is granted", async () => {
    expect((await forRoles(["MOD-29"])).version).not.toBe(
      (await forRoles(["MOD-29", "MOD-33"])).version,
    );
  });

  it("changes when a module is revoked", async () => {
    expect((await forRoles(["MOD-29", "MOD-33"])).version).not.toBe(
      (await forRoles(["MOD-29"])).version,
    );
  });

  it("distinguishes a grant from a revocation by the set, not the digest", async () => {
    // The client needs this difference: a revocation must take effect at once,
    // while a grant must not throw away someone's unsaved form to announce good
    // news. Comparing digests only says "something changed" — comparing the sets
    // says which, which is why the endpoint returns both.
    const before = await forRoles(["MOD-29", "MOD-33"]);
    const revoked = await forRoles(["MOD-29"]);
    const granted = await forRoles(["MOD-29", "MOD-33", "MOD-51"]);

    const lost = before.modules.filter((m) => !revoked.modules.includes(m));
    const gained = granted.modules.filter((m) => !before.modules.includes(m));
    expect(lost).toEqual(["MOD-33"]);
    expect(gained).toEqual(["MOD-51"]);
    expect(before.modules.filter((m) => !granted.modules.includes(m))).toEqual(
      [],
    );
  });

  /**
   * THE GAP `byGroup` OPENED. Hashing the module keys alone was right while the
   * key set was the whole answer. It stopped being so the moment the response
   * started carrying the partition: regrouping a module leaves every key exactly
   * where it was and rearranges the ribbon completely — a tab gains a section,
   * another loses one, and an area can move to a different tab altogether.
   *
   * A digest that cannot see that reports "nothing changed" for the single edit
   * whose effect on screen is the most obvious, so the client's revalidation
   * never fires on it.
   */
  it("changes when a module is regrouped, though the module set is identical", async () => {
    const before = await load({ granted: ["MOD-29", "MOD-33"] }).navAccess(
      CLIENT,
      { role_ids: ["r1"] },
    );
    const after = await load({
      granted: ["MOD-29", "MOD-33"],
      catalogue: regrouped("MOD-33", "transact"),
    }).navAccess(CLIENT, { role_ids: ["r1"] });

    // The thing that did NOT change — which is what makes the digest the only
    // signal available.
    expect(after.modules).toEqual(before.modules);
    // …and the thing that did.
    expect(after.byGroup).not.toEqual(before.byGroup);
    expect(after.version).not.toBe(before.version);
  });

  it("is stable when a regroup moves a module the caller cannot see", async () => {
    // The digest describes THIS caller's ribbon. A verb change on a module they
    // were never granted rearranges nothing they can see, so waking their client
    // for it would be a reload that changes nothing on screen.
    const before = await load({ granted: ["MOD-29"] }).navAccess(CLIENT, {
      role_ids: ["r1"],
    });
    const after = await load({
      granted: ["MOD-29"],
      catalogue: regrouped("MOD-51", "empower"),
    }).navAccess(CLIENT, { role_ids: ["r1"] });

    expect(after.version).toBe(before.version);
  });

  it("still moves when a stale grant against a retired module comes or goes", async () => {
    // A key with no catalogue row has no verb to record, but it is a real grant
    // and the pair form must not swallow it.
    const withStale = await forRoles(["MOD-29", "MOD-999"]);
    const without = await forRoles(["MOD-29"]);
    expect(withStale.version).not.toBe(without.version);
  });
});
