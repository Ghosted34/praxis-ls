"use strict";
// Event keys emitted by MOD-61 goods received. MODULE stays MOD-61 (the RBAC
// grant GRN rides on, per the PRD module map); NUMBERING_KEY is the sequence a
// GRN document number comes from — MOD-33, whose token is "GRN", so a GRN never
// shares the SIN counter with supplier invoices (analysis doc §6.2).
module.exports = {
  MODULE: "MOD-61",
  NUMBERING_KEY: "MOD-33",
  CREATED: "goods_received.created",
  UPDATED: "goods_received.updated",
  ARCHIVED: "goods_received.archived",
};
