"use strict";
const express = require("express");
const { makeLimiter } = require("../../../shared/http/rate-limit");
const { asyncHandler, AppError } = require("../../../utils/errors");
const secure = require("../triage/secure-link");

const router = express.Router();
const limit = makeLimiter({ name: "secure-link-public", max: 60, windowMs: 15 * 60 * 1000 });

router.get("/:token", limit, asyncHandler(async (req, res) => {
  res.set("X-Robots-Tag", "noindex");
  const hash = secure.hashToken(req.params.token);
  const row = await req.tenantDbIn("live", (c) => c.query(
    `SELECT * FROM secure_link WHERE token_hash = $1`,
    [hash],
  ).then((r) => r.rows[0]));
  if (!secure.isUsable(row)) throw new AppError("NOT_FOUND", "This link has expired or been revoked.", 404);
  await req.tenantDbIn("live", (c) => c.query(
    `UPDATE secure_link SET view_count = view_count + 1, first_viewed_at = COALESCE(first_viewed_at, now())
      WHERE secure_link_id = $1`,
    [row.secure_link_id],
  ));
  return res.json({ data: { label: row.label, target_kind: row.target_kind, expires_at: row.expires_at } });
}));

module.exports = { basePath: "/public/secure", feature: null, idParam: "text", router };
