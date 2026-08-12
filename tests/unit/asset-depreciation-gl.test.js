"use strict";

/**
 * DATA 5.5 (Critical) — asset depreciation must actually reach the GL.
 *
 * The defect: `depreciate()` built its journal lines with `account:` while
 * `buildAndInsert` reads `ln.account_code`, and passed no `sourceDocRef` while
 * the validator requires one. The call threw every time. A
 * `catch { entryId = null }` swallowed it, and `markPosted()` then set
 * posted = true with entry_id NULL.
 *
 * So depreciation never posted, on any asset, ever — and the subledger said it
 * had. `accumulatedPosted()` sums `WHERE posted = true`, so the fixed-asset
 * register reported an accumulated depreciation and net book value that the
 * trial balance did not contain, and `dispose()` computed gain/loss from that
 * phantom figure.
 *
 * This was the SECOND time this exact bug shipped — payroll had it, was fixed,
 * and the fix was never generalised. These assertions are written against the
 * shape of the call rather than the outcome, so they fail if anyone reintroduces
 * either half.
 */

const path = require("path");

const SERVICE = "../../src/modules/finance/asset/asset.service";
const JOURNAL = "../../src/modules/finance/journal_entry/journal_entry.service";
const REPO = "../../src/modules/finance/asset/asset.repo";

const ASSET = {
  asset_id: "asset-1",
  entity_id: "entity-1",
  label: "Forklift",
  status: "ACTIVE",
  acquisition_cost: 12000,
  coa_depr_code: "2845",
};
const ROW = {
  depreciation_id: "dep-1",
  period_code: "2026-03",
  amount: 250,
  posted: false,
};

/** Load the service with the journal + repo mocked. */
function load({ postImpl } = {}) {
  jest.resetModules();
  const post = jest.fn(postImpl || (async () => ({ entry_id: "entry-99" })));
  const markPosted = jest.fn(async (_c, id, entryId) => ({
    ...ROW,
    depreciation_id: id,
    posted: true,
    entry_id: entryId,
  }));

  jest.doMock(JOURNAL, () => ({ post }));
  jest.doMock(REPO, () => ({
    findById: async () => ASSET,
    scheduleRow: async () => ({ ...ROW }),
    markPosted,
    accumulatedPosted: async () => 0,
    update: async (_c, _id, patch) => ({ ...ASSET, ...patch }),
  }));
  jest.doMock("../../src/shared/events/emit", () => ({
    emitEvent: jest.fn(async () => {}),
    audit: jest.fn(async () => {}),
    resolveActorId: jest.fn(async (c, id) => id || null),
  }));

  const service = require(SERVICE);
  return { service, post, markPosted };
}

afterEach(() => jest.resetModules());

describe("DATA 5.5 — depreciation posts to the general ledger", () => {
  it("sends account_code, not account", async () => {
    // The first half of the bug. `account:` silently produced
    // `account_code: undefined` inside buildAndInsert.
    const { service, post } = load();
    await service.depreciate(
      {},
      { id: "asset-1", period_code: "2026-03", actor: {} },
    );

    expect(post).toHaveBeenCalledTimes(1);
    const payload = post.mock.calls[0][1];
    for (const line of payload.lines) {
      expect(line).toHaveProperty("account_code");
      expect(line.account_code).toBeTruthy();
      expect(line).not.toHaveProperty("account");
    }
  });

  it("sends a sourceDocRef — the validator rejects the entry without one", async () => {
    // The second half. journal_entry.service.js:42 throws SOURCE_DOC_REQUIRED
    // when `validate` is on (the default) and sourceDocRef is absent.
    const { service, post } = load();
    await service.depreciate(
      {},
      { id: "asset-1", period_code: "2026-03", actor: {} },
    );
    expect(post.mock.calls[0][1].sourceDocRef).toBe("asset:asset-1");
  });

  it("posts a balanced entry: debit 6813, credit the accumulated account", async () => {
    const { service, post } = load();
    await service.depreciate(
      {},
      { id: "asset-1", period_code: "2026-03", actor: {} },
    );
    const { lines } = post.mock.calls[0][1];

    const debit = lines.find((l) => l.debit > 0);
    const credit = lines.find((l) => l.credit > 0);
    expect(debit.account_code).toBe("6813");
    expect(credit.account_code).toBe("2845");
    expect(debit.debit).toBe(credit.credit);
  });

  it("dates the entry on the last day of the period", async () => {
    const { service, post } = load();
    await service.depreciate(
      {},
      { id: "asset-1", period_code: "2026-03", actor: {} },
    );
    expect(post.mock.calls[0][1].entryDate).toBe("2026-03-31");
  });

  it("marks the row posted WITH the returned entry id", async () => {
    const { service, markPosted } = load();
    const out = await service.depreciate(
      {},
      { id: "asset-1", period_code: "2026-03", actor: {} },
    );
    expect(markPosted).toHaveBeenCalledWith({}, "dep-1", "entry-99");
    expect(out.posted_to_gl).toBe(true);
  });

  describe("when the ledger rejects the entry", () => {
    // The behaviour change. Previously swallowed and recorded as posted; a
    // closed period or non-postable account silently diverged the subledger
    // from the GL. Now it fails loudly and posts nothing.
    const rejecting = {
      postImpl: async () => {
        throw new Error("period 2026-03 is locked");
      },
    };

    it("throws instead of returning success", async () => {
      const { service } = load(rejecting);
      await expect(
        service.depreciate(
          {},
          { id: "asset-1", period_code: "2026-03", actor: {} },
        ),
      ).rejects.toMatchObject({ code: "GL_POST_FAILED" });
    });

    it("does NOT mark the period posted — the regression that hid this", async () => {
      const { service, markPosted } = load(rejecting);
      await service
        .depreciate({}, { id: "asset-1", period_code: "2026-03", actor: {} })
        .catch(() => {});
      expect(markPosted).not.toHaveBeenCalled();
    });

    it("surfaces the underlying reason to the caller", async () => {
      const { service } = load(rejecting);
      await expect(
        service.depreciate(
          {},
          { id: "asset-1", period_code: "2026-03", actor: {} },
        ),
      ).rejects.toThrow(/locked/);
    });
  });

  it("refuses to mark posted when the ledger returns no entry id", async () => {
    // Defensive: resolving without an id would recreate posted=true/entry=NULL.
    const { service, markPosted } = load({ postImpl: async () => ({}) });
    await expect(
      service.depreciate(
        {},
        { id: "asset-1", period_code: "2026-03", actor: {} },
      ),
    ).rejects.toMatchObject({ code: "GL_POST_FAILED" });
    expect(markPosted).not.toHaveBeenCalled();
  });

  it("stays idempotent for an already-posted period", async () => {
    jest.resetModules();
    const post = jest.fn();
    jest.doMock(JOURNAL, () => ({ post }));
    jest.doMock(REPO, () => ({
      findById: async () => ASSET,
      scheduleRow: async () => ({ ...ROW, posted: true }),
      markPosted: jest.fn(),
      accumulatedPosted: async () => 0,
    }));
    jest.doMock("../../src/shared/events/emit", () => ({
      emitEvent: jest.fn(),
      audit: jest.fn(),
      resolveActorId: jest.fn(async (c, id) => id || null),
    }));
    const service = require(SERVICE);

    const out = await service.depreciate(
      {},
      { id: "asset-1", period_code: "2026-03", actor: {} },
    );
    expect(out.already_posted).toBe(true);
    expect(post).not.toHaveBeenCalled();
  });
});

describe("the sweep that found it", () => {
  it("no journal line anywhere uses `account:` instead of `account_code:`", () => {
    // A grep as a test. This bug shipped twice — payroll, then asset — because
    // the first fix was applied where the bug was noticed rather than where the
    // class of bug lived. This fails on the third occurrence.
    const fs = require("fs");
    const root = path.resolve(__dirname, "../../src");
    const offenders = [];

    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".service.js")) {
          const src = fs.readFileSync(p, "utf8");
          // Only inside something that looks like a ledger line: an object
          // literal carrying `account:` alongside debit/credit.
          const re = /\{\s*account:\s*[^}]*\b(debit|credit)\s*:/g;
          if (re.test(src)) offenders.push(path.relative(root, p));
        }
      }
    })(root);

    expect(offenders).toEqual([]);
  });
});
