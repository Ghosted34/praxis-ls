/** AI action manifest (AI_READINESS Rule 1) for vacancies / recruitment. */
"use strict";

const service = require("./vacancy.service");
const validator = require("./vacancy.validator");

module.exports = {
  entity: "vacancy",
  module_key: "MOD-11",
  screens: ["vacancies"],

  reads: [
    { key: "list_vacancies", service: service.list, permission: { module: "MOD-11", action: "view" }, describe: "List job vacancies." },
    { key: "get_vacancy", service: service.get, permission: { module: "MOD-11", action: "view" }, describe: "Get one vacancy by id." },
    { key: "list_applicants", service: service.listApplicants, permission: { module: "MOD-11", action: "view" }, describe: "List applicants for a vacancy." },
  ],

  writes: [
    {
      key: "create_vacancy",
      service: (c, p, actor) => service.create(c, { data: p, actor }),
      schema: validator.schemas.create,
      permission: { module: "MOD-11", action: "create" },
      confirm: true,
      describe: "Create a job vacancy (optionally AI-generated).",
    },
    {
      key: "update_vacancy",
      service: (c, p, actor) => (({ vacancy_id, ...patch }) => service.update(c, { id: vacancy_id, patch, actor }))(p),
      schema: validator.schemas.aiUpdate,
      permission: { module: "MOD-11", action: "edit" },
      confirm: true,
      describe: "Update a vacancy (description, department).",
    },
    {
      key: "set_vacancy_status",
      service: (c, p, actor) => service.setStatus(c, { id: p.vacancy_id, status: p.status, actor }),
      schema: validator.schemas.aiStatus,
      permission: { module: "MOD-11", action: "edit" },
      confirm: true,
      describe: "Advance a vacancy (DRAFT → OPEN → CLOSED).",
    },
    {
      key: "add_applicant",
      service: (c, p, actor) => (({ vacancy_id, ...data }) => service.addApplicant(c, { vacancyId: vacancy_id, data, actor }))(p),
      schema: validator.schemas.aiApplicant,
      permission: { module: "MOD-11", action: "edit" },
      confirm: true,
      describe: "Add an applicant to a vacancy.",
    },
    {
      key: "set_applicant_status",
      service: (c, p, actor) => service.setApplicantStatus(c, { vacancyId: p.vacancy_id, applicantId: p.applicant_id, status: p.status, startsOn: p.starts_on || null, actor }),
      schema: validator.schemas.aiApplicantStatus,
      permission: { module: "MOD-11", action: "edit" },
      confirm: true,
      describe: "Move an applicant through the pipeline (SHORTLISTED, INTERVIEWED, HIRED, REJECTED, TALENT_POOL).",
    },
  ],
};
