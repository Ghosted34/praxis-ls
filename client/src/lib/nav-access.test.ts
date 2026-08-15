/**
 * The permissions read is the chrome's only input, and the chrome is the one
 * component that cannot be the thing that crashes — every screen renders inside
 * it. So the boundary coerces rather than trusts.
 *
 * The concrete failure: the shell reads `groups.filter(…)` and
 * `Object.entries(byGroup)` on its first render. A response missing either key
 * — an older API still deployed against a newer client, a proxy that wrapped
 * the body, a fixture returning `[]` — is not a degraded ribbon. It is a
 * TypeError inside a render, and it takes the application down rather than the
 * header.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const response = { current: undefined as unknown };

vi.mock("./api-client", () => ({ tenant: async () => response.current }));

import { fetchNavAccess, NO_ACCESS } from "./nav-access";

beforeEach(() => {
  response.current = undefined;
});

describe("fetchNavAccess", () => {
  it("passes a well-formed answer through unchanged", async () => {
    response.current = {
      modules: ["MOD-29"],
      groups: ["fulfill"],
      byGroup: { fulfill: ["MOD-29"] },
      isCeo: false,
      version: "abc123",
    };
    await expect(fetchNavAccess()).resolves.toEqual(response.current);
  });

  it.each([
    ["nothing at all", undefined],
    ["null", null],
    ["an empty array — what an unmocked fixture returns", []],
    [
      "an older shape with no byGroup",
      { modules: ["MOD-29"], groups: ["fulfill"], isCeo: false, version: "x" },
    ],
    ["an envelope", { data: { groups: ["fulfill"] } }],
    [
      "the right keys with the wrong types",
      { modules: "MOD-29", groups: {}, byGroup: [], isCeo: "yes", version: 7 },
    ],
  ])("survives %s", async (_label, payload) => {
    response.current = payload;
    const out = await fetchNavAccess();
    expect(Array.isArray(out.groups)).toBe(true);
    expect(Array.isArray(out.modules)).toBe(true);
    expect(typeof out.byGroup).toBe("object");
    expect(Array.isArray(out.byGroup)).toBe(false);
    expect(typeof out.isCeo).toBe("boolean");
    expect(typeof out.version).toBe("string");
  });

  it("resolves an unusable body to no access, not to full access", async () => {
    // Falling open would offer every destination and 403 on each click.
    response.current = null;
    await expect(fetchNavAccess()).resolves.toEqual(NO_ACCESS);
  });
});
