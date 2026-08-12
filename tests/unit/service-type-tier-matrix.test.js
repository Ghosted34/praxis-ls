"use strict";
/**
 * The tier matrix write path (MOD-29) — ST-360 → Dictionary.
 *
 * The matrix is the only place a user decides which financial dictionary lines
 * a service pulls and at which bundle, and that decision propagates: every
 * future costing sheet, margin sim and quote of that service type loads the set
 * this produces. The four things pinned here are the ones a click-through would
 * not catch:
 *
 *   1. Setting a tier on a line that is NOT yet scoped ADDS it — the endpoint is
 *      an upsert, so "add at Advanced" and "move Full → Basic" are one call, and
 *      the UI never has to choose between create and update.
 *   2. `dictionary_item.service_type_key` is re-derived on every change. That
 *      denormalised hint still backs `stats.dictionary_items`, so skipping it
 *      leaves the header count disagreeing with the table right beneath it.
 *   3. A NON_OPERATIONAL line is refused. Office rent has no business on a
 *      dossier's pick-list, and silently accepting it would put an overhead on
 *      every costing sheet of that service type.
 *   4. Unlinking a line that is not linked is a 404, not a silent success — a
 *      "Remove" that reports success while nothing changed is the failure mode
 *      that teaches people not to trust the screen.
 */
const service = require("../../src/modules/operations/service_type/service_type.service");
const repo = require("../../src/modules/operations/service_type/service_type.repo");

const ST = {
  service_type_id: "st-1",
  key: "SEA_FREIGHT_IMPORT",
  is_system: true,
  is_active: true,
};
const ITEM = {
  dictionary_item_id: "di-1",
  code: "#D041",
  label_en: "Demurrage",
  label_fr: "Surestaries",
  applicability_mode: "SERVICE_SCOPED",
  is_active: true,
};

/**
 * A client that answers the ONE inline query the service makes (the dictionary
 * item lookup) and swallows the audit insert. Repo methods are stubbed
 * separately — same split as service-type-360.test.js, which keeps a SQL change
 * in the repo from silently passing here.
 */
function fakeClient(itemRow) {
  return {
    query: (sql) => {
      if (/FROM dictionary_item/i.test(sql))
        return Promise.resolve({ rows: itemRow ? [itemRow] : [] });
      return Promise.resolve({ rows: [] });
    },
  };
}

/** Swap repo methods for stubs; returns a restore fn. Direct assignment because
 *  the repo exports are a `{...base, ...local}` spread and spyOn refuses them. */
function stubRepo(map) {
  const saved = {};
  for (const [k, v] of Object.entries(map)) {
    saved[k] = repo[k];
    repo[k] = v;
  }
  return () => Object.assign(repo, saved);
}

describe("service_type.setDictionaryTier", () => {
  test("upserts the link and re-derives service_type_key", async () => {
    const calls = { set: null, sync: null };
    const restore = stubRepo({
      findById: async () => ST,
      setDictionaryTier: async (_c, stId, itemId, tier) => {
        calls.set = { stId, itemId, tier };
        return { service_type_id: stId, dictionary_item_id: itemId, tier };
      },
      syncServiceTypeKey: async (_c, itemId) => {
        calls.sync = itemId;
        return { dictionary_item_id: itemId, service_type_key: ST.key };
      },
    });
    try {
      const link = await service.setDictionaryTier(fakeClient(ITEM), {
        id: ST.service_type_id,
        dictionaryItemId: ITEM.dictionary_item_id,
        tier: "BASIC",
        actor: { user_id: "u1" },
      });
      expect(calls.set).toEqual({
        stId: "st-1",
        itemId: "di-1",
        tier: "BASIC",
      });
      expect(link.tier).toBe("BASIC");
      // (2) — the denormalised hint must move with the link, or the 360 header
      // count and the table below it disagree.
      expect(calls.sync).toBe("di-1");
    } finally {
      restore();
    }
  });

  test("refuses a NON_OPERATIONAL line — an overhead never belongs to a service", async () => {
    const restore = stubRepo({
      findById: async () => ST,
      setDictionaryTier: async () => {
        throw new Error("must not be reached");
      },
      syncServiceTypeKey: async () => null,
    });
    try {
      const overhead = {
        ...ITEM,
        code: "#E027",
        label_en: "Rent",
        applicability_mode: "NON_OPERATIONAL",
      };
      await expect(
        service.setDictionaryTier(fakeClient(overhead), {
          id: ST.service_type_id,
          dictionaryItemId: "di-9",
          tier: "BASIC",
          actor: {},
        }),
      ).rejects.toMatchObject({ code: "NOT_OPERATIONAL", status: 422 });
    } finally {
      restore();
    }
  });

  test("404s on an unknown service type, before touching the dictionary", async () => {
    const restore = stubRepo({ findById: async () => null });
    try {
      await expect(
        service.setDictionaryTier(fakeClient(ITEM), {
          id: "nope",
          dictionaryItemId: "di-1",
          tier: "BASIC",
          actor: {},
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    } finally {
      restore();
    }
  });

  test("404s on an unknown dictionary item", async () => {
    const restore = stubRepo({ findById: async () => ST });
    try {
      await expect(
        service.setDictionaryTier(fakeClient(null), {
          id: ST.service_type_id,
          dictionaryItemId: "ghost",
          tier: "FULL",
          actor: {},
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    } finally {
      restore();
    }
  });
});

describe("service_type.removeDictionaryTier", () => {
  test("unlinks and re-derives service_type_key", async () => {
    let synced = null;
    const restore = stubRepo({
      findById: async () => ST,
      removeDictionaryTier: async (_c, stId, itemId) => ({
        service_type_id: stId,
        dictionary_item_id: itemId,
        tier: "ADVANCED",
      }),
      syncServiceTypeKey: async (_c, itemId) => {
        synced = itemId;
        return null;
      },
    });
    try {
      const removed = await service.removeDictionaryTier(fakeClient(ITEM), {
        id: ST.service_type_id,
        dictionaryItemId: "di-1",
        actor: {},
      });
      expect(removed.tier).toBe("ADVANCED");
      expect(synced).toBe("di-1");
    } finally {
      restore();
    }
  });

  test("404s when the line was not scoped to this service — never a silent no-op", async () => {
    const restore = stubRepo({
      findById: async () => ST,
      removeDictionaryTier: async () => null,
      syncServiceTypeKey: async () => {
        throw new Error("must not resync after a failed unlink");
      },
    });
    try {
      await expect(
        service.removeDictionaryTier(fakeClient(ITEM), {
          id: ST.service_type_id,
          dictionaryItemId: "di-unlinked",
          actor: {},
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    } finally {
      restore();
    }
  });
});
