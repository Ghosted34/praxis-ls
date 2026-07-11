"use strict";
const service = require("./report.service");
const validator = require("./report.validator");
module.exports = {
  entity: "report", module_key: "MOD-63", screens: [],
  reads: [
    { key: "list_reports", service: () => service.catalogue(), describe: "List available reports (income statement, receivables ageing, cash position, dossier margin, procurement spend, …)." },
    { key: "run_report", service: (c, p) => service.run(c, { reportKey: p.report_key, params: p }), describe: "Run a report by report_key with params — powers chat-on-dashboards." },
    { key: "list_saved_reports", service: (c, p) => service.listSaved(c, p, { user_id: p.user_id }), describe: "List saved reports for the user." },
    { key: "dashboard_tiles", service: (c, p) => service.listTiles(c, { user_id: p.user_id }), describe: "The user's dashboard tile layout." },
  ],
  writes: [
    { key: "save_report", service: service.saveReport, schema: validator.schemas.save, permission: { module: "MOD-63", action: "create" }, confirm: true, describe: "Save a report configuration." },
    { key: "set_dashboard_tile", service: service.setTile, schema: validator.schemas.setTile, permission: { module: "MOD-63", action: "edit" }, confirm: true, describe: "Add/update a dashboard tile." },
  ],
};
