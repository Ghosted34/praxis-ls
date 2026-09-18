/**
 * `classifyAiFailure` and the non-streaming ask's timeout — audit G2 and G4.
 *
 * The case worth pinning is the counter-intuitive one: a turn whose vendor chain
 * was exhausted arrives as a SUCCESS. The server answers with prose explaining
 * that no provider is configured, status 200, `answer` populated — so every
 * signal except one says the turn went fine, and the one that does not is
 * `provider: null`. Classifying on the prose instead would break the first time
 * somebody reworded the message, and would misread a genuine ANSWER about vendor
 * configuration as a configuration failure.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { classifyAiFailure, AI_ASK_TIMEOUT_MS } from "./ai-api";

describe("classifyAiFailure", () => {
  it("a turn a vendor answered is not a failure", () => {
    expect(
      classifyAiFailure({ provider: "deepseek", completed: true }),
    ).toBeNull();
  });

  it("a completed turn naming no vendor is a PROVIDER failure", () => {
    const f = classifyAiFailure({ provider: null, completed: true });
    expect(f?.kind).toBe("provider");
    // The message has to point somewhere actionable: nobody staring at this can
    // fix a credential from the chat, and "something went wrong" tells them
    // nothing about who can.
    expect(f?.message).toMatch(/AI Control/);
  });

  it("an undefined provider on a completed turn counts the same as null", () => {
    // The non-streaming fallback used to end the turn without a provider at
    // all, which read as "a vendor answered" purely because the key was absent.
    expect(classifyAiFailure({ completed: true })?.kind).toBe("provider");
  });

  it("does NOT judge an in-flight turn — a missing provider means 'not yet'", () => {
    expect(classifyAiFailure({ provider: null })).toBeNull();
  });

  it("a governance refusal is a decision, not a fault", () => {
    // `blocked` turns already explain themselves in the answer. Drawing an
    // error and a retry button over "your plan does not include this" would be
    // inviting somebody to retry their way past an entitlement.
    expect(
      classifyAiFailure({ provider: null, blocked: true, completed: true }),
    ).toBeNull();
  });

  it("a thrown error is TRANSIENT and keeps its message", () => {
    const f = classifyAiFailure({ error: new Error("Network unreachable") });
    expect(f).toEqual({ kind: "transient", message: "Network unreachable" });
  });

  it("a timeout says so in words, not as a DOMException name", () => {
    const f = classifyAiFailure({
      error: new DOMException("whatever", "TimeoutError"),
    });
    expect(f?.kind).toBe("transient");
    expect(f?.message).toMatch(/too long/i);
  });

  it("an error wins over a null provider — the turn never completed", () => {
    expect(
      classifyAiFailure({ provider: null, completed: true, error: new Error("boom") })?.kind,
    ).toBe("transient");
  });
});

describe("the non-streaming ask is bounded (audit G2)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("is generous but finite — longer than the server's own per-call cap", () => {
    // The server allows each model call `AI_REQUEST_TIMEOUT_MS` (120s), and a
    // turn is several of them. A client bound at or below that would cut off
    // answers the server was still legitimately producing.
    expect(AI_ASK_TIMEOUT_MS).toBeGreaterThan(120_000);
    expect(Number.isFinite(AI_ASK_TIMEOUT_MS)).toBe(true);
  });

  it("aborts the request once the budget is spent", async () => {
    vi.useFakeTimers();
    const { askPraxis } = await import("./ai-api");
    let captured: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      captured = (init as RequestInit | undefined)?.signal ?? undefined;
      // A request that never answers — the exact shape this bound exists for.
      return new Promise<Response>(() => {});
    });

    void askPraxis("anything").catch(() => {
      /* @silent:teardown — the rejection is the point, not the assertion */
    });
    // Let the request reach fetch before the clock moves.
    await Promise.resolve();
    expect(captured?.aborted).toBe(false);

    vi.advanceTimersByTime(AI_ASK_TIMEOUT_MS + 1);
    expect(captured?.aborted).toBe(true);
  });
});
