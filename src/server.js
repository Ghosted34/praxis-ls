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
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { config } = require("./config/env");
const { logger } = require("./config/logger");
const { initRedis } = require("./config/redis");
const routes = require("./routes");
const { router: pwaRouter } = require("./routes/pwa");
const { requestIdMiddleware } = require("./middleware/request-id");
const { isPublicMediaPath } = require("./shared/http/media-guard");
const storage = require("./services/storage.service");

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
function buildCorsOptions() {
  const base = config.APP_BASE_DOMAIN.toLowerCase();
  const extra = new Set(
    config.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  );
  const isDev = config.NODE_ENV !== "production";
  return {
    credentials: true,
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      let host;
      try {
        host = new URL(origin).hostname.toLowerCase();
      } catch {
        return cb(new Error("Bad origin"), false);
      }
      const onBaseDomain = host === base || host.endsWith("." + base);
      const devLocalhost = isDev && (host === "localhost" || host === "127.0.0.1");
      if (onBaseDomain || devLocalhost || extra.has(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"), false);
    },
  };
}

function buildApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  // Helmet with the default CSP relaxed on exactly two knobs. The Control Tower
  // renders the Lovable mock in an <iframe srcDoc> whose document INHERITS this
  // page's CSP: its live-data bridge is an inline <script> (needs
  // script-src 'unsafe-inline') and the mock's controls are inline onclick=
  // attributes (needs script-src-attr — helmet defaults it to 'none').
  // img-src additionally allows https:/blob:/data: because tenant-authored
  // branding (login hero, logos) may point at external URLs.
  // Tightening path (tracked): serve the mock from its own route with a
  // per-route CSP, or migrate its handlers to addEventListener — then restore
  // the defaults here.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          "script-src": ["'self'", "'unsafe-inline'"],
          "script-src-attr": ["'unsafe-inline'"],
          "img-src": ["'self'", "data:", "blob:", "https:"],
        },
      },
    }),
  );
  app.use(cors(buildCorsOptions()));
  app.use(requestIdMiddleware);
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

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
          logger.warn({ err: err.message, key }, "media presign failed");
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

  // Single-origin: when client/dist exists, serve the built PWA alongside /api.
  // Skipped on the admin console host so the tenant app never renders there.
  const clientDist = path.resolve(__dirname, "../client/dist");
  if (fs.existsSync(path.join(clientDist, "index.html"))) {
    const clientStatic = express.static(clientDist, { index: false, maxAge: "1h" });
    app.use((req, res, next) => (onConsoleHost(req) ? next() : clientStatic(req, res, next)));
    app.get("*", (req, res, next) => {
      if (onConsoleHost(req)) return next();
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
  });
  process.on("uncaughtException", (err) => {
    logger.error({ err }, "uncaughtException (kept alive)");
  });
}

function start() {
  installProcessGuards();
  const app = buildApp();
  initRedis().catch((err) => logger.warn({ err: err.message }, "redis unavailable at boot — continuing without it"));
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

module.exports = { buildApp, start };
