"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { insertOne, updateOne, getById, listComplete } = require("../../../shared/db/query-helpers");

// vacancy head + job_applicant children. All SQL lives here.
const base = makeRepo({
  table: "vacancy",
  pk: "vacancy_id",
  activeColumn: null,
  searchColumn: "title",
  orderBy: "created_at DESC",
  // First adopter of record-level scope (audit finding A2). The mechanism has
  // existed since scopes were wired into requirePermission and NO repo declared
  // a column, so `req.scope_ids` was computed on every request and filtered
  // nothing. 0490 gave this table a scope_id, so it can opt in.
  //
  // Effect: a user assigned to a branch sees that branch's vacancies and those
  // beneath it (the closure). A user with no assignment is unrestricted, as
  // before, and a vacancy with no scope stays visible to everyone.
  scopeColumn: "scope_id",
  // API F-29: explicit allow-list; anything else is refused, not interpolated.
  sortable: ["created_at", "title"],
  // API F-28: this repo uses makeRepo's list unchanged, which honours only
  // limit/offset/q — any other key was silently ignored. Now it is named.
  filterable: [],
});

module.exports = {
  ...base,
  insertApplicant: (client, data) => insertOne(client, "job_applicant", data),
  getApplicant: (client, id) => getById(client, "job_applicant", "applicant_id", id),
  updateApplicant: (client, id, patch) => updateOne(client, "job_applicant", "applicant_id", id, patch),
  async listApplicants(client, vacancyId) {
    const { rows } = await listComplete(client, "SELECT * FROM job_applicant WHERE vacancy_id = $1 ORDER BY created_at DESC", [vacancyId], { label: "Job applicants", ceiling: 5000 });
    return rows;
  },
};
