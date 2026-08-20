"use strict";
const crypto = require("crypto");

function mintToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function isUsable(row, now = new Date()) {
  if (!row) return false;
  if (row.revoked_at) return false;
  if (new Date(row.expires_at) <= now) return false;
  return true;
}

module.exports = { mintToken, hashToken, isUsable };
