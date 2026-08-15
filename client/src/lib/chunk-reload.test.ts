/**
 * Recovery from a stale build's chunk references.
 *
 * THE BUG, as reported from production: "This screen couldn't be displayed —
 * Failed to fetch dynamically imported module: .../assets/index-CRdI1OP9.js".
 * A tab open across a deploy keeps the previous index.html (the service worker
 * registers with `registerType: "prompt"`), so every lazy route points at chunk
 * hashes the server has already deleted. It happens to every user on every
 * deploy, and the app looks broken while nothing is.
 *
 * The two things worth pinning are the two ways this goes wrong:
 *   - it does not recover, and users keep seeing the error screen
 *   - it recovers TOO eagerly and becomes a refresh loop, which is far worse
 *     than the error it replaced — an offline user cannot escape it
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withChunkReload, clearChunkReloadFlag } from "./chunk-reload";

const STALE = new TypeError(
  "Failed to fetch dynamically imported module: https://x/assets/index-abc.js",
);

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  reload = vi.fn();
  Object.defineProperty(window, "location", {
    value: { reload },
    writable: true,
  });
});
afterEach(() => sessionStorage.clear());

describe("withChunkReload", () => {
  it("passes a successful import straight through", async () => {
    await expect(withChunkReload(async () => "module")()).resolves.toBe(
      "module",
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads on a stale-chunk failure instead of surfacing an error", async () => {
    const load = withChunkReload(() => Promise.reject(STALE));
    // Never settles — the page is navigating away, and resolving would let React
    // paint something in the moments before it does.
    const pending = load();
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);
    await expect(
      Promise.race([pending, Promise.resolve("still-pending")]),
    ).resolves.toBe("still-pending");
  });

  it("recognises the wording other browsers use", async () => {
    // Chromium, Firefox and Safari all phrase this differently, and a missed
    // match means an error screen where a reload would have worked.
    for (const msg of [
      "error loading dynamically imported module",
      "Importing a module script failed.",
      "Expected a JavaScript module script but the server responded with a MIME type of 'text/html' is not a valid JavaScript MIME type",
    ]) {
      sessionStorage.clear();
      reload.mockClear();
      withChunkReload(() => Promise.reject(new TypeError(msg)))();
      await Promise.resolve();
      expect(reload, msg).toHaveBeenCalledTimes(1);
    }
  });

  it("NEVER reloads twice in a session — a refresh loop is worse than the error", async () => {
    withChunkReload(() => Promise.reject(STALE))();
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);

    // Second failure in the same session: the cause is not a stale build, so it
    // must reach the error boundary where a human can see it.
    await expect(
      withChunkReload(() => Promise.reject(STALE))(),
    ).rejects.toThrow(/Failed to fetch/);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("lets a genuine module error through untouched", async () => {
    // A bug inside the imported module must not be masked as a stale deploy and
    // silently reloaded — that would hide a real crash behind a refresh.
    const boom = new Error(
      "Cannot read properties of undefined (reading 'map')",
    );
    await expect(withChunkReload(() => Promise.reject(boom))()).rejects.toThrow(
      boom,
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it("re-arms after a successful load, so the next deploy can recover too", async () => {
    withChunkReload(() => Promise.reject(STALE))();
    await Promise.resolve();
    clearChunkReloadFlag(); // what main.tsx does once the app renders

    reload.mockClear();
    withChunkReload(() => Promise.reject(STALE))();
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
