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
const milestone = require("../operations/milestone/milestone.service");
const qTicket = require("../operations/q_ticket/q_ticket.service");
const { emitEvent, audit } = require("../../shared/events/emit");
const { AppError } = require("../../utils/errors");

const round = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Ledger actions an external auditor may see, matched on the first dotted segment
 * of `action`. Finance + procurement + costing + document postings only — anything
 * whose prefix isn't here (permission/role, godmode, user, employee/leave/payroll,
 * attendance, session, access_review …) is excluded, so a new sensitive event is
 * off by default rather than leaked. Kept as an allow-list, not a deny-list, on
 * purpose. GL journals ARE included: they show the debits/credits, never the
 * salary detail behind a payroll run.
 */
const AUDIT_LEDGER_PREFIXES = [
  "invoice", "final_invoice", "credit_note", "journal", "journal_entry", "proforma",
  "advance", "payment", "receipt", "asset", "debt", "tax", "purchase_order",
  "purchase_request", "supplier_invoice", "cash_request", "regie", "costing",
  "document", "quotation",
];

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
 * One dossier's chain as the CLIENT sees it.
 *
 * Scoped twice: the file must belong to this client, and only stages flagged
 * `is_client_visible` are returned — our invoicing and internal handling stages
 * are not a client's business, and that flag is set per stage in the template
 * editor rather than guessed at here.
 *
 * The three-date model collapses to ONE date for a client: the COMMITMENT they
 * were given. Our internal forecast is shown only if the tenant has explicitly
 * turned that on (`showForecastToClient`), because a forecast that moves twice
 * a week reads as a schedule nobody is in control of — a tenant should choose
 * that deliberately.
 *
 * The published assumptions come back alongside, so the dates and the
 * conditions they rest on are read together. That is the whole point of
 * publishing the register.
 */
async function clientChain(client, { clientId, dossierId }) {
  if (!clientId) throw new AppError("CLIENT_REQUIRED", "client_id required", 422);
  const policy = await milestone.resolvePolicy(client);
  const out = await repo.clientDossierChain(client, {
    clientId,
    dossierId,
    showForecast: policy.showForecastToClient === true,
  });
  if (!out) throw new AppError("NOT_FOUND", "No such file for this client", 404);
  return out;
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
 * BASIS: OHADA. PRD open question 4 ("whether the Investor terminal needs a true
 * IFRS view or KPIs suffice") is RESOLVED as OHADA — the books are OHADA and no
 * IFRS restatement layer exists or is planned (revisit only for a concrete
 * IFRS-reporting investor). Labelled `basis: "OHADA"` so nobody downstream assumes
 * otherwise. KPIs are ratios derived from the statements already fetched.
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
  const produits = Number(income.data.produits || 0);
  const kpis = {
    revenue: income.data.produits,
    charges: income.data.charges,
    net_result: income.data.result,
    // Ratios from the figures already fetched — null when there's no revenue to
    // divide by, rather than a misleading 0 or an Infinity.
    net_margin_pct: produits ? round((Number(income.data.result || 0) / produits) * 100) : null,
    expense_ratio_pct: produits ? round((Number(income.data.charges || 0) / produits) * 100) : null,
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
/**
 * Auditor room (PRD §5.3) — a time-boxed, period-and-entity-scoped view for an
 * external auditor. Disclosure policy (see doc/SESSION_HANDOFF.md): the financial
 * statements + trial balance, procurement spend, and a general-ledger/document
 * AUDIT TRAIL with the acting user named — for the period. HR, payroll and
 * security/permission events are excluded by the allow-list in repo.auditLedger,
 * and document BINARIES stay behind the gated vault download (this returns the
 * postings, not the files). Same producers as staff Statements, so no number can
 * disagree with the tenant's own books. Grants are time-boxed via
 * portal_access.expires_at (checkAccess / isGrantUsable).
 */
async function auditorView(client, { params = {} }) {
  const period = resolvePeriod(params);
  const p = { from: period.from, to: period.to, entityId: period.entityId };

  const [income, balance, cashFlow, trial, procurement, auditTrail] = await Promise.all([
    report.run(client, { reportKey: "income_statement", params: p }),
    report.run(client, { reportKey: "balance_sheet", params: p }),
    report.run(client, { reportKey: "cash_flow", params: p }),
    report.run(client, { reportKey: "trial_balance", params: p }),
    report.run(client, { reportKey: "procurement_spend", params: p }),
    repo.auditLedger(client, { from: period.from, to: period.to, prefixes: AUDIT_LEDGER_PREFIXES }),
  ]);

  return {
    portal: "AUDITOR",
    basis: "OHADA",
    period: { from: period.from, to: period.to },
    scope: { entity_id: period.entityId },
    disclosure:
      "Financial statements, general-ledger and document postings, and procurement for the period, with the acting user named. HR, payroll and security/permission events are excluded by policy; document files remain behind the gated vault download.",
    income_statement: income.data,
    balance_sheet: balance.data,
    cash_flow: cashFlow.data,
    trial_balance: trial.data,
    procurement_spend: procurement.data,
    audit_trail: auditTrail,
  };
}

/**
 * Q tickets from the client's side. Every call carries the clientId from the
 * PORTAL SESSION and the service re-checks the dossier belongs to them, so a
 * client cannot raise a query against — or read — someone else's file.
 */
const clientTickets = (client, { clientId }) => qTicket.listForClient(client, clientId);
const clientRaiseTicket = (client, { clientId, dossierId, milestoneInstanceId, subject, body, raisedBy }) =>
  qTicket.raise(client, { clientId, dossierId, milestoneInstanceId, subject, body, raisedBy, raisedByEmail: raisedBy });
const clientTicketDetail = (client, { clientId, ticketId }) =>
  qTicket.detail(client, { ticketId, clientId, forClient: true });
const clientReplyTicket = (client, { clientId, ticketId, body }) =>
  qTicket.reply(client, { ticketId, body, fromClient: true, clientId });

module.exports = {
  grantAccess, revokeAccess, listAccess, checkAccess,
  clientView, clientChain, investorView, auditorView,
  clientTickets, clientRaiseTicket, clientTicketDetail, clientReplyTicket,
};
