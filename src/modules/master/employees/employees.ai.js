/**
 * Employee master (MOD-02) AI manifest — the "seventh file" (doc/AI_READINESS.md
 * Rule 1). Reads are auto-approved; writes are Zod-gated, RBAC-checked and
 * confirmation-gated, and route through the same service as the UI.
 */
"use strict";
const service = require("./employees.service");
const validator = require("./employees.validator");

module.exports = {
  entity: "employee",
  module_key: "MOD-02",
  screens: ["hr_employees"],
  reads: [
    { key: "list_employees", service: service.list, permission: { module: "MOD-02", action: "view" }, describe: "List employees (filter by entity, department, employment_type, driver, active, or text)." },
    { key: "get_employee", service: service.get, permission: { module: "MOD-02", action: "view" }, describe: "Get one employee by id, with corporate entity name." },
    { key: "employee_roster", service: service.roster, permission: { module: "MOD-02", action: "view" }, describe: "Active-employee roster (payroll inputs: salary, CNPS, risk class)." },
    { key: "employee_drivers", service: service.drivers, permission: { module: "MOD-02", action: "view" }, describe: "Active drivers, for fleet dispatch/incident assignment." },
    { key: "employee_references", service: service.references, permission: { module: "MOD-02", action: "view" }, describe: "Where an employee is referenced (delete-safety check)." },
  ],
  writes: [
    { key: "create_employee", service: service.create, schema: validator.schemas.create, permission: { module: "MOD-02", action: "create" }, confirm: true, describe: "Register a new employee (identity, CNPS, salary, bank block)." },
    { key: "update_employee", service: (c, p) => (({ employee_id, ...patch }) => service.update(c, { id: employee_id, patch }))(p), schema: validator.schemas.aiUpdate, permission: { module: "MOD-02", action: "edit" }, confirm: true, describe: "Update an employee record by id." },
    { key: "set_employee_active", service: (c, p) => service.setActive(c, { id: p.employee_id, is_active: p.is_active }), schema: validator.schemas.aiSetActive, permission: { module: "MOD-02", action: "edit" }, confirm: true, describe: "Activate or deactivate an employee by id." },
  ],
};
