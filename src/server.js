/**
 * HTTP entrypoint. Lean Express app serving the platform (company dashboard) API
 * and the subdomain-resolved tenant API.
 */
"use strict";

// MUST be first: makes Express 4 route async rejections to the error handler
// instead of crashing the process. See shared/http/async-safe.js and
// doc/PHASE0_PRODUCTION_AUDIT.md.
require("./shared/http/async-safe");

const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { config } = require("./config/env");
const { logger } = require("./config/logger");
const { initRedis } = require("./config/redis");
const routes = require("./routes");
const { apiVersionHeaders, CURRENT: API_VERSION } = require("./middleware/api-version");
const { router: pwaRouter } = require("./routes/pwa");
const { requestIdMiddleware } = require("./middleware/request-id");
const { buildAccessLog } = require("./middleware/access-log");
const { report } = require("./shared/observability/error-reporter");
const { router: clientErrorsRouter } = require("./routes/client-errors");
const { router: metricsRouter } = require("./routes/metrics");
const { initRateLimitStore, apiLimiter } = require("./shared/http/rate-limit");
const { isPublicMediaPath } = require("./shared/http/media-guard");
const storage = require("./services/storage.service");
const registry = require("./services/tenant/registry.service");
const publicHead = require("./shared/http/public-head");
const publicWebPaths = require("./shared/http/public-web-paths");
const inlineScriptHashes = require("./shared/http/inline-script-hashes");

/**
 * Lifetime of a presigned /media URL (s3 driver). Short on purpose: these are
 * public-by-policy assets (logo, login background, avatars), so the signature is
 * a delivery mechanism, not the access control — the allow-list is. Five minutes
 * is long enough for a page load and short enough that a copied URL is useless.
 */
const MEDIA_SIGNED_TTL_SECONDS = 300;
const { errorHandler, notFoundHandler } = require("./middleware/error-handler");

/**
 * CORS origin allowlist. Single-origin is the production model (Express serves
 * the SPA), so cross-origin is mostly the Vite dev host. We reflect any origin
 * on the tenant/platform base domain (*.APP_BASE_DOMAIN + the apex) plus any
 * exact origins in CORS_ORIGINS, and — only in development — localhost on any
 * port. A wildcard cors() on a credentialed multi-tenant auth API was the prior
 * state (see doc/PHASE0_PRODUCTION_AUDIT.md).
 */
/**
 * A rejected origin is a CLIENT error, and has to say so.
 *
 * These were bare `new Error("Not allowed by CORS")` with no status, so the
 * error handler fell through to its 500 branch: the caller got
 * `500 INTERNAL_ERROR`, the line logged at error, and — since OBS-E1 wired the
 * sink in — every one was persisted to platform.error_event and posted to the
 * alert channel.
 *
 * It reached 27 occurrences in a day against `POST /api/graphql`, an endpoint
 * this product does not have. That is a scanner walking the host, i.e. the
 * allowlist WORKING, filed as if the server were broken. Exactly the failure
 * API F-1 fixed for the other eighteen sites: "a brand-new alert channel whose
 * first week is full of 'ticket not found' gets muted, and then it is
 * decoration."
 *
 * 403 with `expose:false` — the handler's 4xx branch logs at warn and does not
 * report, and the origin is not echoed back to whoever probed. The access log
 * still records every one, which is where a spike in blocked origins belongs.
 */
function rejected(message) {
  const err = new Error(message);
  err.status = 403;
  err.code = "ORIGIN_NOT_ALLOWED";
  err.expose = false;
  return err;
}

function buildCorsOptions() {
  const base = config.APP_BASE_DOMAIN.toLowerCase();
  const extra = new Set(
    config.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  );
  const isDev = config.NODE_ENV !== "production";
  return {
    credentials: true,
    // Paged list endpoints report the true match count in X-Total-Count (see
    // shared/http/paged.js). A custom response header is NOT readable by
    // browser JS cross-origin unless it is advertised here — without this the
    // client reads null and silently falls back to "one page", which is the
    // very bug the header exists to fix.
    //
    // X-Request-Id for the same reason, one surface further out: middleware/
    // request-id.js stamps every response with it, and public-web prints it in
    // the error state so a visitor who reports "the tracking page failed" hands
    // over the one string that finds their request in the logs. A tenant on a
    // custom domain calling the API on another origin would otherwise read null
    // and show an error with nothing to quote.
    exposedHeaders: ["X-Total-Count", "X-Request-Id"],
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      let host;
      try {
        host = new URL(origin).hostname.toLowerCase();
      } catch {
        return cb(rejected("Bad origin"), false);
      }
      const onBaseDomain = host === base || host.endsWith("." + base);
      const devLocalhost = isDev && (host === "localhost" || host === "127.0.0.1");
      if (onBaseDomain || devLocalhost || extra.has(origin)) return cb(null, true);
      // A tenant's own domain is DATA, not configuration.
      //
      // `platform.subdomain.surface = 'public'` is what makes a host serve the
      // marketing site, and it is set in the platform console — no deploy, no
      // restart. This allowlist was reading APP_BASE_DOMAIN and CORS_ORIGINS
      // only, so a domain registered that way resolved, served its shell, and
      // then 403'd every asset: Vite tags the module script and the stylesheet
      // `crossorigin`, so both send an Origin, and both were refused. The page
      // loaded and the app never started — the same failure mode as the
      // /public-assets prefix, one layer up.
      //
      // That is the mistake the mount comment already names: an env var copied
      // where a per-tenant fact belongs. So ask the registry the question the
      // request path asks, and let registration be the whole of registration.
      //
      // Unknown origins are attacker-controlled input reaching a lookup, which
      // is why resolveByHost caches MISSES too (HOST_MISS_TTL_MS) under an LRU
      // bounded by HOST_CACHE_MAX — see the note on that cache. The cheap checks
      // above still answer every first-party request without touching it.
      return registry
        .resolveByHost(host)
        .then((meta) =>
          meta && meta.surface === "public"
            ? cb(null, true)
            : cb(rejected("Not allowed by CORS"), false),
        )
        .catch(() => cb(rejected("Not allowed by CORS"), false));
    },
  };
}

function buildApp() {
  const app = express();
  app.disable("x-powered-by");
  // SEC-H5 (2026-08-04): was `true`, i.e. "trust the entire X-Forwarded-For
  // chain". The left of that chain is written by the client, so req.ip — and
  // therefore every IP-keyed rate limiter and every audit row's `ip` — was
  // attacker-controlled. A hop count makes Express take the address the proxy we
  // actually run appended. See TRUST_PROXY_HOPS in config/env.js.
  app.set("trust proxy", config.TRUST_PROXY_HOPS > 0 ? config.TRUST_PROXY_HOPS : false);
  /**
   * SEC-M8 — `unsafe-inline` is GONE. The reason for it no longer exists.
   *
   * `script-src` was relaxed to `'self' 'unsafe-inline'` and `script-src-attr`
   * to `'unsafe-inline'` APPLICATION-WIDE, to support one feature: the Control
   * Tower rendered the Lovable mock in an `<iframe srcDoc>` that inherited this
   * page's CSP, with an inline `<script>` bridge and inline `onclick=`
   * handlers. The cost was that the primary XSS mitigation was switched off for
   * every page including login — and because the refresh token lives in web
   * storage (SEC-L3), a single XSS bought thirty days of account access.
   *
   * PHASE 3 / AUDIT F1 DELETED THAT IFRAME. The Control Tower is real React
   * now; the `onclick=` handlers survive only in comments describing what the
   * mock used to do. So the relaxation had already stopped protecting anything
   * and was purely a liability nobody had gone back to remove — which is worth
   * noticing as a pattern: a documented, deliberate exception outlived its
   * reason silently, because nothing ties an exception to the thing that
   * justified it.
   *
   * VERIFIED BEFORE REMOVING, since this fails closed and loudly if wrong:
   *   - `client/index.html` and `platform-console/index.html` carry exactly one
   *     script each, `<script type="module" src="/src/main.tsx">` — external,
   *     satisfied by `'self'`.
   *   - `vite-plugin-pwa` is configured `injectRegister: false`, so the build
   *     injects no inline registration script; the built `dist/index.html` has
   *     one `<script>` tag.
   *   - The two remaining `srcDoc` iframes (document preview, template preview)
   *     use `sandbox=""` and `sandbox="allow-same-origin"`. Neither grants
   *     `allow-scripts`, so scripts cannot run in them at all and they need no
   *     script-src.
   *
   * `img-src` STAYS relaxed: tenant-authored branding (login hero, logos)
   * legitimately points at external https URLs, and `blob:`/`data:` are used by
   * generated previews. That is a real requirement, not a leftover.
   */
  /**
   * public-web ships ONE inline script — the no-flash theme block in its shell,
   * which must write `data-theme` before first paint or a dark-OS visitor gets a
   * frame of light tokens. `'self'` does not cover an inline block, so without
   * this the browser refuses it and the site renders unstyled on the tenant's
   * own domain. The allowance is a HASH OF THE BUILT FILE, not `'unsafe-inline'`
   * and not a literal pasted from a console: the mitigation stays on for every
   * other page, and editing the theme block moves the hash with it instead of
   * failing silently in production. See shared/http/inline-script-hashes.js.
   */
  const cspDefaults = helmet.contentSecurityPolicy.getDefaultDirectives();
  const publicWebShellHashes = inlineScriptHashes.hashesForFile(
    path.resolve(__dirname, "../public-web/dist/index.html"),
  );
  const scriptSrc = [
    ...(cspDefaults["script-src"] || ["'self'"]),
    ...publicWebShellHashes,
  ];
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...cspDefaults,
          "img-src": ["'self'", "data:", "blob:", "https:"],
          "script-src": scriptSrc,
        },
      },
    }),
  );
  /**
   * PERF S7. `compression` has been a declared dependency all along and was
   * mounted nowhere, and no proxy-level compression is documented either.
   *
   * Measured on a representative list response: 18,020 -> 2,381 bytes, an 86.8%
   * reduction. It applies to every JSON response AND to the 1,318 KB of static
   * SPA assets served by express.static below.
   *
   * Mounted BEFORE the routes and the static handlers so it sees every
   * response, and before the access log records a status — compression does not
   * change the status, so the ordering is only about coverage.
   *
   * `filter` honours the standard `x-no-compression` opt-out and otherwise
   * defers to the library's own content-type judgement, which already declines
   * to waste CPU on already-compressed bytes (images, PDFs, zips).
   *
   * A note for whoever adds Server-Sent Events later: buffering breaks event
   * streams, and the opt-out header is how such a route excludes itself.
   */
  app.use(
    compression({
      filter: (req, res) => {
        if (req.headers["x-no-compression"]) return false;
        return compression.filter(req, res);
      },
    }),
  );

  app.use(cors(buildCorsOptions()));
  app.use(requestIdMiddleware);
  // OBS-L1/L3/T2: the HTTP access log. pino-http was a declared dependency
  // mounted nowhere, so there was no record of who called what, with what
  // status, or how long it took — and no log line anywhere carried a tenant.
  // Mounted after requestIdMiddleware so every line shares that correlation id.
  app.use(buildAccessLog());
  /**
   * The `verify` callback stashes the UNTOUCHED bytes before body-parser
   * parses them. Some routes need the raw text rather than the object:
   * provider webhooks verify a signature over the delivered bytes, and a
   * parser that normalises key order or encodings first would change what
   * the signature covers — so the raw form must be captured HERE, where the
   * global parser runs, because a route-level `express.text` behind it never
   * runs: body-parser sets `req._body` once it has parsed, and every
   * downstream body parser bails on that flag. (The QES webhook audit found
   * exactly this: every genuine delivery was rejected 401 because the route
   * only ever saw a parsed object.) `req.rawBody` is read by
   * qes_public.controller and is null for non-JSON bodies.
   */
  /**
   * ONE route gets a bigger body, and only this one.
   *
   * A job applicant's CV is base64-encoded into the JSON body
   * (`careers-api.ts` → `fileToDataUrl`), and base64 inflates by a third — so
   * the 8 MB the form advertises, and which `careers.service.CV_MAX_BYTES`
   * enforces, is about 10.7 MB on the wire. Against the 2 MB global limit below
   * that meant anything over roughly 1.4 MB was refused with a 413 AFTER the
   * applicant had waited through the whole upload, which is most phone-scanned
   * CVs. The form promised 8 MB and the server had never been able to take it.
   *
   * Mounted BEFORE the global parser rather than after, because body-parser sets
   * `req._body` once it has parsed and every downstream parser bails on that
   * flag — a larger parser registered later would never run. Raising the global
   * limit instead would hand 12 MB bodies to all ~600 routes to fix one; this
   * gives it to the single public path that needs it.
   */
  const CV_APPLY_PATH = /^\/api\/(v\d+\/)?tenant\/careers\/[^/]+\/apply\/?$/;
  app.use(
    CV_APPLY_PATH,
    express.json({ limit: "12mb", verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); } }),
  );

  app.use(express.json({ limit: "2mb", verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); } }));
  app.use(express.urlencoded({ extended: true }));

  // OBS-E2: browser crash reports. Mounted before the tenant router so it needs
  // no Host resolution and no token — the crashes worth catching happen at
  // login, during boot, or after a session expires.
  app.use("/api", clientErrorsRouter);

  // OBS-M1: Prometheus scrape target. Mounted alongside health — no tenant
  // resolution, no token, same reasoning as the probes.
  app.use("/api", metricsRouter);

  /**
   * API F-18. `/api/v1/...` and `/api/...` serve the SAME router: unversioned
   * is an alias for the current version, not a second contract. See
   * middleware/api-version.js for why there is deliberately one implementation.
   *
   * The version middleware runs on both so every response carries
   * X-API-Version, and the unversioned path additionally carries the
   * deprecation notice and increments a counter — which is what will make
   * retiring it a decision based on traffic rather than on nerve.
   */
  app.use("/api", apiVersionHeaders);

  /**
   * PERF S18 — one global ceiling across the whole API.
   *
   * Mounted HERE, after the health, metrics and client-error routes above and
   * before the tenant router, which is the only placement that works: the
   * probes must never be rate-limited (a limiter that 429s
   * `/api/health/ready` turns a busy minute into a failed deploy and a
   * restarting container), and everything below this line shares the one
   * Postgres, the one Redis and the one host.
   *
   * Keyed per tenant — see the note in shared/http/rate-limit.js for why IP
   * alone is wrong in both directions on a multi-tenant deployment.
   */
  app.use("/api", apiLimiter);

  app.use(`/api/${API_VERSION}`, routes);
  app.use("/api", routes);

  // Per-tenant PWA: dynamic /manifest.webmanifest + /icons/app-icon-*.png, both
  // Host-resolved from branding. Mounted before the SPA catch-all so these exact
  // paths aren't swallowed by index.html fallback. See src/routes/pwa.js.
  app.use(pwaRouter);

  // Stored files are served at /media/<key>, under either storage driver.
  //
  // ALLOW-LISTED (2026-08-01). This used to be a flat static mount over the whole
  // storage root — but that root also holds `tenant_<slug>/vault/…`, so the
  // gated download route (GET /documents/:id/download, requirePermission) could
  // be bypassed by anyone who knew a vault key. Only the public prefixes are
  // served here now; everything else 404s and must go through its module.
  // Public assets stay unauthenticated on purpose: the logo and login background
  // have to render before the user has a token.
  //
  // S3 (2026-08-02): mounted under BOTH drivers now. The allow-list is the same;
  // only the delivery differs — a permitted key is answered with a 302 to a
  // short-TTL presigned URL rather than a file off disk. So the bucket needs no
  // public-read: the app is the only way in, under either driver, and the rule
  // lives in code instead of a bucket policy that has to be re-applied per
  // environment. Private artefacts continue to go through their module's gated
  // route (`GET /documents/:id/download` streams via storage.get, which was
  // already correct for s3 — the hole was in URL minting, see storage.service).
  {
    const mediaStatic =
      config.STORAGE_DRIVER === "local"
        ? express.static(path.resolve(config.STORAGE_LOCAL_PATH), {
            maxAge: "1h",
            index: false,
            dotfiles: "deny",
            // Don't fall through to the SPA catch-all on a miss — a missing image
            // should be a 404, not an HTML page with a 200.
            fallthrough: false,
          })
        : null;

    app.use("/media", (req, res, next) => {
      if (!isPublicMediaPath(req.path)) {
        // Deliberately 404, not 403: a probe shouldn't be able to tell a
        // protected key from a nonexistent one.
        return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
      }
      if (mediaStatic) return mediaStatic(req, res, next);

      // s3: hand back a presigned URL for the ALLOW-LISTED key only. Redirecting
      // rather than proxying keeps image bytes off the Node process. The TTL is
      // short because these are embedded in pages that reload often; the browser
      // cache header is deliberately shorter than the signature's lifetime so a
      // cached page never holds a URL that has already expired.
      const key = decodeURIComponent(req.path).replace(/^\/+/, "");
      return storage
        .signedUrl(key, MEDIA_SIGNED_TTL_SECONDS)
        .then((url) => {
          res.set("Cache-Control", `private, max-age=${Math.floor(MEDIA_SIGNED_TTL_SECONDS / 2)}`);
          res.redirect(302, url);
        })
        .catch((err) => {
          logger.warn({ err, key }, "media presign failed");
          res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
        });
    });
  }

  // Praxis-side Platform Console — a standalone React/Vite app that only ever
  // calls /api/platform (NOT tenant-scoped). Served at the ROOT of the dedicated
  // admin host (config.PLATFORM_CONSOLE_HOST, e.g. admin.praxisls.com) and NEVER
  // on a tenant host — so `tenant.example.com/console` can't reach it. Requires
  // nginx to pass the Host header through (it already does; see DEPLOYMENT.md).
  const consoleHost = (config.PLATFORM_CONSOLE_HOST || "").toLowerCase();
  const consoleDir = path.resolve(__dirname, "../platform-console/dist");
  const hasConsole = consoleHost && fs.existsSync(path.join(consoleDir, "index.html"));
  const onConsoleHost = (req) => consoleHost && String(req.hostname || "").toLowerCase() === consoleHost;
  if (hasConsole) {
    const consoleStatic = express.static(consoleDir, { index: false, maxAge: "1h" });
    app.use((req, res, next) => {
      if (!onConsoleHost(req)) return next();                 // tenant host → not here
      if (req.path.startsWith("/api") || req.path.startsWith("/media")) return next();
      consoleStatic(req, res, () => res.sendFile(path.join(consoleDir, "index.html")));
    });
    logger.info({ consoleHost }, "serving platform console at admin host root");
  }

  // The public web app — marketing site (/public/*) and external portal
  // (/portal/*). Same tenant origin as the ERP, and deliberately so: a client who
  // is emailed a tracking link must not be sent to a second domain whose cookies,
  // CSP and tenant Host resolution the ERP knows nothing about.
  //
  // It is mounted BEFORE the client block below, which is the part that matters:
  // `client/dist` answers `app.get("*")`, so anything registered after it is
  // unreachable for page requests. Three rules follow from that, and all three are
  // enforced in tests/unit/public-web-mount.test.js:
  //
  //   · Only this app's own prefixes and the legacy paths it replaces are claimed
  //     — everything else, including /login and /reset-password, still goes to the
  //     ERP. The portal's sign-in lives at /portal/login; the staff sign-in stays
  //     where every bookmark in the company points.
  //   · /api and /media are never handled here, so a mistyped deep link under
  //     /public returns the API's 404 JSON rather than an HTML body an SDK will
  //     try to parse.
  //   · /public-assets is claimed too, because it is where this app's build puts
  //     its JS, CSS and fonts (public-web/vite.config.ts sets `build.assetsDir`
  //     to exactly that name). Unclaimed, those requests fall through to
  //     client/dist and then to the ERP's catch-all, which answers index.html
  //     with 200 text/html — so the shell loads and the app never starts. The
  //     name is deliberately NOT /assets: that one belongs to the ERP's build,
  //     and claiming it here would break the ERP instead.
  //   · the MARKETING prefix is a per-host setting now
  //     (`platform.subdomain.public_base`, edited in the platform console), so the
  //     matcher is built per request from the resolved value rather than being a
  //     constant. `/portal` never moves — invitation emails point at it with a
  //     seven-day expiry. shared/http/public-web-paths.js is the single
  //     definition; this mount and its test both read it, so they cannot drift.
  //
  // `index: false` on the static handler keeps /public resolving to the SPA
  // route rather than to a dist/index.html the browser would otherwise fetch
  // directly, and the fallback sendFile is what makes a forwarded
  // /public/proposals/<token> load at all — a 404 on a deep link is a broken
  // sales document, not a missing page.
  const publicWebDir = path.resolve(__dirname, "../public-web/dist");
  //
  // TWO MOUNTS, and which one answers is a fact about the HOST, read from the
  // tenant registry rather than from configuration:
  //
  //   · a host whose `platform.subdomain.surface` is 'public' — the tenant's own
  //     domain — serves this app at its ROOT, and the ERP not at all. A freight
  //     forwarder does not print `smartls.praxisls.com/public` on an invoice,
  //     and the staff sign-in has no business answering on a domain their
  //     clients visit.
  //   · every other host is a workspace host, and SERVE_PUBLIC_WEB decides
  //     whether it also answers the /public and /portal prefixes. That is what
  //     every tenant gets on day one, at no infrastructure cost: the host
  //     already resolves and the wildcard certificate already covers it.
  //
  // The first version of this was an env var, PUBLIC_WEB_HOST, copied from
  // PLATFORM_CONSOLE_HOST. The copy was the bug. There is one console for the
  // whole platform, so one value fits it; there is one public site PER TENANT,
  // so one value names exactly one tenant's domain and every other tenant's
  // falls through to the staff app. See migrations/platform/0103.
  const hasPublicWeb = fs.existsSync(path.join(publicWebDir, "index.html"));

  if (hasPublicWeb) {
    const publicWebStatic = express.static(publicWebDir, { index: false, maxAge: "1h" });
    // A navigation gets a head that describes the page — title, description,
    // canonical and Open Graph — so a forwarded link renders as a card rather
    // than a blank grey rectangle, and a crawler that does not run JavaScript
    // reads something. See shared/http/public-head.js; it falls back to this
    // file, unmodified, on any failure.
    const sendHtml = publicHead.makeHtmlSender(publicWebDir);
    const sendShell = (req, res) => res.sendFile(path.join(publicWebDir, "index.html"));
    const serveApp = (req, res) =>
      publicWebStatic(req, res, () => sendHtml(req, res, () => sendShell(req, res)));
    const isPublicSurface = (req) => req.hostSurface === "public";

    // The canonical prefix for THIS request's host, for robots/sitemap below.
    // "/" on a host the site owns, the configured prefix on a workspace host —
    // see the surface middleware immediately below, which is what decides.
    const baseOf = (req) => req.publicBase || publicWebPaths.DEFAULT_BASE;

    /**
     * robots.txt and sitemap.xml, per host.
     *
     * Ahead of the mounts, because on a WORKSPACE host neither prefix claims
     * `/robots.txt` — and a workspace host is precisely the one that needs to say
     * "do not index me". Serving nothing there means a crawler decides for itself.
     */
    app.get("/robots.txt", (req, res) => {
      const origin = `${req.protocol}://${req.headers.host}`;
      res
        .type("text/plain")
        .set("Cache-Control", "public, max-age=3600")
        .send(
          publicHead.robots(
            origin,
            isPublicSurface(req) || config.SERVE_PUBLIC_WEB,
            baseOf(req),
          ),
        );
    });

    app.get("/sitemap.xml", async (req, res, next) => {
      if (!isPublicSurface(req) && !config.SERVE_PUBLIC_WEB) return next();
      const host = String(req.headers.host || "").toLowerCase().split(":")[0];
      const origin = `${req.protocol}://${req.headers.host}`;
      try {
        const xml = await publicHead.sitemap(host, origin, baseOf(req));
        res.type("application/xml").set("Cache-Control", "public, max-age=3600").send(xml);
      } catch (err) {
        // A sitemap that 500s is worse than one that is briefly absent: a crawler
        // retries a 404 and gives up on repeated errors.
        logger.warn({ err, host }, "sitemap failed");
        next();
      }
    });

    /**
     * Resolve the host's surface once, before either mount reads it.
     *
     * The host string is derived exactly as `hostTenantResolver` derives it —
     * raw `Host`, lowercased, port stripped — and deliberately not via
     * `req.hostname`, which prefers `X-Forwarded-Host` under `trust proxy`. If
     * the two disagreed, the app a visitor is served and the tenant its data
     * comes from could be decided by different strings, which is a bug nobody
     * would find twice.
     *
     * `resolveByHost` is cached per host (60s hit, 10s miss), so this costs a
     * Map lookup on all but the first request — which matters, because every
     * asset on every page passes through here.
     *
     * A failed lookup falls back to 'erp', i.e. exactly today's behaviour. The
     * alternative — failing closed — would take a tenant's workspace offline
     * because their registry row could not be read, which is worse than showing
     * the workspace on a marketing domain during an outage in which nothing else
     * works either.
     */
    app.use(async (req, res, next) => {
      if (onConsoleHost(req)) return next();
      if (req.path.startsWith("/api") || req.path.startsWith("/media")) return next();
      const host = String(req.headers.host || "").toLowerCase().split(":")[0];
      try {
        const meta = await registry.resolveByHost(host);
        req.hostSurface = meta && meta.surface === "public" ? "public" : "erp";
        // A host the site OWNS serves it at the root. `public_base` is the
        // prefix that keeps the marketing site out of the ERP's way on a shared
        // origin, and on a domain the client brought there is no ERP to avoid —
        // so honouring the column there would put a meaningless `/public` in
        // front of every URL that client prints. The column still applies the
        // moment the host is flipped back to serving the workspace.
        req.publicBase =
          req.hostSurface === "public"
            ? publicWebPaths.ROOT_BASE
            : publicWebPaths.normaliseBase(meta && meta.public_base) ||
              publicWebPaths.DEFAULT_BASE;
      } catch (err) {
        logger.warn({ err, host }, "host surface lookup failed — serving the workspace");
        req.hostSurface = "erp";
        req.publicBase = publicWebPaths.DEFAULT_BASE;
      }
      return next();
    });

    // (a) the tenant's own domain, at its root.
    app.use((req, res, next) => {
      if (!isPublicSurface(req)) return next();
      if (req.path.startsWith("/api") || req.path.startsWith("/media")) return next();
      return serveApp(req, res);
    });

    // (b) the path prefix, on workspace hosts.
    if (config.SERVE_PUBLIC_WEB) {
      app.use((req, res, next) => {
        if (isPublicSurface(req)) return next(); // (a) already answered it
        if (!publicWebPaths.matcherFor(req.publicBase).test(req.path)) return next();
        if (req.path.startsWith("/api") || req.path.startsWith("/media")) return next();
        return serveApp(req, res);
      });
      logger.info({ publicWebDir }, "serving public web at /public and /portal on workspace hosts");
    }
    logger.info("public web built; hosts with surface='public' serve it at their root");
  }

  // Single-origin: when client/dist exists, serve the built PWA alongside /api.
  // Skipped on the admin console host so the tenant app never renders there.
  const clientDist = path.resolve(__dirname, "../client/dist");
  if (fs.existsSync(path.join(clientDist, "index.html"))) {
    const clientStatic = express.static(clientDist, { index: false, maxAge: "1h" });
    // The surface check alongside the console check, and this is the whole point
    // of recording a surface: without it every host that is not the admin console
    // — a tenant's own domain included — is answered here with the staff PWA, and
    // `theirdomain.com/login` becomes a working staff sign-in against whatever
    // tenant that domain resolves to.
    const notThisApp = (req) => onConsoleHost(req) || req.hostSurface === "public";
    app.use((req, res, next) => (notThisApp(req) ? next() : clientStatic(req, res, next)));
    app.get("*", (req, res, next) => {
      if (notThisApp(req)) return next();
      if (req.path.startsWith("/api") || req.path.startsWith("/media")) return next();
      res.sendFile(path.join(clientDist, "index.html"));
    });
    logger.info({ clientDist }, "serving built SPA (single-origin)");
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

function installProcessGuards() {
  // Defense-in-depth: the async-safe shim routes handler rejections to Express,
  // but a stray rejection outside the request lifecycle must not silently kill
  // the process without a log line. A process manager still restarts on a real
  // fatal.
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "unhandledRejection (kept alive)");
    report(reason, { origin: "server", severity: "error", route: "unhandledRejection" });
  });

  // OBS-E4. This used to swallow uncaughtException and keep going, which is
  // the one case where staying up is worse than falling over: after an
  // uncaught throw the process's state is undefined — a half-finished
  // transaction, a released-twice pool client, a module mid-initialisation —
  // and it will keep accepting traffic and serving wrong answers rather than
  // failing where someone can see it.
  //
  // Exit non-zero and let the supervisor restart a clean process. That needs
  // `restart: unless-stopped` on the compose services (OBS-A4, see
  // doc/MONITORING_SETUP.md §3); without it this trades a poisoned process for
  // a dead one, which is still the better trade — a dead process fails the
  // readiness probe and pages someone, whereas a poisoned one does not.
  //
  // The flush delay exists because pino's transport is asynchronous: exiting
  // immediately loses the very log line explaining why.
  process.on("uncaughtException", (err) => {
    logger.error({ err }, "uncaughtException — exiting so the supervisor restarts a clean process");
    // Report BEFORE exiting, and give the send a moment. A crash is the single
    // most important thing to hear about, and it is the one case where the
    // process will not be around to retry.
    report(err, { origin: "server", severity: "fatal", route: "uncaughtException" });
    setTimeout(() => process.exit(1), 750).unref();
  });
}

/**
 * OBS-A1. There is no alerting in this system. The repo side is wired (see
 * doc/MONITORING_SETUP.md), but it needs a webhook or an address, and neither
 * can be committed. Say so loudly at boot rather than looking healthy: an
 * unconfigured alert channel and a working one are indistinguishable right up
 * until the night they aren't.
 */
async function warnIfUnmonitored() {
  // Env alone is no longer the answer: WS-ER1 moved the destination into the
  // platform settings vault, written from Platform Console → Integrations →
  // Alerts, with env as the fallback. Warning on the env vars alone would cry
  // wolf at every boot of a correctly-configured deployment — and a boot warning
  // people learn to ignore is worse than none, because it is the warning that
  // has to still work on the night it matters.
  // `destinationsFor` rather than `destinationFor`: an email destination is a
  // real destination now, and this check should count exactly what can deliver.
  //
  // INCIDENT 2026-08-12 — it used to count `config.ALERT_EMAIL` while nothing
  // anywhere sent email. Filling that variable in SILENCED this warning and
  // delivered nothing, which is the worst possible behaviour for the one check
  // whose job is to say "nobody will be told". The variable now works, so
  // counting it is honest; the fix was to make it true rather than to stop
  // asking.
  let vaultConfigured = false;
  try {
    const alerts = require("./services/platform/alert-routing.service");
    vaultConfigured = (await alerts.destinationsFor("page")).length > 0;
  } catch (err) {
    // The platform DB may not be reachable this early. Fall through to the env
    // check rather than failing boot over a warning.
    logger.debug({ err }, "could not read alert destination from the vault at boot");
  }

  if (!vaultConfigured && !config.ALERT_WEBHOOK_URL && !config.ALERT_EMAIL) {
    logger.warn(
      {},
      "NO ALERT DESTINATION CONFIGURED — set one in Platform Console → Integrations → Alerts " +
        "(or ALERT_WEBHOOK_URL / ALERT_EMAIL as a fallback). Nothing will notify anyone when " +
        "this process fails, a backup fails, or a restore drill fails. See doc/MONITORING_SETUP.md",
    );
  }
}

/**
 * INCIDENT 2026-08-12 — add up the connection pools and compare them against
 * what Postgres will actually accept.
 *
 * Every individual setting was defensible on the day tenant logins started
 * timing out; nobody had ever summed them. See src/config/connection-budget.js
 * for the arithmetic and why this warns rather than refuses by default.
 *
 * Deliberately awaited, unlike `warnIfUnmonitored`: under
 * DB_BUDGET_CHECK=enforce this is allowed to stop the boot, and a check that can
 * stop the boot must finish before the listener opens.
 */
async function checkConnectionBudget() {
  const budget = require("./config/connection-budget");
  const platformDb = require("./services/platform/db");
  await budget.check(platformDb);
}

function start() {
  installProcessGuards();
  // Not awaited: it reads the platform DB, and boot must not block on a warning.
  // A rejection here would be an unhandled rejection over a log line, so it is
  // caught and dropped — the check is best-effort by design.
  warnIfUnmonitored().catch(() => {});
  checkConnectionBudget().catch((err) => {
    if (err && err.code === "DB_BUDGET_EXCEEDED") {
      // Enforce mode. Exit rather than serve on a budget that cannot be met —
      // the alternative is the 12 August failure, where the process looked
      // healthy and only tenant requests failed.
      logger.fatal({ err }, "refusing to start: connection budget exceeded");
      process.exit(1);
    }
    logger.debug({ err }, "connection budget check could not run");
  });
  const app = buildApp();
  initRedis()
    // SEC-C3/H5: the auth limiters are Redis-backed so a limit of N means N
    // across the api + api-standby pair, not N per container. Wired after the
    // connection is up; falls back to an in-process store with a loud warning
    // if Redis is down (see shared/http/rate-limit.js).
    .then(() => initRateLimitStore())
    .catch((err) => {
      // OBS-A3 (Critical). This was ONE warn line. With Redis down the API
      // starts and reports healthy while sessions/refresh, remote session kill,
      // rate limiting, the identity/permission cache, socket.io pub-sub AND ALL
      // JOB ENQUEUEING are broken. Users see login failures and background work
      // that silently never happens.
      //
      // It stays non-fatal on purpose — refusing to boot would turn a degraded
      // cache into a total outage — but it is now an ERROR, it reports, and
      // /api/health/ready marks the process `degraded` so a monitor sees it.
      logger.error(
        { err },
        "REDIS UNAVAILABLE AT BOOT — sessions, rate limiting, the identity cache and ALL job enqueueing are degraded",
      );
      report(err, {
        origin: "server",
        severity: "fatal",
        route: "boot/redis",
        extra: {
          degraded: ["sessions", "rate_limiting", "identity_cache", "socketio_pubsub", "job_enqueueing"],
        },
      });
      initRateLimitStore();
    });
  // OBS-M2. The business-metric collector. Started after the app is built so a
  // collection can never race the module loader, and on a timer rather than per
  // scrape — a 15-second Prometheus poll across the fleet would be its own load
  // problem, and PERF S1 is about a connection budget.
  //
  // These are the metrics that catch a failure the process-level ones cannot:
  // up, returning 200, and silently doing nothing. The depreciation bug had
  // 100% uptime and a zero error rate; the only symptom was a number that
  // should have been rising and was flat.
  require("./shared/observability/business-metrics").start();

  // If workers are enabled in-process (e.g. ENABLE_WORKERS=true in dev or single-container mode), start the worker runtime.
  if (config.ENABLE_WORKERS) {
    const workers = require("./jobs/workers");
    workers.main().catch((err) => {
      logger.error({ err }, "in-process worker failed to start");
    });
  }

  const server = app.listen(config.PORT, () =>
    logger.info({ port: config.PORT, env: config.NODE_ENV }, "praxis-ls api listening"),
  );
  // Real-time layer (Smart Comms) attaches to the same HTTP server.
  require("./realtime").initSocket(server);
  const shutdown = (sig) => {
    logger.info({ sig }, "shutting down");
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  return server;
}

if (require.main === module) start();

module.exports = { buildApp, start, buildCorsOptions };
