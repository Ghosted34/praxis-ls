/**
 * The ring's client channels (PR-3, §4.6).
 *
 * The decision this file pins is the one the metric depends on: WHICH channel
 * the device reports. It is not cosmetic — the ack is what stops the push
 * escalation, so a device that claims a channel it did not use makes the
 * server skip the one tier that might have reached the person.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { presentRing, parseCallLink, ringTag, ringUrl } from "./ring-surface";

const RING = { callId: "8f2f5a1e-3c22-4a53-9a2b-6e0f2c9d1a44", peerName: "Ada" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("presentRing", () => {
  it("a visible tab rings in-app and says `socket`", async () => {
    expect(await presentRing(RING, { pageVisible: () => true })).toBe("socket");
  });

  it("a hidden tab with a service worker shows a real notification and says `notification`", async () => {
    const showNotification = vi.fn(async () => {});
    vi.stubGlobal("navigator", {
      serviceWorker: { ready: Promise.resolve({ showNotification }) },
    });
    const channel = await presentRing(RING, { pageVisible: () => false });
    expect(channel).toBe("notification");
    type RingOptions = NotificationOptions & { actions?: Array<{ action: string }> };
    const [title, options] = showNotification.mock.calls[0] as unknown as [string, RingOptions];
    expect(title).toContain("Ada");
    // The two actions the Android/desktop shade renders, and the tag that makes
    // a second escalation REPLACE the first rather than stack beside it.
    expect(options.tag).toBe(ringTag(RING.callId));
    expect(options.requireInteraction).toBe(true);
    expect((options.actions || []).map((a) => a.action)).toEqual(["accept", "decline"]);
  });

  it("a hidden tab that cannot show anything returns null — and therefore must not ack", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("Notification", { permission: "denied" });
    // null is the honest answer: nothing reached the user on this device, so
    // the caller sends no ack and the server's push tier still fires.
    expect(await presentRing(RING, { pageVisible: () => false })).toBeNull();
  });

  it("falls back to the page Notification when there is no service worker", async () => {
    const ctor = vi.fn();
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("Notification", Object.assign(ctor, { permission: "granted" }));
    expect(await presentRing(RING, { pageVisible: () => false })).toBe("notification");
    expect(ctor).toHaveBeenCalledTimes(1);
  });
});

describe("the deep link", () => {
  it("accepts a call link, with or without an action", () => {
    const id = "8f2f5a1e-3c22-4a53-9a2b-6e0f2c9d1a44";
    expect(parseCallLink(`?call=${id}`)).toEqual({ callId: id, action: null });
    expect(parseCallLink(`?call=${id}&act=accept`)).toEqual({ callId: id, action: "accept" });
    expect(parseCallLink(`?act=decline&call=${id}`)).toEqual({ callId: id, action: "decline" });
  });

  it("refuses anything that is not a call id — the app routes on this", () => {
    expect(parseCallLink("")).toBeNull();
    expect(parseCallLink("?call=")).toBeNull();
    expect(parseCallLink("?call=not-a-uuid")).toBeNull();
    expect(parseCallLink("?callx=8f2f5a1e-3c22-4a53-9a2b-6e0f2c9d1a44")).toBeNull();
  });

  it("the URL the push opens is the one the parser accepts", () => {
    const url = ringUrl(RING.callId, "accept");
    expect(parseCallLink(url.slice(url.indexOf("?")))).toEqual({
      callId: RING.callId,
      action: "accept",
    });
  });
});
