/**
 * Platform RBAC roles + permission matrix (platform.platform_role /
 * platform_role_permission, 0031). Root Admin is a system role that bypasses
 * checks in the middleware, so its matrix row is display-only. Custom roles are
 * fully governed by their capability set.
 */
"use strict";

const { AppError } = require("../../utils/errors");
const { CAP_CATALOGUE } = require("../../middleware/platform-auth");
const platformDb = require("./db");

/** The capability catalogue the matrix columns are drawn from. */
const catalogue = () => CAP_CATALOGUE.slice();

function cleanCaps(capabilities) {
  const known = new Set(CAP_CATALOGUE);
  return Array.from(new Set((capabilities || []).filter((c) => known.has(c))));
}

/** All roles with their capability arrays (the matrix rows). */
async function list() {
  const { rows } = await platformDb.query(
    `SELECT r.role_id, r.code, r.name, r.is_system,
            COALESCE(array_agg(rp.capability) FILTER (WHERE rp.capability IS NOT NULL), '{}') AS capabilities,
            (SELECT count(*)::int FROM platform.platform_user u WHERE u.role = r.code) AS user_count
       FROM platform.platform_role r
       LEFT JOIN platform.platform_role_permission rp ON rp.role_id = r.role_id
      GROUP BY r.role_id
      ORDER BY r.is_system DESC, r.code`,
  );
  return rows;
}

async function roleIdOf(idOrCode) {
  const { rows } = await platformDb.query(
    "SELECT role_id, code, is_system FROM platform.platform_role WHERE role_id = $1 OR code = $1",
    [idOrCode],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", "Role not found", 404);
  return rows[0];
}

async function create({ code, name, capabilities }) {
  const c = String(code || "").trim().toUpperCase().replace(/\s+/g, "_");
  if (!c || !name) throw new AppError("BAD_INPUT", "code and name are required", 422);
  let role;
  try {
    const { rows } = await platformDb.query(
      "INSERT INTO platform.platform_role (code, name, is_system) VALUES ($1,$2,false) RETURNING role_id, code, name, is_system",
      [c, name],
    );
    role = rows[0];
  } catch (e) {
    if (e.code === "23505") throw new AppError("CODE_TAKEN", "A role with that code already exists", 409);
    throw e;
  }
  await replacePermissions(role.role_id, cleanCaps(capabilities));
  return { ...role, capabilities: cleanCaps(capabilities) };
}

async function replacePermissions(roleId, caps) {
  await platformDb.query("DELETE FROM platform.platform_role_permission WHERE role_id = $1", [roleId]);
  for (const cap of caps) {
    await platformDb.query(
      "INSERT INTO platform.platform_role_permission (role_id, capability) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [roleId, cap],
    );
  }
}

/** Replace a role's capability set (the matrix editor). Root Admin is locked to
 *  the full set — it bypasses checks anyway and mustn't be shown as editable. */
async function setPermissions(idOrCode, capabilities) {
  const role = await roleIdOf(idOrCode);
  if (role.code === "PLATFORM_ROOT_ADMIN") {
    throw new AppError("ROOT_LOCKED", "Root Admin always has full access and can't be edited", 409);
  }
  await replacePermissions(role.role_id, cleanCaps(capabilities));
  return { role_id: role.role_id, capabilities: cleanCaps(capabilities) };
}

async function remove(idOrCode) {
  const role = await roleIdOf(idOrCode);
  if (role.is_system) throw new AppError("SYSTEM_ROLE", "Built-in roles can't be deleted", 409);
  const { rows } = await platformDb.query(
    "SELECT count(*)::int AS n FROM platform.platform_user WHERE role = $1",
    [role.code],
  );
  if (rows[0].n > 0) throw new AppError("ROLE_IN_USE", "Reassign users off this role before deleting it", 409);
  await platformDb.query("DELETE FROM platform.platform_role WHERE role_id = $1", [role.role_id]);
  return { role_id: role.role_id, deleted: true };
}

/** True if a role code exists (used to validate platform_user.role writes). */
async function exists(code) {
  const { rows } = await platformDb.query("SELECT 1 FROM platform.platform_role WHERE code = $1", [code]);
  return rows.length > 0;
}

module.exports = { catalogue, list, create, setPermissions, remove, exists };
