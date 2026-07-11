"use strict";
const { makeRepo } = require("../../../shared/crud/resource");
const { insertOne, updateOne, getById } = require("../../../shared/db/query-helpers");

// vacancy head + job_applicant children. All SQL lives here.
const base = makeRepo({
  table: "vacancy",
  pk: "vacancy_id",
  activeColumn: null,
  searchColumn: "title",
  orderBy: "created_at DESC",
});

module.exports = {
  ...base,
  insertApplicant: (client, data) => insertOne(client, "job_applicant", data),
  getApplicant: (client, id) => getById(client, "job_applicant", "applicant_id", id),
  updateApplicant: (client, id, patch) => updateOne(client, "job_applicant", "applicant_id", id, patch),
  async listApplicants(client, vacancyId) {
    const { rows } = await client.query(
      "SELECT * FROM job_applicant WHERE vacancy_id = $1 ORDER BY created_at DESC",
      [vacancyId],
    );
    return rows;
  },
};
