/**
 * The service worker is not built, bundled, typechecked or imported by
 * anything — it is a raw file copied into the bundle and pulled in by Workbox's
 * `importScripts`. Nothing else in this repo can catch a mistake in it, and
 * every failure path inside it is swallowed on purpose (a worker that throws
 * during a push event loses the notification).
 *
 * That combination means a wrong constant in there is INVISIBLE: no build
 * error, no runtime error, no log — just a feature that silently never works.
 * This file asserts the handful of things the worker has to agree with the rest
 * of the app about.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sw = readFileSync(join(__dirname, "../../public/push-handler.js"), "utf8");
const apiClient = readFileSync(join(__dirname, "./api-client.ts"), "utf8");
const tokenStore = readFileSync(join(__dirname, "./push-token-store.ts"), "utf8");

describe("the rotation call the worker makes", () => {
  it("targets /api/tenant/... — the prefix every other call in the app uses", () => {
    // Caught for real: the worker had `/api/notifications/push/rotate`. The
    // tenant surface is mounted under /tenant, so that 404s — and since the
    // worker swallows its errors, rotation repair would have shipped dead and
    // silent, which is precisely the failure it was written to remove.
    expect(sw).toContain('fetch("/api/tenant/notifications/push/rotate"');
    expect(sw).not.toContain('fetch("/api/notifications/');
  });

  it("uses the same prefix the client helper composes", () => {
    // `tenant(p)` → api(`/tenant${p}`) → fetch(`/api/tenant${p}`). If that ever
    // changes, this pins that the worker has to change with it.
    expect(apiClient).toContain("`/tenant${p}`");
    expect(apiClient).toContain("`/api${path}`");
  });

  it("sends the token and the new subscription, as the validator requires", () => {
    expect(sw).toContain("rotation_token: token");
    expect(sw).toContain("subscription: sub.toJSON()");
    expect(sw).toContain('"Content-Type": "application/json"');
  });

  it("stores the replacement token — a single-use token not replaced is a device that rotates once", () => {
    expect(sw).toMatch(/writeRotationToken\(next\)/);
  });
});

describe("the IndexedDB the worker and the page share", () => {
  it("agrees on database, store and key names", () => {
    // The page writes with lib/push-token-store.ts and the worker reads with
    // its own inlined copy — it cannot import a module. Two literals that must
    // match and that nothing else would ever compare.
    for (const literal of ['"praxis-push"', '"tokens"', '"rotation"']) {
      expect(tokenStore).toContain(literal);
      expect(sw).toContain(literal);
    }
  });

  it("both sides open the same schema version", () => {
    expect(tokenStore).toContain("DB_VERSION = 1");
    expect(sw).toMatch(/indexedDB\.open\("praxis-push", 1\)/);
  });
});

describe("the push payload contract", () => {
  it("reads every key the server sends", () => {
    // Mirrors buildPayload in src/shared/push/push.service.js. A key added on
    // the server and not read here is a notification that quietly loses its
    // deep link, its badge or its collapsing behaviour.
    for (const key of [
      "data.title", "data.body", "data.url", "data.tag", "data.renotify",
      "data.requireInteraction", "data.badgeCount", "data.actions", "data.timestamp",
    ]) {
      expect(sw).toContain(key);
    }
  });

  it("renotify is only set alongside a tag, where it means anything", () => {
    expect(sw).toContain("renotify: data.tag ? Boolean(data.renotify) : false");
  });
});
