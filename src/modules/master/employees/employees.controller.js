/** Employee master (MOD-02) HTTP handlers — thin: req.tenantDb → service.
 *  Sensitive reads are field-masked at the boundary (PRD §7.3): a role without
 *  employee.salary visibility never receives base_salary/bank details. Masking is
 *  HTTP-only — internal callers (payroll roster) use the service and see real pay. */
"use strict";
const service = require("./employees.service");
const { maskForUserVia } = require("../../../shared/rbac/field-mask");
const { withDepartment } = require("../../../shared/rbac/department-scope");
const { asyncHandler, AppError } = require("../../../utils/errors");
const actor = (req) => req.user || { user_id: null };

// Read employee data on the env (business) client, but resolve the masked
// field_keys from the identity schema (req.identityDb) — field_visibility is
// identity data, so masking stays enforced under TEST too.
module.exports = {
  list: asyncHandler(async (req, res) => res.json({ data: await maskForUserVia(req.identityDb, req.user, await req.tenantDb((c) => service.list(c, req.query))) })),
  roster: asyncHandler(async (req, res) => res.json({ data: await maskForUserVia(req.identityDb, req.user, await req.tenantDb((c) => service.roster(c, req.query))) })),
  drivers: asyncHandler(async (req, res) => res.json({ data: await maskForUserVia(req.identityDb, req.user, await req.tenantDb((c) => service.drivers(c, req.query))) })),
  get: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.get(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "Employee not found", 404);
    res.json({ data: await maskForUserVia(req.identityDb, req.user, row) });
  }),
  references: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.references(c, req.params.id)) })),

  // The reporting line (0493). Masked like every other employee read — a team
  // list must not become a way around field visibility on salary.
  reports: asyncHandler(async (req, res) => res.json({
    data: await maskForUserVia(req.identityDb, req.user, await req.tenantDb((c) => service.directReports(c, req.params.id))),
  })),
  team: asyncHandler(async (req, res) => res.json({
    data: await maskForUserVia(req.identityDb, req.user, await req.tenantDb((c) => service.team(c, req.params.id))),
  })),
  managers: asyncHandler(async (req, res) => res.json({
    data: await maskForUserVia(req.identityDb, req.user, await req.tenantDb((c) => service.managerChain(c, req.params.id))),
  })),
  // Department is a scope (0490) — resolved on the identity client, since the
  // scope tree lives in the live schema while `employee` does not.
  // Resolved BEFORE the tenant callback opens: `withDepartment` reads the
  // identity schema on the same connection, and doing it inside left the
  // connection on LIVE for the rest of the callback — so a sandbox session
  // wrote employee rows into the live schema. See middleware/tenant-context.
  create: asyncHandler(async (req, res) => {
    const data = await withDepartment(req, req.body);
    res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { data, actor: actor(req) })) });
  }),
  update: asyncHandler(async (req, res) => {
    const patch = await withDepartment(req, req.body);
    res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch, actor: actor(req) })) });
  }),
  setActive: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.setActive(c, { id: req.params.id, is_active: req.body.is_active, actor: actor(req) })) })),
  remove: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.remove(c, { id: req.params.id, actor: actor(req) })) })),
};
