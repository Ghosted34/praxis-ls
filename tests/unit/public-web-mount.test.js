"use strict";

/**
 * The public-web mount, pinned.
 *
 * The block in `src/server.js` that serves `public-web/dist` carries a comment
 * asserting that its rules "are enforced in the path test". There was no such
 * test, and the gap cost exactly what an unenforced comment usually costs: the
 * app's own bundle lived at `/assets/*`, the mount claimed no such path, the
 * request fell through to `client/dist` and then to the ERP's `app.get("*")`,
 * and production served `200 text/html` where the browser expected a module.
 * The page loaded and the app never started.
 *
 * Nothing about that is reachable from `vite dev` or `vite preview`, neither of
 * which goes through the mount — so this file reads the two sources that have to
 * agree and asserts the agreement directly, rather than booting an app that
 * would want a database and a Redis to say anything at all.
 */

const fs = require("fs");
const path = require("path");

const repo = path.resolve(__dirname, "../..");
const serverSrc = fs.readFileSync(path.join(repo, "src/server.js"), "utf8");
const viteSrc = fs.readFileSync(path.join(repo, "public-web/vite.config.ts"), "utf8");

/** The real builder, not a copy of it. The prefix is a per-host setting now, so
 *  the matcher is built per request from the resolved value — this asks the same
 *  module `src/server.js` asks. */
const paths = require("../../src/shared/http/public-web-paths");
const mountMatcher = (base) => paths.matcherFor(base || paths.DEFAULT_BASE);

/** The build output directory public-web actually emits into. */
function assetsDir() {
  const m = viteSrc.match(/assetsDir:\s*"([^"]+)"/);
  if (!m) throw new Error("build.assetsDir not set in public-web/vite.config.ts");
  return m[1];
}

describe("public-web mount path", () => {
  const claims = mountMatcher();
  const dir = assetsDir();

  test("claims the app's own prefixes", () => {
    for (const p of ["/public", "/public/", "/public/track", "/public/proposals/abc",
                     "/portal", "/portal/login", "/portal/client/documents"]) {
      expect({ p, claimed: claims.test(p) }).toEqual({ p, claimed: true });
    }
  });

  test("claims the legacy paths the ERP published", () => {
    for (const p of ["/track", "/track/", "/tracking", "/portfolio", "/portfolio/x",
                     "/proposal/tok", "/proposals/tok", "/careers", "/careers/tok",
                     "/client-portal/set-password"]) {
      expect({ p, claimed: claims.test(p) }).toEqual({ p, claimed: true });
    }
  });

  /* ── the regression this file exists for ──────────────────────────────── */

  test("the build's asset directory is claimed, so the app's JS resolves", () => {
    // If these two ever disagree, production serves the ERP's index.html in
    // place of every chunk, stylesheet and font this app asks for.
    expect(claims.test(`/${dir}/index-D4t5Xk.js`)).toBe(true);
    expect(claims.test(`/${dir}/index-D4t5Xk.css`)).toBe(true);
    expect(claims.test(`/${dir}/inter-latin-wght-normal-Dx4kXJ.woff2`)).toBe(true);
  });

  test("that directory is NOT /assets, which belongs to the ERP's build", () => {
    // Claiming /assets here would fix this app by breaking client/dist, whose
    // bundle is served from exactly that path on the same origin.
    expect(dir).not.toBe("assets");
    expect(claims.test("/assets/index-ERPHASH.js")).toBe(false);
  });

  /* ── everything the mount must leave alone ────────────────────────────── */

  test("does not claim the ERP's own entry points", () => {
    for (const p of ["/", "/login", "/reset-password", "/dashboard",
                     "/settings/portal-access", "/operations/files"]) {
      expect({ p, claimed: claims.test(p) }).toEqual({ p, claimed: false });
    }
  });

  test("does not claim /api or /media", () => {
    // The mount guards these again at request time; this asserts the matcher
    // never wanted them in the first place, so a deep link under /public that
    // does not exist returns the API's 404 JSON rather than an HTML body.
    for (const p of ["/api/tenant/public/services", "/api/tenant/portal/me",
                     "/media/branding/logo.png"]) {
      expect({ p, claimed: claims.test(p) }).toEqual({ p, claimed: false });
    }
  });

  /* ── the per-host surface (migration 0103) ────────────────────────────── */

  test("what a host serves is read from the registry, not from config", () => {
    // The first version of this was a single env var copied from
    // PLATFORM_CONSOLE_HOST. One console serves the whole platform, so one value
    // fits it; one public site serves ONE TENANT, so a single value names one
    // tenant's domain and every other tenant's falls through to the staff app.
    expect(serverSrc).not.toMatch(/PUBLIC_WEB_HOST\s*[:=]/);
    expect(serverSrc).toMatch(/registry\.resolveByHost/);
    expect(serverSrc).toMatch(/req\.hostSurface\s*=/);
  });

  test("the surface column exists, defaults to erp, and is constrained", () => {
    const mig = fs.readFileSync(
      path.join(repo, "migrations/platform/0103_subdomain_surface.sql"),
      "utf8",
    );
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS surface text NOT NULL DEFAULT 'erp'/);
    expect(mig).toMatch(/CHECK \(surface IN \('erp', 'public'\)\)/);
    // Every host registered before this migration is a workspace host. A default
    // of anything else would move existing tenants' entry points on deploy.
    expect(mig).toMatch(/DEFAULT 'erp'/);
  });

  test("resolveByHost carries the surface, resolveBySlug deliberately does not", () => {
    const reg = fs.readFileSync(
      path.join(repo, "src/services/tenant/registry.service.js"),
      "utf8",
    );
    const byHost = reg.slice(reg.indexOf("async function resolveByHost"), reg.indexOf("function invalidateHost"));
    const bySlug = reg.slice(reg.indexOf("async function resolveBySlug"));
    expect(byHost).toMatch(/s\.surface/);
    // Keyed on the tenant, not a host — there is no subdomain row to read one
    // from, and guessing 'erp' would make "we do not know" unsayable.
    expect(bySlug.slice(0, bySlug.indexOf("]"))).not.toMatch(/s\.surface/);
  });

  test("the ERP is not served on a host whose surface is public", () => {
    // The regression this guards: the client block used to be gated on the
    // console host alone, so ANY other host — a tenant's own domain included —
    // got `app.get("*")` and the staff PWA, which made `theirdomain.com/login` a
    // working staff sign-in. Both the static handler and the catch-all skip it.
    const client = serverSrc.slice(serverSrc.indexOf("const clientDist"));
    expect(client).toMatch(/hostSurface === "public"/);
    const guards = client.match(/notThisApp\(req\)/g) || [];
    expect(guards.length).toBeGreaterThanOrEqual(2);
  });

  test("a failed surface lookup falls back to the workspace, not to 502", () => {
    // Failing closed would take a tenant's workspace offline because a registry
    // row could not be read — worse than showing the workspace on a marketing
    // domain during an outage in which nothing else works either.
    const block = serverSrc.slice(serverSrc.indexOf("host surface lookup failed") - 400);
    expect(block).toMatch(/req\.hostSurface = "erp"/);
  });

  test("the prefix mount and the dedicated host are independent", () => {
    // A deployment may run either, both or neither. Requiring SERVE_PUBLIC_WEB in
    // order to serve a tenant's own domain would make "give this client a domain"
    // also mean "change what every workspace subdomain serves".
    expect(serverSrc).toMatch(/if \(config\.SERVE_PUBLIC_WEB\) \{/);
    expect(serverSrc).toMatch(/if \(!isPublicSurface\(req\)\) return next\(\);/);
  });


  /* ── the configurable prefix (migration 0104) ─────────────────────────── */

  test("the marketing prefix moves; /portal never does", () => {
    const site = mountMatcher("/site");
    expect(site.test("/site")).toBe(true);
    expect(site.test("/site/track")).toBe(true);
    // Invitation and set-password emails already in circulation point at
    // /portal with a seven-day expiry. It is not settable anywhere.
    expect(site.test("/portal/login")).toBe(true);
    expect(paths.RESERVED_BASES.has("portal")).toBe(true);
  });

  test("the original prefix is claimed whatever the base is", () => {
    // A tenant who renames to /site must not strand every URL already printed,
    // emailed or indexed under /public; the app redirects it to the new base.
    for (const base of ["/site", "/public", "/marketing"]) {
      expect(mountMatcher(base).test("/public/proposals/tok")).toBe(true);
    }
  });

  test("a prefix the workspace already answers is refused", () => {
    for (const bad of ["settings", "login", "operations", "vault", "api", "portal"]) {
      expect(paths.baseProblem(bad)).toMatch(/already used by the workspace/);
    }
    for (const ok of ["site", "public", "marketing", "web2"]) {
      expect(paths.baseProblem(ok)).toBeNull();
    }
  });

  test("a prefix that could not be a path segment is refused", () => {
    for (const bad of ["a b", "/", "Site/Two", "-lead", "x".repeat(40)]) {
      expect(paths.baseProblem(bad)).toBeTruthy();
    }
  });

  test("absent means the default, not invalid", () => {
    // A row written before 0104 reads as null, and the column's own default is
    // /public — so "nothing here" has to mean the original prefix rather than a
    // validation failure, or every pre-existing host would fail its own check.
    expect(paths.normaliseBase(null)).toBe("/public");
    expect(paths.normaliseBase(undefined)).toBe("/public");
    expect(paths.normaliseBase("")).toBe("/public");
    expect(paths.baseProblem("")).toBeNull();
    // The console still requires a value: `domainBase` in platform.validator.js
    // is `z.string().min(1)`, so an empty field never reaches the service.
  });

  test("bases normalise to one leading slash, lowercase", () => {
    expect(paths.normaliseBase("Site")).toBe("/site");
    expect(paths.normaliseBase("/site/")).toBe("/site");
    expect(paths.normaliseBase("//site")).toBe("/site");
    expect(paths.normaliseBase(null)).toBe("/public");
  });

  test("the column exists, defaults to /public, and is shape-checked", () => {
    const mig = fs.readFileSync(
      path.join(repo, "migrations/platform/0104_subdomain_public_base.sql"),
      "utf8",
    );
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS public_base text NOT NULL DEFAULT '\/public'/);
    expect(mig).toMatch(/CHECK \(public_base ~ /);
  });

  test("the server builds the matcher per request, not once", () => {
    expect(serverSrc).toMatch(/publicWebPaths\.matcherFor\(req\.publicBase\)/);
    expect(serverSrc).not.toMatch(/const PUBLIC_WEB_PATH\s*=/);
  });

  test("prefix matching is on a path segment, not a string prefix", () => {
    // `/publicity` is not `/public`, and a tenant route that merely starts with
    // the same letters must not be swallowed.
    for (const p of ["/publicity", "/portalsomething", "/trackers", "/careersx"]) {
      expect({ p, claimed: claims.test(p) }).toEqual({ p, claimed: false });
    }
  });
});
