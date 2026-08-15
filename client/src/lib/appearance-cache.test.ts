/**
 * Appearance cache.
 *
 * The one job is to make the OFFLINE paint the tenant's, not the vendor's — so
 * the tests hold it to exactly that, and to the promise it can never break the
 * online path:
 *
 *   - what the server gave us survives a round trip through storage;
 *   - an empty cache reads as null (the caller then paints the default), never
 *     throws;
 *   - a corrupt entry reads as null rather than taking the boot down with it;
 *   - a storage that refuses to write is swallowed, because a private-mode
 *     browser must still boot.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  readCachedBranding,
  writeCachedBranding,
  readCachedPwaConfig,
  writeCachedPwaConfig,
} from "./appearance-cache";
import type { Branding } from "./branding";
// TYPE-ONLY, deliberately. Pulling `pwa-config`'s runtime exports would drag in
// `@shared` (and its `zod` dependency) for a test that only round-trips JSON —
// the same reason the cache module itself imports `PwaConfig` as a type.
import type { PwaConfig } from "./pwa-config";

const BRAND: Branding = {
  name: "Smart Logistics & Services Ltd",
  primary: "#f97316",
  primaryForeground: "#ffffff",
  logoUrl: "/media/tenant/logo.png",
};

describe("appearance-cache", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("round-trips branding through storage", () => {
    expect(readCachedBranding()).toBeNull();
    writeCachedBranding(BRAND);
    expect(readCachedBranding()).toEqual(BRAND);
  });

  it("round-trips the pwa config through storage", () => {
    expect(readCachedPwaConfig()).toBeNull();
    // A representative slice — the cache stores whatever the server returned as
    // JSON, so the exact field set does not matter to what is under test here.
    const cfg = {
      offlineText: "Ops is offline",
      splashEnabled: true,
    } as PwaConfig;
    writeCachedPwaConfig(cfg);
    expect(readCachedPwaConfig()).toEqual(cfg);
  });

  it("reads null — never throws — on a corrupt entry", () => {
    localStorage.setItem("praxis.branding.cache", "{not json");
    expect(readCachedBranding()).toBeNull();
  });

  it("swallows a storage that refuses to write, so boot still proceeds", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });
    expect(() => writeCachedBranding(BRAND)).not.toThrow();
    spy.mockRestore();
  });
});
