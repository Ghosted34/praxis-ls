"use strict";
module.exports = { MODULE: "MOD-23", CREATED: "proposal.created", SENT: "proposal.sent", ACCEPTED: "proposal.accepted", REJECTED: "proposal.rejected",
  transition: (status) => "proposal." + String(status).toLowerCase() };
