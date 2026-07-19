/** Marketing campaigns (MOD-22) — campaign lifecycle + newsletter list. SQL in repo. */
"use strict";
const repo = require("./marketing_campaign.repo");
const events = require("./marketing_campaign.events");
const { assertTransition } = require("./marketing_campaign.rules");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { enqueue } = require("../../../jobs/queue-producer");
const { AppError } = require("../../../utils/errors");
const ref = (id) => "campaign:" + id;
async function create(client, { data, actor = {} }) {
  const row = await repo.insert(client, { name: data.name, channel: data.channel || null, status: "DRAFT", starts_on: data.starts_on || null, ends_on: data.ends_on || null, assets_json: JSON.stringify(data.assets || {}) });
  await emitEvent(client, { eventTypeKey: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.campaign_id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.CREATED, moduleKey: events.MODULE, entityRef: ref(row.campaign_id), after: row });
  return row;
}
async function transition(client, { id, to, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Campaign not found", 404);
  assertTransition(before.status, to);
  const row = await repo.update(client, id, { status: to });
  await emitEvent(client, { eventTypeKey: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.transition(to), moduleKey: events.MODULE, entityRef: ref(id), after: row });
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
const get = (client, id) => repo.get(client, id);
const list = (client, q) => repo.list(client, q);
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
  create, transition, subscribe, unsubscribe, get, list, subscribers,
  listSenders, createSender, verifySender, deleteSender,
  listTemplates, getTemplate, createTemplate, updateTemplate, deleteTemplate,
  sendCampaign,
  // Exported for the unit test + so the FE hint list has one source of truth.
  MERGE_FIELDS, renderMerge, mergeVarsFor,
};
