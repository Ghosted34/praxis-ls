"use strict";
module.exports = {
  MODULE: "MOD-01",
  CREATED: "entity.created",
  UPDATED: "entity.updated",
  ARCHIVED: "entity.archived",
  STATUS_CHANGED: "entity.status_changed",
  STRUCTURE_CHANGED: "entity.structure_changed",
  LETTERHEAD_UPDATED: "entity.letterhead_updated",
  // Audited apart from `entity.updated`: the prefix leads every operation-file
  // reference this entity issues, so "when did SL become SM, and who did it"
  // must be answerable without reading forty other columns' worth of diffs.
  OPS_PREFIX_CHANGED: "entity.ops_reference_prefix_changed",
  DOCUMENT_EXPIRING: "entity.document_expiring",

  /*
   * Tax obligation generator (PR-05, 13970). Four keys rather than one, because
   * they are four different things a person does something different about:
   *
   *   generated       the run's summary for one entity — what appeared, what
   *                   was superseded, what has nobody assigned to it. One per
   *                   entity per run, not one per obligation: twenty filings
   *                   arriving as twenty notifications is how a feed gets
   *                   muted.
   *   reminder        one obligation entered a rung of the ladder it has not
   *                   been reminded on. Addressed to the responsible person.
   *   overdue         a deadline passed while the obligation was still PENDING.
   *                   HIGH: this is the event the whole module exists to
   *                   produce, and it is advisory — a status and a message,
   *                   never a block.
   *   status_changed  a human waived, completed or reopened one. Audited
   *                   separately because a waiver is a decision with
   *                   consequences, not a bookkeeping edit.
   */
  TAX_OBLIGATION_GENERATED: "entity.tax_obligation_generated",
  TAX_OBLIGATION_REMINDER: "entity.tax_obligation_reminder",
  TAX_OBLIGATION_OVERDUE: "entity.tax_obligation_overdue",
  TAX_OBLIGATION_STATUS_CHANGED: "entity.tax_obligation_status_changed",
};
