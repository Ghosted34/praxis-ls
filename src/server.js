/**
 * HTTP entrypoint. Lean Express app serving the platform (company dashboard) API
 * and the subdomain-resolved tenant API. Redis/Socket.IO/worker wiring is added
 * as those land.
 */
"use strict";

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { config } = require("./config/env");
const { logger } = require("./config/logger");
const { initRedis } = require("./config/redis");
const routes = require("./routes");
const { AppError } = require("./utils/errors");

function buildApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use("/api", routes);

  // Stored files (STORAGE_DRIVER=local) are served here at /media/<key> — the
  // public URL scheme storage.service.js's publicUrl() builds. Only mounted for
  // the local driver (s3 serves from the bucket/CDN). In dev the Vite server
  // proxies /media here too (client/vite.config.ts). NOTE: this is a flat static
  // mount — fine for public assets like tenant logos (keys are tenant-namespaced
  // by callers); sensitive documents will need an auth-gated download route
  // instead, not this.
  if (config.STORAGE_DRIVER === "local") {
    app.use("/media", express.static(path.resolve(config.STORAGE_LOCAL_PATH), { maxAge: "1h" }));
  }

  // Single-origin model (tech-lead decision): when the frontend has been built
  // (`npm --prefix client run build` → client/dist), this same Express process
  // serves the PWA alongside /api — so the tenant subdomain serves both, the
  // PWA is same-origin with its API (installable/offline, no CORS), and there's
  // one thing to deploy. In dev you instead run the Vite dev server, which
  // proxies /api back here (see client/vite.config.ts) — client/dist won't
  // exist, so this block stays inert. Any unknown /api/* still falls through to
  // the JSON 404 below; every other path returns index.html for client routing.
  const clientDist = path.resolve(__dirname, "../client/dist");
  if (fs.existsSync(path.join(clientDist, "index.html"))) {
    app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/media")) return next();
      res.sendFile(path.join(clientDist, "index.html"));
    });
    logger.info({ clientDist }, "serving built SPA (single-origin)");
  }

  app.use((req, res) =>
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: `No route for ${req.method} ${req.path}`,
      },
    }),
  );

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err instanceof AppError ? err.status : err.status || 500;
    if (status >= 500) logger.error({ err }, "unhandled error");
    res.status(status).json({
      error: {
        code: err.code || "INTERNAL",
        message: err.message || "Internal error",
        details: err.details || undefined,
      },
    });
  });

  return app;
}

function start() {
  const app = buildApp();
  // Best-effort — identity-cache/session-store already tolerate a missing
  // Redis client (see shared/cache/identity-cache.js's safeRedis()), so a
  // Redis outage at boot degrades caching/session-kill rather than crashing
  // the API. initRedis() was never called anywhere before this; getClient()
  // would throw "redis not initialised" on every lookup until now.
  initRedis().catch((err) => logger.warn({ err: err.message }, "redis unavailable at boot — continuing without it"));
  const server = app.listen(config.PORT, () =>
    logger.info({ port: config.PORT, env: config.NODE_ENV }, "praxis-ls api listening"),
  );
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
