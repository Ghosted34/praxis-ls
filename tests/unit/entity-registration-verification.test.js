"use strict";

/**
 * PR-03 — statutory registration verification is a deliberate MOD-01 approval
 * transition. The ordinary child PATCH owns descriptive fields only; this path
 * alone owns `verified`, `verified_by`, and `verified_at`.
 */

let MOCK_GRANTS = [];

jest.mock("../../src/shared/cache/identity-cache", () => ({
  getGrants: async () => MOCK_GRANTS,
  getUserScopeClosure: async () => [],
}));

jest.mock("../../src/shared/events/emit", () => ({
  audit: jest.fn(async () => {}),
  emitEvent: jest.fn(async () => {}),
}));

const express = require("express");
const { entityCommon } = require("@praxis/shared");
const {
  buildResource,
  entityResourceSpecs,
  mountEntityNested,
} = require("../../src/modules/master/_shared/nested");
const { audit } = require("../../src/shared/events/emit");

const spec = () =>
  entityResourceSpecs().find((resource) => resource.seg === "registrations");

function registrationService() {
  const resource = spec();
  return buildResource({
    table: resource.table,
    pk: resource.pk,
    parentCol: "entity_id",
    parentTable: "corporate_entity",
    parentPk: "entity_id",
    moduleKey: "MOD-01",
    label: resource.table,
    writable: resource.writable,
    touch: resource.touch,
    primaryScope: resource.primaryScope,
    isVerifiableRegistration: resource.isVerifiableRegistration,
  }).service;
}

function fakeClient({ existing, returned }) {
  const calls = [];
  return {
    calls,
    query(text, params) {
      calls.push({ text, params });
      if (/^SELECT \* FROM entity_registration/.test(text)) {
        return { rows: existing ? [existing] : [] };
      }
      if (
        /UPDATE entity_registration/.test(text) &&
        /RETURNING \*/.test(text)
      ) {
        return { rows: returned ? [returned] : [] };
      }
      return { rows: [] };
    },
  };
}

const row = (overrides = {}) => ({
  registration_id: "rg-1",
  entity_id: "entity-1",
  country_code: "CM",
  kind: "RCCM",
  number: "RC/DLA/2021/B/206",
  verified: false,
  verified_by: null,
  verified_at: null,
  ...overrides,
});

describe("entity registration verification service", () => {
  beforeEach(() => {
    audit.mockClear();
  });

  it("sets the existing verification fields and audits the approver and time", async () => {
    const after = row({
      verified: true,
      verified_by: "approver-1",
      verified_at: "2026-09-19T12:34:56.000Z",
    });
    const client = fakeClient({ existing: row(), returned: after });

    const result = await registrationService().verify(client, {
      parentId: "entity-1",
      id: "rg-1",
      actor: { user_id: "approver-1" },
    });

    expect(result).toEqual(after);
    const write = client.calls.find((call) =>
      /UPDATE entity_registration/.test(call.text),
    );
    expect(write.text).toMatch(
      /SET verified = true, verified_by = \$2, verified_at = now\(\)/,
    );
    expect(write.text).toMatch(
      /WHERE registration_id = \$1 AND entity_id = \$3/,
    );
    expect(write.params).toEqual(["rg-1", "approver-1", "entity-1"]);
    expect(audit).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        actorUserId: "approver-1",
        action: "entity_registration.verified",
        moduleKey: "MOD-01",
        entityRef: "entity_registration:rg-1",
        before: expect.objectContaining({ verified: false }),
        after: expect.objectContaining({
          verified: true,
          verified_by: "approver-1",
          verified_at: "2026-09-19T12:34:56.000Z",
        }),
      }),
    );
    expect(client.calls.map((call) => call.text)).toEqual(
      expect.arrayContaining(["BEGIN", "COMMIT"]),
    );
  });

  it("unverifies through a separate audited transition", async () => {
    const before = row({
      verified: true,
      verified_by: "approver-0",
      verified_at: "2026-09-18T09:00:00.000Z",
    });
    const after = row();
    const client = fakeClient({ existing: before, returned: after });

    await registrationService().unverify(client, {
      parentId: "entity-1",
      id: "rg-1",
      actor: { user_id: "approver-2" },
    });

    const write = client.calls.find((call) =>
      /UPDATE entity_registration/.test(call.text),
    );
    expect(write.text).toMatch(
      /verified = false, verified_by = NULL, verified_at = NULL/,
    );
    expect(write.params).toEqual(["rg-1", "entity-1"]);
    expect(audit).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        actorUserId: "approver-2",
        action: "entity_registration.unverified",
        before,
        after,
      }),
    );
  });

  it("does not rewrite actor/time or duplicate the audit on a verification retry", async () => {
    const verified = row({
      verified: true,
      verified_by: "approver-1",
      verified_at: "2026-09-19T12:34:56.000Z",
    });
    const client = fakeClient({ existing: verified, returned: null });

    await expect(
      registrationService().verify(client, {
        parentId: "entity-1",
        id: "rg-1",
        actor: { user_id: "approver-2" },
      }),
    ).resolves.toEqual(verified);

    expect(client.calls.some((call) => /UPDATE/.test(call.text))).toBe(false);
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses to verify an empty statutory fact", async () => {
    const client = fakeClient({
      existing: row({ number: "  " }),
      returned: null,
    });
    await expect(
      registrationService().verify(client, {
        parentId: "entity-1",
        id: "rg-1",
        actor: { user_id: "approver-1" },
      }),
    ).rejects.toMatchObject({
      code: "REGISTRATION_NUMBER_REQUIRED",
      status: 422,
    });
    expect(audit).not.toHaveBeenCalled();
  });

  it("cannot act on a registration owned by another entity", async () => {
    const client = fakeClient({
      existing: row({ entity_id: "entity-2" }),
      returned: null,
    });
    await expect(
      registrationService().verify(client, {
        parentId: "entity-1",
        id: "rg-1",
        actor: { user_id: "approver-1" },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});

describe("entity registration verification HTTP contract", () => {
  const router = express.Router();
  mountEntityNested(router, {
    moduleKey: "MOD-01",
    parentTable: "corporate_entity",
    parentPk: "entity_id",
  });

  const layerFor = (suffix) =>
    router.stack.find(
      (layer) =>
        layer.route &&
        layer.route.path === `/:id/registrations/:childId/${suffix}` &&
        layer.route.methods.post,
    );

  async function runGate(layer) {
    const gate = layer.route.stack[0].handle;
    let nexted = false;
    let error = null;
    try {
      await gate(
        {
          user: { user_id: "u-1", role_ids: ["role-1"], is_ceo: false },
          identityDb: (fn) => fn({}),
        },
        {},
        () => {
          nexted = true;
        },
      );
    } catch (caught) {
      error = caught;
    }
    return { nexted, error };
  }

  it.each(["verify", "unverify"])(
    "mounts POST /registrations/:childId/%s behind MOD-01 approve",
    async (suffix) => {
      const layer = layerFor(suffix);
      expect(layer).toBeTruthy();

      MOCK_GRANTS = [{ can_update: true }];
      expect(await runGate(layer)).toMatchObject({
        nexted: false,
        error: { code: "PERMISSION_DENIED", status: 403 },
      });

      MOCK_GRANTS = [{ can_approve: true }];
      expect(await runGate(layer)).toEqual({ nexted: true, error: null });
    },
  );

  it("keeps verification fields out of ordinary PATCH validation and persistence", () => {
    const parsed = entityCommon.registrationUpdate.parse({
      number: "RC/DLA/2021/B/206",
      verified: true,
      verified_by: "approver-1",
      verified_at: "2026-09-19T12:34:56.000Z",
    });
    expect(parsed).toEqual({ number: "RC/DLA/2021/B/206" });
    expect(spec().writable).not.toEqual(
      expect.arrayContaining(["verified", "verified_by", "verified_at"]),
    );
  });
});
