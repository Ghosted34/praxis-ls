"use strict";
const { makeController } = require("../../../shared/crud/resource");
const { asyncHandler, AppError } = require("../../../utils/errors");
const service = require("./hr_contract.service");
const repo = require("./hr_contract.repo");
const drafter = require("./hr_contract.draft");

const base = makeController(service, "Contract");

module.exports = {
  ...base,
  mine: asyncHandler(async (req, res) => {
    const eid = req.user.employee_id;
    if (!eid) return res.json({ data: [] });
    return res.json({ data: await req.tenantDb((c) => service.list(c, { employee_id: eid })) });
  }),
  /**
   * Draft the contract text with the model.
   *
   * ── WHY THIS IS THREE db CALLS AND NOT ONE ──────────────────────────────
   *
   * The model call takes seconds, and this deployment runs a
   * 12-connection-per-tenant ceiling — holding a pooled connection across it is
   * how one slow provider takes the whole tenant's pool. So: read the context
   * and release, call the model with no connection held, then write.
   *
   * `llm.chat` is given the client only to resolve the tenant's configured
   * vendor, which is why that read is its own short-lived call rather than
   * being folded into the write below.
   */
  draftFor: asyncHandler(async (req, res) => {
    const id = req.params.id;
    const context = await req.tenantDb(async (c) => ({
      row: await repo.context(c, id),
      sopTitles: await repo.sopTitles(c),
    }));
    if (!context.row) throw new AppError("NOT_FOUND", "Contract not found", 404);
    const row = context.row;
    const body = req.body || {};

    // What the model is told. The employee's current job title and salary are
    // OFFERED as defaults where the caller stated nothing — an HR officer
    // drafting a confirmation letter for somebody already employed should not
    // have to retype what the system knows. Anything the caller did state wins.
    const terms = {
      title: body.title,
      entity_id: body.entity_id ?? row.entity_id ?? null,
      job_title: body.job_title ?? row.employee_job_title ?? row.vacancy_title ?? null,
      effective_on: body.effective_on ?? row.effective_on ?? null,
      end_on: body.end_on ?? row.end_on ?? null,
      gross_salary: body.gross_salary ?? (row.base_salary === null ? null : Number(row.base_salary)),
      salary_currency: body.salary_currency || "XAF",
      probation_months: body.probation_months ?? null,
      notice_days: body.notice_days ?? drafter.DEFAULT_NOTICE_DAYS,
      working_hours: body.working_hours ?? null,
      place_of_work: body.place_of_work ?? null,
      vacancy_id: body.vacancy_id ?? row.vacancy_id ?? null,
    };

    const draft = await req.tenantDb((c) =>
      drafter.draft(c, {
        ...terms,
        kind: row.kind,
        employee_name: row.employee_name,
        department: row.department,
        entity_name: row.entity_name,
        entity_country: row.entity_country,
        sop_titles: context.sopTitles,
      }));

    const saved = await req.tenantDb((c) =>
      service.applyDraft(c, { id, draft, terms, actor: req.user || { user_id: null } }));
    if (!saved) throw new AppError("NOT_FOUND", "Contract not found", 404);
    res.json({ data: saved });
  }),

  /**
   * Renew a contract (10708) — the new DRAFT lands on top of the list, terms
   * carried over, ready to be drafted with the new dates and sent.
   */
  renewFor: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) =>
      service.renew(c, {
        id: req.params.id,
        effective_on: req.body.effective_on ?? null,
        end_on: req.body.end_on ?? null,
        actor: req.user || { user_id: null },
      }));
    if (!row) throw new AppError("NOT_FOUND", "Contract not found", 404);
    res.status(201).json({ data: row });
  }),

  /** What lapses soon — the query nothing could answer before 0700. */
  lapsing: asyncHandler(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 60, 1), 365);
    const data = await req.tenantDb(async (c) => ({
      expiring: await repo.lapsingWithin(c, { days, kind: "expiry" }),
      probation: await repo.lapsingWithin(c, { days, kind: "probation" }),
    }));
    res.json({ data });
  }),

  setStatus: asyncHandler(async (req, res) => {
    const row = await req.tenantDb((c) => service.setStatus(c, { id: req.params.id, status: req.body.status, actor: req.user || { user_id: null } }));
    if (!row) throw new AppError("NOT_FOUND", "Contract not found", 404);
    res.json({ data: row });
  }),
};
