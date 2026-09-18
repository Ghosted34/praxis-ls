/** AI action manifest (AI_READINESS Rule 1) for training. */
"use strict";

const service = require("./training.service");
const validator = require("./training.validator");

module.exports = {
  entity: "training",
  module_key: "MOD-18",
  screens: ["trainings"],

  reads: [
    { key: "list_trainings", service: service.list, permission: { module: "MOD-18", action: "view" }, describe: "List training sessions." },
    { key: "get_training", service: service.get, permission: { module: "MOD-18", action: "view" }, describe: "Get one training session by id." },
    { key: "list_attendees", service: service.listAttendees, permission: { module: "MOD-18", action: "view" }, describe: "List the attendance roster for a session." },
  ],

  writes: [
    {
      key: "create_training",
      service: (c, p, actor) => service.create(c, { data: p, actor }),
      schema: validator.schemas.create,
      permission: { module: "MOD-18", action: "create" },
      confirm: true,
      describe: "Schedule a training session.",
    },
    {
      key: "update_training",
      service: (c, p, actor) => (({ training_id, ...patch }) => service.update(c, { id: training_id, patch, actor }))(p),
      schema: validator.schemas.aiUpdate,
      permission: { module: "MOD-18", action: "edit" },
      confirm: true,
      describe: "Update a training session (facilitator, date).",
    },
    {
      key: "set_training_status",
      service: (c, p, actor) => service.setStatus(c, { id: p.training_id, status: p.status, actor }),
      schema: validator.schemas.aiStatus,
      permission: { module: "MOD-18", action: "edit" },
      confirm: true,
      describe: "Advance a training (SCHEDULED → DONE, or CANCELLED).",
    },
    {
      key: "add_training_attendee",
      service: (c, p, actor) => (({ training_id, ...data }) => service.addAttendee(c, { trainingId: training_id, data, actor }))(p),
      schema: validator.schemas.aiAttendee,
      permission: { module: "MOD-18", action: "edit" },
      confirm: true,
      describe: "Add an employee to a training roster.",
    },
    {
      key: "update_training_attendee",
      service: (c, p, actor) => (({ training_id, training_attendance_id, ...patch }) => service.updateAttendee(c, { trainingId: training_id, attendeeId: training_attendance_id, patch, actor }))(p),
      schema: validator.schemas.aiAttendeeUpdate,
      permission: { module: "MOD-18", action: "edit" },
      confirm: true,
      describe: "Mark an attendee attended and/or attach a certificate.",
    },
  ],
};
