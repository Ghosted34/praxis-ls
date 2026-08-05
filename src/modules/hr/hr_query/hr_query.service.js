"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./hr_query.repo");
const events = require("./hr_query.events");

const base = makeService({ repo, moduleKey: events.MODULE, entity: "hr_query", events });

/** The caller's own queries (self-service). */
async function mine(client, employeeId) {
  if (!employeeId) return [];
  return repo.list(client, { employee_id: employeeId });
}

/** The employee responds to their own OPEN query. */
async function respond(client, { id, employeeId, response }) {
  if (!employeeId) throw new AppError("NO_EMPLOYEE", "Your account isn't linked to an employee record", 400);
  const row = await repo.respond(client, id, employeeId, response);
  if (!row) throw new AppError("NOT_FOUND", "Query not found, not yours, or already answered", 404);
  return row;
}

module.exports = {
  ...base,
  // Stamp the issuer on create.
  // DATA 2.4: issued_by is REFERENCES app_user(user_id); a live user id raises
  // 23503 beside sandbox data, so it goes through the same guard emit.js uses.
  create: async (client, { data, actor }) => base.create(client, {
    data: { ...data, issued_by: await resolveActorId(client, actor.user_id) }, actor,
  }),
  mine,
  respond,
};
