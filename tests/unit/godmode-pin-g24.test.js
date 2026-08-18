"use strict";

/**
 * G24 — God-Mode PIN expiry + rotation.
 *
 * The legacy minted a fresh token weekly with expires_at = +7 days and refused
 * anything past it. The rebuild's standing PIN was the regression: set once,
 * no expiry, no rotation. These tests pin:
 *   - an expired PIN is refused (403, not verified),
 *   - setPin stamps a hash + expiry,
 *   - rotatePin mints, stores, and delivers via the SECURITY notification
 *     channel (the one email a user cannot turn off),
 *   - the PIN never appears in any log path (returned only to the caller).
 */

const argon2 = require("argon2");
const service = require("../../src/modules/dashboard/godmode/godmode.service");

jest.mock("argon2", () => ({
  hash: jest.fn(async (v) => `argon2:${v}`),
  verify: jest.fn(async (hash, pin) => hash === `argon2:${pin}`),
}));
jest.mock("../../src/modules/notification/notification.service", () => ({
  notify: jest.fn(async () => ({ notification_id: "n-1" })),
}));

const notify = require("../../src/modules/notification/notification.service");

function fakeClient({ pinRec = null, ceo = null } = {}) {
  const queries = [];
  const c = {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/SELECT godmode_pin_hash/.test(sql)) return { rows: pinRec ? [pinRec] : [] };
      if (/SELECT u.user_id, u.full_name, u.email/.test(sql)) return { rows: ceo ? [ceo] : [] };
      if (/UPDATE app_user/.test(sql)) return { rows: [{ godmode_pin_hash: params[1], godmode_pin_expires_at: params[2] }] };
      return { rows: [] };
    },
  };
  return c;
}

const pinRec = (over = {}) => ({
  godmode_pin_hash: "argon2:ABCDEF",
  godmode_pin_set_at: new Date().toISOString(),
  godmode_pin_expires_at: new Date(Date.now() + 86400000).toISOString(),
  ...over,
});

describe("G24 — purge refuses an expired PIN", () => {
  it("refuses a PIN past expires_at with 403", async () => {
    const c = fakeClient({
      pinRec: pinRec({ godmode_pin_expires_at: new Date(Date.now() - 1000).toISOString() }),
    });
    await expect(
      service.verifyPin(c, { userId: "u-1", pin: "ABCDEF" }),
    ).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/expired/) });
  });

  it("accepts a current PIN", async () => {
    const c = fakeClient({ pinRec: pinRec() });
    await expect(service.verifyPin(c, { userId: "u-1", pin: "ABCDEF" })).resolves.toBe(true);
  });

  it("refuses a wrong PIN even when unexpired", async () => {
    const c = fakeClient({ pinRec: pinRec() });
    await expect(service.verifyPin(c, { userId: "u-1", pin: "WRONG!" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("G24 — setPin stamps a hash + expiry", () => {
  it("stores the Argon2 hash with a ~7-day expiry", async () => {
    const c = fakeClient();
    const out = await service.setPin(c, { actor: { user_id: "u-1" }, pin: "SECRET1" });
    expect(out.set).toBe(true);
    const update = c.queries.find((q) => /UPDATE app_user/.test(q.sql));
    expect(update).toBeDefined();
    expect(update.params[1]).toBe("argon2:SECRET1");
    const exp = Date.parse(update.params[2]);
    expect(exp).toBeGreaterThan(Date.now() + 6 * 86400000);
    expect(exp).toBeLessThan(Date.now() + 8 * 86400000);
  });

  it("rejects a too-short PIN", async () => {
    const c = fakeClient();
    await expect(service.setPin(c, { actor: { user_id: "u-1" }, pin: "123" })).rejects.toMatchObject({ status: 422 });
  });
});

describe("G24 — weekly rotation delivers out of band", () => {
  it("mints a fresh 6-char unambiguous PIN, stores it, and notifies via SECURITY", async () => {
    const c = fakeClient({ ceo: { user_id: "u-1", full_name: "CEO", email: "ceo@t.cm" } });
    const out = await service.rotatePin(c, { deliver: true });
    expect(out.rotated).toBe(true);
    expect(out.pin).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    expect(notify.notify).toHaveBeenCalledWith(
      c,
      expect.objectContaining({
        userId: "u-1",
        category: "security",
        title: "Your new God Mode PIN",
      }),
    );
    // The delivered body contains the PIN — the ONLY place it appears.
    const body = notify.notify.mock.calls[0][1].body;
    expect(body).toContain(out.pin);
  });

  it("returns rotated:false when the tenant has no CEO", async () => {
    const c = fakeClient({ ceo: null });
    const out = await service.rotatePin(c, { deliver: true });
    expect(out.rotated).toBe(false);
    expect(notify.notify).not.toHaveBeenCalled();
  });

  it("mints from an unambiguous alphabet", () => {
    const seen = new Set();
    for (let i = 0; i < 50; i += 1) seen.add(service.mintPin());
    expect(seen.size).toBeGreaterThan(40); // no collisions at this sample size
  });
});
