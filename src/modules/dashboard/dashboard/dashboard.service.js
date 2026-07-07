"use strict";
const repo = require("./dashboard.repo");
module.exports = { kpis: (client) => repo.kpis(client) };
