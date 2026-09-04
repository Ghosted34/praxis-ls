"use strict";
const service = require("./report.service");
const validator = require("./report.validator");
module.exports = {
  entity: "report", module_key: "MOD-63", screens: [],
  reads: [
    { key: "list_reports", service: () => service.catalogue(), permission: { module: "MOD-63", action: "view" }, describe: "List available reports (income statement, receivables ageing, cash position, file margin, procurement spend, …)." },
    { key: "run_report", service: (c, p) => service.run(c, { reportKey: p.report_key, params: p }), permission: { module: "MOD-63", action: "view" }, describe: "Run a report by report_key with params — powers chat-on-dashboards." },
    { key: "list_saved_reports", service: (c, p) => service.listSaved(c, p, { user_id: p.user_id }), permission: { module: "MOD-63", action: "view" }, describe: "List saved reports for the user." },
    { key: "dashboard_tiles", service: (c, p) => service.listTiles(c, { user_id: p.user_id }), permission: { module: "MOD-63", action: "view" }, describe: "The user's dashboard tile layout." },
  ],
  writes: [
    { key: "save_report", service: service.saveReport, schema: validator.schemas.save, permission: { module: "MOD-63", action: "create" }, confirm: true, describe: "Save a report configuration." },
    { key: "set_dashboard_tile", service: service.setTile, schema: validator.schemas.setTile, permission: { module: "MOD-63", action: "edit" }, confirm: true, describe: "Add/update a dashboard tile." },
  ],
};
