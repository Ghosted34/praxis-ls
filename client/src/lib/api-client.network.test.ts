/**
 * Network-failure classification in the api-client.
 *
 * This is the seam the whole offline experience hangs off, and there is exactly
 * one way to get it wrong that matters: calling a SERVER error a NETWORK error.
 * Do that and a genuine 500 shows the connection screen, the user reboots a
 * router that is working, our bug goes unreported, and the offline feature has
 * made the product harder to support rather than easier.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiError, NETWORK_DOWN, isNetworkError, tenant } from "./api-client";
import { getConnection, __resetConnectionForTests } from "./connection";

const fetchMock = vi.fn();

const jsonResponse = (status: number, body: unknown) =>
  ({
    status,
    ok: status >= 200 && status < 300,
    statusText: String(status),
    headers: new Headers(),
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as Response;

/**
 * `catch` gives back `unknown`, and every assertion below is about the SHAPE of
 * the failure. Narrowing once here keeps the tests reading as prose rather than
 * as a run of casts.
 */
const failure = (p: Promise<unknown>): Promise<ApiError> =>
  p.then(
    () => null,
    (e) => e,
  ) as Promise<ApiError>;

beforeEach(() => {
  __resetConnectionForTests();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  });
});

afterEach(() => {
  __resetConnectionForTests();
  vi.unstubAllGlobals();
});

describe("a rejected fetch", () => {
  it("becomes a typed NETWORK_DOWN error and marks the connection down", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const err = await failure(tenant("/entities"));

    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe(NETWORK_DOWN);
    // No HTTP status, because nothing came back.
    expect(err.status).toBe(0);
    expect(isNetworkError(err)).toBe(true);
    expect(getConnection().status).toBe("unreachable");
  });

  it("does not match on the browser's message text", async () => {
    // Firefox, Safari and Chrome each word this differently ("NetworkError when
    // attempting to fetch resource.", "Load failed", "Failed to fetch"), which
    // is why nothing downstream is allowed to sniff the string.
    fetchMock.mockRejectedValue(new TypeError("Load failed"));
    const err = await failure(tenant("/entities"));
    expect(err.code).toBe(NETWORK_DOWN);
  });
});

describe("a server that answered", () => {
  it("keeps the connection ONLINE on a 500", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(500, { error: { code: "BOOM", message: "Internal error" } }),
    );

    const err = await failure(tenant("/entities"));

    expect(err.status).toBe(500);
    expect(isNetworkError(err)).toBe(false);
    // The server answering "I'm broken" is proof the network is fine.
    expect(getConnection().status).toBe("online");
  });

  it("keeps a 403's real message and does not treat it as offline", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {
        error: {
          code: "FORBIDDEN",
          message: "You don't have permission to do this.",
        },
      }),
    );

    const err = await failure(tenant("/entities"));

    expect(err.message).toBe("You don't have permission to do this.");
    expect(isNetworkError(err)).toBe(false);
    expect(getConnection().status).toBe("online");
  });

  it("treats a 503 from the gateway as a connection failure", async () => {
    // Our proxy answered, the app behind it did not. Same user experience, same
    // recovery — but the real status survives on the error for support.
    fetchMock.mockResolvedValue(
      jsonResponse(503, {
        error: { code: "UNAVAILABLE", message: "upstream" },
      }),
    );

    const err = await failure(tenant("/entities"));

    expect(err.status).toBe(503);
    expect(isNetworkError(err)).toBe(true);
    expect(getConnection().status).toBe("unreachable");
  });

  it("marks the connection back up on the next successful response", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await tenant("/entities").catch(() => {});
    expect(getConnection().status).toBe("unreachable");

    fetchMock.mockResolvedValue(jsonResponse(200, { data: [] }));
    await tenant("/entities");

    expect(getConnection().status).toBe("online");
  });
});

describe("an aborted request", () => {
  it("is the caller changing its mind, not the network failing", async () => {
    // A cancelled query or an unmounted screen aborts in flight. Reporting that
    // as a drop would put the app on the offline screen every time somebody
    // navigated away from a slow list.
    fetchMock.mockRejectedValue(
      new DOMException("The operation was aborted.", "AbortError"),
    );

    const err: unknown = await tenant("/entities").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DOMException);
    expect(getConnection().status).toBe("online");
  });
});
