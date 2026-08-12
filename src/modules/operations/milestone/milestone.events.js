"use strict";
/**
 * MOD-31 event keys.
 *
 * The scheduling events exist so that "the schedule moved" is something the
 * notification engine, the Control Tower and (later) the client portal can
 * subscribe to, rather than something a user discovers by reopening the file.
 * SLA_BREACH_FORECAST is the important one: it fires when the remaining floors
 * no longer fit before a locked commitment — i.e. while the date can still be
 * renegotiated, not on the day it is missed.
 */
module.exports = {
  MODULE: "MOD-31",
  TEMPLATE_PUBLISHED: "milestone.template.published",
  INSTANTIATED: "milestone.instantiated",
  ADVANCED: "milestone.advanced",
  REOPENED: "milestone.reopened",
  STAGE_INSERTED: "milestone.stage_inserted",
  REBASELINED: "milestone.rebaselined",
  AT_RISK: "milestone.at_risk",
  OVERDUE: "milestone.overdue",
  SLA_BREACH_FORECAST: "milestone.sla_breach_forecast",
  LOCK_RELEASED: "milestone.lock_released",
};
