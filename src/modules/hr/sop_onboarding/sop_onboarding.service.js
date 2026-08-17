/**
 * SOP & onboarding (MOD-16). SOP documents with versioning: `newVersion`
 * supersedes the prior document (deactivates it and issues version n+1), so the
 * active set is always the current procedures. Method surface matches the shared
 * controller.
 */
"use strict";
const repo = require("./sop_onboarding.repo");
const events = require("./sop_onboarding.events");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const drafting = require("./sop.draft");
const templates = require("../../documents/template/template.service");

/** The columns 0704 added, in one list so create, update and newVersion cannot
 *  drift about which of them a procedure carries. */
const SOP_FIELDS = [
  "title", "category", "vault_id", "body_md", "summary", "scope", "department",
  "owner_role", "effective_on", "review_on",
];

const ref = (id) => "sop_document:" + id;

module.exports = {
  __entityMeta: { entity: "sop_onboarding", table: "sop_document", pk: "sop_document_id", activeColumn: "is_active" },

  list: (client, q) => repo.list(client, q),
  get: (client, id) => repo.findById(client, id),

  async create(client, { data, actor = {} }) {
    const row = await repo.insert(client, { ...data, version_no: data.version_no || 1, is_active: data.is_active ?? true });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.sop_document_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.sop_document_id), after: row });
    return row;
  },

  async update(client, { id, patch, actor = {} }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    const row = await repo.update(client, id, patch);
    await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
    return row;
  },

  /** Supersede a SOP: deactivate the current version, issue version n+1. */
  async newVersion(client, { id, patch = {}, actor = {} }) {
    const current = await repo.findById(client, id);
    if (!current) throw new AppError("NOT_FOUND", "SOP not found", 404);
    await repo.update(client, id, { is_active: false });
    /*
     * The new version INHERITS the old one's text and scope.
     *
     * Before 0704 this copied the title, the category and nothing else, which
     * was harmless when an SOP was a title and an uploaded file. Now that the
     * procedure's words live in `body_md`, copying only the title would mean
     * superseding a written procedure produces a BLANK one — the most
     * destructive possible reading of "new version", and silent.
     *
     * `pdf_vault_id` is deliberately NOT carried: the new version has not been
     * rendered yet, and pointing at the previous version's PDF would hand
     * somebody last month's procedure under this month's version number.
     */
    const inherited = {};
    for (const k of SOP_FIELDS) {
      inherited[k] = patch[k] !== undefined ? patch[k] : current[k];
    }
    const next = await repo.insert(client, {
      ...inherited,
      vault_id: patch.vault_id || null,
      ai_generated: current.ai_generated,
      ai_model: current.ai_model,
      version_no: (current.version_no || 1) + 1,
      is_active: true,
    });
    await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(next.sop_document_id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: "sop.new_version", moduleKey: events.MODULE, entityRef: ref(next.sop_document_id), before: current, after: next });
    return next;
  },

  /**
   * Draft the procedure's text from what the tenant told us (0704).
   *
   * The model writes the PROSE; every fact that binds anybody — the scope, the
   * department, the owning role, the effective date, the house rules it backs —
   * is passed in and written from the caller's own input, never read back out
   * of the draft. An SOP is what a lateness deduction is justified against, so
   * a clause a model invented is one the company never agreed and the system
   * will then charge people for.
   *
   * Never throws on the model's account: a tenant with no AI vendor still gets
   * an editable skeleton, and `ai_generated` records which they got.
   */
  async draft(client, { id, input = {}, actor = {} }) {
    const before = await repo.findById(client, id);
    if (!before) throw new AppError("NOT_FOUND", "SOP not found", 404);

    // The house rules this procedure is the written basis for, by NAME, so the
    // document states what it enforces rather than referring to an id.
    const { rows: rules } = await client.query(
      "SELECT name, description FROM hr_rule WHERE sop_document_id = $1 ORDER BY code",
      [id],
    );

    const facts = {
      title: input.title || before.title,
      scope: input.scope || before.scope,
      department: input.department !== undefined ? input.department : before.department,
      owner_role: input.owner_role !== undefined ? input.owner_role : before.owner_role,
      category: input.category !== undefined ? input.category : before.category,
      effective_on: input.effective_on !== undefined ? input.effective_on : before.effective_on,
      purpose: input.purpose || before.summary || "",
      steps: input.steps,
      rules: rules.map((r) => r.name),
    };
    const drafted = await drafting.draft(client, facts);

    const row = await repo.update(client, id, {
      body_md: drafted.body_md,
      ai_generated: drafted.ai_generated,
      ai_model: drafted.ai_model,
      ai_drafted_at: new Date().toISOString(),
      // The facts travel to their own columns from the INPUT, not from the
      // draft — see the header.
      title: facts.title,
      scope: facts.scope,
      department: facts.department,
      owner_role: facts.owner_role,
      category: facts.category,
      effective_on: facts.effective_on,
      summary: input.purpose !== undefined ? input.purpose : before.summary,
    });
    await audit(client, { actorUserId: actor.user_id || null, action: "sop.drafted", moduleKey: events.MODULE, entityRef: ref(id), before, after: { ai_generated: drafted.ai_generated, ai_model: drafted.ai_model } });
    return row;
  },

  /**
   * Render the procedure to a real PDF and file it in the vault.
   *
   * REFUSES on an empty body. 0700 found that the contract renderer produced a
   * letterhead, two parties and a signature block with no clauses between them,
   * and that every contract the product had ever issued was a blank form —
   * because nobody notices: the PDF looks entirely correct until it is read.
   * The same renderer shape is used here, so the same failure is available, and
   * refusing is the only honest answer.
   *
   * `pdf_vault_id` is its own column and NOT `vault_id`: the latter is whatever
   * a human uploaded, and a tenant may hold a signed original alongside the
   * generated one. Overwriting it would destroy the signed copy.
   */
  async renderPdf(client, { id, actor = {} }) {
    const before = await repo.findById(client, id);
    if (!before) throw new AppError("NOT_FOUND", "SOP not found", 404);
    if (!String(before.body_md || "").trim()) {
      throw new AppError(
        "SOP_HAS_NO_TEXT",
        "This procedure has no text, so a PDF would print a letterhead and a signature block with nothing between them. Draft or write the body first.",
        422,
      );
    }
    // `generate`, not `renderPdfFromData`: the latter takes already-computed
    // data (reports, tax filings), while this is a RECORD — `generate` loads it
    // through the same builder the template Studio previews with, so what is
    // filed and what an admin sees on screen cannot diverge.
    const built = await templates.generate(client, { docType: "SOP_DOCUMENT", recordId: id, actor });
    const row = await repo.update(client, id, {
      pdf_vault_id: built.doc_id,
      pdf_rendered_at: new Date().toISOString(),
    });
    await emitEvent(client, { eventTypeKey: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: "sop.rendered", moduleKey: events.MODULE, entityRef: ref(id), after: { pdf_vault_id: built.doc_id } });
    return row;
  },

  async archive(client, { id, actor = {} }) {
    const before = await repo.findById(client, id);
    if (!before) return null;
    await repo.update(client, id, { is_active: false });
    await client.query("INSERT INTO soft_delete (entity_ref, payload_json, deleted_by) VALUES ($1,$2,$3)", [ref(id), before, actor.user_id || null]);
    await emitEvent(client, { eventTypeKey: events.ARCHIVED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
    await audit(client, { actorUserId: actor.user_id || null, action: events.ARCHIVED, moduleKey: events.MODULE, entityRef: ref(id), before });
    return { archived: true, sop_document_id: id };
  },
};
