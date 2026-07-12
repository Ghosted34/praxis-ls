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
    { key: "list_employees", service: service.list, describe: "List employees (filter by entity, department, employment_type, driver, active, or text)." },
    { key: "get_employee", service: service.get, describe: "Get one employee by id, with corporate entity name." },
    { key: "employee_roster", service: service.roster, describe: "Active-employee roster (payroll inputs: salary, CNPS, risk class)." },
    { key: "employee_drivers", service: service.drivers, describe: "Active drivers, for fleet dispatch/incident assignment." },
    { key: "employee_references", service: service.references, describe: "Where an employee is referenced (delete-safety check)." },
  ],
  writes: [
    { key: "create_employee", service: service.create, schema: validator.schemas.create, permission: { module: "MOD-02", action: "create" }, confirm: true, describe: "Register a new employee (identity, CNPS, salary, bank block)." },
    { key: "update_employee", service: service.update, schema: validator.schemas.update, permission: { module: "MOD-02", action: "edit" }, confirm: true, describe: "Update an employee record." },
    { key: "set_employee_active", service: service.setActive, schema: validator.schemas.setActive, permission: { module: "MOD-02", action: "edit" }, confirm: true, describe: "Activate or deactivate an employee." },
  ],
};
