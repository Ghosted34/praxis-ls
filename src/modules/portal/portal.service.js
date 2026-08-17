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
const vault = require("../vault/document_vault/document_vault.service");
const pdf = require("../../services/pdf.service");
const quoteRequest = require("../sales/quote_request/quote_request.service");
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

/** The client's own documents (PRD §11.1 "document vault — own docs"). */
async function clientDocuments(client, { clientId }) {
  if (!clientId) throw new AppError("CLIENT_REQUIRED", "client_id required", 422);
  return repo.clientDocuments(client, clientId);
}

/**
 * A client-visible document's bytes. The ownership + visibility check happens
 * in SQL (repo.clientDocument), so a client can only ever download their own
 * client-visible files — the same scoping as the rest of the portal.
 */
async function clientDocumentDownload(client, { clientId, docId }) {
  if (!clientId) throw new AppError("CLIENT_REQUIRED", "client_id required", 422);
  const doc = await repo.clientDocument(client, clientId, docId);
  if (!doc) throw new AppError("NOT_FOUND", "No such document for this client", 404);
  const buffer = await vault.fetchBytes(client, doc.doc_id);
  return { doc, buffer };
}

// ── Client onboarding command centre (PRD §11.1) ─────────────────────────────

/** The baseline checklist every client starts from. Seeded on first read;
 *  tenants extend per-client later without a migration. */
const ONBOARDING_DEFAULTS = [
  { key: "COMPANY_PROFILE", en: "Company profile completed", fr: "Profil d'entreprise complété", sort: 10 },
  { key: "KYC_DOCUMENTS", en: "KYC documents received", fr: "Documents KYC reçus", sort: 20 },
  { key: "SERVICE_AGREEMENT", en: "Service agreement signed", fr: "Convention de service signée", sort: 30 },
  { key: "FIRST_BOOKING", en: "First shipment booked", fr: "Première expédition réservée", sort: 40 },
];

async function clientOnboarding(client, { clientId }) {
  if (!clientId) throw new AppError("CLIENT_REQUIRED", "client_id required", 422);
  await repo.seedOnboarding(client, clientId, ONBOARDING_DEFAULTS);
  const steps = await repo.onboardingSteps(client, clientId);
  const done = steps.filter((s) => s.done).length;
  return { client_id: clientId, steps, progress: steps.length ? Math.round((done / steps.length) * 100) : 0 };
}

/** Staff toggle a step (done ↔ undone) and record who did it. */
async function toggleOnboardingStep(client, { clientId, stepKey, actor }) {
  if (!clientId) throw new AppError("CLIENT_REQUIRED", "client_id required", 422);
  const row = await repo.markOnboardingStep(client, clientId, stepKey, actor.user_id || null);
  if (!row) throw new AppError("NOT_FOUND", "No such onboarding step for this client", 404);
  await audit(client, {
    actorUserId: actor.user_id || null, action: row.done ? "portal.onboarding_step_done" : "portal.onboarding_step_undone",
    moduleKey: events.MODULE, entityRef: "client_onboarding:" + clientId, after: { step_key: stepKey, done: row.done },
  });
  return row;
}

// ── Client portal secure messaging (PRD §11.1) ───────────────────────────────

const clientMessages = (client, { clientId, dossierId }) =>
  repo.clientMessages(client, clientId, { dossierId });

/** A message from the client's side of the thread. */
async function sendClientMessage(client, { clientId, body, dossierId, authorEmail }) {
  if (!clientId) throw new AppError("CLIENT_REQUIRED", "client_id required", 422);
  const row = await repo.insertClientMessage(client, {
    clientId, dossierId: dossierId || null, direction: "CLIENT", body, authorEmail,
  });
  await emitEvent(client, { eventTypeKey: "portal.client_message", moduleKey: events.MODULE, entityRef: "client_message:" + row.message_id, actorUserId: null });
  return row;
}

/** A reply from the account team. */
async function staffSendMessage(client, { clientId, body, dossierId, actor }) {
  if (!clientId) throw new AppError("CLIENT_REQUIRED", "client_id required", 422);
  const row = await repo.insertClientMessage(client, {
    clientId, dossierId: dossierId || null, direction: "STAFF", body, authorUserId: actor.user_id || null,
  });
  await emitEvent(client, { eventTypeKey: "portal.client_message", moduleKey: events.MODULE, entityRef: "client_message:" + row.message_id, actorUserId: actor.user_id || null });
  return row;
}

const staffMessages = (client, { clientId, dossierId }) =>
  repo.clientMessages(client, clientId, { dossierId });

/**
 * The certified PDF of a thread (PRD §11.1). Renders the conversation, stores
 * it in the vault (content hash + QR verification token), and streams the
 * bytes back — the chat export is a document like any other, and the hash
 * proves it has not been edited since.
 */
async function exportClientChat(client, { clientId }) {
  if (!clientId) throw new AppError("CLIENT_REQUIRED", "client_id required", 422);
  const messages = await repo.clientMessages(client, clientId, { limit: 500 });
  const rows = messages.map((m) => ({
    direction: m.direction,
    author: m.direction === "STAFF" ? (m.author_name || "Account team") : (m.author_email || "Client"),
    body: m.body,
    at: m.created_at,
  }));
  const html = chatHtml(rows);
  const entityRef = `client_chat:${clientId}:${Date.now()}`;
  const key = `documents/client-chat/${clientId}-${Date.now()}.pdf`;
  // docType null: no registry type fits a chat export, and capture allows a
  // null type for exactly this case (placeholder/uncategorised captures).
  const out = await pdf.renderAndStore(client, { html, key, entityRef, docType: null });
  const { buffer } = await vault.fetchBytes(client, out.doc_id);
  return { buffer, verify: out.verify, doc_id: out.doc_id, count: rows.length };
}

function chatHtml(rows) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const items = rows.map((m) =>
    `<div style="margin:0 0 12px;padding:10px 14px;border-radius:10px;background:${m.direction === "STAFF" ? "#eef2f7" : "#fdf1e3"};border:1px solid #e3e9f2">
       <div style="font-size:11px;color:#64748b;margin-bottom:4px">${esc(m.author)} · ${esc(String(m.at).slice(0, 16).replace("T", " "))}</div>
       <div style="font-size:13px;color:#0b2030;white-space:pre-wrap">${esc(m.body)}</div>
     </div>`).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4;margin:18mm}body{font-family:Roboto,'Noto Sans',sans-serif;color:#0b2030}h1{font-size:16px;margin:0 0 4px}p.lead{font-size:12px;color:#64748b;margin:0 0 20px}</style></head><body>
    <h1>Client portal — conversation</h1>
    <p class="lead">Exported from the client portal. Verified by content hash.</p>
    ${items || "<p>No messages.</p>"}
  </body></html>`;
}

// ── Self-service quoting (PRD §11.1) ─────────────────────────────────────────

const clientQuoteRequests = (client, { clientId }) =>
  repo.clientQuoteRequests(client, clientId);

/** A signed-in client books a quote for themselves. The request is filed
 *  against their client record with intake_channel PORTAL, so sales sees it in
 *  the same intake queue as website and manual requests. */
async function createClientQuote(client, { clientId, data, actor }) {
  if (!clientId) throw new AppError("CLIENT_REQUIRED", "client_id required", 422);
  const { rows } = await client.query(
    "SELECT name, email FROM client_master WHERE client_id = $1", [clientId],
  );
  const cm = rows[0];
  const row = await quoteRequest.create(client, {
    data: {
      ...data,
      client_id: clientId,
      intake_channel: "PORTAL",
      requester_name: data.requester_name || cm?.name || null,
      requester_email: data.requester_email || cm?.email || null,
    },
    actor,
  });
  return row;
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
  clientDocuments, clientDocumentDownload,
  clientOnboarding, toggleOnboardingStep,
  clientMessages, sendClientMessage, staffSendMessage, staffMessages, exportClientChat,
  clientQuoteRequests, createClientQuote,
};
