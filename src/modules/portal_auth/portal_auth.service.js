/**
 * Portal auth (PRD §11.1) — authentication for EXTERNAL portal users (client
 * contacts, investors, auditors). Deliberately parallel to app_user and kept off
 * the RBAC path: a portal user has no role/capability and can only ever reach the
 * scoped portal views. The token carries identity only; the *scope* is resolved
 * per request from portal_access (0340), so revoking a grant cuts access at once.
 */
"use strict";

const argon2 = require("argon2");
const jwt = require("jsonwebtoken");
const { config } = require("../../config/env");
const repo = require("./portal_auth.repo");
const { AppError } = require("../../utils/errors");

const TOKEN_TTL = "2h";

function issueToken(user) {
  return jwt.sign({ sub: user.portal_user_id, email: user.email, typ: "portal" }, config.JWT_ACCESS_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

/** Verify a portal token. Throws on anything that isn't a valid portal token. */
function verifyToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.JWT_ACCESS_SECRET);
  } catch (err) {
    throw new AppError(err.name === "TokenExpiredError" ? "TOKEN_EXPIRED" : "INVALID_TOKEN", "Invalid portal token", 401);
  }
  if (payload.typ !== "portal") throw new AppError("INVALID_TOKEN", "Not a portal token", 401);
  return payload;
}

/** Authenticate against the identity schema. Generic error — never reveal which
 *  half (email vs password) failed. */
async function login(client, { email, password }) {
  const generic = new AppError("BAD_CREDENTIALS", "Invalid email or password", 401);
  const user = await repo.findByEmail(client, email);
  if (!user || user.status !== "ACTIVE") throw generic;
  let ok = false;
  try {
    ok = await argon2.verify(user.password_hash, password);
  } catch {
    ok = false;
  }
  if (!ok) {
    await repo.bumpFailed(client, user.portal_user_id);
    throw generic;
  }
  await repo.touchLogin(client, user.portal_user_id);
  return {
    access_token: issueToken(user),
    portal_user: { portal_user_id: user.portal_user_id, email: user.email, full_name: user.full_name },
  };
}

async function createUser(client, { email, password, fullName }) {
  if (!password || String(password).length < 8) throw new AppError("WEAK_PASSWORD", "Password must be at least 8 characters", 422);
  const existing = await repo.findByEmail(client, email);
  if (existing) throw new AppError("EMAIL_TAKEN", "A portal user with that email already exists", 409);
  const password_hash = await argon2.hash(password, { type: argon2.argon2id });
  return repo.insert(client, { email, passwordHash: password_hash, fullName });
}

async function setPassword(client, { id, password }) {
  if (!password || String(password).length < 8) throw new AppError("WEAK_PASSWORD", "Password must be at least 8 characters", 422);
  const password_hash = await argon2.hash(password, { type: argon2.argon2id });
  const row = await repo.setPassword(client, id, password_hash);
  if (!row) throw new AppError("NOT_FOUND", "Portal user not found", 404);
  return row;
}

async function setStatus(client, { id, status }) {
  if (!["ACTIVE", "DISABLED"].includes(status)) throw new AppError("BAD_STATUS", "status must be ACTIVE/DISABLED", 422);
  const row = await repo.setStatus(client, id, status);
  if (!row) throw new AppError("NOT_FOUND", "Portal user not found", 404);
  return row;
}

const listUsers = (client) => repo.list(client);
const getById = (client, id) => repo.findById(client, id);

module.exports = { login, verifyToken, createUser, setPassword, setStatus, listUsers, getById };
