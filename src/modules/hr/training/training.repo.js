"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { insertOne, updateOne, getById, listComplete } = require("../../../shared/db/query-helpers");

// training head + training_attendance children. All SQL lives here.
const base = makeRepo({
  table: "training",
  pk: "training_id",
  activeColumn: null,
  searchColumn: "title",
  orderBy: "created_at DESC",
});

module.exports = {
  ...base,
  insertAttendee: (client, data) => insertOne(client, "training_attendance", data),
  getAttendee: (client, id) => getById(client, "training_attendance", "training_attendance_id", id),
  updateAttendee: (client, id, patch) => updateOne(client, "training_attendance", "training_attendance_id", id, patch),
  async listAttendees(client, trainingId) {
    const { rows } = await listComplete(client, "SELECT * FROM training_attendance WHERE training_id = $1 ORDER BY training_attendance_id", [trainingId], { label: "Training attendance", ceiling: 5000 });
    return rows;
  },
};
