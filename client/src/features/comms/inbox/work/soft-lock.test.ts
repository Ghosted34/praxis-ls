/**
 * The two composer checks that were built end to end and called by nobody.
 *
 * ── WHY THESE TESTS ARE SHAPED THIS WAY ─────────────────────────────────────
 *
 * §8 of the QC audit: a test that imports a module and calls it has tested that
 * module; it has NOT tested that the product uses it. Both of these features
 * failed at exactly that seam — every layer existed, was correct, and was
 * unreached — so a test that only exercised the hooks would reproduce the
 * original mistake one level up.
 *
 * So there are two halves, and both are load-bearing:
 *
 *   · here, the hooks' own behaviour — take, heartbeat, release, and what a
 *     failure renders as;
 *   · in `tests/security/mail-client-api-wiring.test.js`, the call site: that
 *     the composer imports and calls them, and that no other mail endpoint
 *     quietly loses its last caller.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const takeThreadLock = vi.fn();
const releaseThreadLock = vi.fn();
const checkAddresses = vi.fn();

vi.mock("@/lib/mail-api-work", () => ({
  takeThreadLock: (...a: unknown[]) => takeThreadLock(...a),
  releaseThreadLock: (...a: unknown[]) => releaseThreadLock(...a),
  checkAddresses: (...a: unknown[]) => checkAddresses(...a),
}));

import { useThreadLock, LOCK_HEARTBEAT_MS } from "./use-thread-lock";
import { useRecipientHealth, RECIPIENT_CHECK_DEBOUNCE_MS } from "./use-recipient-health";

const lock = (over: Record<string, unknown> = {}) => ({
  email_thread_id: "t-1",
  held_by_me: true,
  held_by_other: false,
  expires_at: new Date(Date.now() + 120_000).toISOString(),
  seconds_remaining: 120,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  takeThreadLock.mockResolvedValue(lock());
  releaseThreadLock.mockResolvedValue({ released: true });
  checkAddresses.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

/* ── §9.2 · the soft lock ─────────────────────────────────────────────────── */

describe("opening the composer on a thread takes the lock", () => {
  it("TAKES IT ON MOUNT — the defect this file exists for", async () => {
    // `email_thread_lock`, both routes, the service, the join on the thread
    // read and the "Marie is writing a reply" bar all shipped. Nothing called
    // take, so the table could only ever hold zero rows.
    renderHook(() => useThreadLock({ threadId: "t-1" }));
    await waitFor(() => expect(takeThreadLock).toHaveBeenCalledWith("t-1"));
  });

  it("renews four times inside the server's two-minute lease", async () => {
    vi.useFakeTimers();
    renderHook(() => useThreadLock({ threadId: "t-1" }));
    expect(takeThreadLock).toHaveBeenCalledTimes(1);
    // 120s of lease, 30s of heartbeat: three renewals before it could lapse.
    await act(async () => {
      vi.advanceTimersByTime(LOCK_HEARTBEAT_MS * 3);
    });
    expect(takeThreadLock).toHaveBeenCalledTimes(4);
    expect(LOCK_HEARTBEAT_MS * 4).toBeLessThanOrEqual(120_000);
  });

  it("releases when the composer closes rather than waiting out the lease", async () => {
    const { unmount } = renderHook(() => useThreadLock({ threadId: "t-1" }));
    await waitFor(() => expect(takeThreadLock).toHaveBeenCalled());
    unmount();
    expect(releaseThreadLock).toHaveBeenCalledWith("t-1");
  });

  it("takes nothing for a brand-new message, which has no thread", () => {
    renderHook(() => useThreadLock({ threadId: null }));
    expect(takeThreadLock).not.toHaveBeenCalled();
  });

  it("REPORTS A COLLEAGUE'S LOCK, AND NEVER ITS OWN", async () => {
    takeThreadLock.mockResolvedValue(
      lock({ held_by_me: false, held_by_other: true, locked_by_name: "Marie" }),
    );
    const { result } = renderHook(() => useThreadLock({ threadId: "t-1" }));
    await waitFor(() => expect(result.current.heldByOther?.locked_by_name).toBe("Marie"));

    takeThreadLock.mockResolvedValue(lock());
    const mine = renderHook(() => useThreadLock({ threadId: "t-2" }));
    await waitFor(() => expect(mine.result.current.lock).not.toBeNull());
    expect(mine.result.current.heldByOther).toBeNull();
  });

  it("a 403 on a tenant without mail.shared_inbox is silence, not an error", async () => {
    // The flag is per tenant. An advisory lock that raises on a tenant that did
    // not buy the feature is worse than no lock at all.
    takeThreadLock.mockRejectedValue(new Error("forbidden"));
    const { result } = renderHook(() => useThreadLock({ threadId: "t-1" }));
    await waitFor(() => expect(takeThreadLock).toHaveBeenCalled());
    expect(result.current.heldByOther).toBeNull();
    expect(result.current.lock).toBeNull();
  });
});

/* ── §9.8 · the recipients ────────────────────────────────────────────────── */

describe("the composer checks the recipients before a send", () => {
  it("ASKS — the clause of §9.8 that was never built", async () => {
    vi.useFakeTimers();
    renderHook(() => useRecipientHealth({ addresses: ["client@maersk.cm"] }));
    expect(checkAddresses).not.toHaveBeenCalled(); // debounced
    await act(async () => {
      vi.advanceTimersByTime(RECIPIENT_CHECK_DEBOUNCE_MS);
    });
    expect(checkAddresses).toHaveBeenCalledWith(["client@maersk.cm"]);
  });

  it("separates a mailbox that does not exist from one that is failing", async () => {
    checkAddresses.mockResolvedValue([
      { email: "gone@maersk.cm", email_status: "HARD_FAILED" },
      { email: "slow@maersk.cm", email_status: "SOFT_FAILING" },
    ]);
    const { result } = renderHook(() =>
      useRecipientHealth({ addresses: ["gone@maersk.cm", "slow@maersk.cm"] }),
    );
    await waitFor(() => expect(result.current.hard).toHaveLength(1));
    expect(result.current.hard[0].email).toBe("gone@maersk.cm");
    expect(result.current.soft[0].email).toBe("slow@maersk.cm");
  });

  it("A CHECK THAT COULD NOT RUN IS NOT A CHECK THAT PASSED", async () => {
    // `rows` stays null on failure — never [], which is what a clean list
    // looks like. The server's `.catch(() => [])` used to erase the same
    // distinction one layer down and has been removed for the same reason.
    checkAddresses.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useRecipientHealth({ addresses: ["a@b.cm"] }));
    await waitFor(() => expect(checkAddresses).toHaveBeenCalled());
    expect(result.current.rows).toBeNull();
    expect(result.current.hard).toEqual([]);
  });

  it("asks once for a settled list, not once per keystroke", async () => {
    vi.useFakeTimers();
    const { rerender } = renderHook((p: { addresses: string[] }) => useRecipientHealth(p), {
      initialProps: { addresses: ["a@b.cm"] },
    });
    // A re-render with an equal list is a NEW array reference every time. The
    // effect must not restart on it — that is the defect §16.5 found in
    // `useGuardrails`, where the check never fired while anyone was typing.
    rerender({ addresses: ["a@b.cm"] });
    rerender({ addresses: ["a@b.cm"] });
    await act(async () => {
      vi.advanceTimersByTime(RECIPIENT_CHECK_DEBOUNCE_MS);
    });
    expect(checkAddresses).toHaveBeenCalledTimes(1);
  });

  it("asks nothing when there is no recipient yet", () => {
    vi.useFakeTimers();
    renderHook(() => useRecipientHealth({ addresses: [] }));
    act(() => {
      vi.advanceTimersByTime(RECIPIENT_CHECK_DEBOUNCE_MS * 2);
    });
    expect(checkAddresses).not.toHaveBeenCalled();
  });
});
