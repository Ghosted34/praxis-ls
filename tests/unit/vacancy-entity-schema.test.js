"use strict";
/**
 * The drafting wizard's grounding read, against the schema it actually runs on.
 *
 * WHAT BROKE. `vacancy.repo.getEntity` / `soleEntity` (0526) selected a column
 * called `name` from `corporate_entity`. The column is `legal_name` — it has
 * been since 0100, and every other module reads it by that name. Postgres
 * answered 42703, the error handler turned that into a 500 "A required column
 * is missing", and because BOTH of these run before anything else in the
 * interview, all four drafting endpoints failed on their first call: the wizard
 * could not even ask its first question.
 *
 * WHY A COLUMN TYPO SURVIVED CI. Nothing static could see it. The schema-drift
 * gate compares migrations to each other, not code to migrations; the API
 * contract records routes, not columns; the repo layer has no live database
 * outside the integration suite, which needs Postgres and does not run on a
 * normal PR. The same blind spot produced B5 — `UPDATE session` against a table
 * named `user_session` — and `session-repo-schema.test.js` is its twin.
 *
 * SO THIS DECIDES IT FROM THE FILES. The migrations state which columns
 * `corporate_entity` has; the repo states which it selects. Both are readable
 * without a database, so the question "does this query reference a column that
 * exists?" is answerable on every PR — and the fake client below fails with the
 * same `42703` a real one would, rather than a message about the test.
 */

// The service emits and audits through a live client. Neither is what these
// tests are about, and both would need a real Postgres to look up an event type.
jest.mock("../../src/shared/events/emit", () => ({
  resolveActorId: async (_c, id) => id || null,
  emitEvent: jest.fn().mockResolvedValue(),
  audit: jest.fn().mockResolvedValue(),
}));

const fs = require("fs");
const path = require("path");

const repo = require("../../src/modules/hr/vacancy/vacancy.repo");

const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS = path.join(ROOT, "migrations", "tenant");

/**
 * Every column `corporate_entity` has, read from the migration set: the CREATE
 * TABLE body plus every later ADD COLUMN. Derived rather than listed, so a
 * column added in a future migration is available here the day it lands.
 */
function corporateEntityColumns() {
  const cols = new Set();
  for (const file of fs.readdirSync(MIGRATIONS).sort()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, file), "utf8");

    const created = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+corporate_entity\s*\(([\s\S]*?)\n\s*\)\s*;/i.exec(sql);
    if (created) {
      for (const line of created[1].split("\n")) {
        const m = /^\s*([a-z_][a-z0-9_]*)\s+[a-z]/i.exec(line);
        // Skip table-level constraints, which start with a keyword rather than
        // a column name.
        if (m && !/^(primary|foreign|unique|check|constraint)$/i.test(m[1]))
          cols.add(m[1].toLowerCase());
      }
    }

    // One ALTER TABLE can carry many comma-separated ADD COLUMN clauses — 0515
    // adds thirty in a single statement — so the statement is matched first and
    // every clause inside it second.
    for (const stmt of sql.matchAll(
      /ALTER\s+TABLE\s+(?:ONLY\s+)?corporate_entity\b([\s\S]*?);/gi,
    ))
      for (const m of stmt[1].matchAll(
        /ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z_][a-z0-9_]*)/gi,
      ))
        cols.add(m[1].toLowerCase());
  }
  return cols;
}

/**
 * A client that answers like Postgres: any column in the SELECT list that the
 * migrations do not define fails with 42703, the code the error handler maps to
 * the 500 the user saw.
 */
function fakeClient(columns, row = {}) {
  return {
    queries: [],
    async query(text, params) {
      this.queries.push(text);
      const select = /SELECT\s+([\s\S]*?)\s+FROM\s+corporate_entity/i.exec(text);
      if (select) {
        const selected = select[1]
          .split(",")
          .map((s) => s.trim().split(/\s+/)[0].toLowerCase())
          .filter((s) => s && s !== "*");
        for (const col of selected) {
          if (!columns.has(col)) {
            const err = new Error(`column "${col}" does not exist`);
            err.code = "42703";
            throw err;
          }
        }
      }
      return { rows: [{ entity_id: "e1", ...row }], rowCount: 1, params };
    },
  };
}

describe("vacancy.repo — the hiring entity read (0526)", () => {
  const columns = corporateEntityColumns();

  it("knows the table it is reading", () => {
    // Guards the guard: if the migration parse ever returns nothing, every
    // assertion below would pass vacuously.
    expect(columns.has("entity_id")).toBe(true);
    expect(columns.has("legal_name")).toBe(true);
    expect(columns.has("trading_name")).toBe(true);
    // The name this query used to ask for, and the reason the wizard 500'd.
    expect(columns.has("name")).toBe(false);
  });

  it("getEntity selects only columns that exist", async () => {
    const client = fakeClient(columns);
    await expect(repo.getEntity(client, "e1")).resolves.toMatchObject({
      entity_id: "e1",
    });
  });

  it("soleEntity selects only columns that exist", async () => {
    const client = fakeClient(columns);
    await expect(repo.soleEntity(client)).resolves.toMatchObject({
      entity_id: "e1",
    });
  });

  it("reads the company name from legal_name, which is what the advert prints", async () => {
    const draft = require("../../src/modules/hr/vacancy/vacancy.draft");
    const client = fakeClient(columns, { legal_name: "JBS Praxis SA" });
    const entity = await repo.soleEntity(client);

    // Both places the name reaches a candidate: the prompt's grounding block,
    // and the template advert used when no model is reachable.
    expect(draft.entityContext(entity)).toContain("JBS Praxis SA");
    expect(draft.templateDraft({ entity, answers: { title: "Stylist" } }).description).toContain(
      "JBS Praxis SA",
    );
  });
});

/**
 * Which company is hiring, asked only when it is a real question.
 *
 * `soleEntity` returns a row only when the tenant has EXACTLY ONE active
 * entity — two or more is a null, and the caller is expected to ask. Nothing
 * asked. So on a multi-entity tenant the interview ran with no entity at all:
 * the salary band fell back to a hard-coded currency, the prompt lost the
 * labour market and the grounding block, and the vacancy was written with
 * `entity_id` NULL — which 0526 calls the link from advert to hire that loses
 * the thread. The question is what closes it, and the count has to include it.
 */
describe("vacancy.service — the hiring-entity question (0526)", () => {
  const service = require("../../src/modules/hr/vacancy/vacancy.service");
  const drafting = require("../../src/modules/hr/vacancy/vacancy.draft");
  const repo = require("../../src/modules/hr/vacancy/vacancy.repo");

  const ONE = { entity_id: "e1", legal_name: "JBS Praxis SA", default_currency: "XAF" };
  const TWO = [ONE, { entity_id: "e2", trading_name: "JBS Nigeria", default_currency: "NGN" }];

  afterEach(() => jest.restoreAllMocks());

  it("does not ask a tenant with one company a question with one answer", async () => {
    jest.spyOn(repo, "soleEntity").mockResolvedValue(ONE);
    const list = jest.spyOn(repo, "listHiringEntities");

    const out = await service.intakeQuestions({}, {});
    expect(out.questions).toBe(drafting.BASE_QUESTIONS);
    expect(out.total).toBe(drafting.TOTAL_QUESTIONS);
    expect(out.currency).toBe("XAF");
    expect(out.entity).toEqual({ entity_id: "e1", name: "JBS Praxis SA" });
    // Settled already — no reason to go looking for alternatives.
    expect(list).not.toHaveBeenCalled();
  });

  it("asks a multi-entity tenant first, and counts the question", async () => {
    jest.spyOn(repo, "soleEntity").mockResolvedValue(null);
    jest.spyOn(repo, "listHiringEntities").mockResolvedValue(TWO);

    const out = await service.intakeQuestions({}, {});
    expect(out.questions).toHaveLength(drafting.BASE_QUESTIONS.length + 1);
    expect(out.total).toBe(drafting.TOTAL_QUESTIONS + 1);

    const [first] = out.questions;
    expect(first).toMatchObject({ key: "entity_id", type: "entity" });
    // Each choice carries its own currency, so picking one relabels the salary
    // question without another round trip.
    expect(first.options).toEqual([
      { value: "e1", label: "JBS Praxis SA", currency: "XAF" },
      { value: "e2", label: "JBS Nigeria", currency: "NGN" },
    ]);
    // Nothing is settled until they answer.
    expect(out.entity).toBeNull();
  });

  it("stops asking once an entity has been chosen", async () => {
    jest.spyOn(repo, "getEntity").mockResolvedValue({ ...ONE, entity_id: "e2", default_currency: "NGN" });
    const list = jest.spyOn(repo, "listHiringEntities");

    const out = await service.intakeQuestions({}, { entityId: "e2" });
    expect(out.questions).toBe(drafting.BASE_QUESTIONS);
    expect(out.currency).toBe("NGN");
    expect(list).not.toHaveBeenCalled();
  });
});

/**
 * Pausing, and why it is not "unpublish" (0683).
 *
 * The lifecycle had no way to say "stop taking applications for a fortnight".
 * CLOSED is an ending — it is the `approve` transition, and reopening reads as
 * a new decision — and unpublishing MINTS A NEW TOKEN on the way back, so every
 * candidate holding the old careers URL loses it permanently because somebody
 * paused for a week. PAUSED keeps the token; the public reads already require
 * OPEN, so the role drops off the careers page on its own.
 */
describe("vacancy.service — pause and resume (0683)", () => {
  const service = require("../../src/modules/hr/vacancy/vacancy.service");
  const repo = require("../../src/modules/hr/vacancy/vacancy.repo");
  const { AppError } = require("../../src/utils/errors");

  const vacancy = (status) => ({ vacancy_id: "v1", status, public_token: "tok" });

  function stub(from) {
    jest.spyOn(repo, "findById").mockResolvedValue(vacancy(from));
    const update = jest
      .spyOn(repo, "update")
      .mockImplementation((_c, _id, patch) => Promise.resolve({ ...vacancy(from), ...patch }));
    return update;
  }

  afterEach(() => jest.restoreAllMocks());

  it.each([
    ["OPEN", "PAUSED"],
    ["PAUSED", "OPEN"],
    ["PAUSED", "CLOSED"],
  ])("allows %s → %s", async (from, to) => {
    const update = stub(from);
    const row = await service.setStatus({}, { id: "v1", status: to, actor: {} });
    expect(row.status).toBe(to);
    // The token is never touched by a state change — that is the whole point of
    // pausing rather than unpublishing.
    expect(update.mock.calls[0][2]).not.toHaveProperty("public_token");
    expect(row.public_token).toBe("tok");
  });

  it("refuses to reopen a closed role — that is a new vacancy, not a state change", async () => {
    stub("CLOSED");
    await expect(
      service.setStatus({}, { id: "v1", status: "OPEN", actor: {} }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("refuses to pause a draft that was never open", async () => {
    stub("DRAFT");
    await expect(
      service.setStatus({}, { id: "v1", status: "PAUSED", actor: {} }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

/**
 * Re-scoring everyone, and what a partial failure is allowed to do (0684).
 *
 * Criteria and the job description are what a score MEANS, and both get edited
 * after applicants have arrived — so without this the column silently mixes
 * scores taken against three different versions of the role. What matters here
 * is the failure shape: one unreadable CV must not abandon the other forty, and
 * the caller has to be told how many of each, because "12 scored" with three
 * silently missing is how a shortlist gets trusted more than it should be.
 */
describe("vacancy.service — re-score all (0684)", () => {
  const service = require("../../src/modules/hr/vacancy/vacancy.service");
  const repo = require("../../src/modules/hr/vacancy/vacancy.repo");
  const scoring = require("../../src/modules/hr/vacancy/vacancy.scoring");

  const APPLICANTS = [
    { applicant_id: "a1", full_name: "One" },
    { applicant_id: "a2", full_name: "Two" },
    { applicant_id: "a3", full_name: "Three" },
  ];

  beforeEach(() => {
    jest.spyOn(repo, "findById").mockResolvedValue({ vacancy_id: "v1", title: "Stylist" });
    jest.spyOn(repo, "listApplicants").mockResolvedValue(APPLICANTS);
    jest.spyOn(repo, "listCriteria").mockResolvedValue([]);
    jest.spyOn(repo, "updateApplicant").mockResolvedValue({});
  });
  afterEach(() => jest.restoreAllMocks());

  it("scores every applicant and says how many", async () => {
    jest.spyOn(scoring, "assess").mockResolvedValue({ ai_score: 70 });
    const out = await service.scoreAllApplicants({}, { vacancyId: "v1" });
    expect(out).toMatchObject({ scored: 3, failed: 0, total: 3 });
    expect(repo.updateApplicant).toHaveBeenCalledTimes(3);
  });

  it("keeps going when one candidate fails, and counts it", async () => {
    jest
      .spyOn(scoring, "assess")
      .mockResolvedValueOnce({ ai_score: 70 })
      .mockRejectedValueOnce(new Error("unreadable CV"))
      // A null assessment is a failure too — the model answered, unusably.
      .mockResolvedValueOnce(null);

    const out = await service.scoreAllApplicants({}, { vacancyId: "v1" });
    expect(out).toMatchObject({ scored: 1, failed: 2, total: 3 });
    // The one that worked was still written: a partial run is not rolled back.
    expect(repo.updateApplicant).toHaveBeenCalledTimes(1);
  });

  it("caps the run rather than looping over a popular role forever", async () => {
    jest.spyOn(scoring, "assess").mockResolvedValue({ ai_score: 70 });
    const out = await service.scoreAllApplicants({}, { vacancyId: "v1", limit: 2 });
    expect(out).toMatchObject({ scored: 2, total: 3, skipped: 1 });
  });

  it("is a 404, not an empty result, when the vacancy does not exist", async () => {
    repo.findById.mockResolvedValue(null);
    expect(await service.scoreAllApplicants({}, { vacancyId: "nope" })).toBeNull();
  });
});
