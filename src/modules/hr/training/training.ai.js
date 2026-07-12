/** AI action manifest (AI_READINESS Rule 1) for training. */
"use strict";

const service = require("./training.service");
const validator = require("./training.validator");

module.exports = {
  entity: "training",
  module_key: "MOD-18",
  screens: ["trainings"],

  reads: [
    { key: "list_trainings", service: service.list, describe: "List training sessions." },
    { key: "get_training", service: service.get, describe: "Get one training session by id." },
    { key: "list_attendees", service: service.listAttendees, describe: "List the attendance roster for a session." },
  ],

  writes: [
    {
      key: "create_training",
      service: service.create,
      schema: validator.schemas.create,
      permission: { module: "MOD-18", action: "create" },
      confirm: true,
      describe: "Schedule a training session.",
    },
    {
      key: "update_training",
      service: service.update,
      schema: validator.schemas.update,
      permission: { module: "MOD-18", action: "edit" },
      confirm: true,
      describe: "Update a training session (facilitator, date).",
    },
    {
      key: "set_training_status",
      service: service.setStatus,
      schema: validator.schemas.status,
      permission: { module: "MOD-18", action: "edit" },
      confirm: true,
      describe: "Advance a training (SCHEDULED → DONE, or CANCELLED).",
    },
    {
      key: "add_training_attendee",
      service: service.addAttendee,
      schema: validator.schemas.attendee,
      permission: { module: "MOD-18", action: "edit" },
      confirm: true,
      describe: "Add an employee to a training roster.",
    },
    {
      key: "update_training_attendee",
      service: service.updateAttendee,
      schema: validator.schemas.attendeeUpdate,
      permission: { module: "MOD-18", action: "edit" },
      confirm: true,
      describe: "Mark an attendee attended and/or attach a certificate.",
    },
  ],
};
