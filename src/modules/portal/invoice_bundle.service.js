/**
 * An invoice's supporting documents, shared with the client (client portal
 * redesign PR 2, migration 14160).
 *
 * THE FLOW, as the owner asked for it: at the end of a file the final invoice
 * goes to the client with the proof behind its disbursements. Finance opens
 * the invoice, sees every document the file's reconciliation holds — the ones
 * a cash request marked as owing a receipt already ticked — unticks anything
 * internal, and publishes. ONE click. The client's portal then shows the
 * invoice with its documents, and "download all" returns the invoice and every
 * document as one ZIP, numbered in the order the lines appear.
 *
 * WHAT PUBLISHING DOES NOT DO: it does not touch the vault rows. A receipt is
 * evidence first; the bundle is a grant for one invoice, and withdrawing it
 * takes nothing out of the file.
 */
"use strict";

const repo = require("./invoice_bundle.repo");
const zip = require("../../shared/files/zip");
const vault = require("../vault/document_vault/document_vault.service");
const { emitEvent, audit, resolveActorId } = require("../../shared/events/emit");
const { AppError } = require("../../utils/errors");
const { atomically } = require("../../shared/db/tx");

const MODULE = "MOD-51"; // final invoices — the bundle is part of issuing one

/** An invoice the client can already see is one that has been issued. */
const ISSUED = (status) => !["DRAFT", "SUBMITTED_FOR_VALIDATION", "SUBMITTED_FOR_APPROVAL"].includes(String(status || ""));

/**
 * The ZIP is built in memory for one response, so it is bounded far below the
 * writer's own ceiling. A file's supporting documents are a few megabytes of
 * scans; 150 MB is a file nobody should be asked to download on a phone.
 */
const MAX_BUNDLE_BYTES = 150 * 1024 * 1024;

const extOf = (row) => {
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(String(row.original_name || ""));
  const fromPath = /\.([a-z0-9]{2,5})$/i.exec(String(row.storage_path || ""));
  return ((fromName && fromName[1]) || (fromPath && fromPath[1]) || "pdf").toLowerCase();
};

/** What a person reads for one document: the uploader's note, else its file name. */
function nameOf(row) {
  const note = String(row.note || "").trim();
  if (note) return note;
  const original = String(row.original_name || "").trim();
  if (original) return original.replace(/\.[a-z0-9]{2,5}$/i, "");
  return "document";
}

function candidateView(row, inBundle) {
  return {
    doc_id: row.doc_id,
    name: nameOf(row),
    line_label: row.line_label || null,
    file_name: row.original_name || null,
    ext: extOf(row),
    justification_required: row.justification_required === true,
    in_bundle: inBundle,
  };
}

function bundleView(bundle) {
  if (!bundle) return null;
  return {
    published_at: bundle.published_at,
    published_by_name: bundle.published_by_name || null,
    items: bundle.items.map((it) => ({
      doc_id: it.doc_id,
      position: it.position,
      label: it.label || null,
      name: nameOf(it),
      ext: extOf(it),
    })),
  };
}

/* ── staff ──────────────────────────────────────────────────────────────── */

/** What finance sees before publishing: the invoice, what is already shared,
 *  and every document the file could share, the owed receipts pre-ticked. */
async function staffView(c, { invoiceId }) {
  const inv = await repo.invoice(c, invoiceId);
  if (!inv) throw new AppError("NOT_FOUND", "Final invoice not found", 404);
  const bundle = await repo.bundleFor(c, invoiceId);
  const shared = new Set((bundle ? bundle.items : []).map((i) => i.doc_id));
  const rows = inv.dossier_id ? await repo.candidates(c, inv.dossier_id) : [];
  return {
    invoice: {
      invoice_id: inv.invoice_id,
      doc_number: inv.doc_number,
      status: inv.status,
      issued: ISSUED(inv.status),
      currency: inv.currency,
      total_ttc: Number(inv.total_ttc),
      client_id: inv.client_id,
      client_name: inv.client_name || null,
      dossier_id: inv.dossier_id,
      dossier_ref: inv.dossier_ref || null,
    },
    published: bundleView(bundle),
    // Before the first publication the suggestion is the owed receipts; after
    // it, what was actually shared — finance's last decision wins over ours.
    candidates: rows.map((r) => candidateView(r, bundle ? shared.has(r.doc_id) : r.justification_required === true)),
  };
}

/**
 * Publish (or re-publish) the bundle. Only documents from THIS file's
 * reconciliation can be shared through it — an id from anywhere else is
 * refused, whatever the caller sends.
 */
async function publish(c, { invoiceId, docIds = [], actor = {} }) {
  const inv = await repo.invoice(c, invoiceId);
  if (!inv) throw new AppError("NOT_FOUND", "Final invoice not found", 404);
  if (!ISSUED(inv.status)) {
    throw new AppError("INVOICE_NOT_ISSUED", "Issue the invoice before sharing it with the client", 409);
  }
  if (!inv.client_id) throw new AppError("CLIENT_REQUIRED", "This invoice has no client", 422);
  const rows = inv.dossier_id ? await repo.candidates(c, inv.dossier_id) : [];
  const allowed = new Map(rows.map((r) => [r.doc_id, r]));
  const wanted = [...new Set((docIds || []).map(String))];
  const stray = wanted.filter((id) => !allowed.has(id));
  if (stray.length) {
    // 409, not 422: the usual cause is a document taken off the reconciliation
    // while the dialog was open, and a 422's details would print as raw ids.
    throw new AppError(
      "NOT_ON_THIS_FILE",
      "A document is no longer on this file's reconciliation. Reopen the invoice and share again.",
      409,
    );
  }
  // The client's order is the file's order, not the order ticks were made in.
  const items = rows
    .filter((r) => wanted.includes(r.doc_id))
    .map((r, i) => ({ doc_id: r.doc_id, position: i + 1, label: r.line_label || null }));

  const publishedBy = await resolveActorId(c, actor.user_id);
  // The bundle and its items land together or not at all.
  await atomically(c, async () => {
    const bundle = await repo.upsertBundle(c, { invoiceId, clientId: inv.client_id, dossierId: inv.dossier_id, publishedBy });
    await repo.replaceItems(c, bundle.bundle_id, items);
  });
  await audit(c, {
    actorUserId: publishedBy, action: "invoice_bundle.published", moduleKey: MODULE,
    entityRef: `final_invoice:${invoiceId}`, after: { documents: items.length },
  });
  await emitEvent(c, {
    eventTypeKey: "invoice_bundle.published", moduleKey: MODULE, entityRef: `final_invoice:${invoiceId}`,
    actorUserId: actor.user_id || null,
    payload: { client_id: inv.client_id, invoice_id: invoiceId, doc_number: inv.doc_number, documents: items.length },
  });
  return staffView(c, { invoiceId });
}

async function withdraw(c, { invoiceId, actor = {} }) {
  const inv = await repo.invoice(c, invoiceId);
  if (!inv) throw new AppError("NOT_FOUND", "Final invoice not found", 404);
  const removed = await repo.deleteBundle(c, invoiceId);
  if (removed) {
    await audit(c, {
      actorUserId: await resolveActorId(c, actor.user_id), action: "invoice_bundle.withdrawn", moduleKey: MODULE,
      entityRef: `final_invoice:${invoiceId}`, after: { withdrawn: true },
    });
  }
  return staffView(c, { invoiceId });
}

/* ── client ─────────────────────────────────────────────────────────────── */

/** The client's copy: what is shared and when — not which staff member shared it. */
async function clientView(c, { clientId, invoiceId }) {
  const view = bundleView(await repo.clientBundle(c, { clientId, invoiceId }));
  return view ? { published_at: view.published_at, items: view.items } : null;
}

/** One shared document's bytes — only if it is in this client's bundle. */
async function clientFile(c, { clientId, invoiceId, docId }) {
  const bundle = await repo.clientBundle(c, { clientId, invoiceId });
  const item = bundle && bundle.items.find((i) => i.doc_id === docId);
  if (!item) throw new AppError("NOT_FOUND", "That document is not shared with you", 404);
  const { buffer } = await vault.fetchBytes(c, docId);
  return { buffer, name: `${nameOf(item)}.${extOf(item)}` };
}

/** "01 Invoice FAC-2026-1182.pdf", "02 Port charges (PAD) receipt.pdf" … */
const entryName = (n, parts, ext) =>
  `${String(n).padStart(2, "0")} ${parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 110)}.${ext}`;

/**
 * The invoice and every shared document as one ZIP. `invoicePdf` is passed in
 * (portal_client.service owns rendering the invoice of record) so this module
 * does not import its caller.
 */
async function clientZip(c, { clientId, invoiceId, invoicePdf }) {
  const bundle = await repo.clientBundle(c, { clientId, invoiceId });
  if (!bundle) throw new AppError("NOT_FOUND", "Nothing is shared with this invoice yet", 404);
  const pdf = await invoicePdf();
  const entries = [{ name: entryName(1, [pdf.name.replace(/\.pdf$/i, "")], "pdf"), data: pdf.buffer }];
  let total = pdf.buffer.length;
  for (const it of bundle.items) {
    const { buffer } = await vault.fetchBytes(c, it.doc_id);
    total += buffer.length;
    if (total > MAX_BUNDLE_BYTES) {
      throw new AppError("BUNDLE_TOO_LARGE", "These documents are too large to download together — download them one by one", 413);
    }
    const label = it.label && it.label !== nameOf(it) ? it.label : null;
    entries.push({ name: entryName(entries.length + 1, [label, nameOf(it)], extOf(it)), data: buffer });
  }
  const base = String(pdf.name || "invoice").replace(/\.pdf$/i, "");
  return { buffer: zip.build(entries), name: `${base}-documents.zip`, type: "application/zip" };
}

module.exports = { staffView, publish, withdraw, clientView, clientFile, clientZip, MAX_BUNDLE_BYTES };
