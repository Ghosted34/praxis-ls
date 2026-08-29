/**
 * The unread count on the installed app's icon.
 *
 * Every other notification channel is a moment — a banner shows and is gone, a
 * sound plays once, a push expires if the phone was off past its TTL. The badge
 * is the only one that is a STATE: it sits on the home screen until the thing
 * is read. It is what catches the notification swiped away half-asleep.
 *
 * So what matters here is that it is set at all on platforms that have it, that
 * it is CLEARED (a stale "4" on an empty inbox trains people to ignore it), and
 * that it can never throw — a badge is a convenience and the notification is
 * the message.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setAppBadge, resetAppBadgeMemo } from "./app-badge";

function setup({ supported = true, rejects = false, worker = true } = {}) {
  const setBadge = vi.fn(() => (rejects ? Promise.reject(new Error("nope")) : Promise.resolve()));
  const clearBadge = vi.fn(() => (rejects ? Promise.reject(new Error("nope")) : Promise.resolve()));
  const postMessage = vi.fn();

  vi.stubGlobal("navigator", {
    ...(supported ? { setAppBadge: setBadge, clearAppBadge: clearBadge } : {}),
    ...(worker
      ? { serviceWorker: { ready: Promise.resolve({ active: { postMessage } }) } }
      : {}),
  });
  return { setBadge, clearBadge, postMessage };
}

beforeEach(() => resetAppBadgeMemo());
afterEach(() => vi.unstubAllGlobals());

describe("setAppBadge", () => {
  it("sets the count", () => {
    const { setBadge } = setup();
    setAppBadge(4);
    expect(setBadge).toHaveBeenCalledWith(4);
  });

  it("zero CLEARS the badge rather than setting a 0", () => {
    // A stale number on an empty inbox is worse than no number: it teaches the
    // user that the badge means nothing.
    const { setBadge, clearBadge } = setup();
    setAppBadge(0);
    expect(clearBadge).toHaveBeenCalled();
    expect(setBadge).not.toHaveBeenCalled();
  });

  it("does not re-issue the same count — this runs on every render", () => {
    const { setBadge } = setup();
    setAppBadge(3);
    setAppBadge(3);
    setAppBadge(3);
    expect(setBadge).toHaveBeenCalledTimes(1);
    setAppBadge(5);
    expect(setBadge).toHaveBeenCalledTimes(2);
  });

  it("also tells the service worker, which owns the badge once the app is closed", async () => {
    const { postMessage } = setup();
    setAppBadge(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(postMessage).toHaveBeenCalledWith({ type: "SET_APP_BADGE", count: 2 });
  });

  it("a platform that rejects the call does not throw at the caller", () => {
    setup({ rejects: true });
    expect(() => setAppBadge(1)).not.toThrow();
  });

  it("an unsupported platform (iOS Safari outside an installed app) is a no-op, not an error", async () => {
    const { postMessage } = setup({ supported: false });
    expect(() => setAppBadge(9)).not.toThrow();
    // The worker is STILL told, even with no page-side API: on some platforms
    // only the worker's call sticks, so skipping it there would mean no badge
    // at all on exactly the devices that most need one.
    await Promise.resolve();
    await Promise.resolve();
    expect(postMessage).toHaveBeenCalledWith({ type: "SET_APP_BADGE", count: 9 });
  });

  it("negative or non-finite counts are treated as empty", () => {
    const { clearBadge, setBadge } = setup();
    setAppBadge(Number.NaN);
    expect(clearBadge).toHaveBeenCalled();
    expect(setBadge).not.toHaveBeenCalled();
  });
});
