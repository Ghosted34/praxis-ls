"use strict";
/**
 * Push-subscription ROTATION, and the notice when a device goes quiet.
 *
 * ── THE FAILURE ─────────────────────────────────────────────────────────────
 *
 * Browsers replace push subscriptions on their own schedule. The old endpoint
 * dies immediately and nothing reports it: the server keeps sending to a dead
 * address, the phone keeps not receiving, neither side sees an error. Worse,
 * the repair used to run on app boot — and the reason the user was not opening
 * the app was that their notifications had stopped. The fix was gated behind
 * the thing it broke.
 *
 * The service worker cannot re-register the normal way: /push/subscribe is
 * authenticated and a worker has no session. So rotation is authorised by a
 * single-use token, stored server-side only as a SHA-256 (migration 12752).
 *
 * These tests hold the security properties of that unauthenticated path, which
 * are the whole reason it is safe to have one.
 */
const crypto = require("node:crypto");

jest.mock("../../src/modules/notification/notification.repo");
jest.mock("../../src/services/email.service", () => ({ send: jest.fn().mockResolvedValue({}) }));
jest.mock("../../src/shared/push/push.service", () => ({
  sendToUser: jest.fn(),
  getPublicKey: jest.fn(),
}));

const repo = require("../../src/modules/notification/notification.repo");
const email = require("../../src/services/email.service");
const svc = require("../../src/modules/notification/notification.service");

const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const client = { query: jest.fn(async () => ({ rows: [] })) };
const actor = { user_id: "u-1" };
const subscription = {
  endpoint: "https://fcm.example/new",
  keys: { p256dh: "k1", auth: "k2" },
};

beforeEach(() => {
  jest.clearAllMocks();
  repo.savePushSubscription.mockResolvedValue({ subscription_id: "s-1" });
  repo.setRotationToken.mockResolvedValue(1);
  repo.clearDeviceLapse.mockResolvedValue(undefined);
  repo.countPushSubscriptions.mockResolvedValue(1);
  repo.claimDeviceLapseNotice.mockResolvedValue(true);
  repo.activeEmailsFor.mockResolvedValue(
    new Map([["u-1", { user_id: "u-1", email: "u@x.com", full_name: "U" }]]),
  );
});

describe("subscribing issues a rotation token", () => {
  test("the token is returned in plaintext but stored ONLY as a hash", async () => {
    const out = await svc.subscribePush(client, actor, { subscription, userAgent: "UA" });

    expect(out.subscribed).toBe(true);
    expect(typeof out.rotation_token).toBe("string");
    expect(out.rotation_token.length).toBeGreaterThan(20);

    const [, endpoint, storedHash] = repo.setRotationToken.mock.calls[0];
    expect(endpoint).toBe(subscription.endpoint);
    // The plaintext must never reach the table: this column is the one thing
    // standing between a database read and somebody redirecting a user's
    // notifications to a device of their own.
    expect(storedHash).not.toBe(out.rotation_token);
    expect(storedHash).toBe(sha(out.rotation_token));
    expect(storedHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("two subscribes never mint the same token", async () => {
    const a = await svc.subscribePush(client, actor, { subscription });
    const b = await svc.subscribePush(client, actor, { subscription });
    expect(a.rotation_token).not.toBe(b.rotation_token);
  });

  test("registering a device clears any standing 'you went quiet' state", async () => {
    await svc.subscribePush(client, actor, { subscription });
    expect(repo.clearDeviceLapse).toHaveBeenCalledWith(client, "u-1");
  });

  test("a deployment whose migration has not run still subscribes", async () => {
    repo.setRotationToken.mockRejectedValue(new Error('column "rotation_token_hash" does not exist'));
    const out = await svc.subscribePush(client, actor, { subscription });
    expect(out.subscribed).toBe(true);
    expect(out.rotation_token).toBeNull();
  });
});

describe("rotating", () => {
  test("a valid token moves the subscription and issues a replacement", async () => {
    repo.rotatePushSubscription.mockResolvedValue({ user_id: "u-1", subscription_id: "s-1" });
    const out = await svc.rotatePush(client, { rotationToken: "TOKEN-ABCDEFGHIJKLMNOPQR", subscription });

    expect(out.rotated).toBe(true);
    expect(repo.rotatePushSubscription).toHaveBeenCalledWith(client, {
      tokenHash: sha("TOKEN-ABCDEFGHIJKLMNOPQR"),
      endpoint: subscription.endpoint,
      p256dh: "k1",
      auth: "k2",
    });
    // Single-use: without a replacement the NEXT rotation has nothing to
    // present, and the device is back to boot-time repair for ever.
    expect(typeof out.rotation_token).toBe("string");
    expect(out.rotation_token).not.toBe("TOKEN-ABCDEFGHIJKLMNOPQR");
  });

  test("the token is matched by HASH — a raw token never goes near the lookup", async () => {
    repo.rotatePushSubscription.mockResolvedValue({ user_id: "u-1" });
    await svc.rotatePush(client, { rotationToken: "PLAINTEXT-TOKEN-VALUE-1234", subscription });
    const { tokenHash } = repo.rotatePushSubscription.mock.calls[0][1];
    expect(tokenHash).not.toBe("PLAINTEXT-TOKEN-VALUE-1234");
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("an unknown or spent token is rejected", async () => {
    repo.rotatePushSubscription.mockResolvedValue(null);
    await expect(
      svc.rotatePush(client, { rotationToken: "WRONG-TOKEN-VALUE-ABCDEFGH", subscription }),
    ).rejects.toMatchObject({ code: "ROTATION_REJECTED", status: 404 });
  });

  test("rejection is INDISTINGUISHABLE across every failure mode — no oracle", async () => {
    // This endpoint is unauthenticated. If a spent token answered differently
    // from an unknown one, it would be a place to probe tokens.
    repo.rotatePushSubscription.mockResolvedValue(null);
    const errors = [];
    for (const t of ["UNKNOWN-TOKEN-AAAAAAAAAAAA", "SPENT-TOKEN-BBBBBBBBBBBBBB"]) {
      /* eslint-disable-next-line no-await-in-loop */
      await svc.rotatePush(client, { rotationToken: t, subscription }).catch((e) => errors.push(e));
    }
    expect(errors).toHaveLength(2);
    expect(errors[0].code).toBe(errors[1].code);
    expect(errors[0].status).toBe(errors[1].status);
    expect(errors[0].message).toBe(errors[1].message);
  });

  test("a malformed call is refused before it touches the database", async () => {
    await expect(
      svc.rotatePush(client, { rotationToken: "", subscription }),
    ).rejects.toMatchObject({ code: "INVALID_ROTATION", status: 422 });
    await expect(
      svc.rotatePush(client, { rotationToken: "T-AAAAAAAAAAAAAAAAAAAAAA", subscription: { endpoint: "x" } }),
    ).rejects.toMatchObject({ code: "INVALID_ROTATION", status: 422 });
    expect(repo.rotatePushSubscription).not.toHaveBeenCalled();
  });

  test("a successful rotation clears the lapse state for the owner it found", async () => {
    repo.rotatePushSubscription.mockResolvedValue({ user_id: "u-7" });
    await svc.rotatePush(client, { rotationToken: "TOKEN-ABCDEFGHIJKLMNOPQR", subscription });
    expect(repo.clearDeviceLapse).toHaveBeenCalledWith(client, "u-7");
  });
});

describe("the route is public, and rate limited", () => {
  const raw = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../../src/modules/notification/notification.routes.js"),
    "utf8",
  );
  /**
   * Comments stripped before anything is matched. The block above the rotate
   * route explains itself by quoting `router.use(authMiddleware)`, and an
   * earlier version of these tests found THAT rather than the statement — so
   * every position check was measuring prose. Reading code only is the fix.
   */
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

  test("rotate is registered BEFORE authMiddleware — order is what makes it reachable", () => {
    // A service worker has no session. Registered after the auth gate, this
    // route would 401 every time and the whole mechanism would be dead code.
    expect(src.indexOf('router.post("/push/rotate"')).toBeLessThan(src.indexOf("router.use(authMiddleware)"));
  });

  test("and it is the ONLY route before the auth gate", () => {
    const publicHalf = src.slice(0, src.indexOf("router.use(authMiddleware)"));
    const routes = publicHalf.match(/router\.(get|post|put|delete)\(/g) || [];
    expect(routes).toHaveLength(1);
  });

  test("an unauthenticated lookup-by-secret is rate limited", () => {
    expect(raw).toMatch(/makeLimiter\(\{\s*name:\s*"push-rotate"/);
    expect(src).toMatch(/router\.post\("\/push\/rotate",\s*rotateLimiter/);
  });

  test("push device routes use identityDb, not tenantDb", () => {
    // A subscription written while the user was in TEST landed in the sandbox
    // schema, while every producer that matters reads live — so the toggle said
    // "on" and nothing was ever sent. tenant-context.js names devices as
    // identity data for exactly this reason.
    const ctrl = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "../../src/modules/notification/notification.controller.js"),
      "utf8",
    );
    for (const fn of ["subscribePush", "unsubscribePush", "devices", "rotatePush"]) {
      // A slice, not the first line: `rotatePush` spans several lines and its
      // opening one names no database accessor at all.
      const at = ctrl.indexOf(`  ${fn}: asyncHandler`);
      expect(at).toBeGreaterThan(-1);
      const line = ctrl.slice(at, at + 400);
      expect(line).toMatch(/identityDb/);
      expect(line).not.toMatch(/req\.tenantDb/);
    }
  });
});

describe("telling a user their last device went quiet", () => {
  const push = require("../../src/shared/push/push.service");

  test("every device pruned → one email, breaking the boot-repair deadlock", async () => {
    push.sendToUser.mockResolvedValue({ sent: 0, failed: 0, total: 2, pruned: 2 });
    repo.countPushSubscriptions.mockResolvedValue(0);

    await svc.deliverOutbound(client, {
      recipients: [{ userId: "u-1", push: true, email: false }],
      notification: { title: "Mail", category: "comms", emailFallback: true },
    });

    expect(repo.claimDeviceLapseNotice).toHaveBeenCalledWith(client, "u-1");
    const subjects = email.send.mock.calls.map(([, m]) => m.subject);
    expect(subjects).toContain("Your device stopped receiving notifications");
  });

  test("another device still works → no notice", async () => {
    push.sendToUser.mockResolvedValue({ sent: 1, failed: 0, total: 2, pruned: 1 });
    await svc.deliverOutbound(client, {
      recipients: [{ userId: "u-1", push: true, email: false }],
      notification: { title: "Mail", category: "comms", emailFallback: true },
    });
    expect(repo.claimDeviceLapseNotice).not.toHaveBeenCalled();
  });

  test("the claim is what rate limits it — a lost claim sends nothing", async () => {
    // Two workers pruning two of the same user's devices in the same second
    // must not both email. The atomicity lives in the repo's ON CONFLICT.
    push.sendToUser.mockResolvedValue({ sent: 0, failed: 0, total: 1, pruned: 1 });
    repo.countPushSubscriptions.mockResolvedValue(0);
    repo.claimDeviceLapseNotice.mockResolvedValue(false);

    await svc.deliverOutbound(client, {
      recipients: [{ userId: "u-1", push: true, email: false }],
      notification: { title: "Mail", category: "comms", emailFallback: true },
    });
    const subjects = email.send.mock.calls.map(([, m]) => m.subject);
    expect(subjects).not.toContain("Your device stopped receiving notifications");
  });

  test("the notice never costs the fallback email that follows it", async () => {
    push.sendToUser.mockResolvedValue({ sent: 0, failed: 0, total: 1, pruned: 1 });
    repo.countPushSubscriptions.mockRejectedValue(new Error("table missing"));

    await svc.deliverOutbound(client, {
      recipients: [{ userId: "u-1", push: true, email: false }],
      notification: { title: "Mail from Ama", category: "comms", emailFallback: true },
    });
    const subjects = email.send.mock.calls.map(([, m]) => m.subject);
    expect(subjects).toContain("Mail from Ama");
  });
});
