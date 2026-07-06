/**
 * Structured logging with Pino.
 *
 * Use logger.info({ key: 'value' }, 'message') — never string-format JSON.
 * Pretty-printed in dev, JSON in production.
 */

"use strict";

const pino = require("pino");

const isDev =
  process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

const baseConfig = {
  level: process.env.LOG_LEVEL || "info",
  base: {
    app: process.env.APP_NAME || "pixiegirl-hub-backend",
    env: process.env.NODE_ENV || "development",
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body.password",
      "req.body.confirm_password",
      "req.body.token",
      "*.password",
      "*.token",
      "*.secret",
      "*.api_key",
      "*.bank_account_number",
      "*.pin",
    ],
    censor: "[REDACTED]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

const logger = isDev
  ? pino({
      ...baseConfig,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname",
        },
      },
    })
  : pino(baseConfig);

module.exports = { logger };
