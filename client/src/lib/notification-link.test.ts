/**
 * Every destination a notification can offer is a route the router actually
 * serves.
 *
 * ── THE FAILURE THIS EXISTS TO CATCH ───────────────────────────────────────
 *
 * A wrong in-app path does not 404. `app.tsx` ends with
 * `<Route path="*" element={<Navigate to="/" replace />} />`, so anything that
 * matches nothing lands on the Control Tower — no error, no console warning,
 * nothing to notice in review. The user clicks a notification about an invoice
 * and arrives at the dashboard, which is indistinguishable from the click doing
 * nothing at all.
 *
 * That is not a hypothesis. Both hand-written deep links in the tree were wrong
 * when this test was added, and both had shipped:
 *
 *   /costing/costings/<id>   — the route is `costing/costing/:costingId`
 *   /settings/notifications  — the route is `/notifications`, and there is no
 *                              `settings/:section` to catch it either
 *
 * Neither was caught by a type, a lint rule or a test, because a string is a
 * string. Parsing the real router is the only check that has teeth.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { entityRoute } from "@praxis/shared";
import { notificationLink } from "./notification-link";

const here = dirname(fileURLToPath(import.meta.url));
const APP = readFileSync(resolve(here, "../app/app.tsx"), "utf8");

/** Every `path="…"` in the router, normalised to a leading slash. Nested
 *  authenticated routes are written relative to the shell's index route, so
 *  `hr/:section` and `/login` both mean an absolute path of one shape. */
const ROUTES: string[] = [...APP.matchAll(/path="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((p) => p !== "*")
  .map((p) => (p.startsWith("/") ? p : `/${p}`));

/** Does `path` match a router pattern, treating `:param` as one segment? */
function isRouted(path: string): boolean {
  const clean = path.split("?")[0].split("#")[0];
  const parts = clean.split("/").filter(Boolean);
  return ROUTES.some((pattern) => {
    const pat = pattern.split("/").filter(Boolean);
    if (pat.length !== parts.length) return false;
    return pat.every((seg, i) => seg.startsWith(":") || seg === parts[i]);
  });
}

describe("the router parse this test depends on", () => {
  // A regex that silently matched nothing would make every assertion below
  // vacuously pass, which is the one way this test could lie.
  it("finds the routes it is going to check against", () => {
    expect(ROUTES.length).toBeGreaterThan(50);
    expect(ROUTES).toContain("/notifications");
    expect(ROUTES).toContain("/costing/costing/:costingId");
  });

  it("rejects the two paths that were actually broken", () => {
    expect(isRouted("/costing/costings/abc")).toBe(false);
    expect(isRouted("/settings/notifications")).toBe(false);
  });
});

describe("every route the resolver can emit is served", () => {
  it.each(entityRoute.allRoutes())("%s is a real route", (url) => {
    expect(isRouted(url)).toBe(true);
  });
});

describe("notificationLink", () => {
  it("prefers the stored link_url over the derived one", () => {
    // Mail's own `?thread=` is the query the inbox reads as its initial
    // selection — a type-and-id map cannot derive it, so the producer wins.
    expect(
      notificationLink({
        link_url: "/comms/mail?thread=abc",
        entity_ref: "email_thread:abc",
      }),
    ).toEqual({ url: "/comms/mail?thread=abc", precision: "record" });
  });

  it("falls back to entity_ref for rows written before the column existed", () => {
    expect(notificationLink({ link_url: null, entity_ref: "lead:42" })).toEqual({
      url: "/sales/leads/42",
      precision: "record",
    });
  });

  it("reports a list landing as a list landing", () => {
    // The UI words the affordance from this. Promising a record and delivering
    // a list is a smaller copy of the broken promise the feature exists to end.
    expect(notificationLink({ entity_ref: "payroll:7" })?.precision).toBe(
      "section",
    );
  });

  it("returns null when there is nowhere to go", () => {
    // A God Mode PIN is the entire message and has no page. Returning
    // `/notifications` to make something clickable would send the reader back
    // to the list they clicked from.
    expect(notificationLink({ link_url: null, entity_ref: null })).toBeNull();
    expect(notificationLink({ entity_ref: "domain:praxisls.com" })).toBeNull();
    expect(notificationLink(null)).toBeNull();
  });

  /**
   * Found by CodeQL on the commit that introduced this module, and a crash
   * rather than a curiosity: `DETAIL[type]` walked the prototype chain, so
   * `valueOf:y` THREW a TypeError out of `linkFor` — which runs while a
   * notification row renders. One stored ref would have taken down the bell and
   * the inbox. `constructor:x` and `toString:x` did not throw; they returned
   * "x" and "[object Undefined]" as URLs, which is the quieter half of the same
   * bug.
   */
  it.each([
    "constructor:x",
    "toString:x",
    "valueOf:y",
    "hasOwnProperty:z",
    "__proto__:q",
  ])("does not dispatch to the prototype chain for %s", (ref) => {
    expect(() => notificationLink({ entity_ref: ref })).not.toThrow();
    expect(notificationLink({ entity_ref: ref })).toBeNull();
  });

  it("refuses a stored value that would leave the app", () => {
    // `//evil.example` is protocol-relative: a router treats it as external.
    expect(
      notificationLink({ link_url: "//evil.example", entity_ref: null }),
    ).toBeNull();
    expect(
      notificationLink({ link_url: "https://evil.example", entity_ref: null }),
    ).toBeNull();
  });
});
