"use strict";
// Credit notes share the invoicing permission (MOD-51) so no new catalogue entry
// is needed, but draw their own document-numbering sequence (NUMBER_KEY) so a
// credit note doesn't consume a final-invoice number.
module.exports = {
  MODULE: "MOD-51",
  NUMBER_KEY: "MOD-51-CN",
  DRAFTED: "credit_note.drafted",
  POSTED: "credit_note.posted",
};
