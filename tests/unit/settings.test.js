"use strict";
/** Tenant settings reader/writer (BUILD_CONVENTIONS §6). */
const {
  getSetting,
  getRule,
  getSection,
  putSetting,
} = require("../../src/shared/config/settings");

function fakeClient(store) {
  return {
    store,
    query: async (sql, params) => {
      if (
        /SELECT value FROM setting WHERE section = \$1 AND key = \$2/.test(sql)
      ) {
        const v = store[params[0] + "|" + params[1]];
        return { rows: v === undefined ? [] : [{ value: v }] };
      }
      if (/SELECT key, value FROM setting WHERE section = \$1/.test(sql)) {
        return {
          rows: Object.keys(store)
            .filter((k) => k.startsWith(params[0] + "|"))
            .map((k) => ({ key: k.split("|")[1], value: store[k] })),
        };
      }
      if (/INSERT INTO setting/.test(sql)) {
        store[params[0] + "|" + params[1]] = JSON.parse(params[2]);
        return {
          rows: [
            {
              section: params[0],
              key: params[1],
              value: store[params[0] + "|" + params[1]],
              version: 2,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
}

describe("settings reader/writer", () => {
  it("getSetting returns value or fallback", async () => {
    const c = fakeClient({ "finance|regie": { policy_window_days: 10 } });
    expect(await getSetting(c, "finance", "regie")).toEqual({
      policy_window_days: 10,
    });
    expect(await getSetting(c, "finance", "missing", { d: 1 })).toEqual({
      d: 1,
    });
  });
  it("getRule reads a field with default", async () => {
    const c = fakeClient({ "finance|regie": { policy_window_days: 10 } });
    expect(await getRule(c, "finance", "regie", "policy_window_days", 7)).toBe(
      10,
    );
    expect(await getRule(c, "finance", "regie", "grace_days", 3)).toBe(3);
    expect(await getRule(c, "finance", "absent", "x", 99)).toBe(99);
  });
  it("getSection maps keys to values", async () => {
    const c = fakeClient({
      "numbering|MOD-51": { prefix: "INV" },
      "numbering|MOD-55": { prefix: "JE" },
    });
    expect(await getSection(c, "numbering")).toEqual({
      "MOD-51": { prefix: "INV" },
      "MOD-55": { prefix: "JE" },
    });
  });
  it("putSetting upserts and round-trips", async () => {
    const c = fakeClient({});
    await putSetting(c, {
      section: "numbering",
      key: "MOD-51",
      value: { prefix: "SMLS", padding: 5 },
      actor: { user_id: "u1" },
    });
    expect(await getSetting(c, "numbering", "MOD-51")).toEqual({
      prefix: "SMLS",
      padding: 5,
    });
  });
});
