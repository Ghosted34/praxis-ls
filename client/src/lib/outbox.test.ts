/**
 * Outbox.
 *
 * This is the file where a mistake costs a duplicated invoice, so the tests are
 * about restraint as much as delivery:
 *
 *   - a 422 must NOT be queued (re-asking cannot change the answer, and the
 *     form's field-level errors depend on it still throwing);
 *   - the idempotency key must be identical on the replay, because that is the
 *     only thing standing between "retry" and "post it twice";
 *   - a write queued in SANDBOX must never replay into LIVE;
 *   - a rejected write must stay visible rather than being quietly dropped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiError, NETWORK_DOWN } from "./api-client";
import {
  submitQueued,
  flushOutbox,
  getOutbox,
  queuedCount,
  discardEntry,
  __resetOutboxForTests,
} from "./outbox";
import { tokenStore } from "./token-store";
import { __resetConnectionForTests } from "./connection";

const tenantMock = vi.fn();

vi.mock("./api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api-client")>();
  return { ...actual, tenant: (...args: unknown[]) => tenantMock(...args) };
});

const offline = () =>
  new ApiError(
    NETWORK_DOWN,
    "Can't reach the server — you appear to be offline.",
    0,
  );

beforeEach(() => {
  localStorage.clear();
  __resetOutboxForTests();
  __resetConnectionForTests();
  tenantMock.mockReset();
  vi.spyOn(tokenStore, "getEnv").mockReturnValue("live");
});

afterEach(() => {
  __resetOutboxForTests();
  vi.restoreAllMocks();
});

describe("submitQueued", () => {
  it("sends normally when the network is up", async () => {
    tenantMock.mockResolvedValue({ entity_id: "e1" });

    const r = await submitQueued<{ entity_id: string }>({
      path: "/entities",
      method: "POST",
      body: { code: "SLAS" },
      label: "SLAS",
    });

    expect(r.status).toBe("sent");
    expect(r.status === "sent" && r.data.entity_id).toBe("e1");
    expect(queuedCount()).toBe(0);
    // Even the FIRST attempt carries the key: the request may land and its
    // response be lost, and the replay has to be recognisable as the same write.
    const [, opts] = tenantMock.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(opts.headers["Idempotency-Key"]).toBeTruthy();
  });

  it("queues the write when nothing answered", async () => {
    tenantMock.mockRejectedValue(offline());

    const r = await submitQueued({
      path: "/entities",
      method: "POST",
      body: { code: "SLAS" },
      label: "New entity — SLAS",
    });

    expect(r.status).toBe("queued");
    expect(queuedCount()).toBe(1);
    expect(getOutbox()[0].label).toBe("New entity — SLAS");
  });

  it("RE-THROWS a validation failure instead of queueing it", async () => {
    // Queueing a 422 would delay the same rejection and rob `<Form>` of the
    // field-level routing that depends on the ApiError reaching it.
    tenantMock.mockRejectedValue(
      new ApiError("VALIDATION_ERROR", "code: required", 422, {
        code: ["required"],
      }),
    );

    await expect(
      submitQueued({ path: "/entities", body: {}, label: "x" }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(queuedCount()).toBe(0);
  });

  it("survives a reload — the queue is persisted", async () => {
    tenantMock.mockRejectedValue(offline());
    await submitQueued({
      path: "/entities",
      body: { code: "SLAS" },
      label: "SLAS",
    });

    const raw = localStorage.getItem("praxis.outbox.v1");
    expect(raw).toContain("SLAS");
  });
});

describe("flushOutbox", () => {
  it("replays with the SAME idempotency key and clears the entry", async () => {
    tenantMock.mockRejectedValueOnce(offline());
    await submitQueued({
      path: "/entities",
      method: "POST",
      body: { code: "SLAS" },
      label: "SLAS",
    });
    const queuedKey = getOutbox()[0].id;

    tenantMock.mockResolvedValueOnce({ entity_id: "e1" });
    const summary = await flushOutbox();

    expect(summary.sent).toBe(1);
    expect(queuedCount()).toBe(0);
    const [, opts] = tenantMock.mock.calls[1] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(opts.headers["Idempotency-Key"]).toBe(queuedKey);
  });

  it("keeps the queue intact when the network is still down", async () => {
    tenantMock.mockRejectedValue(offline());
    await submitQueued({ path: "/entities", body: { code: "A" }, label: "A" });
    await submitQueued({ path: "/entities", body: { code: "B" }, label: "B" });

    const summary = await flushOutbox();
    expect(summary.sent).toBe(0);
    expect(queuedCount()).toBe(2);
  });

  it("stops the line at the first network failure rather than burning attempts", async () => {
    tenantMock.mockRejectedValue(offline());
    await submitQueued({ path: "/entities", body: { code: "A" }, label: "A" });
    await submitQueued({ path: "/entities", body: { code: "B" }, label: "B" });
    tenantMock.mockReset();
    tenantMock.mockRejectedValue(offline());

    await flushOutbox();

    // One attempt, not two: an ERP write sequence is causal, and marching on
    // through a dead network rejects entries that were never wrong.
    expect(tenantMock).toHaveBeenCalledTimes(1);
  });

  it("moves a write the server REFUSED to rejected, and keeps it visible", async () => {
    tenantMock.mockRejectedValueOnce(offline());
    await submitQueued({
      path: "/journal-entries",
      body: {},
      label: "Journal entry — March",
    });

    tenantMock.mockRejectedValueOnce(
      new ApiError("PERIOD_CLOSED", "That period is closed.", 409),
    );
    const summary = await flushOutbox();

    expect(summary.rejected).toBe(1);
    const entry = getOutbox()[0];
    // Silently dropping a write the user believes they made is the one outcome
    // worse than telling them it failed.
    expect(entry.state).toBe("rejected");
    expect(entry.lastError).toBe("That period is closed.");
    expect(queuedCount()).toBe(0);
  });

  it("never replays a SANDBOX write into LIVE", async () => {
    vi.spyOn(tokenStore, "getEnv").mockReturnValue("sandbox");
    tenantMock.mockRejectedValueOnce(offline());
    await submitQueued({
      path: "/entities",
      body: { code: "TEST" },
      label: "TEST",
    });

    vi.spyOn(tokenStore, "getEnv").mockReturnValue("live");
    tenantMock.mockReset();
    const summary = await flushOutbox();

    expect(tenantMock).not.toHaveBeenCalled();
    expect(summary.sent).toBe(0);
    // Still held, for whenever the user switches back.
    expect(queuedCount()).toBe(1);
  });

  it("shares one flush between racing callers, and tells them both the truth", async () => {
    tenantMock.mockRejectedValueOnce(offline());
    await submitQueued({
      path: "/entities",
      body: { code: "SLAS" },
      label: "SLAS",
    });

    tenantMock.mockReset();
    tenantMock.mockResolvedValue({ ok: true });
    // The reconnect handler and the watcher's summary call land in the same
    // tick. One request must go out…
    const [a, b] = await Promise.all([flushOutbox(), flushOutbox()]);

    expect(tenantMock).toHaveBeenCalledTimes(1);
    // …and BOTH callers must be told it was sent. Handing the loser a zeroed
    // summary is what made the reconnect toast go silent in exactly the case
    // it exists for.
    expect(a).toEqual({ sent: 1, rejected: 0, remaining: 0 });
    expect(b).toEqual(a);
  });

  it("retries the server's IDEMPOTENCY_IN_PROGRESS instead of rejecting the write", async () => {
    // 409 usually means "no". This one means "your first attempt is still
    // running" — calling it permanent would tell the user a write failed at
    // the moment it was succeeding.
    tenantMock.mockRejectedValueOnce(offline());
    await submitQueued({
      path: "/entities",
      body: { code: "SLAS" },
      label: "SLAS",
    });

    tenantMock.mockRejectedValueOnce(
      new ApiError(
        "IDEMPOTENCY_IN_PROGRESS",
        "An identical request is still being processed.",
        409,
      ),
    );
    const first = await flushOutbox();
    expect(first.rejected).toBe(0);
    expect(queuedCount()).toBe(1);

    tenantMock.mockResolvedValueOnce({ entity_id: "e1" });
    expect((await flushOutbox()).sent).toBe(1);
  });

  it("does not replay one user's queued write under another user's session", async () => {
    const jwt = (sub: string) => `x.${btoa(JSON.stringify({ sub }))}.y`;
    vi.spyOn(tokenStore, "getAccess").mockReturnValue(jwt("user-a"));
    tenantMock.mockRejectedValueOnce(offline());
    await submitQueued({
      path: "/entities",
      body: { code: "SLAS" },
      label: "SLAS",
    });

    vi.spyOn(tokenStore, "getAccess").mockReturnValue(jwt("user-b"));
    tenantMock.mockReset();
    const summary = await flushOutbox();

    // Wrong created_by and a wrong audit trail — on a shared dispatch desk
    // that is not hypothetical.
    expect(tenantMock).not.toHaveBeenCalled();
    expect(summary.sent).toBe(0);
    expect(queuedCount()).toBe(1);
  });
});

describe("discardEntry", () => {
  it("removes exactly one entry", async () => {
    tenantMock.mockRejectedValue(offline());
    await submitQueued({ path: "/entities", body: { code: "A" }, label: "A" });
    await submitQueued({ path: "/entities", body: { code: "B" }, label: "B" });

    discardEntry(getOutbox()[0].id);

    expect(getOutbox()).toHaveLength(1);
    expect(getOutbox()[0].label).toBe("B");
  });
});
