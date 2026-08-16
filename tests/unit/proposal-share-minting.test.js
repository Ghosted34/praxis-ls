"use strict";

/**
 * F5 — the MINTING half of proposal sharing.
 *
 * tests/unit/proposal-f5-sharing.test.js covers `resolve()`, `get()` and
 * `download()` — everything a visitor does with a token that already exists —
 * plus two assertions that read proposal.service.js as TEXT and check it
 * contains "randomBytes(32)" and "createHmac". Nothing called the function.
 *
 * So this shipped: `createHmac("sha256", config.JWT_SECRET)`, where
 * `JWT_SECRET` is not a key src/config/env.js defines. It resolved to
 * `undefined`, `createHmac` threw `TypeError: The "key" argument must be of
 * type string…`, and `POST /proposals/:id/share` answered 500 in every
 * environment — the feature could not mint a single link. The text assertion
 * passed the whole time, because the strings it looks for were right there in
 * the line that threw.
 *
 * The lesson this file encodes: when the thing under test is a value produced
 * by crypto, assert on the VALUE. Reading the source for the name of an API is
 * not a test of the call.
 */

const crypto = require("crypto");

jest.mock("../../src/modules/sales/proposal/proposal.repo", () => ({
  get: jest.fn(),
  update: jest.fn(async (_c, _id, fields) => ({ proposal_id: "p1", ...fields })),
}));
jest.mock("../../src/shared/events/emit", () => ({
  audit: jest.fn(),
  emitEvent: jest.fn(),
  resolveActorId: jest.fn(async (_c, id) => id),
}));

const repo = require("../../src/modules/sales/proposal/proposal.repo");
const service = require("../../src/modules/sales/proposal/proposal.service");
const { config } = require("../../src/config/env");

describe("F5 share-token minting", () => {
  beforeEach(() => jest.clearAllMocks());

  test("signedToken returns raw.signature and does not throw on a real config", () => {
    const token = service.signedToken();
    expect(typeof token).toBe("string");
    const [raw, sig] = token.split(".");
    expect(raw).toBeTruthy();
    expect(sig).toBeTruthy();
    // 32 random bytes, base64url — 43 characters, no padding.
    expect(Buffer.from(raw, "base64url")).toHaveLength(32);
    expect(sig).toBe(
      crypto.createHmac("sha256", config.JWT_ACCESS_SECRET).update(raw).digest("base64url"),
    );
  });

  test("the signing secret is one the env schema actually defines", () => {
    expect(config.JWT_ACCESS_SECRET).toEqual(expect.any(String));
    expect(config.JWT_ACCESS_SECRET.length).toBeGreaterThan(0);
    expect(config.JWT_SECRET).toBeUndefined();
  });

  test("two tokens never collide", () => {
    const seen = new Set(Array.from({ length: 200 }, () => service.signedToken()));
    expect(seen.size).toBe(200);
  });

  test("share() on a SENT proposal stores only the hash and returns the token", async () => {
    repo.get.mockResolvedValue({ proposal_id: "p1", status: "SENT" });
    const client = { query: jest.fn(async () => ({ rows: [] })) };

    const out = await service.share(client, { id: "p1", expiresInDays: 7, actor: {} });

    expect(out.token).toContain(".");
    expect(out.path).toBe(`/public/proposals/${encodeURIComponent(out.token)}`);
    const [, , fields] = repo.update.mock.calls[0];
    // The token itself is never persisted — only its sha256, which is what
    // proposal_public.service looks up.
    expect(fields.share_token_hash).toBe(
      crypto.createHash("sha256").update(out.token).digest("hex"),
    );
    expect(JSON.stringify(fields)).not.toContain(out.token);
    expect(fields.share_revoked_at).toBeNull();
    expect(new Date(fields.share_expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  test("a proposal that has not been sent cannot be shared", async () => {
    repo.get.mockResolvedValue({ proposal_id: "p1", status: "DRAFT" });
    await expect(service.share({ query: jest.fn() }, { id: "p1" })).rejects.toMatchObject({
      code: "NOT_SENT",
      status: 422,
    });
  });
});
