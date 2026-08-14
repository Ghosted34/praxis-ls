/**
 * Behaviour tests for `useAction`.
 *
 * The four branches that matter live in the expected/unexpected split at the
 * top of the file:
 *
 *   changed:true   → success toast, onSuccess, no report
 *   changed:false  → idle toast, onSuccess, no report
 *   expected throw (403/422/CONFIG_MISSING/NETWORK_DOWN/AbortError)
 *                  → error toast, NEVER reported
 *   unexpected throw (5xx, TypeError, malformed envelope)
 *                  → error toast, reported
 *
 * Plus class D: no `success` opt = no toast on success or failure, but a
 * failure still records at `onError:"notice"`.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act as rtlAct, waitFor } from "@testing-library/react";

import { useAction } from "./use-action";
import { ToastProvider } from "@/components/ui/toast";
import { ApiError, NETWORK_DOWN } from "./api-client";
import * as reporting from "./error-reporting";

const wrap = ({ children }: { children: React.ReactNode }) => (
  <ToastProvider>{children}</ToastProvider>
);

/**
 * Mount a component that constructs `useAction(fn, opts)` and exposes its
 * `run` + latest `busy`/`error` on the returned `handle` for assertions.
 */
function harness<A extends unknown[], R>(fn: (...a: A) => Promise<R>, opts: Parameters<typeof useAction<A, R>>[1] = {}) {
  const handle: { current: ReturnType<typeof useAction<A, R>> | null } = { current: null };
  function Probe() {
    const a = useAction(fn, opts);
    handle.current = a;
    return null;
  }
  render(<Probe />, { wrapper: wrap });
  return handle;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("useAction — resolved calls", () => {
  it("changed:true fires success toast and onSuccess", async () => {
    const onSuccess = vi.fn();
    const fn = vi.fn(async () => ({ ok: true as const, changed: true, data: { id: "s1" } }));
    const h = harness(fn, { success: "Session revoked", onSuccess });
    let result: unknown;
    await rtlAct(async () => { result = await h.current!.run(); });
    expect(fn).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: "s1" });
    expect(onSuccess).toHaveBeenCalledWith({ id: "s1" });
    // The toast region is aria-live=polite; a live announcement is present.
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Session revoked");
  });

  it("changed:false fires idle toast (info role, not error)", async () => {
    const onSuccess = vi.fn();
    const fn = vi.fn(async () => ({ ok: true as const, changed: false, message: "Server said already revoked" }));
    const h = harness(fn, {
      success: "Session revoked",
      idle: "That session was already revoked",
      onSuccess,
    });
    await rtlAct(async () => { await h.current!.run(); });
    expect(onSuccess).toHaveBeenCalledOnce();
    // Info toast uses role=status; error uses role=alert. This must be status.
    expect(document.querySelector('[role="status"]')?.textContent).toContain("already revoked");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("no envelope → treated as changed:true (legacy path)", async () => {
    const fn = vi.fn(async () => "plain-payload");
    const h = harness(fn, { success: "Done" });
    await rtlAct(async () => { await h.current!.run(); });
    expect(document.querySelector('[role="status"]')?.textContent).toContain("Done");
  });

  it("no `success` opt (class D) → no toast on success", async () => {
    const fn = vi.fn(async () => ({ ok: true as const, changed: true }));
    const h = harness(fn, { onError: "notice" });
    await rtlAct(async () => { await h.current!.run(); });
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("useAction — expected failures are NEVER reported", () => {
  it("403 shows error toast; report not called", async () => {
    const report = vi.spyOn(reporting, "reportClientError").mockImplementation(() => {});
    const fn = vi.fn(async () => { throw new ApiError("PERMISSION_DENIED", "No", 403); });
    const h = harness(fn, { success: "…" });
    await rtlAct(async () => { await h.current!.run(); });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("permission");
    expect(report).not.toHaveBeenCalled();
  });

  it("422 is not reported", async () => {
    const report = vi.spyOn(reporting, "reportClientError").mockImplementation(() => {});
    const fn = vi.fn(async () => { throw new ApiError("VALIDATION_ERROR", "bad", 422, { email: "required" }); });
    const h = harness(fn, { success: "…" });
    await rtlAct(async () => { await h.current!.run(); });
    expect(report).not.toHaveBeenCalled();
  });

  it("CONFIG_MISSING (424) is not reported — it is unfinished setup", async () => {
    const report = vi.spyOn(reporting, "reportClientError").mockImplementation(() => {});
    const fn = vi.fn(async () => { throw new ApiError("CONFIG_MISSING", "SMTP not set", 424); });
    const h = harness(fn, { success: "…" });
    await rtlAct(async () => { await h.current!.run(); });
    expect(report).not.toHaveBeenCalled();
  });

  it("NETWORK_DOWN is not reported — the network dropped, that is not our fault", async () => {
    const report = vi.spyOn(reporting, "reportClientError").mockImplementation(() => {});
    const fn = vi.fn(async () => { throw new ApiError(NETWORK_DOWN, "offline", 0); });
    const h = harness(fn, { success: "…" });
    await rtlAct(async () => { await h.current!.run(); });
    expect(report).not.toHaveBeenCalled();
  });

  it("AbortError is not reported — the caller changed its mind", async () => {
    const report = vi.spyOn(reporting, "reportClientError").mockImplementation(() => {});
    const fn = vi.fn(async () => { throw new DOMException("aborted", "AbortError"); });
    const h = harness(fn, { success: "…" });
    await rtlAct(async () => { await h.current!.run(); });
    expect(report).not.toHaveBeenCalled();
  });
});

describe("useAction — unexpected failures ARE reported", () => {
  it("500 reaches the reporter", async () => {
    const report = vi.spyOn(reporting, "reportClientError").mockImplementation(() => {});
    const fn = vi.fn(async () => { throw new ApiError("INTERNAL_ERROR", "boom", 500); });
    const h = harness(fn, { success: "…" });
    await rtlAct(async () => { await h.current!.run(); });
    expect(report).toHaveBeenCalledOnce();
    expect(report.mock.calls[0][0].fatal).toBe(true);
  });

  it("a plain TypeError reaches the reporter", async () => {
    const report = vi.spyOn(reporting, "reportClientError").mockImplementation(() => {});
    const fn = vi.fn(async () => { throw new TypeError("undefined is not a function"); });
    const h = harness(fn, { success: "…" });
    await rtlAct(async () => { await h.current!.run(); });
    expect(report).toHaveBeenCalledOnce();
  });

  it("onError:'notice' records at notice — no toast if no success copy, still reported", async () => {
    const report = vi.spyOn(reporting, "reportClientError").mockImplementation(() => {});
    const fn = vi.fn(async () => { throw new ApiError("INTERNAL_ERROR", "boom", 500); });
    const h = harness(fn, { onError: "notice" });
    await rtlAct(async () => { await h.current!.run(); });
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(report).toHaveBeenCalledOnce();
    // notice ≠ fatal.
    expect(report.mock.calls[0][0].fatal).toBe(false);
  });

  it("onError:'silent' never toasts and never reports", async () => {
    const report = vi.spyOn(reporting, "reportClientError").mockImplementation(() => {});
    const fn = vi.fn(async () => { throw new ApiError("INTERNAL_ERROR", "boom", 500); });
    const h = harness(fn, { onError: "silent", silentReason: "storage" });
    await rtlAct(async () => { await h.current!.run(); });
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });
});

describe("useAction — mechanics", () => {
  it("busy toggles true during, false after", async () => {
    let resolve!: (v: unknown) => void;
    const fn = vi.fn(() => new Promise((r) => { resolve = r; }));
    const h = harness(fn, { success: "done" });
    let pending: Promise<unknown> | null = null;
    rtlAct(() => { pending = h.current!.run(); });
    await waitFor(() => expect(h.current!.busy).toBe(true));
    rtlAct(() => { resolve({ ok: true, changed: true }); });
    await rtlAct(async () => { await pending; });
    expect(h.current!.busy).toBe(false);
  });

  it("run never rejects — the error is on .error", async () => {
    const fn = vi.fn(async () => { throw new ApiError("PERMISSION_DENIED", "No", 403); });
    const h = harness(fn, { success: "…" });
    let ret: unknown;
    await rtlAct(async () => { ret = await h.current!.run(); });
    expect(ret).toBeUndefined();
    expect(h.current!.error).toMatch(/permission/i);
  });
});
