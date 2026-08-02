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
/**
 * Default reporting window for the investor terminal.
 *
 * WHY THIS EXISTS. The statement producers take optional `from`/`to` and, given
 * neither, sum the ENTIRE validated ledger — inception-to-date. That is a
 * defensible trial balance and a meaningless income statement: "revenue" would be
 * every franc the company has ever billed, growing forever and comparable to
 * nothing. So an investor view with no period is not a neutral default, it is a
 * wrong one. Defaults to the current calendar year, which is the OHADA fiscal
 * year unless a tenant has said otherwise; an explicit ?from/?to still wins.
 */
function resolvePeriod(params) {
  const to = params.to || new Date().toISOString().slice(0, 10);
  const from = params.from || `${new Date(to).getUTCFullYear()}-01-01`;
  return { from, to, entityId: params.entityId || params.entity_id || null };
}

/**
 * Investor / Board terminal (PRD §5.2): read-only KPIs and financial statements,
 * **no operational detail** — no dossiers, no clients, no per-shipment margin.
 * That boundary is the whole point of the tier, so it is enforced by what this
 * function fetches rather than by what the UI chooses to render.
 *
 * Every producer here is the same one the staff Statements screen uses, so an
 * investor cannot be shown a number that disagrees with the tenant's own books.
 *
 * NOT an IFRS view. PRD open question 4 ("whether the Investor terminal needs a
 * true IFRS view or KPIs suffice") is still unanswered, so this is OHADA as kept.
 * Labelled as such in the payload so nobody downstream assumes otherwise.
 */
async function investorView(client, { params = {} }) {
  const period = resolvePeriod(params);
  const p = { from: period.from, to: period.to, entityId: period.entityId };

  const [income, balance, cashPos, cashFlow] = await Promise.all([
    report.run(client, { reportKey: "income_statement", params: p }),
    report.run(client, { reportKey: "balance_sheet", params: p }),
    report.run(client, { reportKey: "cash_position", params: p }),
    report.run(client, { reportKey: "cash_flow", params: p }),
  ]);

  // Headline figures derived from the statements ALREADY fetched — no extra
  // query, and no second definition of "revenue" that could drift from the
  // Compte de résultat sitting beside it on the same screen.
  const kpis = {
    revenue: income.data.produits,
    charges: income.data.charges,
    net_result: income.data.result,
    // cash_position is a point-in-time class-5 balance and ignores from/to by
    // design — "cash on hand" means today, not "cash during the period".
    cash_on_hand: (cashPos.data && cashPos.data.total_cash) ?? 0,
    balance_sheet_total: balance.data.active,
  };

  return {
    portal: "INVESTOR",
    basis: "OHADA",
    period: { from: period.from, to: period.to },
    kpis,
    income_statement: income.data,
    balance_sheet: balance.data,
    cash_position: cashPos.data,
    cash_flow: cashFlow.data,
  };
}
async function auditorView(client, { params = {} }) {
  const compliance = await report.run(client, { reportKey: "procurement_spend", params });
  return { portal: "AUDITOR", note: "Time-boxed audit room. Reuses vault + audit ledger + reporting.", procurement_spend: compliance.data };
}

module.exports = { grantAccess, revokeAccess, listAccess, checkAccess, clientView, investorView, auditorView };
