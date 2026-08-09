"use strict";
module.exports = {
  MODULE: "MOD-05",
  CREATED: "dictionary_item.created",
  UPDATED: "dictionary_item.updated",
  // A rate is never edited in place — it is superseded (expire the open row,
  // open a new one). One event for the pair, because it is one decision.
  RATE_SUPERSEDED: "dictionary_item.rate_superseded",
  IMPORTED: "dictionary_item.imported",
};
