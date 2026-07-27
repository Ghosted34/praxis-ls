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

    // Hiring an applicant provisions the employee record the rest of the system
    // builds on (payroll, contracts, dispatch). Only on the transition INTO HIRED
    // so re-saving the status can't create duplicates. Runs in the caller's tx.
    if (status === "HIRED" && before.status !== "HIRED" && row.full_name) {
      // Carry the vacancy's role (title) + department onto the new employee, so
      // the profile isn't a nameless "—" the moment it's provisioned.
      const vacancy = await repo.findById(client, vacancyId);
      const ins = await client.query(
        "INSERT INTO employee (full_name, job_title, department, is_active) VALUES ($1, $2, $3, true) RETURNING employee_id",
        [row.full_name, vacancy?.title || null, vacancy?.department || null],
      );
      const employeeId = ins.rows[0].employee_id;
      await emitEvent(client, { eventTypeKey: events.APPLICANT_UPDATED, moduleKey: events.MODULE, entityRef: `employee:${employeeId}`, actorUserId: actor.user_id, payload: { provisioned_from_applicant: applicantId, vacancy_id: vacancyId } });
      await audit(client, { actorUserId: actor.user_id, action: "employee_provisioned", moduleKey: events.MODULE, entityRef: `employee:${employeeId}`, after: { employee_id: employeeId, full_name: row.full_name, source: "vacancy_hire" } });
      return { ...row, provisioned_employee_id: employeeId };
    }
    return row;
  },
};
