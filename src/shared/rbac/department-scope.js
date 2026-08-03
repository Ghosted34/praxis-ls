/**
 * Department = scope.
 *
 * "Department" was free text in three places (employee, vacancy,
 * purchase_request) with no table behind it, so it could not be grouped,
 * filtered reliably or connected to anything — `employees.repo` matched it with
 * string equality, which makes "Operations" and "operations" two departments
 * (audit findings B1/B4). 0490 adds `scope_id` alongside the text, pointing at
 * the `scope` tree, which the schema has always described as "the entity /
 * branch / department a user belongs to" and which approvals already route
 * through.
 *
 * WHY THIS HELPER EXISTS. `scope` is identity data pinned to the LIVE schema,
 * while the three tables carrying `scope_id` are business data written to the
 * env-selected schema. So there is no foreign key (see 0489/0490 for why one
 * would be unsatisfiable under TEST) and no cross-schema join available. The
 * reference therefore has to be validated in code, on the identity client, and
 * every caller must do it the same way — hence one place rather than three.
 *
 * The pairing rule: `scope_id` is the meaning, `department` is a display
 * snapshot taken at write time (the pattern 0477 used for line items). Callers
 * pass whichever they have; this returns both, so a document that prints
 * `department` keeps working and a query that groups by `scope_id` becomes
 * possible.
 */
"use strict";

const { AppError } = require("../../utils/errors");

/**
 * Resolve a department reference against the identity schema.
 *
 * @param {object} identityClient  a client on the LIVE/identity schema
 * @param {object} input           { scope_id?, department? }
 * @returns {Promise<{scope_id: string|null, department: string|null}>}
 *
 * · scope_id given  → verified; `department` is refreshed from the scope's name
 *                     so the snapshot can't drift from the thing it names.
 * · text only       → kept as-is, scope_id null. Tenants that haven't built
 *                     their organigramme yet, and imports, must not be blocked.
 * · neither         → both null.
 */
async function resolveDepartment(identityClient, { scope_id = null, department = null } = {}) {
  if (!scope_id) {
    const text = typeof department === "string" ? department.trim() : null;
    return { scope_id: null, department: text || null };
  }

  const { rows } = await identityClient.query(
    "SELECT scope_id, name FROM scope WHERE scope_id = $1 LIMIT 1",
    [scope_id],
  );
  if (!rows.length) {
    throw new AppError(
      "UNKNOWN_DEPARTMENT",
      "That department doesn't exist. Pick one from the list — departments are the scopes in Security › Scopes.",
      422,
    );
  }
  return { scope_id: rows[0].scope_id, department: rows[0].name };
}

/**
 * Controller-side convenience: resolve on req.identityDb and merge into a body.
 * Keeps the three call sites to one line each and guarantees they all read the
 * identity schema rather than whichever environment the user is viewing.
 */
async function withDepartment(req, body = {}) {
  const resolved = await req.identityDb((c) =>
    resolveDepartment(c, { scope_id: body.scope_id, department: body.department }),
  );
  return { ...body, ...resolved };
}

module.exports = { resolveDepartment, withDepartment };
