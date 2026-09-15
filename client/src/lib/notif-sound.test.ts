/**
 * The throttle and the tab badge — the two bits of this that are pure logic and
 * that break quietly.
 *
 * Sound synthesis itself is not asserted here: jsdom has no AudioContext, and a
 * test that mocks the oscillator graph would be testing the mock. What IS
 * testable is when we decide to play at all, and that is where the failures
 * live — a reconnect replaying events into a burst of overlapping tones, or an
 * unbounded seen-set leaking in a tab left open for a working week.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { tierFor, playOnce, isNotifSoundEnabled, setNotifSoundEnabled } from "./notif-sound";
import { applyTabBadge, resetTabBadgeBase } from "./tab-badge";

describe("tierFor", () => {
  it("is silent unless the server said it may interrupt", () => {
    // The decision is the user's preference resolved server-side; this module
    // must never second-guess it, or two people in one channel disagree.
    expect(tierFor({ interrupt: false, priority: "HIGH" })).toBe("silent");
    expect(tierFor({ interrupt: null, priority: "HIGH" })).toBe("silent");
  });

  it("separates urgent from ordinary interrupts", () => {
    expect(tierFor({ interrupt: true, priority: "HIGH" })).toBe("urgent");
    expect(tierFor({ interrupt: true, priority: "NORMAL" })).toBe("alert");
  });
});

describe("playOnce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("never throws where there is no AudioContext", () => {
    // jsdom has none. Real browsers in a locked-down enterprise profile can
    // also refuse one, and a throw here runs inside a socket handler — it would
    // take down every later notification, not just the sound.
    expect(() => playOnce("urgent", "n-1")).not.toThrow();
    expect(() => playOnce("silent", "n-2")).not.toThrow();
  });
});

describe("the sound switch", () => {
  it("defaults on, and survives a round trip", () => {
    // Default ON deliberately: a missed approval costs more than an unexpected
    // blip, so unreadable storage must not read as "muted".
    expect(isNotifSoundEnabled()).toBe(true);
    setNotifSoundEnabled(false);
    expect(isNotifSoundEnabled()).toBe(false);
    setNotifSoundEnabled(true);
    expect(isNotifSoundEnabled()).toBe(true);
  });
});

describe("applyTabBadge", () => {
  beforeEach(() => {
    resetTabBadgeBase();
    document.title = "Praxis LS";
  });

  it("shows the count and takes it away again", () => {
    applyTabBadge(3);
    expect(document.title).toBe("(3) Praxis LS");
    applyTabBadge(0);
    expect(document.title).toBe("Praxis LS");
  });

  it("does not compound on repeated calls", () => {
    // The bug this exists for: re-reading document.title as the base each time
    // turns "(3) Praxis LS" into "(5) (3) Praxis LS" and then keeps going.
    applyTabBadge(3);
    applyTabBadge(5);
    applyTabBadge(7);
    expect(document.title).toBe("(7) Praxis LS");
  });

  it("caps at 99+", () => {
    applyTabBadge(1200);
    expect(document.title).toBe("(99+) Praxis LS");
  });

  it("ignores nonsense counts rather than printing them", () => {
    applyTabBadge(Number.NaN);
    expect(document.title).toBe("Praxis LS");
    applyTabBadge(-4);
    expect(document.title).toBe("Praxis LS");
  });
});
