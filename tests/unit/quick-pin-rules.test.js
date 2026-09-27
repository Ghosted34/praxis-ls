"use strict";

/**
 * Quick PIN — the shared weak-PIN rule, and what registration and PIN sign-in
 * do with it. Five guesses against a random 4-digit PIN is a 0.05% chance;
 * against `1234` it is a coin toss. The rule is what keeps the first number
 * true.
 */

const { quickPin } = require("@praxis/shared");

describe("quickPin.weakPinReason", () => {
  it.each(["0000", "1111", "9999", "1234", "6789", "9876", "3210", "1212", "1010", "6969", "1122", "7788", "2000", "1004"])(
    "refuses %s",
    (pin) => {
      expect(quickPin.weakPinReason(pin)).toEqual(expect.any(String));
    },
  );

  it.each(["4817", "3091", "7264", "5830", "1739"])("accepts %s", (pin) => {
    expect(quickPin.weakPinReason(pin)).toBeNull();
  });

  it("reports the shape too, so one check covers both", () => {
    expect(quickPin.weakPinReason("123")).toMatch(/exactly 4 digits/);
    expect(quickPin.weakPinReason("12a4")).toMatch(/exactly 4 digits/);
    expect(quickPin.weakPinReason(null)).toMatch(/exactly 4 digits/);
    expect(quickPin.PIN_LENGTH).toBe(4);
  });
});

// ── The service ──────────────────────────────────────────────────────────────

const mockCalls = { revokeDevice: [], insertDevice: [], notifications: [], audits: [] };
let mockActiveDevices = 0;
let mockFailedPin = 0;

jest.mock("../../src/modules/security/app_user/app_user.repo", () => ({
  getUserSafe: async () => ({ user_id: "u-1", email: "ama@acme.cm", status: "ACTIVE" }),
  findByEmail: async () => ({ user_id: "u-1", email: "ama@acme.cm", full_name: "Ama", status: "ACTIVE" }),
  revokeDevice: async (client, deviceId, userId) => {
    mockCalls.revokeDevice.push({ deviceId, userId });
    return { device_id: deviceId };
  },
  countActiveDevices: async () => mockActiveDevices,
  insertDevice: async (client, d) => {
    mockCalls.insertDevice.push(d);
    return { device_id: "d-new", label: d.label, status: "ACTIVE", created_at: "2026-09-25T10:00:00Z" };
  },
  getActiveDeviceForUser: async () => ({ device_id: "d-1", pin_hash: "hash:4817" }),
  recordDevicePinFailure: async () => ({ failed_pin: ++mockFailedPin }),
  resetDevicePin: async () => undefined,
}));
jest.mock("../../src/modules/security/app_user/session-policy", () => ({
  ...jest.requireActual("../../src/modules/security/app_user/session-policy"),
  assertFreshAuth: jest.fn(async () => ({ via: "recent_sign_in" })),
}));
jest.mock("../../src/modules/notification/notification.repo", () => ({
  insertForUser: async (client, n) => {
    mockCalls.notifications.push(n);
    return {};
  },
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: async () => undefined,
  audit: async (client, a) => {
    mockCalls.audits.push(a);
  },
  resolveActorId: async () => null,
  clearEventTypeCache: () => {},
  WATCHER_ROLE_CODES: [],
}));
jest.mock("argon2", () => ({
  argon2id: 2,
  hash: async (pw) => `hash:${pw}`,
  verify: async (hash, pw) => hash === `hash:${pw}`,
}));

const svc = require("../../src/modules/security/app_user/app_user.service");
const sessionPolicy = require("../../src/modules/security/app_user/session-policy");

describe("registerPinDevice", () => {
  beforeEach(() => {
    for (const k of Object.keys(mockCalls)) mockCalls[k].length = 0;
    mockActiveDevices = 0;
    sessionPolicy.assertFreshAuth.mockClear();
  });

  it("refuses a weak PIN with the shared rule's words", async () => {
    await expect(svc.registerPinDevice({}, { userId: "u-1", pin: "1234" })).rejects.toMatchObject({
      code: "WEAK_PIN",
      status: 422,
    });
    expect(mockCalls.insertDevice).toHaveLength(0);
  });

  it("needs a fresh sign-in (or the password) before it hands out a way in", async () => {
    await svc.registerPinDevice({}, { userId: "u-1", pin: "4817", sessionId: "s-1", currentPassword: null });
    expect(sessionPolicy.assertFreshAuth).toHaveBeenCalledWith({}, { sessionId: "s-1", userId: "u-1", currentPassword: null });
  });

  it("replaces this device's previous PIN instead of leaving it ACTIVE", async () => {
    await svc.registerPinDevice({}, { userId: "u-1", pin: "4817", replaceDeviceId: "d-old" });
    expect(mockCalls.revokeDevice).toEqual([{ deviceId: "d-old", userId: "u-1" }]);
    expect(mockCalls.insertDevice).toHaveLength(1);
  });

  it("caps the number of devices a person can hold a PIN on", async () => {
    mockActiveDevices = 10;
    await expect(svc.registerPinDevice({}, { userId: "u-1", pin: "4817" })).rejects.toMatchObject({ code: "PIN_DEVICE_LIMIT" });
  });

  it("raises a security alert and a sensitive audit row", async () => {
    await svc.registerPinDevice({}, { userId: "u-1", pin: "4817", label: "  Front desk  " });
    expect(mockCalls.insertDevice[0].label).toBe("Front desk");
    expect(mockCalls.notifications[0]).toMatchObject({ userId: "u-1", category: "security", priority: "HIGH" });
    expect(mockCalls.audits[0]).toMatchObject({ action: "app_user.pin_device.registered", isSensitive: true });
  });
});

describe("pinLogin", () => {
  beforeEach(() => {
    for (const k of Object.keys(mockCalls)) mockCalls[k].length = 0;
    mockFailedPin = 0;
  });

  it("tells the user how many attempts are left", async () => {
    await expect(
      svc.pinLogin({}, { email: "ama@acme.cm", deviceId: "d-1", pin: "0001" }),
    ).rejects.toMatchObject({ code: "INVALID_PIN", details: { attempts_left: 4 } });
  });

  it("switches the device's PIN off on the fifth miss, and says so to the account holder", async () => {
    mockFailedPin = 4;
    await expect(
      svc.pinLogin({}, { email: "ama@acme.cm", deviceId: "d-1", pin: "0001" }),
    ).rejects.toMatchObject({ code: "PIN_LOCKED" });
    expect(mockCalls.revokeDevice).toEqual([{ deviceId: "d-1", userId: "u-1" }]);
    expect(mockCalls.notifications).toHaveLength(1);
  });
});
