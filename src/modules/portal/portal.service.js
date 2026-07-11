/**
 * Portals — external-facing, scoped read surfaces (Client / Investor / Auditor)
 * plus the portal_access grant management. Access grants are time-boxed
 * (auditor) and email-scoped; the data views delegate to the services that
 * already own the numbers (report, receivables, dossier) — no new business
 * logic, just scoping. External-user authentication (magic link / portal token)
 * is a separate surface; today the views are internally gated so staff can grant
 * + preview a client's/investor's/auditor's exact scope. SQL is in the repo.
 */
"use strict";

const repo = require("./portal.repo");
const events = require("./portal.events");
const { isGrantUsable } = require("./portal.rules");
const report = require("../vault/report/report.service");
const receivables = require("../finance/smart_receivables/smart_receivables.service");
const { emitEvent, audit } = require("../../shared/events/emit");
const { AppError } = require("../../utils/errors");

// ── Access grants ──
async function grantAccess(client, { portal, subjectEmail, clientId = null, expiresAt = null, actor = {} }) {
  if (!["CLIENT", "INVESTOR", "AUDITOR"].includes(portal)) throw new AppError("BAD_PORTAL", "portal must be CLIENT/INVESTOR/AUDITOR", 422);
  if (portal === "CLIENT" && !clientId) throw new AppError("CLIENT_REQUIRED", "a CLIENT portal grant needs a client_id scope", 422);
  const row = await repo.insertAccess(client, { portal, subject_email: String(subjectEmail).toLowerCase(), client_id: clientId, expires_at: expiresAt });
  await emitEvent(client, { eventTypeKey: events.ACCESS_GRANTED, moduleKey: events.MODULE, entityRef: "portal_access:" + row.portal_access_id, actorUserId: actor.user_id || null, priority: "HIGH" });
  await audit(client, { actorUserId: actor.user_id || null, action: events.ACCESS_GRANTED, moduleKey: events.MODULE, entityRef: "portal_access:" + row.portal_access_id, after: row });
  return row;
}
async function revokeAccess(client, { id, actor = {} }) {
  const row = await repo.revoke(client, id);
  if (!row) throw new AppError("NOT_FOUND", "Active grant not found", 404);
  await emitEvent(client, { eventTypeKey: events.ACCESS_REVOKED, moduleKey: events.MODULE, entityRef: "portal_access:" + id, actorUserId: actor.user_id || null });
  await audit(client, { actorUserId: actor.user_id || null, action: events.ACCESS_REVOKED, moduleKey: events.MODULE, entityRef: "portal_access:" + id, after: row });
  return { revoked: true };
}
const listAccess = (client, q) => repo.listAccess(client, q);
async function checkAccess(client, { email, portal }) {
  const grant = await repo.activeFor(client, String(email || "").toLowerCase(), portal);
  return { allowed: isGrantUsable(grant), grant: grant || null };
}

// ── Portal data views (scoped, delegated) ──
async function clientView(client, { clientId }) {
  if (!clientId) throw new AppError("CLIENT_REQUIRED", "client_id required", 422);
  const [dossiers, invoices, ageing] = await Promise.all([
    repo.clientDossiers(client, clientId),
    repo.clientInvoices(client, clientId),
    receivables.ageing(client, { clientId }),
  ]);
  return { portal: "CLIENT", client_id: clientId, dossiers, invoices, receivables_ageing: ageing };
}
async function investorView(client, { params = {} }) {
  const [income, cash] = await Promise.all([
    report.run(client, { reportKey: "income_statement", params }),
    report.run(client, { reportKey: "cash_position", params }),
  ]);
  return { portal: "INVESTOR", income_statement: income.data, cash_position: cash.data };
}
async function auditorView(client, { params = {} }) {
  const compliance = await report.run(client, { reportKey: "procurement_spend", params });
  return { portal: "AUDITOR", note: "Time-boxed audit room. Reuses vault + audit ledger + reporting.", procurement_spend: compliance.data };
}

module.exports = { grantAccess, revokeAccess, listAccess, checkAccess, clientView, investorView, auditorView };
