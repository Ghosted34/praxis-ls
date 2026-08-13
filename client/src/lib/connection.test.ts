/**
 * Connection monitor.
 *
 * The four things that would each, on their own, make the offline experience
 * worse than the "Something went wrong." it replaces:
 *
 *   - it never notices the server came back, and the user sits on the offline
 *     screen with a working connection;
 *   - it decides the network is down because the SERVER returned a 500, and
 *     sends the user to reboot a router over our bug;
 *   - a screen firing nine parallel requests produces nine probe loops;
 *   - it trusts `navigator.onLine`, which is the bug this replaced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getConnection,
  onReconnect,
  probeNow,
  reportReachable,
  reportUnreachable,
  installConnectionMonitor,
  __resetConnectionForTests,
} from "./connection";

const fetchMock = vi.fn();

beforeEach(() => {
  __resetConnectionForTests();
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  });
});

afterEach(() => {
  __resetConnectionForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("connection state", () => {
  it("starts online and goes unreachable exactly once for a burst of failures", () => {
    expect(getConnection().status).toBe("online");

    // The finance hub fires nine concurrent requests; all nine fail together.
    const seen: string[] = [];
    const off = onReconnect(() => seen.push("reconnect"));
    for (let i = 0; i < 9; i++) reportUnreachable();

    expect(getConnection().status).toBe("unreachable");
    expect(getConnection().since).toBeTypeOf("number");
    // One transition, so one probe loop — not nine racing each other.
    expect(seen).toHaveLength(0);
    off();
  });

  it("recovers when the probe answers, and tells listeners once", async () => {
    const onBack = vi.fn();
    onReconnect(onBack);
    reportUnreachable();

    fetchMock.mockResolvedValue({ status: 200 } as Response);
    await probeNow();

    expect(getConnection().status).toBe("online");
    expect(getConnection().since).toBeNull();
    expect(getConnection().attempts).toBe(0);
    expect(onBack).toHaveBeenCalledTimes(1);

    // Already online: a second success is not a second recovery.
    await probeNow();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("stays unreachable and backs off when the probe fails", async () => {
    reportUnreachable();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await probeNow();
    expect(getConnection().status).toBe("unreachable");
    expect(getConnection().attempts).toBe(1);
    expect(getConnection().nextProbeAt).toBeTypeOf("number");

    await probeNow();
    expect(getConnection().attempts).toBe(2);
  });

  it("treats a 5xx from the health endpoint as REACHABLE", async () => {
    // The distinction the whole feature rests on: the server answering "I am
    // broken" proves the network is fine. Reporting that as offline would show
    // the connection screen for a server bug.
    reportUnreachable();
    fetchMock.mockResolvedValue({ status: 503 } as Response);

    await probeNow();
    expect(getConnection().status).toBe("online");
  });

  it("does not probe at all when the interface is down", async () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      configurable: true,
    });
    reportUnreachable();

    await probeNow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getConnection().status).toBe("unreachable");
  });

  it("reportReachable is a no-op while already online", () => {
    const onBack = vi.fn();
    onReconnect(onBack);
    reportReachable();
    expect(onBack).not.toHaveBeenCalled();
  });
});

describe("installConnectionMonitor", () => {
  it("goes down on the offline event and re-probes on the online event", async () => {
    installConnectionMonitor();

    window.dispatchEvent(new Event("offline"));
    expect(getConnection().status).toBe("unreachable");

    // `online` must NOT be trusted as proof by itself — hotel wifi raises it
    // several seconds before anything routes. It triggers a probe; the probe
    // decides.
    fetchMock.mockResolvedValue({ status: 200 } as Response);
    window.dispatchEvent(new Event("online"));
    expect(getConnection().status).toBe("unreachable");

    await vi.waitFor(() => expect(getConnection().status).toBe("online"));
  });

  it("survives a reconnect listener that throws, so the rest still run", async () => {
    onReconnect(() => {
      throw new Error("a refetch blew up");
    });
    const second = vi.fn();
    onReconnect(second);

    reportUnreachable();
    fetchMock.mockResolvedValue({ status: 200 } as Response);
    await probeNow();

    // The outbox is one of these listeners. A broken screen refetch must not
    // strand queued writes.
    expect(second).toHaveBeenCalledTimes(1);
    expect(getConnection().status).toBe("online");
  });
});
