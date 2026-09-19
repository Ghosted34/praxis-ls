"use strict";

/**
 * PR-01 — the `/entities/:id/360` capability contract.
 *
 * The dossier is one aggregation behind one `view` route, but its controls are
 * not one capability: status/child/letterhead/calendar writes need `edit`,
 * document & registration verification needs `approve`, and the Public Story
 * needs MOD-01 `edit` OR MOD-29 `edit` (Decision Q10). `capabilitiesFor(req)`
 * is the answer the UI reads so it never offers a control that will 403.
 *
 * These tests pin the shape and the Q10 rule:
 *   view        = MOD-01 can_read
 *   edit        = MOD-01 can_update
 *   approve     = MOD-01 can_approve
 *   public_story= MOD-01 can_update OR MOD-29 can_update
 */

let MOCK_GRANTS_BY_MODULE = {};

jest.mock("../../src/shared/cache/identity-cache", () => ({
  getGrants: async (_client, { module }) => MOCK_GRANTS_BY_MODULE[module] || [],
}));

const { capabilitiesFor } = require("../../src/modules/master/entity-360.service");

const makeReq = (user) => ({
  user,
  identityDb: (fn) => fn("CLIENT"),
});

const CEO = { user_id: "u-ceo", role_ids: ["r-ceo"], is_ceo: true };
const EDITOR = { user_id: "u-editor", role_ids: ["r-editor"], is_ceo: false };
const VIEWER = { user_id: "u-viewer", role_ids: ["r-viewer"], is_ceo: false };
const WEBEDITOR = { user_id: "u-web", role_ids: ["r-web"], is_ceo: false };

describe("entity-360 capabilitiesFor (PR-01)", () => {
  beforeEach(() => {
    MOCK_GRANTS_BY_MODULE = {};
  });

  it("returns the all-false baseline for a caller with no grants", async () => {
    expect(await capabilitiesFor(makeReq(VIEWER))).toEqual({
      view: false,
      edit: false,
      approve: false,
      public_story: false,
    });
  });

  it("maps MOD-01 read to view, and nothing else", async () => {
    MOCK_GRANTS_BY_MODULE = { "MOD-01": [{ can_read: true }] };
    expect(await capabilitiesFor(makeReq(VIEWER))).toEqual({
      view: true,
      edit: false,
      approve: false,
      public_story: false,
    });
  });

  it("maps MOD-01 update to edit (and public_story via Q10)", async () => {
    MOCK_GRANTS_BY_MODULE = { "MOD-01": [{ can_update: true }] };
    expect(await capabilitiesFor(makeReq(EDITOR))).toEqual({
      view: false,
      edit: true,
      approve: false,
      public_story: true,
    });
  });

  it("maps MOD-01 approve to approve", async () => {
    MOCK_GRANTS_BY_MODULE = { "MOD-01": [{ can_approve: true }] };
    const caps = await capabilitiesFor(makeReq(EDITOR));
    expect(caps.approve).toBe(true);
    expect(caps.edit).toBe(false);
  });

  it("gives a website editor public_story without MOD-01 edit (Decision Q10)", async () => {
    MOCK_GRANTS_BY_MODULE = { "MOD-29": [{ can_update: true }] };
    const caps = await capabilitiesFor(makeReq(WEBEDITOR));
    expect(caps.public_story).toBe(true);
    expect(caps.edit).toBe(false);
  });

  it("does not give a MOD-29 READER anything on an entity dossier", async () => {
    MOCK_GRANTS_BY_MODULE = { "MOD-29": [{ can_read: true }] };
    expect(await capabilitiesFor(makeReq(WEBEDITOR))).toEqual({
      view: false,
      edit: false,
      approve: false,
      public_story: false,
    });
  });

  it("requires the columns to be exactly true", async () => {
    MOCK_GRANTS_BY_MODULE = { "MOD-01": [{ can_update: "yes" }] };
    expect((await capabilitiesFor(makeReq(EDITOR))).edit).toBe(false);
  });

  it("gives the CEO everything without a lookup", async () => {
    expect(await capabilitiesFor(makeReq(CEO))).toEqual({
      view: true,
      edit: true,
      approve: true,
      public_story: true,
    });
  });

  it("returns the baseline when there is no user (e.g. a system read)", async () => {
    expect(await capabilitiesFor(null)).toEqual({
      view: false,
      edit: false,
      approve: false,
      public_story: false,
    });
    expect(await capabilitiesFor({ identityDb: (fn) => fn("CLIENT") })).toEqual({
      view: false,
      edit: false,
      approve: false,
      public_story: false,
    });
  });

  it("returns the baseline when the request has no identityDb", async () => {
    expect(await capabilitiesFor({ user: VIEWER })).toEqual({
      view: false,
      edit: false,
      approve: false,
      public_story: false,
    });
  });
});
