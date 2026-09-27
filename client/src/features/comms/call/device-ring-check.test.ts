/**
 * The device check behind "can this device ring?" (calls audit A15).
 */
import { describe, it, expect } from "vitest";
import {
  checkDeviceRing, canRingWhenClosed, isIosDevice, needsInstall, type DeviceRingStatus,
} from "./device-ring-check";

const ANDROID = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";

function status(over: Partial<DeviceRingStatus> = {}): DeviceRingStatus {
  return {
    permission: "granted", subscribed: true, endpoint: "https://push.example/abc",
    installed: false, ios: false, soundBlocked: false, ...over,
  };
}

describe("checkDeviceRing", () => {
  it("reads every line, and a device with all of them can ring closed", async () => {
    const s = await checkDeviceRing({
      userAgent: ANDROID, standalone: false, permission: () => "granted",
      subscription: async () => ({ endpoint: "https://push.example/abc" }), soundBlocked: () => false,
    });
    expect(s).toEqual(status());
    expect(canRingWhenClosed(s)).toBe(true);
  });

  it("an iPhone in a browser tab needs the installed app, whatever else is true", async () => {
    const s = await checkDeviceRing({
      userAgent: IPHONE, standalone: false, permission: () => "unsupported",
      subscription: async () => null, soundBlocked: () => false,
    });
    expect(needsInstall(s)).toBe(true);
    expect(canRingWhenClosed(s)).toBe(false);
  });

  it("an iPad that reports itself as a Mac is still an iPad", () => {
    expect(isIosDevice(IPAD_AS_MAC, 5)).toBe(true);
    expect(isIosDevice(IPAD_AS_MAC, 0)).toBe(false);
  });

  it("a subscription that cannot be read is 'unknown', not 'none'", async () => {
    const s = await checkDeviceRing({
      userAgent: ANDROID, standalone: false, permission: () => "granted",
      subscription: async () => {
        throw new Error("no service worker");
      },
      soundBlocked: () => false,
    });
    expect(s.subscribed).toBeNull();
    expect(canRingWhenClosed(s)).toBe(false);
  });
});

