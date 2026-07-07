/**
 * HTTP entrypoint. Lean Express app serving the platform (company dashboard) API
 * and the subdomain-resolved tenant API. Redis/Socket.IO/worker wiring is added
 * as those land.
 */
"use strict";

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { config } = require("./config/env");
const { logger } = require("./config/logger");
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
