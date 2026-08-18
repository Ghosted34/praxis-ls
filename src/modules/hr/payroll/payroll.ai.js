/** Payroll (MOD-17) AI manifest — reads open; writes confirm-gated + RBAC. */
"use strict";
const service = require("./payroll.service");
const validator = require("./payroll.validator");

module.exports = {
  entity: "payroll",
  module_key: "MOD-17",
  screens: ["hr_payroll"],
  reads: [
    { key: "list_payroll_runs", service: service.list, permission: { module: "MOD-17", action: "view" }, describe: "List payroll runs (by entity/status)." },
    { key: "get_payroll_run", service: service.get, permission: { module: "MOD-17", action: "view" }, describe: "Get a payroll run with its per-employee items." },
  ],
  writes: [
    { key: "create_payroll_run", service: service.createRun, schema: validator.schemas.createRun, permission: { module: "MOD-17", action: "create" }, confirm: true, describe: "Open a payroll run for an entity + period (YYYY-MM)." },
    { key: "compute_payroll", service: service.compute, schema: validator.schemas.compute, permission: { module: "MOD-17", action: "edit" }, confirm: true, describe: "Compute payslips for all active employees (CNPS/IRPP/CAC/CFC/FNE per KB §9)." },
    { key: "set_payroll_status", service: (c, p) => service.setStatus(c, { id: p.payroll_run_id, status: p.status }), schema: validator.schemas.aiStatus, permission: { module: "MOD-17", action: "approve" }, confirm: true, describe: "Advance a payroll run by id (OPEN→COMPUTED→SUBMITTED→APPROVED→VALIDATED→DISBURSED, or REJECTED); validation posts the GL entry." },
  ],
};
