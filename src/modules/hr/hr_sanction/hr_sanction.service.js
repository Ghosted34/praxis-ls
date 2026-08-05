"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
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
  // DATA 2.4: issued_by is REFERENCES app_user(user_id); a live user id raises
  // 23503 beside sandbox data, so it goes through the same guard emit.js uses.
  create: async (client, { data, actor }) => base.create(client, {
    data: { ...data, issued_by: await resolveActorId(client, actor.user_id) }, actor,
  }),
  mine,
  lift,
};
