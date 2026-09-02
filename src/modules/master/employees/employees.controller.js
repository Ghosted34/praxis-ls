/** Employee master (MOD-02) HTTP handlers — thin: req.tenantDb → service.
 *  Sensitive reads are field-masked at the boundary (PRD §7.3): a role without
 *  employee.salary visibility never receives base_salary/bank details. Masking is
 *  HTTP-only — internal callers (payroll roster) use the service and see real pay. */
"use strict";
const service = require("./employees.service");
const self = require("./employees.self");
const { maskForUserVia, maskedKeysFor } = require("../../../shared/rbac/field-mask");
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
  // Self-service. No MOD-02 grant, no id parameter — see employees.self.js.
  // NOT field-masked: the projection is the mask, and it is a fixed list rather
  // than a role-dependent one, so a person always sees the same fields about
  // themselves regardless of what field_visibility says about salaries.
  mine: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((c) => self.getMine(c, { actor: actor(req) })),
  })),
  updateMine: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((c) => self.updateMine(c, { patch: req.body || {}, actor: actor(req) })),
  })),
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
    // `slug` is the storage prefix the vault writes scans under, so it has to be
    // resolved out here with the rest of the request context — the service takes
    // a bare client and must not reach for the request.
    const slug = req.tenant && req.tenant.slug;
    res.status(201).json({ data: await req.tenantDb((c) => service.create(c, { data, slug, actor: actor(req) })) });
  }),
  update: asyncHandler(async (req, res) => {
    const patch = await withDepartment(req, req.body);
    res.json({ data: await req.tenantDb((c) => service.update(c, { id: req.params.id, patch, actor: actor(req) })) });
  }),
  setActive: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.setActive(c, { id: req.params.id, is_active: req.body.is_active, actor: actor(req) })) })),
  setStatus: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((c) => service.setStatus(c, { id: req.params.id, ...req.body, actor: actor(req) })),
  })),
  remove: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.remove(c, { id: req.params.id, actor: actor(req) })) })),

  /* ── Staff file (12764) ────────────────────────────────────────────────── */
  // The registry, not a document: no employee id, and it is the same list for
  // everybody, which is why it hangs off /employees/document-types rather than
  // being fetched once per employee.
  documentTypes: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.documentTypes(c)) })),
  documents: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listDocuments(c, req.params.id)) })),
  addDocument: asyncHandler(async (req, res) => res.status(201).json({
    data: await req.tenantDb((c) => service.addDocument(c, {
      id: req.params.id, body: req.body, slug: req.tenant && req.tenant.slug, actor: actor(req),
    })),
  })),
  updateDocument: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((c) => service.updateDocument(c, { id: req.params.id, documentId: req.params.documentId, patch: req.body, actor: actor(req) })),
  })),
  removeDocument: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((c) => service.removeDocument(c, { id: req.params.id, documentId: req.params.documentId, actor: actor(req) })),
  })),

  /* ── Standing pay lines (12765) ────────────────────────────────────────── */
  // Masked like every other salary read: an allowance IS pay, and a role that
  // cannot see `base_salary` must not read the responsibility allowance instead.
  // `amount` is redacted here rather than through FIELD_MAP — the name is shared
  // with invoices, receipts and journal lines, so nulling it globally would blank
  // half the product for anybody masked on salary. See maskedKeysFor.
  allowances: asyncHandler(async (req, res) => {
    const rows = await req.tenantDb((c) => service.listAllowances(c, req.params.id, { on: req.query.on || null }));
    const masked = (await maskedKeysFor(req.identityDb, req.user)).includes("employee.salary");
    res.json({ data: masked ? rows.map((r) => ({ ...r, amount: null })) : rows });
  }),
  addAllowance: asyncHandler(async (req, res) => res.status(201).json({
    data: await req.tenantDb((c) => service.addAllowance(c, { id: req.params.id, body: req.body, actor: actor(req) })),
  })),
  updateAllowance: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((c) => service.updateAllowance(c, { id: req.params.id, allowanceId: req.params.allowanceId, patch: req.body, actor: actor(req) })),
  })),
  removeAllowance: asyncHandler(async (req, res) => res.json({
    data: await req.tenantDb((c) => service.removeAllowance(c, { id: req.params.id, allowanceId: req.params.allowanceId, actor: actor(req) })),
  })),
  pay: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.pay(c, req.params.id, { on: req.query.on || null }));
    const masked = (await maskedKeysFor(req.identityDb, req.user)).includes("employee.salary");
    // `base_salary` and `monthly_gross` are in FIELD_MAP; the per-line amounts
    // are not, for the reason above, so they are nulled here on the way out.
    const shaped = masked ? { ...data, lines: data.lines.map((l) => ({ ...l, amount: null })) } : data;
    res.json({ data: await maskForUserVia(req.identityDb, req.user, shaped) });
  }),

  /* ── Readiness and the account ─────────────────────────────────────────── */
  // NOT masked: readiness names which fields are BLANK, never their values. A
  // role that cannot see a salary can still be told the salary is missing —
  // that is the whole point of handing the gap to whoever can close it.
  readiness: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.readiness(c, req.params.id)) })),
  // Static — no employee, no database. It is the LIST, so the wizard can score a
  // draft that has not been saved yet against the same definition the server
  // will apply to it.
  readinessRequirements: asyncHandler(async (_req, res) => res.json({ data: service.readinessRequirements() })),
  account: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.account(c, req.params.id)) })),
};
