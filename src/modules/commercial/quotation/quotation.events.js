"use strict";
module.exports = { MODULE: "MOD-27", CREATED: "quotation.created", SENT: "quotation.sent", ACCEPTED: "quotation.accepted", REJECTED: "quotation.rejected", CONVERTED: "quotation.converted",
  transition: (s) => "quotation." + String(s).toLowerCase() };
