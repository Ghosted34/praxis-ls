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
//
// One PIN per person, valid on ANY device (14230). What made four digits safe
// on one device was that an attacker needed the device; now they need only the
// email, so the limits count every miss from everywhere against the ACCOUNT.

const mockCalls = { upserts: [], deleted: [], notifications: [], audits: [], sessions: [] };
let mockPinRow = null;
let mockCounts = { failed_attempts: 0, window_failures: 0 };
let mockUser = null;

jest.mock("../../src/modules/security/app_user/app_user.repo", () => ({
  getUserSafe: async () => ({ user_id: "u-1", email: "ama@acme.cm", status: "ACTIVE" }),
  findByEmail: async () => mockUser,
  getQuickPin: async () => mockPinRow,
  upsertQuickPin: async (client, d) => {
    mockCalls.upserts.push(d);
    return { created_at: "2026-09-29T10:00:00Z", updated_at: "2026-09-29T10:00:00Z", last_used_at: null, inserted: !mockPinRow };
  },
  recordQuickPinFailure: async () => {
    mockCounts = { failed_attempts: mockCounts.failed_attempts + 1, window_failures: mockCounts.window_failures + 1 };
    return mockCounts;
  },
  recordQuickPinSuccess: async () => {
    mockCounts = { ...mockCounts, failed_attempts: 0 };
  },
  deleteQuickPin: async (client, userId) => {
    mockCalls.deleted.push(userId);
    return { user_id: userId };
  },
  hasQuickPin: async () => !!mockPinRow,
  // issueSessionTokens' own writes — enough to reach its return.
  recordLoginSuccess: async () => undefined,
  createSession: async () => "s-new",
  setRefreshJti: async () => undefined,
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

function reset() {
  for (const k of Object.keys(mockCalls)) mockCalls[k].length = 0;
  mockPinRow = null;
  mockCounts = { failed_attempts: 0, window_failures: 0 };
  mockUser = { user_id: "u-1", email: "ama@acme.cm", full_name: "Ama", status: "ACTIVE", is_2fa_enabled: false };
  sessionPolicy.assertFreshAuth.mockClear();
}

describe("setQuickPin", () => {
  beforeEach(reset);

  it("refuses a weak PIN with the shared rule's words", async () => {
    await expect(svc.setQuickPin({}, { userId: "u-1", pin: "1234" })).rejects.toMatchObject({
      code: "WEAK_PIN",
      status: 422,
    });
    expect(mockCalls.upserts).toHaveLength(0);
  });

  it("needs a fresh sign-in (or the password) before it hands out a way in", async () => {
    await svc.setQuickPin({}, { userId: "u-1", pin: "4817", sessionId: "s-1", currentPassword: null });
    expect(sessionPolicy.assertFreshAuth).toHaveBeenCalledWith({}, { sessionId: "s-1", userId: "u-1", currentPassword: null });
  });

  it("stores ONE hash for the person — no device in sight", async () => {
    await svc.setQuickPin({}, { userId: "u-1", pin: "4817" });
    expect(mockCalls.upserts).toEqual([{ userId: "u-1", pinHash: "hash:4817" }]);
  });

  it("raises a security alert and a sensitive audit row, naming a change as a change", async () => {
    mockPinRow = { user_id: "u-1", pin_hash: "hash:3091" };
    await svc.setQuickPin({}, { userId: "u-1", pin: "4817" });
    expect(mockCalls.notifications[0]).toMatchObject({ userId: "u-1", category: "security", priority: "HIGH", title: "Your Quick PIN was changed" });
    expect(mockCalls.audits[0]).toMatchObject({ action: "app_user.quick_pin.changed", isSensitive: true });
  });
});

describe("pinLogin — from any device", () => {
  beforeEach(() => {
    reset();
    mockPinRow = { user_id: "u-1", pin_hash: "hash:4817" };
  });

  it("signs in with the email and the PIN alone — no device id needed", async () => {
    const r = await svc.pinLogin({}, { email: "ama@acme.cm", pin: "4817" });
    expect(r).toMatchObject({ access_token: expect.any(String), user: { user_id: "u-1", has_quick_pin: true } });
  });

  it("still accepts (and ignores) a device id from a client older than 14230", async () => {
    const r = await svc.pinLogin({}, { email: "ama@acme.cm", deviceId: "d-anything", pin: "4817" });
    expect(r.access_token).toEqual(expect.any(String));
  });

  it("asks for the authenticator code after the PIN — the PIN replaces the password, not the second factor", async () => {
    mockUser.is_2fa_enabled = true;
    const r = await svc.pinLogin({}, { email: "ama@acme.cm", pin: "4817" });
    expect(r).toMatchObject({ pending_2fa: true, pending_token: expect.any(String) });
    expect(r.access_token).toBeUndefined();
  });

  it("points an account with no PIN at the password", async () => {
    mockPinRow = null;
    await expect(svc.pinLogin({}, { email: "ama@acme.cm", pin: "4817" })).rejects.toMatchObject({ code: "PIN_LOGIN_UNAVAILABLE" });
  });

  it("tells the user how many attempts are left", async () => {
    await expect(svc.pinLogin({}, { email: "ama@acme.cm", pin: "0001" })).rejects.toMatchObject({
      code: "INVALID_PIN",
      details: { attempts_left: 4 },
    });
  });

  it("switches the PIN off everywhere on the fifth miss in a row, and says so", async () => {
    mockCounts = { failed_attempts: 4, window_failures: 4 };
    await expect(svc.pinLogin({}, { email: "ama@acme.cm", pin: "0001" })).rejects.toMatchObject({ code: "PIN_LOCKED" });
    expect(mockCalls.deleted).toEqual(["u-1"]);
    expect(mockCalls.notifications).toHaveLength(1);
    expect(mockCalls.audits[0]).toMatchObject({ action: "app_user.quick_pin.locked_out", isSensitive: true });
  });

  it("switches it off on the tenth miss in 30 days even when the owner's own PIN keeps ending the run", async () => {
    // Four misses, the owner signs in, four more, the owner again… the run never
    // reaches five, but the window does reach ten.
    mockCounts = { failed_attempts: 1, window_failures: 9 };
    await expect(svc.pinLogin({}, { email: "ama@acme.cm", pin: "0001" })).rejects.toMatchObject({ code: "PIN_LOCKED" });
    expect(mockCalls.deleted).toEqual(["u-1"]);
    expect(mockCalls.notifications[0].body).toMatch(/10 times in 30 days/);
  });

  it("counts the attempts left against whichever limit is nearer", async () => {
    mockCounts = { failed_attempts: 0, window_failures: 7 };
    await expect(svc.pinLogin({}, { email: "ama@acme.cm", pin: "0001" })).rejects.toMatchObject({
      details: { attempts_left: 2 },
    });
  });

  it("a right PIN ends the run of misses", async () => {
    mockCounts = { failed_attempts: 3, window_failures: 3 };
    await svc.pinLogin({}, { email: "ama@acme.cm", pin: "4817" });
    expect(mockCounts).toEqual({ failed_attempts: 0, window_failures: 3 });
  });
});

describe("removeQuickPin", () => {
  beforeEach(reset);

  it("turns the PIN off for every device and tells the account holder", async () => {
    await svc.removeQuickPin({}, { userId: "u-1" });
    expect(mockCalls.deleted).toEqual(["u-1"]);
    expect(mockCalls.notifications[0]).toMatchObject({ title: "Your Quick PIN was turned off" });
  });
});
