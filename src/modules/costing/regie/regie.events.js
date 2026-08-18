"use strict";
// event_log keys are free-form citext, but `workflow` binds to event_type_id
// (0120:22) — so an event that is not a seeded event_type can never carry an
// approval chain. All five below are seeded by 9094_seed_regie_policy.sql;
// advance.aged_unjustified was already seeded by 9020:69.
module.exports = {
  MODULE: "MOD-49",
  ISSUED: "regie.issued",
  RETIRED: "regie.retired",
  QUERIED: "regie.queried",
  WRITE_OFF: "regie.write_off",
  UNAGED: "regie.unaged",
  AGED: "advance.aged_unjustified",
};
