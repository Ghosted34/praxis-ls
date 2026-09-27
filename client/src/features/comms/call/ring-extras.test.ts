/**
 * PR-4's small pieces: the tab title while a call rings (step 9), no screen
 * wake lock by default (E13), and the ring intent kept across a login
 * redirect (step 7).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { startRingingTitle, stopRingingTitle, RING_TITLE_FLASH_MS } from "./ring-title";
import { acquireCallKeepAlive, releaseWakeLock } from "./wake-keepalive";
import { captureCallIntent, takeCallIntent, INTENT_TTL_MS } from "./call-intent";

const CALL = "8f2f5a1e-3c22-4a53-9a2b-6e0f2c9d1a44";

describe("the tab title while a call rings", () => {
  afterEach(() => {
    stopRingingTitle();
    vi.useRealTimers();
  });

  it("flashes who is calling and puts the title back", () => {
    vi.useFakeTimers();
    document.title = "Praxis LS — Comms";
    startRingingTitle("📞 Aïcha is calling");
    expect(document.title).toBe("📞 Aïcha is calling");
    vi.advanceTimersByTime(RING_TITLE_FLASH_MS);
    expect(document.title).toBe("Praxis LS — Comms");
    vi.advanceTimersByTime(RING_TITLE_FLASH_MS);
    expect(document.title).toBe("📞 Aïcha is calling");
    stopRingingTitle();
    expect(document.title).toBe("Praxis LS — Comms");
  });
});

describe("a voice call holds no screen wake lock (E13)", () => {
  afterEach(() => {
    releaseWakeLock();
    vi.unstubAllGlobals();
  });

  it("the call keep-alive never asks for the screen", () => {
    const request = vi.fn(async () => ({ release: async () => {} }));
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request } });
    acquireCallKeepAlive();
    expect(request).not.toHaveBeenCalled();
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: undefined });
  });
});

describe("a ring intent across a login redirect", () => {
  afterEach(() => sessionStorage.clear());

  it("is kept at boot and taken once", () => {
    captureCallIntent(`?ring=${CALL}&act=accept`);
    expect(takeCallIntent()).toMatchObject({ callId: CALL, action: "accept" });
    expect(takeCallIntent()).toBeNull();
  });

  it("is dropped when it is older than a ring", () => {
    const at = Date.now();
    captureCallIntent(`?ring=${CALL}&act=decline`, at);
    expect(takeCallIntent(at + INTENT_TTL_MS + 1)).toBeNull();
  });

  it("only a ring link is kept (not a summary link, not junk)", () => {
    captureCallIntent(`?call=${CALL}`);
    expect(takeCallIntent()).toBeNull();
    captureCallIntent("?ring=not-a-uuid");
    expect(takeCallIntent()).toBeNull();
  });
});
