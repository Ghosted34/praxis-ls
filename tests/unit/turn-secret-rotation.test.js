"use strict";

/**
 * Rotating the relay's shared secret without dropping a call.
 *
 * The secret has two readers that must agree: the API signs each call's
 * credential with it, coturn verifies with its own copy. Changing it used to
 * mean both sides at once, by hand, which is why in practice it never
 * happened.
 *
 * coturn's `turn/realm/<realm>/secret` is a SET and every member is valid, so
 * a rotation can keep the old secret alive exactly as long as a credential
 * minted under it could still be in a browser's hands. These tests hold the
 * four properties that makes it safe:
 *
 *   1. both secrets reach coturn BEFORE the API starts signing with the new
 *      one — the other order signs with a value coturn has never seen;
 *   2. the old one stops being valid when its window closes, not before;
 *   3. it is then removed from coturn too, or the rotation never finished;
 *   4. none of it engages unless the deployment opted in.
 */

jest.mock("../../src/config/env", () => {
  const real = jest.requireActual("../../src/config/env");
  return { ...real, config: { ...real.config } };
});

const mockStore = { value: {}, secret: null };
const mockPut = jest.fn(async ({ value, secret }) => {
  mockStore.value = value;
  if (secret !== undefined) mockStore.secret = secret;
});
jest.mock("../../src/services/platform/settings.service", () => ({
  resolve: jest.fn(async () => ({ value: mockStore.value, secret: mockStore.secret })),
  put: mockPut,
}));

jest.mock("../../src/config/redis", () => {
  const fake = require("../helpers/fake-redis").createFakeRedis();
  return { getClient: () => fake, __fake: fake };
});

const { config } = require("../../src/config/env");
const redis = require("../../src/config/redis").__fake;
const secrets = require("../../src/modules/smartcomm/smartcomm.turn.secret.service");

const REALM = "turn.example.com";
const KEY = `turn/realm/${REALM}/secret`;
const saved = { ...config };

beforeEach(() => {
  Object.assign(config, saved, {
    TURN_REALM: REALM,
    TURN_CREDENTIAL_SECRET: "from-the-host",
    TURN_SECRET_SOURCE: "vault",
  });
  mockStore.value = { host: REALM };
  mockStore.secret = null;
  mockPut.mockClear();
  redis._reset();
});
afterEach(() => Object.assign(config, saved));

const members = () => redis.smembers(KEY);

describe("off unless the deployment opted in", () => {
  beforeEach(() => { config.TURN_SECRET_SOURCE = "env"; });

  it("signs with the host's secret and never reads the vault", async () => {
    mockStore.secret = JSON.stringify({ current: "from-the-vault" });
    expect(await secrets.activeSecret()).toBe("from-the-host");
  });

  it("refuses to rotate, because coturn holds a static secret it cannot reach", async () => {
    await expect(secrets.rotate()).rejects.toMatchObject({ status: 409 });
  });

  it("publishes nothing", async () => {
    expect(await secrets.syncRelay()).toMatchObject({ synced: false });
    expect(await members()).toEqual([]);
  });
});

describe("the vault's secret, once opted in", () => {
  it("falls back to the host's until one is stored", async () => {
    expect(await secrets.activeSecret()).toBe("from-the-host");
  });

  it("prefers the stored one", async () => {
    mockStore.secret = JSON.stringify({ current: "from-the-vault" });
    expect(await secrets.activeSecret()).toBe("from-the-vault");
  });

  it("reads a row written before rotation existed, which held a bare string", async () => {
    mockStore.secret = "a-plain-old-secret";
    expect(await secrets.activeSecret()).toBe("a-plain-old-secret");
  });

  it("falls back to the host's when the vault cannot be read", async () => {
    const settings = require("../../src/services/platform/settings.service");
    settings.resolve.mockRejectedValueOnce(new Error("platform db down"));
    expect(await secrets.activeSecret()).toBe("from-the-host");
  });
});

describe("rotation", () => {
  beforeEach(() => { mockStore.secret = JSON.stringify({ current: "the-old-one" }); });

  it("puts BOTH secrets in coturn's set before the API switches over", async () => {
    // The ordering is the property: if the vault were written first and the
    // Redis write then failed, the API would sign with a secret coturn has
    // never heard of and every call would fail.
    const seen = [];
    mockPut.mockImplementationOnce(async (args) => {
      seen.push(...(await members()));
      mockStore.secret = args.secret;
    });
    await secrets.rotate();
    expect(seen).toContain("the-old-one");
    expect(seen).toHaveLength(2);
  });

  it("leaves the old secret working if the relay cannot be told", async () => {
    redis._state.fail = true;
    await expect(secrets.rotate()).rejects.toThrow();
    redis._state.fail = false;
    // Nothing was written to the vault, so the API still signs with the old
    // secret — the rotation simply has not happened.
    expect(await secrets.activeSecret()).toBe("the-old-one");
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("signs with the new secret immediately afterwards", async () => {
    await secrets.rotate();
    const now = await secrets.activeSecret();
    expect(now).not.toBe("the-old-one");
    expect(now).toHaveLength(64);
  });

  it("keeps the old one valid for one call's length, then stops", async () => {
    const t0 = Date.now();
    await secrets.rotate({ now: t0 });
    expect(await secrets.validSecrets(t0 + 60_000)).toContain("the-old-one");
    expect(await secrets.validSecrets(t0 + secrets.OVERLAP_MS + 1)).not.toContain("the-old-one");
  });

  it("refuses when there is no secret to rotate", async () => {
    mockStore.secret = null;
    config.TURN_CREDENTIAL_SECRET = "";
    await expect(secrets.rotate()).rejects.toMatchObject({ status: 409 });
  });
});

describe("pruning finishes the rotation", () => {
  it("does nothing while the window is open", async () => {
    const t0 = Date.now();
    mockStore.secret = JSON.stringify({ current: "the-old-one" });
    await secrets.rotate({ now: t0 });
    expect(await secrets.prune({ now: t0 + 60_000 })).toMatchObject({ pruned: false });
    expect(await members()).toHaveLength(2);
  });

  /**
   * Without this the old secret stays in coturn's set and keeps verifying
   * credentials, which is the one thing rotation exists to stop.
   */
  it("drops the old secret from the vault AND from coturn once it expires", async () => {
    const t0 = Date.now();
    mockStore.secret = JSON.stringify({ current: "the-old-one" });
    await secrets.rotate({ now: t0 });
    const after = t0 + secrets.OVERLAP_MS + 1;
    expect(await secrets.prune({ now: after })).toMatchObject({ pruned: true });
    const left = await members();
    expect(left).toHaveLength(1);
    expect(left).not.toContain("the-old-one");
    expect(await secrets.validSecrets(after)).toEqual(left);
  });

  it("is idempotent", async () => {
    mockStore.secret = JSON.stringify({ current: "only-one" });
    expect(await secrets.prune()).toMatchObject({ pruned: false, reason: "nothing retired" });
  });
});

describe("publishing is a difference, never a rebuild", () => {
  /**
   * DEL-then-SADD would leave a window, however short, in which coturn's set
   * is empty and every call is refused.
   */
  it("adds what is missing and removes what is stale, in place", async () => {
    await redis.sadd(KEY, "stale-one", "keep-me");
    const out = await secrets.publishToRelay(["keep-me", "brand-new"], REALM);
    expect(out).toMatchObject({ published: 1, removed: 1 });
    expect((await members()).sort()).toEqual(["brand-new", "keep-me"]);
  });

  it("says so rather than guessing when there is no realm", async () => {
    expect(await secrets.publishToRelay(["x"], "")).toMatchObject({ reason: "no realm" });
  });
});

describe("what the console is told", () => {
  it("never carries a secret, only its shape", async () => {
    mockStore.secret = JSON.stringify({ current: "abcdef123456" });
    const out = await secrets.status();
    expect(out).toMatchObject({ source: "vault", secret_set: true, rotating: false, last4: "3456" });
    expect(JSON.stringify(out)).not.toMatch(/abcdef12/);
  });

  it("reports an open rotation window", async () => {
    mockStore.secret = JSON.stringify({ current: "the-old-one" });
    await secrets.rotate();
    const out = await secrets.status();
    expect(out.rotating).toBe(true);
    expect(Date.parse(out.previous_valid_until)).toBeGreaterThan(Date.now());
  });
});
