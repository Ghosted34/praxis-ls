/**
 * The ring's client channels (PR-3, §4.6).
 *
 * The decision this file pins is the one the metric depends on: WHICH channel
 * the device reports. It is not cosmetic — the ack is what stops the push
 * escalation, so a device that claims a channel it did not use makes the
 * server skip the one tier that might have reached the person.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { presentRing, parseCallLink, parseSummaryLink, ringTag, ringUrl } from "./ring-surface";

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

describe("the deep links: ?ring= rings, ?call= opens the summary (A6)", () => {
  const id = "8f2f5a1e-3c22-4a53-9a2b-6e0f2c9d1a44";

  it("a ring link, with or without an action", () => {
    expect(parseCallLink(`?ring=${id}`)).toEqual({ callId: id, action: null });
    expect(parseCallLink(`?ring=${id}&act=accept`)).toEqual({ callId: id, action: "accept" });
    expect(parseCallLink(`?act=decline&ring=${id}`)).toEqual({ callId: id, action: "decline" });
  });

  it("?call= is never a ring: it is the old summary-notification link", () => {
    expect(parseCallLink(`?call=${id}`)).toBeNull();
    expect(parseCallLink(`?call=${id}&act=accept`)).toBeNull();
    expect(parseSummaryLink(`?call=${id}`)).toBe(id);
    expect(parseSummaryLink(`?ring=${id}`)).toBeNull();
  });

  it("refuses anything that is not a call id — the app routes on this", () => {
    expect(parseCallLink("")).toBeNull();
    expect(parseCallLink("?ring=")).toBeNull();
    expect(parseCallLink("?ring=not-a-uuid")).toBeNull();
    expect(parseCallLink(`?ringx=${id}`)).toBeNull();
    expect(parseSummaryLink("?call=not-a-uuid")).toBeNull();
  });

  it("the URL a ring notification opens is the one the parser accepts", () => {
    const url = ringUrl(RING.callId, "accept");
    expect(url).toBe(`/comms?ring=${RING.callId}&act=accept`);
    expect(parseCallLink(url.slice(url.indexOf("?")))).toEqual({
      callId: RING.callId,
      action: "accept",
    });
  });
});
