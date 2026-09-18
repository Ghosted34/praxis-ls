/**
 * AI action manifest (AI_ARCHITECTURE §2) for onboarding checklists (MOD-16).
 *
 * Onboarding is a chase list: who started, what is still outstanding, and tick
 * the thing off. All three are natural-language questions, and none of them was
 * reachable — the module shipped without a manifest.
 *
 * `outstanding` is the read worth having first: it is the one that answers
 * "what is overdue for our new starters" without the caller naming a checklist.
 */
"use strict";

const service = require("./onboarding.service");
const validator = require("./onboarding.validator");

const MOD = "MOD-16";

module.exports = {
  entity: "onboarding_checklist",
  module_key: MOD,
  screens: [],

  reads: [
    { key: "list_onboarding_checklists", service: service.list, permission: { module: MOD, action: "view" }, describe: "List onboarding checklists (filter by status)." },
    { key: "get_onboarding_checklist", service: service.get, permission: { module: MOD, action: "view" }, describe: "Get one onboarding checklist by id, with its items." },
    { key: "outstanding_onboarding_items", service: service.outstanding, permission: { module: MOD, action: "view" }, describe: "Onboarding items still open, within the next `days` (default 14) — the chase list." },
    { key: "list_onboarding_templates", service: service.listTemplates, permission: { module: MOD, action: "view" }, describe: "List onboarding templates (pass include_inactive to see retired ones)." },
  ],

  writes: [
    {
      key: "create_onboarding_checklist",
      service: (c, p, actor) => service.create(c, { employee_id: p.employee_id, template_id: p.template_id, starts_on: p.starts_on, items: p.items, actor }),
      schema: validator.schemas.create,
      permission: { module: MOD, action: "create" },
      confirm: true,
      describe: "Raise an onboarding checklist for an employee, from a template or from a plain list of labels.",
    },
    {
      key: "add_onboarding_item",
      service: (c, p, actor) => (({ onboarding_checklist_id, ...data }) => service.addItem(c, { checklistId: onboarding_checklist_id, data, actor }))(p),
      schema: validator.schemas.aiAddItem,
      permission: { module: MOD, action: "edit" },
      confirm: true,
      describe: "Add one task to an onboarding checklist (label, due date or day offset, owner, whether it is mandatory).",
    },
    {
      key: "update_onboarding_item",
      service: (c, p, actor) => (({ onboarding_item_id, ...patch }) => service.updateItem(c, { itemId: onboarding_item_id, patch, actor }))(p),
      schema: validator.schemas.aiItemUpdate,
      permission: { module: MOD, action: "edit" },
      confirm: true,
      describe: "Amend one onboarding item by id (due date, owner, notes, or whether it is done).",
    },
    {
      key: "toggle_onboarding_item",
      service: (c, p, actor) => service.toggleItem(c, { itemId: p.onboarding_item_id, isDone: p.is_done, actor }),
      schema: validator.schemas.aiToggle,
      permission: { module: MOD, action: "edit" },
      confirm: true,
      describe: "Tick one onboarding item done, or untick it.",
    },
    {
      key: "reschedule_onboarding_checklist",
      service: (c, p, actor) => service.reschedule(c, { id: p.onboarding_checklist_id, startsOn: p.starts_on, actor }),
      schema: validator.schemas.aiReschedule,
      permission: { module: MOD, action: "edit" },
      confirm: true,
      describe: "Move a checklist's start date; every day-offset item re-dates with it.",
    },
    {
      key: "complete_onboarding_checklist",
      service: (c, p, actor) => service.complete(c, { id: p.onboarding_checklist_id, actor }),
      schema: validator.schemas.aiComplete,
      permission: { module: MOD, action: "edit" },
      confirm: true,
      describe: "Close an onboarding checklist once its mandatory items are done.",
    },
  ],
};
