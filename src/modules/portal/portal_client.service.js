/**
 * Client portal (redesign, PR 1) — what the new client screens read and do.
 *
 * The first portal answered "does a shipment exist" and "is there an invoice".
 * A client could not send the document we were waiting for, could not tell us
 * they had paid, could not see where a shipment had got to without opening it,
 * and could not add a colleague. This service is those four things, plus the
 * staff half of each (review an upload, confirm a payment claim, ask for a
 * document), because a portal where the client can act and nobody on our side
 * can answer is worse than one where nobody can act.
 *
 * ── RULES THAT HOLD EVERYWHERE BELOW ───────────────────────────────────────
 *
 *   · `clientId` comes from the portal GRANT (controller), never the request.
 *     Everything is re-scoped to it in SQL (portal_client.repo), and a row that
 *     is not this client's is reported as NOT_FOUND, never as FORBIDDEN.
 *   · A client can PROPOSE and never POST. An upload is a PENDING vault row
 *     until staff accept it; a payment claim is a `payment_proof` until finance
 *     confirms it, and confirming only DRAFTS a receipt through the receivables
 *     service, whose posting keeps its own approval.
 *   · Every staff decision is audited, and every client submission raises an
 *     event the notification layer routes to the people who work it.
 */
"use strict";

const crypto = require("crypto");
const repo = require("./portal_client.repo");
const bundles = require("./invoice_bundle.service");
const chat = require("./portal_chat.service");
const proposals = require("./portal_proposal.service");
const portal = require("./portal.service");
const vault = require("../vault/document_vault/document_vault.service");
const shipmentDetails = require("../operations/shipment_details/shipment_details.service");
const letterhead = require("../master/entity-letterhead.service");
const receivables = require("../finance/smart_receivables/smart_receivables.service");
const { emitEvent, audit, resolveActorId } = require("../../shared/events/emit");
const { logger } = require("../../config/logger");
const { AppError } = require("../../utils/errors");

const MODULE_OPS = "MOD-29";
const MODULE_FINANCE = "MOD-52";

/** What a client may send: a scan, a phone photo, or a PDF. Checked on the
 *  DECODED, sniffed bytes by the vault — a renamed .exe is refused on content. */
const UPLOAD_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

const notFound = (what = "That item") => new AppError("NOT_FOUND", `${what} was not found`, 404);
const n = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const round2 = (v) => Math.round(n(v) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

/* ── shaping ────────────────────────────────────────────────────────────── */

/**
 * The transport mode a card's icon shows, from the service type key the
 * tenant chose (`SEA_FREIGHT_IMPORT`, `AIR_EXPORT`, `HINTERLAND_TRANSIT` …).
 * A best reading of a free-text key, and only ever decorative: nothing
 * downstream branches on it.
 */
function modeOf(serviceKey) {
  const k = String(serviceKey || "").toUpperCase();
  if (/AIR/.test(k)) return "AIR";
  if (/SEA|OCEAN|MARITIME|FCL|LCL/.test(k)) return "SEA";
  if (/RAIL/.test(k)) return "RAIL";
  if (/WAREHOUS|STORAGE|BONDED|ENTREPOT/.test(k)) return "STORAGE";
  if (/ROAD|TRUCK|HAULAGE|HINTERLAND|INLAND|DELIVERY|TRANSPORT/.test(k)) return "ROAD";
  if (/CUSTOMS|CLEARANCE|DOUANE|TRANSIT/.test(k)) return "CUSTOMS";
  return "OTHER";
}

const pick = (lang, en, fr) => (lang === "fr" ? fr || en : en || fr) || null;

function shipmentCard(row, lang, openRequests = 0) {
  const total = n(row.stages_total);
  const done = n(row.stages_done);
  return {
    dossier_id: row.dossier_id,
    ref: row.ref,
    title: row.title || null,
    status: row.status,
    mode: modeOf(row.service_key),
    service: pick(lang, row.service_en, row.service_fr),
    origin: row.pol || null,
    destination: row.pod || null,
    // The actual arrival supersedes the estimate once recorded — the same rule
    // shipment_details applies to ETA/ATA (LAST wins).
    arrival: row.ata || row.eta || null,
    arrived: !!row.ata,
    transport_ref: row.bl_mawb || null,
    conveyance: row.vessel_flight || null,
    progress: { done, total, percent: total ? Math.round((done / total) * 100) : 0 },
    current_step: done >= total && total > 0 ? null : pick(lang, row.current_label_en, row.current_label),
    current_status: row.current_status || null,
    next_due: row.next_due || null,
    last_update: row.last_done_at || null,
    created_at: row.created_at,
    open_requests: openRequests,
  };
}

function requestView(row) {
  return {
    client_request_id: row.client_request_id,
    dossier_id: row.dossier_id,
    dossier_ref: row.dossier_ref || null,
    source: row.source,
    kind: row.kind,
    doc_type_code: row.doc_type_code,
    doc_type_en: row.doc_type_en || null,
    doc_type_fr: row.doc_type_fr || null,
    title: row.title,
    note: row.note,
    due_on: row.due_on,
    status: row.status,
    answer_text: row.answer_text,
    answer_doc_id: row.answer_doc_id,
    answer_doc_name: row.answer_doc_name || null,
    answered_at: row.answered_at,
    review_note: row.review_note,
    created_at: row.created_at,
  };
}

/** The client's reading of an invoice: what is left, and what state that is. */
function invoiceView(row, asOf = today()) {
  const total = round2(row.total_ttc);
  const paid = round2(row.allocated);
  const inReview = round2(row.in_review);
  const outstanding = Math.max(0, round2(total - paid));
  let state;
  if (["CANCELLED", "REVERSED"].includes(row.status)) state = "CANCELLED";
  else if (outstanding <= 0.005) state = "PAID";
  else if (inReview > 0 && inReview >= outstanding - 0.005) state = "IN_REVIEW";
  else if (row.payment_due_on && row.payment_due_on < asOf) state = "OVERDUE";
  else if (paid > 0) state = "PART_PAID";
  else state = "DUE";
  const days = row.payment_due_on
    ? Math.round((Date.parse(row.payment_due_on) - Date.parse(asOf)) / 86400000)
    : null;
  return {
    invoice_id: row.invoice_id,
    doc_number: row.doc_number,
    issued_on: row.issued_on,
    payment_due_on: row.payment_due_on,
    days_to_due: days,
    currency: row.currency || "XAF",
    total,
    paid,
    in_review: inReview,
    outstanding: state === "CANCELLED" ? 0 : outstanding,
    state,
    dossier_id: row.dossier_id,
    dossier_ref: row.dossier_ref || null,
    // Supporting documents finance shared with it (14160) — the paperclip count.
    documents_count: Number(row.documents_count || 0),
  };
}

/** Balance due and overdue, per currency — a client billed in XAF and EUR
 *  must never see the two added together. */
function totalsByCurrency(invoices) {
  const byCcy = new Map();
  for (const i of invoices) {
    if (["PAID", "CANCELLED"].includes(i.state)) continue;
    const t = byCcy.get(i.currency) || { currency: i.currency, due: 0, overdue: 0, count: 0 };
    t.due = round2(t.due + i.outstanding);
    if (i.state === "OVERDUE") t.overdue = round2(t.overdue + i.outstanding);
    t.count += 1;
    byCcy.set(i.currency, t);
  }
  return [...byCcy.values()].sort((a, b) => b.due - a.due);
}

/* ── identity + home ────────────────────────────────────────────────────── */

async function clientIdentity(c, { clientId }) {
  const row = await repo.clientIdentity(c, clientId);
  if (!row) return null;
  return { client_id: row.client_id, name: row.name, legal_name: row.legal_name || null, language: row.preferred_language || null };
}

const canOps = (scope) => scope === "ALL" || scope === "OPERATIONS";
const canBilling = (scope) => scope === "ALL" || scope === "BILLING";

/**
 * Everything the Home screen shows, in one read, shaped by the person's scope:
 * a finance colleague sees what is due and nothing about shipments; an
 * operations colleague sees shipments and paperwork and no amounts.
 */
async function home(c, { clientId, scope = "ALL", lang = "en", me = null, since = null }) {
  const company = await clientIdentity(c, { clientId });
  const out = { company, scope, shipments: null, requests: null, billing: null, chat: null, proposals: null };
  // The badge on the chat button (14170): what the team wrote since I last looked.
  if (me) out.chat = { unread: await chat.unread(c, { clientId, me, scope, since }) };

  if (canOps(scope)) {
    await repo.syncRuleRequests(c, clientId);
    const asks = (await repo.clientRequests(c, clientId)).map(requestView);
    const openByFile = countOpenByFile(asks);
    const active = await repo.shipments(c, clientId, { state: "active", limit: 50 });
    out.shipments = {
      active_count: active.length,
      items: active.slice(0, 8).map((r) => shipmentCard(r, lang, openByFile.get(r.dossier_id) || 0)),
    };
    const needed = asks.filter((r) => r.status === "OPEN" || r.status === "REJECTED");
    out.requests = {
      open_count: needed.length,
      in_review_count: asks.filter((r) => r.status === "SUBMITTED").length,
      items: needed.slice(0, 4),
    };
    // A proposal waiting for the client's answer is something they owe us too.
    out.proposals = { pending_count: await proposals.pendingCount(c, { clientId }) };
  }

  if (canBilling(scope)) {
    const asOf = today();
    const invoices = (await repo.billingInvoices(c, clientId)).map((r) => invoiceView(r, asOf));
    const open = invoices.filter((i) => ["DUE", "OVERDUE", "PART_PAID"].includes(i.state));
    const nextDue = open
      .filter((i) => i.payment_due_on)
      .sort((a, b) => (a.payment_due_on < b.payment_due_on ? -1 : 1))[0] || null;
    out.billing = {
      totals: totalsByCurrency(invoices),
      due_count: open.length,
      overdue_count: invoices.filter((i) => i.state === "OVERDUE").length,
      in_review_count: invoices.filter((i) => i.state === "IN_REVIEW").length,
      next_due: nextDue,
    };
  }
  return out;
}

function countOpenByFile(asks) {
  const m = new Map();
  for (const r of asks) {
    if (!r.dossier_id || !(r.status === "OPEN" || r.status === "REJECTED")) continue;
    m.set(r.dossier_id, (m.get(r.dossier_id) || 0) + 1);
  }
  return m;
}

/* ── shipments ──────────────────────────────────────────────────────────── */

async function shipments(c, { clientId, state = "active", lang = "en" }) {
  await repo.syncRuleRequests(c, clientId);
  const openByFile = countOpenByFile((await repo.clientRequests(c, clientId)).map(requestView));
  const rows = await repo.shipments(c, clientId, { state: ["active", "done", "all"].includes(state) ? state : "active" });
  return rows.map((r) => shipmentCard(r, lang, openByFile.get(r.dossier_id) || 0));
}

/** The facts strip a client may see — only fields the service-type owner marked
 *  client-visible, composed by the shared projection every document uses. */
async function clientFacts(c, dossierId, lang) {
  try {
    const d = await shipmentDetails.forDossier(c, dossierId, { lang, clientVisibleOnly: true });
    return {
      facets: d.facets,
      facet_order: d.facet_order,
      route_label: d.route_label,
      containers: d.containers && d.containers.enabled
        ? {
          summary: d.containers.summary,
          units: (d.containers.lines || []).flatMap((l) =>
            (Array.isArray(l.units) && l.units.length ? l.units : [{}]).map((u) => ({
              type: pick(lang, l.container_type_en, l.container_type_fr) || l.container_type_code || null,
              container_no: u.container_no || null,
              seal_no: u.seal_no || null,
              discharged_on: u.discharged_on || null,
              out_of_port_on: u.out_of_port_on || null,
              returned_on: u.returned_on || null,
            }))),
        }
        : null,
    };
  } catch (err) {
    // taxonomy: degraded-optional — the facts strip is decoration on a page whose
    // job is the progress chain; a service type with a broken field set must not
    // take the whole shipment page down with it.
    logger.warn({ err, dossier_id: dossierId }, "[portal] shipment facts unavailable");
    return null;
  }
}

/**
 * One shipment, everything the client may know about it on one screen: where it
 * is (the chain), what it is (the facts), what we need from them for it, the
 * documents filed against it and — when their scope includes money — its invoices.
 */
async function shipment(c, { clientId, dossierId, scope = "ALL", lang = "en" }) {
  const card = await repo.shipmentCard(c, clientId, dossierId);
  if (!card) throw notFound("That shipment");
  const chain = await portal.clientChain(c, { clientId, dossierId });
  const ids = await repo.stageIds(c, dossierId);
  const idOf = new Map(ids.map((s) => [`${s.code}|${Number(s.stage_seq)}`, s.milestone_instance_id]));
  const milestones = chain.milestones.map((m) => ({
    ...m,
    milestone_instance_id: idOf.get(`${m.code}|${Number(m.stage_seq)}`) || null,
  }));

  await repo.syncRuleRequests(c, clientId);
  const asks = (await repo.clientRequests(c, clientId)).map(requestView).filter((r) => r.dossier_id === dossierId);
  const openCount = asks.filter((r) => r.status === "OPEN" || r.status === "REJECTED").length;
  const documents = (await portal.clientDocuments(c, { clientId })).filter((d) => d.dossier_id === dossierId);
  const invoices = scope === "ALL"
    ? (await repo.billingInvoices(c, clientId)).filter((i) => i.dossier_id === dossierId).map((r) => invoiceView(r))
    : [];

  return {
    shipment: shipmentCard(card, lang, openCount),
    milestones,
    assumptions: chain.assumptions,
    facts: await clientFacts(c, dossierId, lang),
    requests: asks,
    documents,
    invoices,
  };
}

/* ── requests: what we are waiting for ─────────────────────────────────── */

async function requests(c, { clientId }) {
  await repo.syncRuleRequests(c, clientId);
  return (await repo.clientRequests(c, clientId)).map(requestView);
}

/** The vault row for a file a client sent, PENDING until someone looks at it. */
async function storeClientFile(c, { clientId, dossierId = null, docTypeCode = null, file, entityRef, slug }) {
  if (!file) throw new AppError("FILE_REQUIRED", "Choose a file to send", 422);
  const type = docTypeCode ? await repo.documentType(c, docTypeCode) : null;
  return vault.createDocument(c, {
    entityRef,
    docType: type ? type.code : docTypeCode,
    file,
    clientId,
    dossierId,
    docTypeRefId: type ? type.ref_id : null,
    originalName: file.originalname || null,
    maxBytes: UPLOAD_MAX_BYTES,
    allowedTypes: UPLOAD_TYPES,
    sniff: true,
    status: "PENDING",
    slug,
    actor: {},
  });
}

/** `BL_AWB` is one requirement and two registry types: an air file gets the
 *  air waybill, anything else the bill of lading. */
async function concreteType(c, clientId, request) {
  if (request.doc_type_code !== "BL_AWB") return request.doc_type_code;
  const file = request.dossier_id ? await repo.ownsDossier(c, clientId, request.dossier_id) : null;
  return file && /AIR/i.test(file.service_key || "") ? "MAWB" : "BL";
}

async function uploadForRequest(c, { clientId, requestId, file, email, slug }) {
  const request = await repo.clientRequest(c, clientId, requestId);
  if (!request) throw notFound("That request");
  if (!["OPEN", "REJECTED", "SUBMITTED"].includes(request.status)) {
    throw new AppError("REQUEST_CLOSED", "This request is already closed", 409);
  }
  const code = await concreteType(c, clientId, request);
  const doc = await storeClientFile(c, {
    clientId, dossierId: request.dossier_id, docTypeCode: code, file, entityRef: `client_request:${requestId}`, slug,
  });
  // A second file sent before anyone reviewed the first REPLACES it — the
  // reviewer must not have to guess which of two scans the client meant.
  if (request.status === "SUBMITTED" && request.answer_doc_id) await repo.archiveVaultDoc(c, request.answer_doc_id);
  await repo.submitRequest(c, { requestId, clientId, docId: doc.doc_id, email });
  await emitEvent(c, {
    eventTypeKey: "client_request.submitted",
    moduleKey: MODULE_OPS,
    entityRef: `client_request:${requestId}`,
    payload: { client_id: clientId, dossier_id: request.dossier_id, doc_type_code: code, kind: "DOCUMENT" },
  });
  return requestView(await repo.clientRequest(c, clientId, requestId));
}

async function answerRequest(c, { clientId, requestId, text, email }) {
  const request = await repo.clientRequest(c, clientId, requestId);
  if (!request) throw notFound("That request");
  if (!["OPEN", "REJECTED", "SUBMITTED"].includes(request.status)) {
    throw new AppError("REQUEST_CLOSED", "This request is already closed", 409);
  }
  await repo.submitRequest(c, { requestId, clientId, text: String(text).trim(), email });
  await emitEvent(c, {
    eventTypeKey: "client_request.submitted",
    moduleKey: MODULE_OPS,
    entityRef: `client_request:${requestId}`,
    payload: { client_id: clientId, dossier_id: request.dossier_id, kind: "INFO" },
  });
  return requestView(await repo.clientRequest(c, clientId, requestId));
}

/** "Share a document" — something nobody asked for, reviewed like everything else. */
async function shareDocument(c, { clientId, dossierId = null, docTypeCode = null, note = null, file, email, slug }) {
  if (dossierId && !(await repo.ownsDossier(c, clientId, dossierId))) throw notFound("That shipment");
  if (docTypeCode && !(await repo.documentType(c, docTypeCode))) {
    throw new AppError("BAD_DOC_TYPE", "Choose one of the listed document types", 422);
  }
  const id = crypto.randomUUID();
  const doc = await storeClientFile(c, { clientId, dossierId, docTypeCode, file, entityRef: `client_request:${id}`, slug });
  const row = await repo.insertRequest(c, {
    client_id: clientId, dossier_id: dossierId, source: "CLIENT", kind: "DOCUMENT", doc_type_code: docTypeCode,
    note, status: "SUBMITTED", answer_doc_id: doc.doc_id, answered_by_email: email, answered_at: new Date(),
  });
  await emitEvent(c, {
    eventTypeKey: "client_request.submitted",
    moduleKey: MODULE_OPS,
    entityRef: `client_request:${row.client_request_id}`,
    payload: { client_id: clientId, dossier_id: dossierId, doc_type_code: docTypeCode, kind: "DOCUMENT", unsolicited: true },
  });
  return requestView(await repo.clientRequest(c, clientId, row.client_request_id));
}

/** A file the client sent, streamed back to them. */
async function requestFile(c, { clientId, requestId }) {
  const request = await repo.clientRequest(c, clientId, requestId);
  if (!request || !request.answer_doc_id) throw notFound("That file");
  const { doc, buffer } = await vault.fetchBytes(c, request.answer_doc_id);
  return { buffer, name: doc.original_name || "document" };
}

const documentTypes = (c) => repo.documentTypes(c);

/* ── billing ────────────────────────────────────────────────────────────── */

/**
 * The primary account the invoice PDF prints (entity-letterhead.paymentBlock),
 * so "how to pay" on screen is exactly what is on the paper — never a second,
 * portal-only list of accounts that could drift from it.
 */
async function howToPay(c, entityId) {
  if (!entityId) return null;
  const { entity, accounts } = await repo.entityForPayment(c, entityId);
  if (!entity) return null;
  const block = letterhead.paymentBlock(entity, accounts);
  const a = (block.accounts || [])[0];
  if (!a) return null;
  return {
    label: a.label || null,
    bank_name: a.bank_name || null,
    branch: a.branch || null,
    account_number: a.account_number || null,
    iban: a.iban || null,
    swift_bic: a.swift_bic || null,
    currency: a.currency || null,
    holder_name: a.holder_name || null,
  };
}

async function billing(c, { clientId }) {
  const asOf = today();
  const rows = await repo.billingInvoices(c, clientId);
  const invoices = rows.map((r) => invoiceView(r, asOf));
  const proofs = await repo.clientProofs(c, clientId);
  // "How to pay" for the entity that issued the newest invoice still open — the
  // company this client actually owes money to.
  const openRow = rows.find((r) => {
    const v = invoiceView(r, asOf);
    return ["DUE", "OVERDUE", "PART_PAID"].includes(v.state);
  });
  const company = await repo.clientIdentity(c, clientId);
  const payTo = await howToPay(c, (openRow && openRow.entity_id) || (company && company.entity_id) || null);
  return {
    totals: totalsByCurrency(invoices),
    invoices,
    proofs: proofs.map(proofView),
    how_to_pay: payTo,
  };
}

async function invoice(c, { clientId, invoiceId, lang }) {
  const detail = await portal.clientInvoice(c, { clientId, invoiceId, lang });
  const row = (await repo.billingInvoices(c, clientId)).find((r) => r.invoice_id === invoiceId);
  const entity = await repo.invoiceEntity(c, clientId, invoiceId);
  return {
    ...detail,
    summary: row ? invoiceView(row) : null,
    how_to_pay: await howToPay(c, entity && entity.entity_id),
    // The supporting documents finance has shared with this invoice (14160).
    documents: await bundles.clientView(c, { clientId, invoiceId }),
  };
}

/**
 * The invoice as a PDF — the vaulted document of record when one exists, and
 * rendered once (then vaulted) when it does not. Serving the existing artifact
 * rather than re-rendering keeps what the client downloads identical to what
 * was issued, hash and all.
 */
async function invoicePdf(c, { clientId, invoiceId, lang, origin = null, env = "live" }) {
  const inv = await repo.invoiceEntity(c, clientId, invoiceId);
  if (!inv) throw notFound("That invoice");
  let doc = await repo.vaultByRef(c, `final_invoice:${invoiceId}`);
  if (!doc || !vault.hasBytes(doc.storage_path)) {
    const templates = require("../documents/template/template.service");
    const out = await templates.generate(c, {
      docType: "FINAL_INVOICE", recordId: invoiceId, actor: {}, origin, language: lang === "fr" ? "fr" : "en", env,
    });
    doc = { doc_id: out.doc_id };
  }
  const { buffer } = await vault.fetchBytes(c, doc.doc_id);
  return { buffer, name: `${inv.doc_number || "invoice"}.pdf` };
}

/* ── proof of payment ──────────────────────────────────────────────────── */

const METHODS = ["BANK", "MOBILE_MONEY", "CASH", "CHEQUE"];

function proofView(p) {
  return {
    payment_proof_id: p.payment_proof_id,
    amount: round2(p.amount),
    currency: p.currency,
    method: p.method,
    provider: p.provider,
    paid_on: p.paid_on,
    reference: p.reference,
    note: p.note,
    dossier_id: p.dossier_id,
    dossier_ref: p.dossier_ref || null,
    status: p.status,
    review_note: p.review_note,
    reviewed_at: p.reviewed_at,
    submitted_by_email: p.submitted_by_email,
    created_at: p.created_at,
    has_file: !!p.doc_id,
    allocations: (p.allocations || []).map((a) => ({ invoice_id: a.invoice_id, doc_number: a.doc_number, amount: round2(a.amount) })),
  };
}

/**
 * "I have paid." Checked the way a finance clerk would: every invoice named is
 * this client's and issued, no invoice is named twice, and the amounts spread
 * across invoices do not exceed what was paid. What is NOT checked is whether
 * the money arrived — that is the whole reason this is a claim for finance to
 * confirm rather than a receipt.
 */
async function submitProof(c, { clientId, email, amount, currency, method, provider, paidOn, reference, note, dossierId, allocations = [], file, slug }) {
  if (!file) throw new AppError("FILE_REQUIRED", "Add a photo or PDF of your receipt", 422);
  if (!METHODS.includes(method)) throw new AppError("BAD_METHOD", "Choose how you paid", 422);
  const total = round2(amount);
  if (!(total > 0)) throw new AppError("BAD_AMOUNT", "Enter the amount you paid", 422);
  if (paidOn > today()) throw new AppError("BAD_DATE", "The payment date cannot be in the future", 422);

  const seen = new Set();
  const allocs = [];
  for (const a of allocations || []) {
    if (!a || !a.invoice_id || seen.has(a.invoice_id)) continue;
    seen.add(a.invoice_id);
    const amt = round2(a.amount);
    if (amt > 0) allocs.push({ invoice_id: a.invoice_id, amount: amt });
  }
  if (allocs.length) {
    const found = await repo.payableInvoices(c, clientId, allocs.map((a) => a.invoice_id));
    if (found.length !== allocs.length) throw notFound("One of those invoices");
    const spread = round2(allocs.reduce((s, a) => s + a.amount, 0));
    if (spread > total + 0.01) {
      throw new AppError("ALLOCATION_EXCEEDS", "The invoices add up to more than the amount paid", 422);
    }
  }
  if (dossierId && !(await repo.ownsDossier(c, clientId, dossierId))) throw notFound("That shipment");

  const id = crypto.randomUUID();
  const doc = await storeClientFile(c, { clientId, dossierId, docTypeCode: "PAYMENT_PROOF", file, entityRef: `payment_proof:${id}`, slug });

  await c.query("BEGIN");
  let row;
  try {
    row = await repo.insertProof(c, {
      payment_proof_id: id,
      client_id: clientId, amount: total, currency: String(currency || "XAF").toUpperCase().slice(0, 3),
      method, provider, paid_on: paidOn, reference, note, dossier_id: dossierId, doc_id: doc.doc_id,
      submitted_by_email: email,
    });
    await repo.insertProofAllocations(c, row.payment_proof_id, allocs);
    await c.query("COMMIT");
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  }
  await emitEvent(c, {
    eventTypeKey: "payment_proof.submitted",
    moduleKey: MODULE_FINANCE,
    entityRef: `payment_proof:${row.payment_proof_id}`,
    priority: "HIGH",
    payload: { client_id: clientId, amount: total, currency, invoices: allocs.length },
  });
  return proofView(await repo.proofById(c, row.payment_proof_id));
}

/* ── the client's team ─────────────────────────────────────────────────── */

const SCOPES = ["ALL", "OPERATIONS", "BILLING"];

const team = (c, { clientId }) => repo.teamGrants(c, clientId);

/**
 * A client admin adds a colleague. The grant is written here (tenant); the
 * login and the set-password email are the identity half, which the controller
 * does next through the same `inviteUser` staff invites use.
 *
 * A person already holding CLIENT access for ANOTHER company is refused: the
 * portal resolves one company per login (the newest grant wins), so silently
 * adding a second would move their whole portal to this company.
 */
async function addTeamMember(c, { clientId, email, scope = "ALL", isAdmin = false, invitedBy }) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!SCOPES.includes(scope)) throw new AppError("BAD_SCOPE", "Choose what they can see", 422);
  const existing = await repo.activeClientGrantFor(c, normalized);
  if (existing && existing.client_id === clientId) {
    throw new AppError("ALREADY_IN_TEAM", "This person is already in your team", 409);
  }
  if (existing) {
    throw new AppError("OTHER_COMPANY", "This person already has portal access for another company. Ask us to add them.", 409);
  }
  return repo.insertTeamGrant(c, { clientId, email: normalized, scope, isAdmin, invitedBy });
}

async function updateTeamMember(c, { clientId, grantId, scope, isAdmin, selfGrantId }) {
  if (scope && !SCOPES.includes(scope)) throw new AppError("BAD_SCOPE", "Choose what they can see", 422);
  if (isAdmin === false && (await repo.countAdmins(c, clientId)) <= 1) {
    const current = (await repo.teamGrants(c, clientId)).find((g) => g.portal_access_id === grantId);
    if (current && current.is_client_admin) {
      throw new AppError("LAST_ADMIN", "Your team needs at least one admin", 409);
    }
  }
  if (grantId === selfGrantId && scope && scope !== "ALL") {
    throw new AppError("SELF_SCOPE", "You cannot narrow your own access", 409);
  }
  const row = await repo.updateTeamGrant(c, { clientId, grantId, scope, isAdmin });
  if (!row) throw notFound("That team member");
  return row;
}

async function removeTeamMember(c, { clientId, grantId, selfGrantId }) {
  if (grantId === selfGrantId) throw new AppError("SELF_REMOVE", "You cannot remove yourself", 409);
  const row = await repo.removeTeamGrant(c, { clientId, grantId });
  if (!row) throw notFound("That team member");
  return row;
}

/* ── staff: requests to clients ────────────────────────────────────────── */

const staffRequests = async (c, { clientId = null, status = null }) =>
  (await repo.staffRequests(c, { clientId, status })).map((r) => ({ ...requestView(r), client_id: r.client_id, client_name: r.client_name }));

/** Staff ask a client for a document or a piece of information. */
async function createRequest(c, { clientId, dossierId = null, kind, docTypeCode = null, title = null, note = null, dueOn = null, actor = {} }) {
  const company = await repo.clientIdentity(c, clientId);
  if (!company) throw notFound("That client");
  if (dossierId && !(await repo.ownsDossier(c, clientId, dossierId))) throw notFound("That file for this client");
  if (kind === "DOCUMENT" && !docTypeCode && !title) {
    throw new AppError("VALIDATION_ERROR", "Name the document you need", 422);
  }
  if (kind === "INFO" && !title) throw new AppError("VALIDATION_ERROR", "Write the question", 422);
  if (docTypeCode && !(await repo.documentType(c, docTypeCode))) {
    throw new AppError("BAD_DOC_TYPE", "Choose a document type from the list", 422);
  }
  const row = await repo.insertRequest(c, {
    client_id: clientId, dossier_id: dossierId, source: "STAFF", kind, doc_type_code: docTypeCode,
    title, note, due_on: dueOn, status: "OPEN", created_by: await resolveActorId(c, actor.user_id),
  });
  await audit(c, {
    actorUserId: actor.user_id || null, action: "client_request.created", moduleKey: MODULE_OPS,
    entityRef: `client_request:${row.client_request_id}`, after: { client_id: clientId, dossier_id: dossierId, kind, doc_type_code: docTypeCode, title },
  });
  // The client is told — by email and on their phone (notify-portal, 14180).
  await emitEvent(c, {
    eventTypeKey: "client_request.created", moduleKey: MODULE_OPS, entityRef: `client_request:${row.client_request_id}`,
    actorUserId: actor.user_id || null, payload: { client_id: clientId, dossier_id: dossierId, kind },
  });
  return requestView(await repo.requestById(c, row.client_request_id));
}

/**
 * Accept, reject (with the reason the client will read) or cancel. Accepting
 * or rejecting needs something to judge, so both require a SUBMITTED answer;
 * cancelling is for a request that should never have been asked — including a
 * rule-driven one this client is exempt from, which then stays cancelled.
 */
async function reviewRequest(c, { requestId, decision, note = null, actor = {} }) {
  const current = await repo.requestById(c, requestId);
  if (!current) throw notFound("That request");
  const next = { ACCEPT: "ACCEPTED", REJECT: "REJECTED", CANCEL: "CANCELLED" }[decision];
  if (!next) throw new AppError("BAD_DECISION", "decision must be ACCEPT, REJECT or CANCEL", 422);
  if ((decision === "ACCEPT" || decision === "REJECT") && current.status !== "SUBMITTED") {
    throw new AppError("NOTHING_TO_REVIEW", "The client has not sent anything for this request yet", 409);
  }
  if (decision === "REJECT" && !String(note || "").trim()) {
    throw new AppError("REASON_REQUIRED", "Tell the client what is wrong so they can fix it", 422);
  }
  if (decision === "CANCEL" && ["ACCEPTED", "CANCELLED"].includes(current.status)) {
    throw new AppError("REQUEST_CLOSED", "This request is already closed", 409);
  }
  const reviewer = await resolveActorId(c, actor.user_id);
  const row = await repo.reviewRequest(c, { requestId, status: next, note: note ? String(note).trim() : null, reviewedBy: reviewer });
  if (current.answer_doc_id && decision !== "CANCEL") {
    await repo.setVaultReview(c, { docId: current.answer_doc_id, status: decision === "ACCEPT" ? "VERIFIED" : "REJECTED", verifiedBy: reviewer });
  }
  await audit(c, {
    actorUserId: actor.user_id || null, action: `client_request.${next.toLowerCase()}`, moduleKey: MODULE_OPS,
    entityRef: `client_request:${requestId}`, before: { status: current.status }, after: { status: next, note },
  });
  await emitEvent(c, {
    eventTypeKey: "client_request.reviewed", moduleKey: MODULE_OPS, entityRef: `client_request:${requestId}`,
    actorUserId: actor.user_id || null, payload: { client_id: row.client_id, status: next },
  });
  return requestView(await repo.requestById(c, requestId));
}

async function staffRequestFile(c, { requestId }) {
  const request = await repo.requestById(c, requestId);
  if (!request || !request.answer_doc_id) throw notFound("That file");
  const { doc, buffer } = await vault.fetchBytes(c, request.answer_doc_id);
  return { buffer, name: doc.original_name || "document" };
}

/* ── staff: payment claims ─────────────────────────────────────────────── */

const staffProofs = async (c, { status = null, clientId = null }) =>
  (await repo.staffProofs(c, { status, clientId })).map((p) => ({ ...proofView(p), client_id: p.client_id, client_name: p.client_name }));

/**
 * Finance confirms the money arrived. The claim flips to CONFIRMED first — the
 * status guard is what stops two people confirming one proof twice — and then,
 * when it names invoices, a DRAFT receipt is created through the receivables
 * service for finance to post the usual way. A proof with no invoice (an advance
 * paid ahead of the bill) is confirmed without a receipt: that money is a
 * customer advance, and the proforma flow records those.
 */
async function confirmProof(c, { proofId, treasuryAccountId = null, actor = {} }) {
  const proof = await repo.proofById(c, proofId);
  if (!proof) throw notFound("That payment");
  if (proof.status !== "SUBMITTED") throw new AppError("ALREADY_REVIEWED", "This payment was already reviewed", 409);
  const reviewer = await resolveActorId(c, actor.user_id);
  const flipped = await repo.reviewProof(c, { proofId, status: "CONFIRMED", reviewedBy: reviewer });
  if (!flipped) throw new AppError("ALREADY_REVIEWED", "This payment was already reviewed", 409);

  let receiptId = null;
  if ((proof.allocations || []).length) {
    try {
      const receipt = await receivables.createDraft(c, {
        clientId: proof.client_id, method: proof.method, treasuryAccountId, amount: Number(proof.amount),
        receivedOn: proof.paid_on, actor,
      });
      receiptId = receipt && receipt.receipt_id;
      if (receiptId) await repo.setProofReceipt(c, proofId, receiptId);
    } catch (err) {
      // Put the claim back so it can be confirmed again: a confirmed proof with
      // no receipt behind it would read as "done" and never be posted.
      await repo.reopenProof(c, proofId);
      throw err;
    }
  }
  if (proof.doc_id) await repo.setVaultReview(c, { docId: proof.doc_id, status: "VERIFIED", verifiedBy: reviewer });
  await audit(c, {
    actorUserId: actor.user_id || null, action: "payment_proof.confirmed", moduleKey: MODULE_FINANCE,
    entityRef: `payment_proof:${proofId}`, after: { receipt_id: receiptId, amount: proof.amount, currency: proof.currency },
  });
  await emitEvent(c, {
    eventTypeKey: "payment_proof.confirmed", moduleKey: MODULE_FINANCE, entityRef: `payment_proof:${proofId}`,
    actorUserId: actor.user_id || null, payload: { client_id: proof.client_id, amount: Number(proof.amount), receipt_id: receiptId },
  });
  return { ...proofView(await repo.proofById(c, proofId)), receipt_id: receiptId };
}

async function rejectProof(c, { proofId, note, actor = {} }) {
  if (!String(note || "").trim()) throw new AppError("REASON_REQUIRED", "Tell the client why", 422);
  const reviewer = await resolveActorId(c, actor.user_id);
  const row = await repo.reviewProof(c, { proofId, status: "REJECTED", note: String(note).trim(), reviewedBy: reviewer });
  if (!row) {
    if (!(await repo.proofById(c, proofId))) throw notFound("That payment");
    throw new AppError("ALREADY_REVIEWED", "This payment was already reviewed", 409);
  }
  if (row.doc_id) await repo.setVaultReview(c, { docId: row.doc_id, status: "REJECTED", verifiedBy: reviewer });
  await audit(c, {
    actorUserId: actor.user_id || null, action: "payment_proof.rejected", moduleKey: MODULE_FINANCE,
    entityRef: `payment_proof:${proofId}`, after: { note },
  });
  await emitEvent(c, {
    eventTypeKey: "payment_proof.rejected", moduleKey: MODULE_FINANCE, entityRef: `payment_proof:${proofId}`,
    actorUserId: actor.user_id || null, payload: { client_id: row.client_id },
  });
  return proofView(await repo.proofById(c, proofId));
}

async function proofFile(c, { proofId, clientId = null }) {
  const proof = await repo.proofById(c, proofId);
  if (!proof || !proof.doc_id || (clientId && proof.client_id !== clientId)) throw notFound("That file");
  const { doc, buffer } = await vault.fetchBytes(c, proof.doc_id);
  return { buffer, name: doc.original_name || "receipt" };
}

module.exports = {
  modeOf, invoiceView, totalsByCurrency, shipmentCard,
  clientIdentity, home, shipments, shipment,
  requests, uploadForRequest, answerRequest, shareDocument, requestFile, documentTypes,
  billing, invoice, invoicePdf, submitProof, proofFile, howToPay,
  team, addTeamMember, updateTeamMember, removeTeamMember,
  staffRequests, createRequest, reviewRequest, staffRequestFile,
  staffProofs, confirmProof, rejectProof,
  UPLOAD_MAX_BYTES,
};
