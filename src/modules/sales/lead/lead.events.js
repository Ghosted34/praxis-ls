"use strict";
module.exports = { MODULE: "MOD-20", CREATED: "lead.created", UPDATED: "lead.updated", CONVERTED: "lead.converted",
  transition: (status) => "lead." + String(status).toLowerCase() };
