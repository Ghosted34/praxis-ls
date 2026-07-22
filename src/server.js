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
  app.use(helmet());
  app.use(cors(buildCorsOptions()));
  app.use(requestIdMiddleware);
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use("/api", routes);

  // Per-tenant PWA: dynamic /manifest.webmanifest + /icons/app-icon-*.png, both
  // Host-resolved from branding. Mounted before the SPA catch-all so these exact
  // paths aren't swallowed by index.html fallback. See src/routes/pwa.js.
  app.use(pwaRouter);

  // Local storage driver serves stored files at /media/<key>. Flat static mount
  // — fine for public assets (tenant logos); sensitive documents need an
  // auth-gated download route instead (tracked for Phase 1).
  if (config.STORAGE_DRIVER === "local") {
    app.use("/media", express.static(path.resolve(config.STORAGE_LOCAL_PATH), { maxAge: "1h" }));
  }

  // Single-origin: when client/dist exists, serve the built PWA alongside /api.
  const clientDist = path.resolve(__dirname, "../client/dist");
  if (fs.existsSync(path.join(clientDist, "index.html"))) {
    app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
    app.get("*", (req, res, next) => {
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
