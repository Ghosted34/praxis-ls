"use strict";
module.exports = {
  MODULE: "MOD-05",
  CREATED: "dictionary_item.created",
  UPDATED: "dictionary_item.updated",
  // A rate is never edited in place — it is superseded (expire the open row,
  // open a new one). One event for the pair, because it is one decision.
  RATE_SUPERSEDED: "dictionary_item.rate_superseded",
  IMPORTED: "dictionary_item.imported",
  // The direction changed, so the code moved to the new letter's next free
  // number. Audit-only: the before/after pair is the record of the old code.
  RECODED: "dictionary_item.recoded",
};
