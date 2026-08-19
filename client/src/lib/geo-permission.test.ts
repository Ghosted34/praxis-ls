import { describe, it, expect, afterEach, vi } from "vitest";
import { geoRecoverySteps, queryGeoPermission, watchGeoFix, watchGeoPermission } from "./geo-permission";

describe("geoRecoverySteps", () => {
  it("names Safari settings on iOS", () => {
    const steps = geoRecoverySteps(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    );
    expect(steps[0]).toMatch(/Settings/i);
    expect(steps.join(" ")).toMatch(/Safari/i);
  });

  it("names site permissions on Android", () => {
    const steps = geoRecoverySteps(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0",
    );
    expect(steps.join(" ")).toMatch(/Permissions|Site settings/i);
  });

  it("falls back to the address-bar lock on desktop", () => {
    const steps = geoRecoverySteps(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0",
    );
    expect(steps.join(" ")).toMatch(/address bar/i);
  });
});

describe("queryGeoPermission", () => {
  const originalGeo = navigator.geolocation;
  const originalPerms = navigator.permissions;

  afterEach(() => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: originalGeo });
    Object.defineProperty(navigator, "permissions", { configurable: true, value: originalPerms });
  });

  it("returns unsupported when geolocation is missing", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
    expect(await queryGeoPermission()).toBe("unsupported");
  });

  it("returns granted when the Permissions API says so", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: {} });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: async () => ({ state: "granted" }) },
    });
    expect(await queryGeoPermission()).toBe("granted");
  });

  it("returns denied when the Permissions API says so", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: {} });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: async () => ({ state: "denied" }) },
    });
    expect(await queryGeoPermission()).toBe("denied");
  });

  it("watchGeoPermission emits on change and unsubscribes", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: {} });
    const listeners: Array<() => void> = [];
    const status = {
      state: "denied" as PermissionState,
      addEventListener: (_e: string, fn: () => void) => listeners.push(fn),
      removeEventListener: () => { listeners.length = 0; },
    };
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: async () => status },
    });
    const seen: string[] = [];
    const stop = watchGeoPermission((s) => seen.push(s));
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toContain("denied");
    status.state = "granted";
    listeners.forEach((fn) => fn());
    expect(seen).toContain("granted");
    stop();
    expect(listeners).toHaveLength(0);
  });

  it("watchGeoFix calls onDenied on PERMISSION_DENIED and clears the watch", () => {
    const clearWatch = vi.fn();
    const watchPosition = vi.fn((_ok: unknown, err: (e: { code: number; message: string }) => void) => {
      err({ code: 1, message: "denied" });
      return 42;
    });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { watchPosition, clearWatch },
    });
    const onDenied = vi.fn();
    const stop = watchGeoFix(onDenied);
    expect(onDenied).toHaveBeenCalled();
    stop();
    expect(clearWatch).toHaveBeenCalledWith(42);
  });

  it("watchGeoPermission emits prompt when the query is rejected (Safari)", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: {} });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: async () => { throw new Error("not supported"); } },
    });
    const seen: string[] = [];
    const stop = watchGeoPermission((s) => seen.push(s));
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual(["prompt"]);
    stop();
  });

  it("watchGeoPermission stays quiet if it was stopped before the query rejected", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: {} });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: async () => { throw new Error("not supported"); } },
    });
    const seen: string[] = [];
    watchGeoPermission((s) => seen.push(s))();
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([]);
  });

  it("treats a rejected query as prompt (Safari)", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: {} });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: async () => { throw new Error("not supported"); } },
    });
    expect(await queryGeoPermission()).toBe("prompt");
  });
});
