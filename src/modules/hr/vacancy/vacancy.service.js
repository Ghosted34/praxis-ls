"use strict";
const { makeService } = require("../../../shared/crud/resource");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const repo = require("./vacancy.repo");
const events = require("./vacancy.events");

// Recruitment: vacancy head + applicant pipeline. Vacancy lifecycle
// DRAFT → OPEN → CLOSED; applicants move through their own status pipeline.
const TRANSITIONS = {
  DRAFT: ["OPEN"],
  OPEN: ["CLOSED"],
  CLOSED: [],
};

const base = makeService({ repo, moduleKey: events.MODULE, entity: "vacancy", events });

module.exports = {
  ...base,
  listApplicants: (client, vacancyId) => repo.listApplicants(client, vacancyId),

  async setStatus(client, { id, status, actor }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    const allowed = TRANSITIONS[before.status] || [];
    if (!allowed.includes(status)) {
      throw new AppError("INVALID_TRANSITION", `Cannot move vacancy ${before.status} → ${status}`, 422);
    }
    const row = await repo.update(client, id, { status });
    const entityRef = `vacancy:${id}`;
    await emitEvent(client, { eventTypeKey: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.STATUS_CHANGED, moduleKey: events.MODULE, entityRef, before, after: row });
    return row;
  },

  async addApplicant(client, { vacancyId, data, actor }) {
    const vacancy = await repo.findById(client, vacancyId);
    if (!vacancy) return null;
    const row = await repo.insertApplicant(client, { ...data, vacancy_id: vacancyId });
    const entityRef = `vacancy:${vacancyId}`;
    await emitEvent(client, { eventTypeKey: events.APPLICANT_ADDED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.APPLICANT_ADDED, moduleKey: events.MODULE, entityRef, after: row });
    return row;
  },

  async setApplicantStatus(client, { vacancyId, applicantId, status, actor }) {
    const before = await repo.getApplicant(client, applicantId);
    if (!before || before.vacancy_id !== vacancyId) return null;
    const row = await repo.updateApplicant(client, applicantId, { status });
    const entityRef = `vacancy:${vacancyId}`;
    await emitEvent(client, { eventTypeKey: events.APPLICANT_UPDATED, moduleKey: events.MODULE, entityRef, actorUserId: actor.user_id });
    await audit(client, { actorUserId: actor.user_id, action: events.APPLICANT_UPDATED, moduleKey: events.MODULE, entityRef, before, after: row });
    return row;
  },
};
