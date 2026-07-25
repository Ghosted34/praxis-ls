/**
 * Platform user administration (company-side operators). CRUD over
 * platform.platform_user with the three fixed roles (0030_platform_ops.sql:
 * PLATFORM_ROOT_ADMIN | PLATFORM_SUPPORT | PLATFORM_BILLING). Passwords are
 * Argon2id. Guards protect the platform from locking itself out: you can't
 * delete/deactivate/demote the last active Root Admin, and you can't delete
 * your own account.
 */
"use strict";

const argon2 = require("argon2");
const { AppError } = require("../../utils/errors");
const platformDb = require("./db");
const roles = require("./roles.service");

const SAFE = "platform_user_id, email, full_name, role, is_active, last_login_at, created_at";

async function assertRole(role) {
  if (role === undefined || role === null) return;
  if (!(await roles.exists(role))) {
    throw new AppError("BAD_ROLE", `unknown role '${role}'`, 422);
  }
}

async function countActiveRootAdmins(exceptId) {
  const { rows } = await platformDb.query(
    `SELECT count(*)::int AS n FROM platform.platform_user
     WHERE role = 'PLATFORM_ROOT_ADMIN' AND is_active = true
       AND ($1::uuid IS NULL OR platform_user_id <> $1)`,
    [exceptId || null],
  );
  return rows[0].n;
}

function list() {
  return platformDb
    .query(`SELECT ${SAFE} FROM platform.platform_user ORDER BY created_at`)
    .then((r) => r.rows);
}

async function create({ email, fullName, password, role }) {
  const mail = String(email || "").trim().toLowerCase();
  if (!mail || !password) throw new AppError("BAD_INPUT", "email and password are required", 422);
  await assertRole(role);
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  try {
    const { rows } = await platformDb.query(
      `INSERT INTO platform.platform_user (email, full_name, role, password_hash, is_active)
       VALUES ($1,$2,$3,$4,true) RETURNING ${SAFE}`,
      [mail, fullName || mail, role || "PLATFORM_SUPPORT", hash],
    );
    return rows[0];
  } catch (e) {
    if (e.code === "23505") throw new AppError("EMAIL_TAKEN", "A platform user with that email already exists", 409);
    throw e;
  }
}

async function getOr404(id) {
  const { rows } = await platformDb.query(
    `SELECT ${SAFE}, role FROM platform.platform_user WHERE platform_user_id = $1`,
    [id],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", "Platform user not found", 404);
  return rows[0];
}

async function update(id, { fullName, role, isActive }) {
  const current = await getOr404(id);
  await assertRole(role);
  // Guard: never leave the platform with zero active Root Admins.
  const demoting = role !== undefined && role !== null && role !== "PLATFORM_ROOT_ADMIN" && current.role === "PLATFORM_ROOT_ADMIN";
  const deactivating = isActive === false && current.is_active === true;
  if ((demoting || deactivating) && (await countActiveRootAdmins(id)) === 0) {
    throw new AppError("LAST_ROOT_ADMIN", "Cannot demote or deactivate the last active Root Admin", 409);
  }
  const sets = [];
  const params = [];
  const add = (frag, val) => { params.push(val); sets.push(`${frag} $${params.length}`); };
  if (fullName !== undefined) add("full_name =", fullName);
  if (role !== undefined && role !== null) add("role =", role);
  if (isActive !== undefined) add("is_active =", isActive);
  if (sets.length === 0) return getOr404(id);
  params.push(id);
  const { rows } = await platformDb.query(
    `UPDATE platform.platform_user SET ${sets.join(", ")} WHERE platform_user_id = $${params.length} RETURNING ${SAFE}`,
    params,
  );
  return rows[0];
}

async function setPassword(id, password) {
  await getOr404(id);
  if (!password || String(password).length < 8) throw new AppError("WEAK_PASSWORD", "Password must be at least 8 characters", 422);
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  await platformDb.query(
    "UPDATE platform.platform_user SET password_hash = $2 WHERE platform_user_id = $1",
    [id, hash],
  );
  return { platform_user_id: id, updated: true };
}

async function remove(id, actorId) {
  const current = await getOr404(id);
  if (String(id) === String(actorId)) throw new AppError("SELF_DELETE", "You can't delete your own account", 409);
  if (current.role === "PLATFORM_ROOT_ADMIN" && current.is_active && (await countActiveRootAdmins(id)) === 0) {
    throw new AppError("LAST_ROOT_ADMIN", "Cannot delete the last active Root Admin", 409);
  }
  await platformDb.query("DELETE FROM platform.platform_user WHERE platform_user_id = $1", [id]);
  return { platform_user_id: id, deleted: true };
}

module.exports = { list, create, update, setPassword, remove };
