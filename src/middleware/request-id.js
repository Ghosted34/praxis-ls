/**
 * Request ID middleware.
 * Reads X-Request-Id from header (if client sent one) or generates a uuid.
 * Stored on req.request_id and echoed back on the response, so logs can be
 * correlated end-to-end (frontend → backend → DB → AI).
 */

"use strict";

const { v4: uuidv4 } = require("uuid");

function requestIdMiddleware(req, res, next) {
  const incoming = req.headers["x-request-id"];
  const id =
    typeof incoming === "string" && incoming.length <= 64 ? incoming : uuidv4();
  req.request_id = id;
  res.setHeader("X-Request-Id", id);
  next();
}

module.exports = { requestIdMiddleware };
