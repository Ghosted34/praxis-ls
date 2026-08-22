/**
 * Tier 4 wet signatures — print jobs, returned scans and reconciliation.
 *
 * The state machine is intentionally first-class. Paper is the weakest chain of
 * custody in the programme, so it gets more corroboration, not less: a barcode
 * decode is only a candidate until the print job, document type, request state
 * and duplicate-scan checks all agree.
 */
"use strict";

const repo = require("./signature_wet.repo");
const events = require("./signature_wet.events");
const requestRepo = require("../signature_request/signature_request.repo");
const sigRepo = require("../document_signature/document_signature.repo");
const sigService = require("../document_signature/document_signature.service");
const vaultService = require("../document_vault/document_vault.service");
const barcode = require("../../../services/signatures/barcode");
const canonical = require("../../../services/signatures/canonical");
const tokens = require("../../../services/signatures/tokens");
const { getSetting } = require("../../../shared/config/settings");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { AppError } = require("../../../utils/errors");

const UPLOAD_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/jpg", "image/webp"];

function presentJob(job) {
  if (!job) return null;
  return {
    print_job_id: job.print_job_id,
    request_id: job.request_id,
    party_id: job.party_id,
    entity_ref: job.entity_ref,
    doc_type: job.doc_type,
    document_vault_id: job.document_vault_id,
    content_hash: job.content_hash,
    print_code: barcode.formatCode(job.print_code),
    reprint_of: job.reprint_of,
    reprint_no: job.reprint_no,
    status: job.status,
    printed_at: job.printed_at,
    reconciled_at: job.reconciled_at,
    reconciled_by: job.reconciled_by,
    scan_vault_id: job.scan_vault_id,
  };
}

function presentIngest(row) {
  if (!row) return null;
  return {
    ingest_id: row.ingest_id,
    source: row.source,
    source_ref: row.source_ref,
    document_vault_id: row.document_vault_id,
    decoded_code: row.decoded_code ? barcode.formatCode(row.decoded_code) : null,
    decode_status: row.decode_status,
    print_job_id: row.print_job_id,
    match_status: row.match_status,
    match_notes: row.match_notes,
    processed_at: row.processed_at,
    entity_ref: row.entity_ref,
    doc_type: row.doc_type,
    print_code: row.print_code ? barcode.formatCode(row.print_code) : null,
  };
}

async function uniquePrintCode(client) {
  for (let i = 0; i < 8; i += 1) {
    const code = barcode.mintCode();
    if (!(await repo.getJobByCode(client, code))) return code;
  }
  throw new AppError("PRINT_CODE_EXHAUSTED", "Could not mint a unique print code.", 500);
}

/**
 * Issue the paper copy. The caller may pass a request+party from the signing
 * flow, or just a document ref for an internal reprint. The content hash is the
 * live canonical hash at print time: that is what came out of the printer.
 */
async function issue(client, opts) {
  const { requestId = null, partyId = null, entityRef, docType, documentVaultId = null, doc = null, actor = {} } = opts;
  if (!entityRef) throw new AppError("NO_ENTITY_REF", "entity_ref is required", 422);
  if (!docType) throw new AppError("NO_DOC_TYPE", "doc_type is required", 422);

  const existing = await repo.openJobForParty(client, partyId);
  if (existing) return presentJob(existing);

  const liveDoc = await sigService.loadDoc(client, { docType, entityRef, doc });
  const { hash } = canonical.build(docType, liveDoc);
  const job = await repo.insertJob(client, {
    request_id: requestId,
    party_id: partyId,
    entity_ref: entityRef,
    doc_type: docType,
    document_vault_id: documentVaultId,
    content_hash: hash,
    print_code: await uniquePrintCode(client),
    status: "ISSUED",
  });

  await emitEvent(client, {
    eventTypeKey: events.PRINTED, moduleKey: events.MODULE, entityRef,
    actorUserId: actor.user_id || null,
    payload: { print_job_id: job.print_job_id, request_id: requestId, reprint_no: job.reprint_no },
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: events.PRINTED, moduleKey: events.MODULE,
    entityRef, after: { print_job_id: job.print_job_id, print_code: job.print_code, content_hash: hash },
  });

  return presentJob(job);
}

async function reprint(client, { id, actor = {} }) {
  const prior = await repo.getJob(client, id);
  if (!prior) throw new AppError("NOT_FOUND", "Print job not found", 404);
  if (["VOIDED", "REJECTED"].includes(prior.status)) {
    throw new AppError("NOT_REPRINTABLE", `A ${prior.status} print job cannot be reprinted.`, 409);
  }
  const liveDoc = await sigService.loadDoc(client, { docType: prior.doc_type, entityRef: prior.entity_ref });
  const { hash } = canonical.build(prior.doc_type, liveDoc);
  if (hash !== prior.content_hash) {
    throw new AppError(
      "DOCUMENT_AMENDED",
      "This document changed since the paper-signature copy was issued. Reissue the signature request instead of reprinting it.",
      409,
      { print_job_id: prior.print_job_id },
    );
  }
  const root = prior.reprint_of || prior.print_job_id;
  const n = await repo.latestReprintNo(client, root);
  const job = await repo.insertJob(client, {
    request_id: prior.request_id,
    party_id: prior.party_id,
    entity_ref: prior.entity_ref,
    doc_type: prior.doc_type,
    document_vault_id: prior.document_vault_id,
    content_hash: hash,
    print_code: await uniquePrintCode(client),
    reprint_of: root,
    reprint_no: n + 1,
    status: "ISSUED",
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: events.PRINTED, moduleKey: events.MODULE,
    entityRef: prior.entity_ref, after: { print_job_id: job.print_job_id, reprint_of: root, reprint_no: job.reprint_no },
  });
  return presentJob(job);
}

async function barcodeFor(client, id) {
  const job = await repo.getJob(client, id);
  if (!job) throw new AppError("NOT_FOUND", "Print job not found", 404);
  const svg = await barcode.generateSvg(job.print_code);
  return { ...presentJob(job), svg, code: job.print_code };
}

async function markPrinted(client, { id, actor = {} }) {
  const job = await repo.markPrinted(client, id);
  if (!job) throw new AppError("NOT_FOUND", "Print job not found", 404);
  await audit(client, {
    actorUserId: actor.user_id || null,
    action: events.PRINTED,
    moduleKey: events.MODULE,
    entityRef: job.entity_ref,
    after: { print_job_id: job.print_job_id, status: job.status },
  });
  return presentJob(job);
}

async function ingest(client, opts) {
  const { source = "UPLOAD", sourceRef = null, dataUrl, actor = {}, slug } = opts;
  const row = await vaultService.createDocument(client, {
    dataUrl,
    entityRef: null,
    docType: "WET_SIGNATURE_SCAN",
    fileContext: "SIGNATURE_INGEST",
    maxBytes: 25 * 1024 * 1024,
    allowedTypes: UPLOAD_TYPES,
    sniff: true,
    slug,
    actor,
  });
  const ingestRow = await repo.insertIngest(client, {
    source,
    source_ref: sourceRef,
    document_vault_id: row.doc_id,
    decode_status: "PENDING",
    match_status: "PENDING",
  });

  await emitEvent(client, {
    eventTypeKey: events.SCANNED_RETURNED, moduleKey: events.MODULE,
    entityRef: "document_vault:" + row.doc_id,
    actorUserId: actor.user_id || null,
    payload: { ingest_id: ingestRow.ingest_id, source },
  });

  return presentIngest(ingestRow);
}

function decodeNote(decoded) {
  if (!decoded || decoded.status === "NO_BARCODE") return "No DataMatrix barcode was found.";
  if (decoded.reason === "PDF_RASTERIZE_FAILED") return "This PDF could not be opened for barcode decoding.";
  if (decoded.reason === "EMPTY_INPUT") return "The uploaded file was empty.";
  return "The returned scan could not be opened or decoded reliably.";
}

async function decodeAndReconcile(client, { ingestId, actor = {}, docTypeHint = null } = {}) {
  await repo.lockIngest(client, ingestId);
  const ingestRow = await repo.getIngest(client, ingestId);
  if (!ingestRow) throw new AppError("NOT_FOUND", "Signature ingest row not found", 404);
  const { buffer } = await vaultService.fetchBytes(client, ingestRow.document_vault_id);
  const decoded = await barcode.decode(buffer);

  if (decoded.status !== "DECODED") {
    const row = await repo.updateIngest(client, ingestId, {
      decode_status: decoded.status,
      match_status: "REVIEW",
      match_notes: decodeNote(decoded),
      processed_at: new Date(),
    });
    await emitEvent(client, {
      eventTypeKey: events.RECONCILE_REVIEW, moduleKey: events.MODULE,
      entityRef: "document_vault:" + ingestRow.document_vault_id,
      actorUserId: actor.user_id || null,
      payload: { ingest_id: ingestId, decode_status: decoded.status },
    });
    return presentIngest(row);
  }

  return reconcileCode(client, { ingestRow, code: decoded.code, actor, docTypeHint });
}

async function reconcileCode(client, { ingestRow, code, actor = {}, docTypeHint = null }) {
  let job = await repo.getJobByCode(client, code);
  const failures = [];
  if (job) {
    await repo.lockJob(client, job.print_job_id);
    job = await repo.getJob(client, job.print_job_id);
  }
  if (!job) failures.push("PRINT_JOB_NOT_FOUND");
  if (job && !["ISSUED", "PRINTED"].includes(job.status)) failures.push("PRINT_JOB_NOT_OPEN");
  if (job && docTypeHint && job.doc_type !== docTypeHint) failures.push("DOC_TYPE_MISMATCH");

  let request = null;
  if (job && job.request_id) request = await requestRepo.getRequest(client, job.request_id);
  if (job && job.request_id && (!request || !["SENT", "PARTIALLY_SIGNED"].includes(request.status))) {
    failures.push("REQUEST_NOT_WAITING_FOR_SIGNATURE");
  }
  if (job && await repo.hasReconciledScan(client, job.print_job_id)) failures.push("ALREADY_RECONCILED");
  if (job && request && ["SENT", "PARTIALLY_SIGNED"].includes(request.status)) {
    try {
      const requestService = require("../signature_request/signature_request.service");
      const liveDoc = await requestService.assertUnamended(client, request);
      const { hash } = canonical.build(job.doc_type, liveDoc);
      if (hash !== job.content_hash) failures.push("PRINTED_PAYLOAD_AMENDED");
    } catch (err) {
      failures.push(err && err.code === "DOCUMENT_AMENDED" ? "DOCUMENT_AMENDED" : "DOCUMENT_UNREADABLE");
    }
  }

  if (failures.length) {
    if (job && ["ISSUED", "PRINTED"].includes(job.status)) {
      await repo.transitionJob(client, job.print_job_id, "REVIEW", ["ISSUED", "PRINTED"], {
        scan_vault_id: ingestRow.document_vault_id,
      });
    }
    const row = await repo.updateIngest(client, ingestRow.ingest_id, {
      decoded_code: code,
      decode_status: "DECODED",
      print_job_id: job ? job.print_job_id : null,
      match_status: "REVIEW",
      match_notes: failures.join(", "),
      processed_at: new Date(),
    });
    await emitEvent(client, {
      eventTypeKey: events.RECONCILE_REVIEW, moduleKey: events.MODULE,
      entityRef: job ? job.entity_ref : "document_vault:" + ingestRow.document_vault_id,
      actorUserId: actor.user_id || null,
      payload: { ingest_id: ingestRow.ingest_id, decoded_code: code, failures },
    });
    return presentIngest(row);
  }

  const notes = docTypeHint
    ? "Corroborated: open print job, document type hint, waiting request, no prior reconciliation, unchanged payload."
    : "Corroborated: open print job, waiting request, no prior reconciliation, unchanged payload. Document type could not be derived from the scan.";
  return finalizeReconciliation(client, {
    ingestRow,
    job,
    request,
    actor,
    matchStatus: "AUTO",
    matchNotes: notes,
    decodedCode: code,
  });
}

async function finalizeReconciliation(client, { ingestRow, job, request, actor = {}, matchStatus, matchNotes, decodedCode = null }) {
  const signer = await signerForWet(client, job, request);
  const sig = await sigRepo.insert(client, {
    entity_ref: job.entity_ref,
    doc_type: job.doc_type,
    document_vault_id: ingestRow.document_vault_id,
    payload_version: 1,
    content_hash: job.content_hash,
    content_payload: JSON.stringify({
      print_job_id: job.print_job_id,
      print_code: job.print_code,
      reconciliation: matchStatus,
    }),
    artifact_hash: null,
    assurance_level: "WET",
    visual_mark: "INK",
    preset_code: "PRINT_SIGN",
    sign_reason: null,
    party: signer.party,
    identity_source: signer.identity_source,
    signer_user_id: signer.signer_user_id,
    signer_name: signer.signer_name,
    signer_role: signer.signer_role,
    signer_email: signer.signer_email,
    signature_request_id: job.request_id,
    verify_code: tokens.mintVerifyCode(),
  });

  const actorId = await resolveActorId(client, actor.user_id).catch(() => null);
  const settled = await settleWetParty(client, { job, request, actor });

  await repo.transitionJob(client, job.print_job_id, "RECONCILED", ["ISSUED", "PRINTED", "REVIEW"], {
    scan_vault_id: ingestRow.document_vault_id,
    reconciled_by: actorId,
  });
  const row = await repo.updateIngest(client, ingestRow.ingest_id, {
    decoded_code: decodedCode || job.print_code,
    decode_status: decodedCode ? "DECODED" : ingestRow.decode_status,
    print_job_id: job.print_job_id,
    match_status: matchStatus,
    match_notes: matchNotes,
    processed_at: new Date(),
  });

  await emitEvent(client, {
    eventTypeKey: events.RECONCILED, moduleKey: events.MODULE, entityRef: job.entity_ref,
    actorUserId: actor.user_id || null,
    payload: {
      ingest_id: row.ingest_id,
      print_job_id: job.print_job_id,
      signature_id: sig.signature_id,
      reconciliation: matchStatus,
      request_completed: settled.completed,
    },
  });
  await audit(client, {
    actorUserId: actor.user_id || null, action: events.RECONCILED, moduleKey: events.MODULE,
    entityRef: job.entity_ref,
    after: { ingest_id: row.ingest_id, print_job_id: job.print_job_id, signature_id: sig.signature_id, reconciliation: matchStatus },
  });

  return { ...presentIngest(row), signature_id: sig.signature_id, verify_code: tokens.formatCode(sig.verify_code) };
}

async function settleWetParty(client, { job, request, actor = {} }) {
  if (!job.party_id || !request) return { settled: false, completed: false };

  const settled = await requestRepo.settleParty(client, job.party_id, "SIGNED");
  if (!settled) {
    throw new AppError("ALREADY_SETTLED", "This signing party has already been settled.", 409,
      { party_id: job.party_id });
  }

  const remaining = await requestRepo.nextPendingParty(client, request.request_id);
  if (remaining) {
    await requestRepo.transitionRequest(client, request.request_id, "PARTIALLY_SIGNED",
      ["DRAFT", "SENT", "PARTIALLY_SIGNED"]);
    return { settled: true, completed: false, next_party_id: remaining.party_id };
  }

  const completed = await requestRepo.transitionRequest(
    client,
    request.request_id,
    "COMPLETED",
    ["DRAFT", "SENT", "PARTIALLY_SIGNED"],
    { completed_at: new Date() },
  );

  if (completed) {
    try {
      const requestService = require("../signature_request/signature_request.service");
      await requestService.generateCertificate(client, { id: request.request_id, language: "fr" });
    } catch {
      /* @silent:storage — reconciliation is the legal act; the certificate is
         recoverable through POST /signature-requests/:id/certificate. */
    }
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: "document_signature.completed",
      moduleKey: events.MODULE,
      entityRef: request.entity_ref,
      after: { request_id: request.request_id, via: "WET" },
    });
  }

  return { settled: true, completed: Boolean(completed) };
}

async function signerForWet(client, job, request) {
  if (job.party_id) {
    const parties = request ? await requestRepo.listParties(client, request.request_id) : [];
    const p = parties.find((x) => x.party_id === job.party_id);
    if (p) {
      return {
        party: p.party_kind === "ISSUER" ? "ISSUER" : "EXTERNAL",
        identity_source: p.source === "ON_FILE" ? "ON_FILE" : "OVERRIDE",
        signer_user_id: null,
        signer_name: p.full_name,
        signer_role: p.party_role,
        signer_email: p.email,
      };
    }
  }
  return {
    party: "EXTERNAL",
    identity_source: "DECLARED",
    signer_user_id: null,
    signer_name: "Wet-signature return",
    signer_role: null,
    signer_email: null,
  };
}

async function bind(client, { ingestId, printJobId, actor = {} }) {
  const ingestRow = await repo.getIngest(client, ingestId);
  let job = await repo.getJob(client, printJobId);
  if (!ingestRow || !job) throw new AppError("NOT_FOUND", "Ingest row or print job not found", 404);
  await repo.lockJob(client, job.print_job_id);
  job = await repo.getJob(client, printJobId);
  if (!job) throw new AppError("NOT_FOUND", "Print job not found", 404);
  if (!["ISSUED", "PRINTED", "REVIEW"].includes(job.status)) {
    throw new AppError("NOT_BINDABLE", `A ${job.status} print job cannot be bound.`, 409,
      { print_job_id: printJobId, status: job.status });
  }
  if (await repo.hasReconciledScan(client, job.print_job_id)) {
    throw new AppError("ALREADY_RECONCILED", "This print job has already been reconciled.", 409,
      { print_job_id: printJobId });
  }
  const request = job.request_id ? await requestRepo.getRequest(client, job.request_id) : null;
  if (request && ["SENT", "PARTIALLY_SIGNED"].includes(request.status)) {
    const requestService = require("../signature_request/signature_request.service");
    await requestService.assertUnamended(client, request);
  }
  return finalizeReconciliation(client, {
    ingestRow,
    job,
    request,
    actor,
    matchStatus: "MANUAL",
    matchNotes: "Bound by operator after review.",
    decodedCode: ingestRow.decoded_code || job.print_code,
  });
}

async function reject(client, { ingestId, reason, actor = {} }) {
  const row = await repo.updateIngest(client, ingestId, {
    match_status: "REJECTED",
    match_notes: reason || "Rejected by operator.",
    processed_at: new Date(),
  });
  if (!row) throw new AppError("NOT_FOUND", "Signature ingest row not found", 404);
  if (row.print_job_id) {
    await repo.transitionJob(client, row.print_job_id, "REJECTED", ["ISSUED", "PRINTED", "REVIEW"], {
      scan_vault_id: row.document_vault_id,
    });
  }
  await audit(client, {
    actorUserId: actor.user_id || null, action: events.RECONCILE_REVIEW, moduleKey: events.MODULE,
    entityRef: "document_vault:" + row.document_vault_id, after: { ingest_id: ingestId, rejected: true, reason },
  });
  return presentIngest(row);
}

async function queue(client, opts) {
  return (await repo.listQueue(client, opts)).map(presentIngest);
}

async function unreconciledOffenders(client) {
  const days = Number(await getSetting(client, "signature_policy", "unreconciled_days", 7));
  const rows = await repo.unreconciled(client, Number.isFinite(days) && days >= 0 ? days : 7);
  return rows.map((r) => ({
    entity_ref: "signature_print_job:" + r.print_job_id,
    message: `${r.doc_type} ${r.entity_ref} was printed for hand-signature on ${new Date(r.created_at).toISOString().slice(0, 10)} and has not come back.`,
  }));
}

module.exports = {
  issue, reprint, barcodeFor, markPrinted, ingest, decodeAndReconcile, bind, reject, queue,
  unreconciledOffenders, presentJob, presentIngest,
};
