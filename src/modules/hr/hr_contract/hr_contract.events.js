"use strict";
module.exports = {
  MODULE: "MOD-12",
  CREATED: "hr_contract.created",
  UPDATED: "hr_contract.updated",
  ARCHIVED: "hr_contract.archived",
  STATUS_CHANGED: "hr_contract.status_changed",
  DRAFTED: "hr_contract.drafted",
  RENDERED: "hr_contract.rendered",
  /* 10708 — the renewal action 0700 kept pointing at but never shipped. */
  RENEWED: "hr_contract.renewed",
  /* The two dates nothing has ever watched (0700). A fixed term that lapses
   * unnoticed is an employee working without a contract; a probation that
   * passes unnoticed is a confirmation nobody made — which in most
   * jurisdictions confirms them by default, the opposite of what the employer
   * intended. */
  EXPIRING: "hr_contract.expiring",
  PROBATION_ENDING: "hr_contract.probation_ending",
};
