"use strict";
/**
 * THE STATEMENT (Q19, RECONCILIATION_ENGINEERING_GUIDE §6.4).
 *
 * The whole programme exists to close a conversation, and this is the closed
 * conversation made paper: what was budgeted, what actually happened, why the
 * difference, and the documents that prove it. The legacy print engine could
 * never be asked for it, and the questionnaire's sign-off on it (Q19) was
 * given with three conditions this file keeps:
 *
 *   1. It carries variance REASONS and the per-line proof list — a statement
 *      showing −12 000 with no sentence explaining it generates the email
 *      asking why. Both live in `statementData`, so the PDF and the xlsx say
 *      exactly the same thing (one model, two renderings — and not the legacy's
 *      failure mode, the legacy's print_versus_email_bodies divergence).
 *   2. It vaults under a STABLE entity_ref — one row per settled round,
 *      re-rendered in place — because renderPdfFromData's timestamped ref is
 *      built for one-shot contracts, and a per-download vault row per click
 *      of the export button is a vault nobody can read.
 *   3. Dates print dd/mm/yyyy, by the kit (§6.4: ON PAPER means paper).
 *
 * The render + store goes through pdf.renderAndStore → the vault, which means
 * the stored content_hash is the master's (§6.6) and nothing here keeps its
 * own copy.
 */

const repo = require("./dossier_reconciliation.repo");
const rules = require("./dossier_reconciliation.rules");
const events = require("./dossier_reconciliation.events");
const service = require("./dossier_reconciliation.service");
const registry = require("../../../services/documents/templates/registry");
const templateSvc = require("../../documents/template/template.service");
const pdf = require("../../../services/pdf.service");
const spreadsheet = require("../../../services/spreadsheet");
const smartcomm = require("../../smartcomm/smartcomm.service");
const { emitEvent, audit } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");
const k = require("../../../services/documents/templates/kit");

const MODULE = events.MODULE;
const DOC = "RECONCILIATION_STATEMENT";
const ref = (id) => `dossier_reconciliation:${id}`;

/* ════════════════════ ONE MODEL, TWO RENDERINGS ══════════════════════════ */

/**
 * The statement's data, in the shape the template and the xlsx read it.
 *
 * This is a projection over `sheetFor` — never a second query for the numbers
 * — because the one thing worse than no statement is a statement that
 * disagrees with the screen the operator just read. Derived once, twice
 * rendered.
 */
async function statementData(client, { dossierId, dossierHeader = null }) {
  const sheet = await service.sheetFor(client, { dossierId });
  const head = dossierHeader || (await repo.dossierHeader(client, dossierId));
  if (!head) throw new AppError("NOT_FOUND", "Operations file not found", 404);

  const names = await repo.userNames(client, [sheet.submitted_by, sheet.settled_by]);

  const number = `REC-${head.ref || "file"}-r${sheet.revision || 1}`;
  const latest = Array.isArray(sheet.settlements) && sheet.settlements.length ? sheet.settlements[0] : null;

  const lines = (sheet.lines || []).map((l) => ({
    costing_line_id: l.costing_line_id,
    item_code: l.item_code,
    label: l.label,
    budget_ttc: l.budget_ttc,
    disbursed: l.disbursed,
    actual_ttc: l.actual_ttc,
    variance: l.variance,
    variance_reason: l.variance_reason,
    spent_on: l.spent_on,
    justification_required: l.justification_required,
    // The proofs are named, not just counted. Names come from the uploader's
    // note when there is one, from the vault's original filename otherwise,
    // because "3 documents" is a number and "port-invoice.pdf" is a thing.
    proofs: (l.documents || []).map((d) => d.note || nameOf(d.storage_path) || "attachment"),
    documents: (l.documents || []).map((d) => ({
      doc_id: d.doc_id,
      label: d.note || nameOf(d.storage_path) || "attachment",
      uploaded_by: d.uploaded_by_name || null,
      uploaded_at: d.uploaded_at || null,
      doc_status: d.doc_status || null,
    })),
  }));

  // The three grades as SENTENCES — the numbers are on the page already, what
  // a reader needs is which question each verdict answers (Q17).
  const g = sheet.grades || {};
  const money = (v) => `${(Math.round(Number(v) * 100) / 100).toLocaleString("fr-FR")} ${sheet.currency || "XAF"}`;
  const grade_sentences = [];
  if (g.execution) {
    grade_sentences.push(
      g.execution.key === "PENDING"
        ? "Did we execute to plan? Not yet — no actuals recorded."
        : g.execution.key === "WITHIN_BUDGET"
          ? `Did we execute to plan? Within budget — ${money(sheet.totals.variance)} under the allowance.`
          : `Did we execute to plan? Over budget — ${money(-sheet.totals.variance)} past the allowance${sheet.totals.reasons_missing ? `, reason still missing on ${sheet.totals.reasons_missing} line(s)` : ", reason on file"}.`,
    );
  }
  if (g.accountability) {
    grade_sentences.push(
      g.accountability.key === "ACCOUNTED"
        ? "Is the cash accounted for? Yes — everything not spent came back to the vault."
        : `Is the cash accounted for? ${money(g.accountability.amount)} is still to account for.`,
    );
  }
  if (g.commercial) {
    grade_sentences.push(
      g.commercial.key === "NO_QUOTE"
        ? "Did the file make money? No accepted quotation on file, so the margin question does not arise."
        : g.commercial.key === "PROFITABLE"
          ? `Did the file make money? Yes — ${money(sheet.totals.margin_ht)} (HT) earned over the actual cost.`
          : `Did the file make money? No — ${money(-sheet.totals.margin_ht)} (HT) below the quoted price.`,
    );
  }

  return {
    number,
    date: new Date().toISOString().slice(0, 10),
    dossier_ref: head.ref || null,
    dossier_title: head.title || null,
    entity_id: head.entity_id || null,
    reconciliation_id: sheet.reconciliation_id,
    status: sheet.status,
    status_words: wordsFor(sheet.status),
    revision: sheet.revision || 1,
    settled_at: latest ? latest.settled_at : sheet.settled_at,
    currency: sheet.currency || "XAF",
    exchange_rate_to_xaf: sheet.exchange_rate_to_xaf,
    party: {
      name: head.client_name || "",
      lines: [head.client_niu && `NIU ${head.client_niu}`, head.client_rccm && `RCCM ${head.client_rccm}`].filter(Boolean),
    },
    service: { fr: head.service_fr || head.service_en || null, en: head.service_en || head.service_fr || null },
    lines,
    totals: {
      budget_ttc: sheet.totals.budget_ttc,
      disbursed: sheet.totals.disbursed,
      actual_ttc: sheet.totals.actual_ttc,
      variance: sheet.totals.variance,
      returned: sheet.totals.returned,
      outstanding: sheet.totals.outstanding,
      margin_ht: sheet.totals.margin_ht,
      quoted_ht: sheet.costing && sheet.costing.quoted_ht !== null ? Number(sheet.costing.quoted_ht) : null,
    },
    grades: g,
    grade_sentences,
    prepared_by_name: sheet.submitted_by ? names.get(sheet.submitted_by) || null : null,
    prepared_at: sheet.submitted_at || null,
    settled_by_name: sheet.settled_by ? names.get(sheet.settled_by) || null : null,
    statement_doc_id: latest ? latest.statement_doc_id : null,
  };
}

const nameOf = (storagePath) =>
  storagePath ? String(storagePath).split("/").pop().split("?")[0] : null;

const wordsFor = (status) => ({
  OPEN: { fr: "Ouverte", en: "Open" },
  SUBMITTED: { fr: "À solder", en: "To settle" },
  SETTLED: { fr: "Soldée", en: "Settled" },
  REJECTED: { fr: "Rejetée", en: "Rejected" },
}[status] || null);

/* ════════════════════════ RENDER — PDF via the kit ═══════════════════════ */

/**
 * Render the statement PDF and store it in the vault under a STABLE ref.
 *
 * `renderPdfFromData` stamps a timestamped ref — right for a one-shot
 * contract, wrong here: a settled round re-renders in place, and two hundred
 * downloads must be two hundred reads of ONE row, not two hundred rows. The
 * template.service seam (resolveCfg + watermarkFor) and the pdf seam
 * (renderAndStore) are both used, so the letterhead, the sandbox watermark
 * rule and the content-hash discipline are the documents module's own, not
 * re-derived here.
 *
 * `entityRef`: `reconciliation_statement:<reconId>:rev<N>` when a
 * reconciliation exists; a dossier-scoped draft ref when none does yet —
 * the draft preview is still a real PDF, it simply cannot be mistaken for a
 * settled one.
 */
async function statementPdf(client, { dossierId, actor = {}, language = null }) {
  const data = await statementData(client, { dossierId });
  const tpl = registry.get(DOC);
  const { cfg, entity } = await templateSvc.resolveCfg(client, DOC, data.entity_id, null, { language });
  // G2 — the sandbox watermark rule is template.service's, not the caller's.
  cfg.watermark = k.watermarkFor(client, cfg.watermark);
  const html = tpl.build(data, cfg, entity, null);
  const stamp = Date.now();
  const entityRef = data.reconciliation_id
    ? `${DOC.toLowerCase()}:${data.reconciliation_id}:rev${data.revision}`
    : `${DOC.toLowerCase()}:${dossierId}:draft`;
  const key = `documents/${DOC}/${data.number}-${stamp}.pdf`;
  return pdf.renderAndStore(client, { html, key, entityRef, docType: DOC, actor });
}

/* ════════════════════════ RENDER — xlsx for the audit ════════════════════ */

/**
 * The same rows, tabulated for whoever reconciles against the ledger by hand.
 * Two sheets: the cover IS the statement (the spreadsheet service stamps the
 * generated-at and the brand), the data sheet carries one row per budget
 * line with the reason and the proofs — the three conditions of Q19 again.
 */
async function statementXlsx(client, { dossierId, registrationNumbers = false } = {}) {
  const data = await statementData(client, { dossierId });
  // Language is the ENTITY's, resolved inside the context — the workbook is a
  // controlled document of the file's tenant, and its language was chosen the
  // day the entity was configured, not per-download. `registrationNumbers`
  // (PR-04) is the requester's MOD-01 view grant, resolved by the controller:
  // the xlsx cover is an export, so its RCCM/NIU lines obey the tax boundary.
  const ctx = await spreadsheet.resolveContext(client, { entityId: data.entity_id, registrationNumbers });
  const fr = ctx.language === "fr";
  const H = (f, e) => (fr ? f : e);
  const day = (v) => (v ? String(v).slice(0, 10).split("-").reverse().join("/") : "");

  const lines = {
    name: fr ? "Réconciliation" : "Reconciliation",
    columns: [
      { key: "line", header: H("Ligne", "Line") },
      { key: "budget_ttc", header: H("Budget (TTC)", "Budget (TTC)"), format: "money", currency: data.currency },
      { key: "disbursed", header: H("Décaissé", "Disbursed"), format: "money", currency: data.currency },
      { key: "actual_ttc", header: H("Réel (TTC)", "Actual (TTC)"), format: "money", currency: data.currency },
      { key: "variance", header: H("Écart", "Variance"), format: "money", currency: data.currency },
      { key: "spent_on", header: H("Dépensé le", "Spent on") },
      { key: "reason", header: H("Raison de l'écart", "Variance reason"), width: 42 },
      { key: "proofs", header: H("Justificatifs", "Proof documents"), width: 42 },
    ],
    rows: data.lines.map((l) => ({
      line: [l.item_code ? `${l.item_code} · ` : "", l.label].join(""),
      budget_ttc: l.budget_ttc,
      disbursed: l.disbursed,
      actual_ttc: l.actual_ttc,
      variance: l.variance,
      spent_on: day(l.spent_on),
      reason: l.variance_reason || "",
      proofs: l.proofs.join("; "),
    })),
    totals: {
      line: ctx.language === "fr" ? "Total" : "Total",
      budget_ttc: data.totals.budget_ttc,
      disbursed: data.totals.disbursed,
      actual_ttc: data.totals.actual_ttc,
      variance: data.totals.variance,
    },
  };

  const proofs = {
    name: fr ? "Justificatifs" : "Proofs",
    columns: [
      { key: "line", header: H("Ligne", "Line") },
      { key: "document", header: H("Document", "Document") },
      { key: "uploaded_by", header: H("Déposé par", "Uploaded by") },
      { key: "uploaded_at", header: H("Déposé le", "Uploaded on") },
      { key: "status", header: H("Statut", "Status") },
    ],
    rows: data.lines.flatMap((l) =>
      l.documents.map((d) => ({
        line: [l.item_code ? `${l.item_code} · ` : "", l.label].join(""),
        document: d.label,
        uploaded_by: d.uploaded_by || "",
        uploaded_at: day(d.uploaded_at),
        status: d.doc_status || "",
      })),
    ),
  };

  const summary = {
    name: fr ? "Synthèse" : "Summary",
    columns: [
      { key: "label", header: H("Intitulé", "Item") },
      { key: "value", header: H("Valeur", "Value") },
    ],
    rows: [
      { label: H("Dossier", "File"), value: data.dossier_ref || "" },
      { label: H("Client", "Client"), value: data.party.name },
      { label: H("Service", "Service"), value: fr ? (data.service.fr || "") : (data.service.en || "") },
      { label: H("Statut", "Status"), value: data.status },
      { label: H("Révision", "Revision"), value: String(data.revision) },
      { label: H("Écart", "Variance"), value: String(data.totals.variance) },
      { label: H("Restitué à la caisse", "Returned to the vault"), value: String(data.totals.returned) },
      { label: H("Reste à justifier", "Cash to account for"), value: String(data.totals.outstanding) },
    ],
  };

  const wb = await spreadsheet.buildWorkbook({
    context: ctx,
    cover: true,
    sheets: [summary, lines, proofs],
  });
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filenameBase: data.number, context: ctx };
}

/* ═══════════════ GOOD FAITH CONSEQUENCE — after the commit ═══════════════ */

/**
 * The render that belongs to a settlement. Called AFTER the settle commit —
 * two hundred download-button clicks must not be able to roll back a
 * committed 581=0, and a hiccup in the paper must not undo the posting
 * (CLASS G, ERROR_HANDLING: post-commit best-effort, warn loudly, carry on).
 *
 * `require`ing the statement module lazily inside settle keeps the module
 * graph one-way (statement→service), and lets the settlement tests mock this
 * module without puppeteer ever being touched.
 */
async function statementForSettlement(client, { dossierId, actor = {} }) {
  const doc = await statementPdf(client, { dossierId, actor });
  // The SETTLED row exists by now; bindSettlementStatement only fills a NULL
  // — two settlements of the same revision can't both win a ref the history
  // has already taken (write-once, see the repo's comment).
  const sheet = await service.sheetFor(client, { dossierId });
  if (sheet.reconciliation_id === null || sheet.reconciliation_id === undefined) return doc;
  await repo.bindSettlementStatement(client, {
    reconciliationId: sheet.reconciliation_id,
    revision: sheet.revision,
    docId: doc.doc_id,
  });
  return doc;
}

/* ═══════════════════════════ SEND — Smart Comms (Q19) ════════════════════ */

/**
 * Post the statement to the file's Smart Comms conversation, with the PDF
 * attached by VAULT ID — the attachment is a pointer, not a copy, because
 * the vault is the master and a second byte-identical copy is not a second
 * document, it is the same document with two desks.
 *
 * Channel choice (owner answer Q19): prefer the dossier channel — the
 * statement announces the closed conversation to whoever follows the file —
 * and let the sender pick a DIRECT message instead. This function resolves
 * exactly one destination and says which it used.
 */
async function sendStatement(client, { dossierId, actor, ip, note, target = "channel", userId = null }) {
  const header = await repo.forDossier(client, dossierId);
  if (!header) throw new AppError("NOT_FOUND", "No reconciliation exists for this file yet — open the sheet to create one", 404);
  const dossierHead = await repo.dossierHeader(client, dossierId);

  // Render — reuses the settled render when one is on the record, mints
  // otherwise. The vault is the source of the attachment either way.
  const sheet = await service.sheetFor(client, { dossierId });
  const latest = Array.isArray(sheet.settlements) && sheet.settlements.length ? sheet.settlements[0] : null;
  const doc = latest && latest.statement_doc_id
    ? { doc_id: latest.statement_doc_id }
    : await statementPdf(client, { dossierId, actor });

  // ── Destination ────────────────────────────────────────────────────────
  let channel = null;
  if (target === "direct") {
    if (!userId) throw new AppError("VALIDATION_ERROR", "user_id is required for a direct message", 422);
    channel = await smartcomm.createChannel(client, {
      // member_ids lists the OTHER member(s) — the actor is enrolled as OWNER
      // by createChannel itself, and the DIRECT dedupe triggers on exactly one.
      data: { kind: "DIRECT", member_ids: [userId] },
      actor,
    });
  } else {
    channel = await smartcomm.findDossierChannel(client, { dossierId });
    if (!channel) {
      const dossier = await repo.dossierHeader(client, dossierId);
      channel = await smartcomm.createChannel(client, {
        data: { kind: "DOSSIER", dossier_id: dossierId, name: `${dossier ? dossier.ref : "File"} — reconciliation`, member_ids: [actor.user_id].filter(Boolean) },
        actor,
      });
    }
  }

  const body = note && note.trim()
    ? note.trim()
    : `Reconciliation statement ${dataNumber(dossierHead, sheet)} — ${sheet.status === "SETTLED" ? "settled" : `status ${sheet.status}`}.`;
  const message = await smartcomm.postMessage(client, {
    groupId: channel.group_id || channel.comms_group_id,
    body,
    attachments: [{
      attachment_kind: "VAULT",
      vault_id: doc.doc_id,
      filename: `${dataNumber(dossierHead, sheet)}.pdf`,
      content_type: "application/pdf",
    }],
    actor,
  });

  await emitEvent(client, {
    eventTypeKey: events.STATEMENT_SENT, moduleKey: MODULE,
    actorUserId: actor.user_id || null,
    entityRef: ref(header.reconciliation_id),
    payload: {
      dossier_ref: dataNumber(dossierHead, sheet),
      doc_id: doc.doc_id, group_id: channel.group_id || channel.comms_group_id,
      amount_xaf: sheet.totals.actual_ttc,
    },
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: events.STATEMENT_SENT, moduleKey: MODULE,
    entityRef: ref(header.reconciliation_id),
    after: { doc_id: doc.doc_id, group_id: channel.group_id || channel.comms_group_id, target },
    ip,
  });

  return {
    doc_id: doc.doc_id,
    group: channel,
    message_id: message.message_id || message.comms_message_id,
    message,
    target,
  };
}

const dataNumber = (dossierHead, sheet) =>
  `REC-${(dossierHead && dossierHead.ref) || "file"}-r${(sheet && sheet.revision) || 1}`;

module.exports = {
  statementData, statementPdf, statementXlsx, statementForSettlement, sendStatement,
};
