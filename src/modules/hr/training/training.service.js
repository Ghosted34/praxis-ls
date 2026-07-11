"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./training.repo");
const events = require("./training.events");

// Training sessions + attendance roster. Session lifecycle:
// SCHEDULED → DONE | CANCELLED. Attendance rows track who attended + certificate.
const TRANSITIONS = {
  SCHEDULED: ["DONE", "CANCELLED"],
  DONE: [],
  CANCELLED: [],
};

const base = makeService({ repo, moduleKey: events.MODULE, entity: "training", events });

module.exports = {
  ...base,
  listAttendees: (client, trainingId) => repo.listAttendees(client, trainingId),

  async setStatus(client, { id, status, actor }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    const allowed = TRANSITIONS[before.status] || [];
    if (!allowed.includes(status)) {
      throw new AppError("INVALID_TRANSITION", `Cannot move training ${before.status} → ${status}`, 422);
    }
    const row = await repo.update(client, id, { status });
    const entityRef = `training:${id}`;
    await emitEvent(client, { eventTypeKey: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, before, after: row });
    return row;
  },

  async addAttendee(client, { trainingId, data, actor }) {
    const training = await repo.findById(client, trainingId);
    if (!training) return null;
    const row = await repo.insertAttendee(client, { ...data, training_id: trainingId });
    const entityRef = `training:${trainingId}`;
    await emitEvent(client, { eventTypeKey: events.ATTENDEE_ADDED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.ATTENDEE_ADDED, moduleKey: events.MODULE, entityRef, after: row });
    return row;
  },

  async updateAttendee(client, { trainingId, attendeeId, patch, actor }) {
    const before = await repo.getAttendee(client, attendeeId);
    if (!before || before.training_id !== trainingId) return null;
    const row = await repo.updateAttendee(client, attendeeId, patch);
    const entityRef = `training:${trainingId}`;
    await emitEvent(client, { eventTypeKey: events.ATTENDEE_UPDATED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.ATTENDEE_UPDATED, moduleKey: events.MODULE, entityRef, before, after: row });
    return row;
  },
};
