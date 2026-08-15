/**
 * Marketing campaigns (MOD-22) — service layer.
 *
 * F8 (doc/SALES_CRM_FEATURES.md#F8): the campaign register as a
 * budget-and-performance record. Marketing plans a campaign, sets a budget and
 * targets, gets it approved, runs it, and records what it produced.
 *
 * THREE THINGS THIS LAYER OWNS.
 *
 * 1. THE APPROVAL IS A RECORD, NOT A STATUS. `submit`, `approve` and `reject`
 *    each stamp who did it and when, emit their own event, and audit. The
 *    legacy does all three by POSTing `status` to one save endpoint, which is
 *    why its rejection reason is validated in the browser and why nothing
 *    anywhere records who approved a budget.
 *
 * 2. FIELD LOCKS ARE ENFORCED HERE, NOT DECORATED IN THE DRAWER. `rules.
 *    assertEditable` is called on every patch. The legacy sets `readOnly` on
 *    inputs from JS (toggleInputLocking) and its save endpoint accepts every
 *    field in every state, so the lock is a suggestion to anyone holding curl.
 *
 * 3. THE FIGURES ARE HAND-ENTERED AND SAY SO. Writing any actual stamps
 *    `actuals_updated_at` and `actuals_updated_by_user_id`, so the screen can
 *    report when a human last touched them. Nothing here derives leads or wins
 *    from campaign attribution — F8 settles that as out of scope, and the
 *    honesty of the register depends on not pretending otherwise.
 *
 * The newsletter, sender-identity, template and send paths below are unchanged
 * by this slice and must stay that way: F8's definition of done requires that
 * sending a campaign email still works exactly as it did.
 */
"use strict";
const repo = require("./marketing_campaign.repo");
const events = require("./marketing_campaign.events");
const rules = require("./marketing_campaign.rules");
const { assertTransition } = rules;
const { emitEvent, audit } = require("../../../shared/events/emit");
const { enqueue } = require("../../../jobs/queue-producer");
const { AppError } = require("../../../utils/errors");
const ref = (id) => "campaign:" + id;

/** Rows a CSV export will stream before it tells the caller it truncated. */
const EXPORT_CAP = 10000;
async function create(client, { data, actor = {} }) {
  const row = await repo.insert(client, { ...data, owner_user_id: data.owner_user_id || actor.user_id || null });
  await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.campaign_id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.campaign_id), after: row });
  return row;
}

/**
 * Patch a campaign.
 *
 * The state decides which fields are legal (`rules.assertEditable`); the ROUTE
 * decides who may patch at all in that state — a PENDING_APPROVAL or ENDED
 * campaign requires the `approve` permission, everything else requires `edit`.
 * Both halves are needed: without the field rule an approver could rewrite the
 * targets after approving them, and without the route rule the campaign owner
 * could edit their own budget while it sits in front of the approver.
 *
 * Writing an actual stamps who and when. That stamp is the whole basis on which
 * the screen is allowed to say these numbers are hand-entered and as of a date.
 */
async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Campaign not found", 404);

  const fields = {};
  for (const k of repo.WRITABLE) if (patch[k] !== undefined) fields[k] = patch[k];
  if (!Object.keys(fields).length) return before;

  rules.assertEditable(before.status, fields);

  if (rules.touchesActuals(fields)) {
    fields.actuals_updated_at = new Date();
    fields.actuals_updated_by_user_id = actor.user_id || null;
  }

  const row = await repo.update(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: events.UPDATED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  if (rules.touchesActuals(fields)) {
    await emitEvent(client, { eventTypeKey: events.ACTUALS_RECORDED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  }
  return row;
}

/**
 * Ordinary lifecycle moves — submit, pause, resume, end.
 *
 * PENDING_APPROVAL has no exit here at all; `rules.assertTransition` refuses
 * one with a message pointing at approve/reject. That refusal is the point: the
 * target state ACTIVE is reachable both by resuming a paused campaign (the
 * owner's act) and by approving a pending one (the approver's), and an endpoint
 * keyed on the target state cannot tell those apart. Splitting them is what
 * stops a resume being a route to self-approval.
 */
async function transition(client, { id, to, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Campaign not found", 404);
  assertTransition(before.status, to);

  const fields = { status: to };
  if (to === "PENDING_APPROVAL") {
    fields.submitted_at = new Date();
    fields.submitted_by_user_id = actor.user_id || null;
    // A resubmission clears the previous verdict. Leaving a stale rejection
    // reason on a campaign that has since been corrected and sent back is how
    // the drawer ends up showing "reduce by 20%" on a budget already reduced.
    fields.rejection_reason = null;
    fields.rejected_at = null;
    fields.rejected_by_user_id = null;
  }

  const row = await repo.update(client, id, fields);
  const key = to === "PENDING_APPROVAL" ? events.SUBMITTED : events.transition(to);
  await emitEvent(client, { eventTypeKey: key, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: key, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/**
 * Approve a campaign awaiting approval — it goes ACTIVE and its plan locks.
 *
 * Gated on `approve` at the route. Nothing else in the module can reach ACTIVE
 * from PENDING_APPROVAL, so "who approved this budget, and when" has exactly
 * one answer and it is written on the row.
 */
async function approve(client, { id, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Campaign not found", 404);
  const to = rules.assertDecision(before.status, "APPROVE");
  const row = await repo.update(client, id, {
    status: to,
    approved_at: new Date(),
    approved_by_user_id: actor.user_id || null,
    rejection_reason: null,
    rejected_at: null,
    rejected_by_user_id: null,
  });
  await emitEvent(client, { eventTypeKey: events.APPROVED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.APPROVED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

/**
 * Send it back to the planner, with a reason they can act on.
 *
 * The reason is REQUIRED, and required here rather than in the browser. The
 * legacy asks for one in a JS alert (performRejection) and its save endpoint
 * takes `rejection_reason: null` without complaint, so a rejection that skips
 * the screen tells the submitter nothing about what to fix. A CHECK constraint
 * backs this up at the table, so neither this path nor any future one can write
 * a reasonless rejection.
 */
async function reject(client, { id, reason, actor = {} }) {
  const trimmed = String(reason || "").trim();
  if (!trimmed) {
    throw new AppError("REASON_REQUIRED", "Say why it is being sent back — the planner has to know what to change", 422, {
      reason: ["required"],
    });
  }
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Campaign not found", 404);
  const to = rules.assertDecision(before.status, "REJECT");
  const row = await repo.update(client, id, {
    status: to,
    rejection_reason: trimmed,
    rejected_at: new Date(),
    rejected_by_user_id: actor.user_id || null,
    // The submission stamps stay: they are the record of who sent it and when,
    // and the next submit overwrites them. Clearing them here would erase the
    // first half of the exchange the reason is the second half of.
  });
  await emitEvent(client, { eventTypeKey: events.REJECTED, moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.REJECTED, moduleKey: events.MODULE, entityRef: ref(id), before, after: row });
  return row;
}

async function subscribe(client, { email, name, source, actor = {} }) {
  const row = await repo.subscribe(client, { email, name, source });
  await emitEvent(client, { eventTypeKey: events.SUBSCRIBED, moduleKey: events.MODULE, entityRef: "newsletter:" + email, actorUserId: actor.user_id || null });
  return row;
}
async function unsubscribe(client, { email, actor = {} }) {
  const row = await repo.unsubscribe(client, email);
  if (!row) throw new AppError("NOT_FOUND", "Subscriber not found", 404);
  await emitEvent(client, { eventTypeKey: events.UNSUBSCRIBED, moduleKey: events.MODULE, entityRef: "newsletter:" + email, actorUserId: actor.user_id || null });
  return row;
}
/** The row, its owner's name, and the two derived cost-per-lead figures. */
async function get(client, id) {
  const row = await repo.getWithOwner(client, id);
  if (!row) return null;
  return { ...row, cost_per_lead: rules.costPerLead(row), target_cost_per_lead: rules.targetCostPerLead(row) };
}

/**
 * The register and its four KPI tiles in one trip.
 *
 * The tiles are folded in `rules.kpiFrom` from a single aggregate, so the
 * summary and the rows are answering the same WHERE. Conversion is computed
 * from the totals rather than averaged across campaigns — see the note in
 * rules — which is the difference between a tile that is additive and one that
 * flatters a campaign with a single lead and a single win.
 */
async function list(client, q = {}) {
  const { rows, total, agg, limit, offset } = await repo.list(client, q);
  return {
    rows: rows.map((r) => ({ ...r, cost_per_lead: rules.costPerLead(r), target_cost_per_lead: rules.targetCostPerLead(r) })),
    total,
    kpi: rules.kpiFrom(agg),
    limit,
    offset,
  };
}

/** Every matching row, for the CSV export. `truncated` is reported, never hidden. */
const listForExport = (client, q = {}) => repo.listForExport(client, q, EXPORT_CAP);

const subscribers = (client, q) => repo.listSubscribers(client, q);

// --- Sending identities (campaign_sender) ---
const listSenders = (client) => repo.listSenders(client);
async function createSender(client, { data, actor = {} }) {
  const domain = String(data.from_address || "").split("@")[1] || null;
  const row = await repo.insertSender(client, { from_name: data.from_name, from_address: data.from_address, domain });
  await audit(client, { actorUserId: actor.user_id || null, action: "campaign_sender.created", moduleKey: events.MODULE, entityRef: "campaign_sender:" + row.sender_id, after: row });
  return row;
}
async function verifySender(client, { id, actor = {} }) {
  const row = await repo.verifySender(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Sender not found", 404);
  await audit(client, { actorUserId: actor.user_id || null, action: "campaign_sender.verified", moduleKey: events.MODULE, entityRef: "campaign_sender:" + id, after: row });
  return row;
}
async function deleteSender(client, { id, actor = {} }) {
  const row = await repo.deleteSender(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Sender not found", 404);
  await audit(client, { actorUserId: actor.user_id || null, action: "campaign_sender.deleted", moduleKey: events.MODULE, entityRef: "campaign_sender:" + id });
  return row;
}

// --- Email templates (campaign_template) ---
const listTemplates = (client) => repo.listTemplates(client);
const getTemplate = (client, id) => repo.getTemplate(client, id);
async function assertSender(client, senderId) {
  if (!senderId) return;
  const s = await repo.getSender(client, senderId);
  if (!s) throw new AppError("BAD_SENDER", "Unknown sender", 422);
}
async function createTemplate(client, { data, actor = {} }) {
  await assertSender(client, data.from_sender_id);
  const row = await repo.insertTemplate(client, {
    name: data.name, subject: data.subject || null, body_html: data.body_html || null, from_sender_id: data.from_sender_id || null,
  });
  await audit(client, { actorUserId: actor.user_id || null, action: "campaign_template.created", moduleKey: events.MODULE, entityRef: "campaign_template:" + row.template_id, after: row });
  return row;
}
async function updateTemplate(client, { id, data, actor = {} }) {
  const before = await repo.getTemplate(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Template not found", 404);
  await assertSender(client, data.from_sender_id);
  const fields = {};
  for (const k of ["name", "subject", "body_html", "from_sender_id"]) if (data[k] !== undefined) fields[k] = data[k];
  const row = await repo.updateTemplate(client, id, fields);
  await audit(client, { actorUserId: actor.user_id || null, action: "campaign_template.updated", moduleKey: events.MODULE, entityRef: "campaign_template:" + id, after: row });
  return row;
}
async function deleteTemplate(client, { id, actor = {} }) {
  const row = await repo.deleteTemplate(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Template not found", 404);
  await audit(client, { actorUserId: actor.user_id || null, action: "campaign_template.deleted", moduleKey: events.MODULE, entityRef: "campaign_template:" + id });
  return row;
}

/**
 * Per-recipient merge fields.
 *
 * Authors write `{{name}}` in a subject or body and each recipient's copy is
 * rendered from their own subscriber row. Deliberate choices:
 *
 *  - **Unknown tokens are left intact.** `{{firstname}}` renders literally rather
 *    than silently vanishing, so a typo is visible in a test send instead of
 *    producing a blank where a name should be.
 *  - **Values are HTML-escaped in the body, raw in the subject.** `name` is
 *    supplied by whoever hit the public subscribe endpoint, so it's untrusted;
 *    escaping it stops a subscriber injecting markup into every other
 *    recipient's email. Subjects aren't HTML, but newlines are stripped —
 *    a CR/LF there is header injection.
 *  - **`name` falls back to the email's local part**, then to "there", so
 *    "Hi {{name}}," never renders as "Hi ,".
 */
const MERGE_FIELDS = ["name", "email", "campaign", "year"];

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function renderMerge(text, vars, { html = false } = {}) {
  if (!text) return text;
  return String(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key) => {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) return whole;
    const v = vars[key] === null || vars[key] === undefined ? "" : String(vars[key]);
    return html ? escapeHtml(v) : v.replace(/[\r\n]+/g, " ");
  });
}

function mergeVarsFor(subscriber, campaign) {
  const local = String(subscriber.email || "").split("@")[0];
  return {
    name: subscriber.name || local || "there",
    email: subscriber.email || "",
    campaign: campaign.name || "",
    year: String(new Date().getFullYear()),
  };
}

// Send a template to every active newsletter subscriber via the chosen sender.
// Each recipient is a durable "email" queue job (delivered by jobs/handlers/
// email-send.js → email.service.send); `from` overrides the From header with the
// template's sender identity while transport still resolves per-tenant. Subject
// and body are rendered per recipient through the merge fields above.
async function sendCampaign(client, { id, templateId, tenantMeta, env = "live", actor = {} }) {
  const campaign = await repo.get(client, id);
  if (!campaign) throw new AppError("NOT_FOUND", "Campaign not found", 404);
  if (campaign.status === "ENDED") throw new AppError("CAMPAIGN_ENDED", "Campaign has ended", 422);
  const template = await repo.getTemplate(client, templateId);
  if (!template) throw new AppError("BAD_TEMPLATE", "Unknown template", 422);
  let from;
  if (template.from_sender_id) {
    const sender = await repo.getSender(client, template.from_sender_id);
    if (sender) from = sender.from_name ? `"${sender.from_name}" <${sender.from_address}>` : String(sender.from_address);
  }
  const subjectTpl = template.subject || campaign.name;
  const htmlTpl = template.body_html || "";
  const recipients = await repo.listActiveSubscriberEmails(client);
  let queued = 0;
  for (const s of recipients) {
    const vars = mergeVarsFor(s, campaign);
    await enqueue("email", "campaign", {
      tenantMeta, env, to: s.email,
      subject: renderMerge(subjectTpl, vars),
      html: renderMerge(htmlTpl, vars, { html: true }),
      from, purpose: "NOTIFICATIONS", moduleKey: events.MODULE,
    });
    queued += 1;
  }
  await audit(client, { actorUserId: actor.user_id || null, action: "campaign.sent", moduleKey: events.MODULE, entityRef: ref(id), after: { template_id: templateId, queued } });
  return { campaign_id: id, template_id: templateId, queued };
}

module.exports = {
  create, update, transition, approve, reject,
  subscribe, unsubscribe, get, list, listForExport, subscribers, EXPORT_CAP,
  listSenders, createSender, verifySender, deleteSender,
  listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate,
  sendCampaign,
  // Exported for the unit test + so the FE hint list has one source of truth.
  MERGE_FIELDS, renderMerge, mergeVarsFor,
};
