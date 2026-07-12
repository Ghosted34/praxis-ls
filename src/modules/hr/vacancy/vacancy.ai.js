/** AI action manifest (AI_READINESS Rule 1) for vacancies / recruitment. */
"use strict";

const service = require("./vacancy.service");
const validator = require("./vacancy.validator");

module.exports = {
  entity: "vacancy",
  module_key: "MOD-11",
  screens: ["vacancies"],

  reads: [
    { key: "list_vacancies", service: service.list, describe: "List job vacancies." },
    { key: "get_vacancy", service: service.get, describe: "Get one vacancy by id." },
    { key: "list_applicants", service: service.listApplicants, describe: "List applicants for a vacancy." },
  ],

  writes: [
    {
      key: "create_vacancy",
      service: service.create,
      schema: validator.schemas.create,
      permission: { module: "MOD-11", action: "create" },
      confirm: true,
      describe: "Create a job vacancy (optionally AI-generated).",
    },
    {
      key: "update_vacancy",
      service: service.update,
      schema: validator.schemas.update,
      permission: { module: "MOD-11", action: "edit" },
      confirm: true,
      describe: "Update a vacancy (description, department).",
    },
    {
      key: "set_vacancy_status",
      service: service.setStatus,
      schema: validator.schemas.status,
      permission: { module: "MOD-11", action: "edit" },
      confirm: true,
      describe: "Advance a vacancy (DRAFT → OPEN → CLOSED).",
    },
    {
      key: "add_applicant",
      service: service.addApplicant,
      schema: validator.schemas.applicant,
      permission: { module: "MOD-11", action: "edit" },
      confirm: true,
      describe: "Add an applicant to a vacancy.",
    },
    {
      key: "set_applicant_status",
      service: service.setApplicantStatus,
      schema: validator.schemas.applicantStatus,
      permission: { module: "MOD-11", action: "edit" },
      confirm: true,
      describe: "Move an applicant through the pipeline (SHORTLISTED, INTERVIEWED, HIRED, REJECTED, TALENT_POOL).",
    },
  ],
};
