"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./hr_sanction.repo");
const events = require("./hr_sanction.events");

const base = makeService({ repo, moduleKey: events.MODULE, entity: "hr_sanction", events });

async function mine(client, employeeId) {
  if (!employeeId) return [];
  return repo.list(client, { employee_id: employeeId });
}

async function lift(client, { id, actor }) {
  const row = await repo.lift(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Sanction not found or already lifted", 404);
  const ref = `hr_sanction:${id}`;
  await emitEvent(client, { eventTypeKey: events.LIFTED, moduleKey: events.MODULE, entityRef: ref, actorUserId: actor.user_id });
  await audit(client, { actorUserId: actor.user_id, action: events.LIFTED, moduleKey: events.MODULE, entityRef: ref, after: row });
  return row;
}

module.exports = {
  ...base,
  create: (client, { data, actor }) => base.create(client, { data: { ...data, issued_by: actor.user_id || null }, actor }),
  mine,
  lift,
};
