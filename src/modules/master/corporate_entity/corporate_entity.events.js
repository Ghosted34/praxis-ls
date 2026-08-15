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
};
