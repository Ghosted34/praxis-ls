"use strict";
const service = require("./meeting.service");
const validator = require("./meeting.validator");
module.exports = {
  entity: "meeting", module_key: "MOD-21", screens: [],
  reads: [
    { key: "list_meetings", service: (c, p) => service.list(c, p), describe: "List meetings (filter lead/client)." },
    { key: "get_meeting", service: (c, p) => service.get(c, p.id || p), describe: "Get a meeting with its notes/minutes." },
  ],
  writes: [
    { key: "schedule_meeting", service: (c, p) => service.create(c, { data: p }), schema: validator.schemas.create, permission: { module: "MOD-21", action: "create" }, confirm: true, describe: "Schedule a meeting." },
    { key: "add_meeting_note", service: (c, p) => service.addNote(c, p), schema: validator.schemas.note, permission: { module: "MOD-21", action: "edit" }, confirm: true, describe: "Add a note or minutes to a meeting." },
  ],
};
