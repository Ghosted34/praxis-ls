/**
 * Proposals in the client portal (client portal redesign PR 2): read one,
 * download it, decline it with a reason, or accept it with an e-signature.
 *
 * ── THE SIGNATURE IS THE SIGNATURE PROGRAMME'S, NOT A SECOND ONE ───────────
 *
 * doc/SIGNATURE_ENGINEERING_GUIDE.md already built what "e-sign" means here:
 * a signature request with the counterparty as an ON-FILE party, an emailed
 * six-digit code bound to the document's canonical hash (§6.4), a stamp or a
 * drawn mark, and a signature row the verification portal can answer for. The
 * portal does not invent a lighter one beside it — a click that "counts as a
 * signature" would be exactly the evidence gap that programme closed. So:
 *
 *   start    → the request (opened on behalf of whoever sent the proposal, the
 *              portal user as its one ON-FILE counterparty — their address is
 *              on file because the tenant invited it), dispatched without the
 *              email link (they are already here), and the code sent.
 *   complete → the code verified, then `signature_public.complete`, then the
 *              proposal moves SENT → ACCEPTED through the proposal service.
 *
 * The party's signing token never reaches the browser: each step mints a
 * fresh one server-side (`remintSignToken`) and hands it to the public
 * service. The browser proves who it is with the portal session and the code.
 *
 * ── WHEN THE TENANT HAS E-SIGNATURE OFF ────────────────────────────────────
 *
 * The menu for PROPOSAL (tenant policy + feature flags, `presets.resolveMenu`)
 * may offer no digital card. Accepting a proposal is still the business event
 * the client came to do, so the portal then offers a confirmed "Accept" —
 * recorded with the portal identity in the audit ledger, and never called a
 * signature anywhere.
 */
"use strict";

const proposalRepo = require("../sales/proposal/proposal.repo");
const proposalService = require("../sales/proposal/proposal.service");
const proposalEvents = require("../sales/proposal/proposal.events");
const presentation = require("../sales/proposal/proposal.presentation");
const { languageRef } = require("../sales/proposal_public/proposal_public.service");
const requestService = require("../vault/signature_request/signature_request.service");
const signing = require("../vault/signature_public/signature_public.service");
const presets = require("../../services/signatures/presets");
const vault = require("../vault/document_vault/document_vault.service");
const notificationRepo = require("../notification/notification.repo");
const { emitEvent, audit } = require("../../shared/events/emit");
const { AppError } = require("../../utils/errors");

const DOC_TYPE = "PROPOSAL";
/** The two cards a signed-in client can complete here: the others hand off (QES) or go to paper. */
const DIGITAL = ["STAMP", "DRAWN"];
const VISIBLE = ["SENT", "ACCEPTED", "REJECTED"];
const entityRef = (id) => `proposal:${id}`;
const langOf = (lang) => (String(lang || "").toLowerCase().startsWith("fr") ? "fr" : "en");

/** A proposal of THIS client that the client may see: sent, or already answered. */
async function owned(c, { clientId, proposalId }) {
  const row = await proposalRepo.get(c, proposalId);
  if (!row || row.client_id !== clientId || !VISIBLE.includes(row.status)) {
    throw new AppError("NOT_FOUND", "Proposal not found", 404);
  }
  return row;
}

const totalOf = (lines) => lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);

/** Valid until: the day it was sent plus its validity, when it has one. */
function validUntil(row) {
  const days = Number(row.validity_days);
  if (!Number.isFinite(days) || days <= 0) return null;
  const from = new Date(row.sent_at || row.updated_at || row.created_at);
  if (Number.isNaN(from.getTime())) return null;
  return new Date(from.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** The client's signature on a proposal, if one exists — for "Signed by … on …". */
async function signatureOf(c, proposalId) {
  const { rows } = await c.query(
    `SELECT signature_id, signer_name, signer_role, signed_at, created_at, visual_mark, assurance_level, verify_code
       FROM document_signature
      WHERE entity_ref = $1 AND party = 'EXTERNAL' AND revoked_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [entityRef(proposalId)],
  );
  const s = rows[0];
  if (!s) return null;
  return {
    signer_name: s.signer_name,
    signer_role: s.signer_role || null,
    signed_at: s.signed_at || s.created_at,
    mark: s.visual_mark,
    assurance: s.assurance_level,
    verify_code: s.verify_code ? String(s.verify_code) : null,
  };
}

async function list(c, { clientId }) {
  const { rows } = await c.query(
    `SELECT p.proposal_id, p.doc_number, p.title, p.status, p.currency, p.validity_days,
            p.created_at, p.updated_at, p.origin_location, p.destination_location,
            COALESCE(t.total, 0) AS total
       FROM proposal p
       LEFT JOIN (SELECT proposal_id, SUM(COALESCE(qty, 1) * COALESCE(unit_price, 0)) AS total
                    FROM proposal_line GROUP BY proposal_id) t ON t.proposal_id = p.proposal_id
      WHERE p.client_id = $1 AND p.status = ANY($2::text[])
      ORDER BY CASE p.status WHEN 'SENT' THEN 0 ELSE 1 END, p.updated_at DESC
      LIMIT 100`,
    [clientId, VISIBLE],
  );
  return rows.map((r) => ({
    proposal_id: r.proposal_id,
    doc_number: r.doc_number || null,
    title: r.title,
    status: r.status,
    currency: r.currency || "XAF",
    total: Number(r.total || 0),
    route: [r.origin_location, r.destination_location].filter(Boolean).join(" → ") || null,
    sent_on: r.updated_at,
    valid_until: validUntil(r),
  }));
}

/** What the tenant lets a signed-in client sign this with, right now. */
async function digitalCards(c, lang) {
  try {
    const menu = await presets.resolveMenu(c, { docType: DOC_TYPE, language: lang });
    return menu.cards.filter((card) => DIGITAL.includes(card.preset_code)).map((card) => ({
      preset_code: card.preset_code,
      label: card.label,
      blurb: card.blurb || null,
    }));
  } catch {
    // An unsignable configuration reads as "no e-signature", which the portal
    // answers with a confirmed accept — never as a broken proposal.
    return [];
  }
}

async function get(c, { clientId, proposalId, lang = "en" }) {
  const row = await owned(c, { clientId, proposalId });
  const [lines, narratives, clientRows] = await Promise.all([
    proposalRepo.listLines(c, proposalId),
    proposalRepo.listNarratives(c, proposalId),
    c.query("SELECT name, legal_name FROM client_master WHERE client_id = $1", [clientId]),
  ]);
  const model = presentation.build({
    proposal: row, lines, narratives, client: clientRows.rows[0] || null,
    language: langOf(lang) === "fr" ? "FR" : "EN",
  });
  await proposalRepo.stampViewed(c, proposalId).catch(() => {
    /* @silent:storage — "viewed" is telemetry for sales, never a reason to fail the read */
  });
  const cards = row.status === "SENT" ? await digitalCards(c, langOf(lang)) : [];
  const declineReasons = row.status === "SENT"
    ? (await presets.reasons(c, { kind: "DECLINE" })).map((r) => ({
      reason_code: r.reason_code, label: langOf(lang) === "fr" ? r.label_fr : r.label_en,
    }))
    : [];
  return {
    proposal: {
      proposal_id: row.proposal_id,
      doc_number: row.doc_number || null,
      title: row.title,
      status: row.status,
      currency: row.currency || "XAF",
      total: totalOf(lines),
      valid_until: validUntil(row),
    },
    presentation: model,
    signature: row.status === "ACCEPTED" ? await signatureOf(c, proposalId) : null,
    signing: { available: cards.length > 0, cards },
    decline_reasons: declineReasons,
  };
}

/** The PDF, in the language asked for when the proposal was issued in both. */
async function pdf(c, { clientId, proposalId, lang = "en" }) {
  const row = await owned(c, { clientId, proposalId });
  const selected = presentation.selectedLanguage(row, langOf(lang) === "fr" ? "FR" : "EN");
  const exact = await vault.getByRef(c, languageRef(row.proposal_id, selected));
  const docId = (exact && exact.doc_id) || row.pdf_vault_id;
  if (!docId) throw new AppError("NOT_READY", "The document is still being prepared", 409);
  const out = await vault.fetchBytes(c, docId);
  await proposalRepo.stampDownloaded(c, proposalId).catch(() => {
    /* @silent:storage — telemetry, as above */
  });
  return { buffer: out.buffer, name: `${row.doc_number || "proposal"}.pdf`, type: "application/pdf" };
}

/* ── signing ─────────────────────────────────────────────────────────────── */

function assertOpen(row) {
  if (row.status !== "SENT") {
    throw new AppError("PROPOSAL_ANSWERED", "This proposal has already been answered", 409, { status: row.status });
  }
  const until = validUntil(row);
  if (until && until < new Date().toISOString().slice(0, 10)) {
    throw new AppError("PROPOSAL_EXPIRED", "This proposal is no longer valid. Ask for an updated one.", 409);
  }
}

/**
 * Who stands behind the request: the person who sent the proposal, as the
 * ledger remembers it; else its reviewer; else the MD. A signature request is
 * always somebody's (`created_by` is NOT NULL, guide §6.3), and a client
 * cannot be that somebody.
 */
async function sender(c, row) {
  const first = await notificationRepo.requesterFor(c, entityRef(row.proposal_id)).catch(() => null);
  if (first) return first;
  if (row.reviewed_by) return row.reviewed_by;
  // The MD is the CEO role (as auth derives is_ceo — app_user has no column).
  const { rows } = await c.query(
    `SELECT u.user_id
       FROM app_user u
       JOIN user_role ur ON ur.user_id = u.user_id
       JOIN role r ON r.role_id = ur.role_id
      WHERE r.code = 'CEO' AND u.status = 'ACTIVE'
      ORDER BY u.created_at ASC LIMIT 1`,
  );
  if (rows[0]) return rows[0].user_id;
  throw new AppError("NO_SENDER", "This proposal cannot be signed online. Contact your account manager.", 409);
}

/** This person's open party on this proposal's open request, if there is one. */
async function openParty(c, { proposalId, email }) {
  const { rows } = await c.query(
    `SELECT p.party_id, p.request_id, p.status
       FROM signature_party p
       JOIN signature_request r ON r.request_id = p.request_id
      WHERE r.entity_ref = $1 AND r.status IN ('DRAFT','SENT','PARTIALLY_SIGNED')
        AND lower(p.email::text) = lower($2) AND p.status IN ('PENDING','SENT','VIEWED')
      ORDER BY r.created_at DESC LIMIT 1`,
    [entityRef(proposalId), email],
  );
  return rows[0] || null;
}

/** A fresh token for this party, used and forgotten inside one request. */
async function tokenFor(c, partyId) {
  const out = await requestService.remintSignToken(c, { partyId });
  if (!out) throw new AppError("SIGNING_CLOSED", "This signature request is closed. Reload the proposal.", 409);
  return out.token;
}

/** Open (or reuse) the signing request and email the code. */
async function startSigning(c, { clientId, proposalId, me, grantId = null, lang = "en", tenantName = "" }) {
  const row = await owned(c, { clientId, proposalId });
  assertOpen(row);
  const cards = await digitalCards(c, langOf(lang));
  if (!cards.length) throw new AppError("ESIGN_UNAVAILABLE", "Online signing is not available for this proposal", 409);

  let party = await openParty(c, { proposalId, email: me.email });
  if (party && party.status === "PENDING") {
    // Created but never sent (an earlier attempt stopped half-way): send it now.
    const actor = { user_id: await sender(c, row) };
    await requestService.dispatch(c, { id: party.request_id, actor, language: langOf(lang), sendEmail: null });
    party = await openParty(c, { proposalId, email: me.email });
  }
  if (!party) {
    const actor = { user_id: await sender(c, row) };
    const request = await requestService.create(c, {
      entityRef: entityRef(proposalId),
      docType: DOC_TYPE,
      allowPaper: false,
      parties: [{
        party_kind: "COUNTERPARTY",
        source: "ON_FILE",
        // The address is on file because the tenant invited it to the portal.
        source_ref: grantId ? `portal_access:${grantId}` : `portal_user:${me.portal_user_id}`,
        full_name: me.full_name || me.email,
        party_role: null,
        email: me.email,
        language: langOf(lang),
      }],
      actor,
      language: langOf(lang),
    });
    // Dispatched WITHOUT the email link: the signer is already in the portal.
    await requestService.dispatch(c, { id: request.request_id, actor, language: langOf(lang), sendEmail: null });
    party = await openParty(c, { proposalId, email: me.email });
    if (!party) throw new AppError("SIGNING_CLOSED", "The signature request could not be opened", 409);
  }

  const token = await tokenFor(c, party.party_id);
  const view = await signing.resolve(c, { token, lang: langOf(lang) });
  const code = await signing.sendOtp(c, { token, lang: langOf(lang), tenantName });
  return {
    signer: { full_name: view.signer.full_name, email_masked: view.signer.email_masked },
    cards: view.menu.cards.filter((card) => DIGITAL.includes(card.preset_code)).map((card) => ({
      preset_code: card.preset_code, label: card.label, blurb: card.blurb || null,
    })),
    otp: code,
  };
}

/** Send the code again (the same row; the programme caps resends). */
async function resendCode(c, { clientId, proposalId, me, lang = "en", tenantName = "" }) {
  const row = await owned(c, { clientId, proposalId });
  assertOpen(row);
  const party = await openParty(c, { proposalId, email: me.email });
  if (!party) throw new AppError("SIGNING_NOT_STARTED", "Start signing first", 409);
  return { otp: await signing.sendOtp(c, { token: await tokenFor(c, party.party_id), lang: langOf(lang), tenantName }) };
}

/**
 * Verify the code, sign, and accept. The order is the programme's: the code
 * is checked against THIS payload, `complete` re-derives the hash (a proposal
 * edited since the code was sent is refused), then the proposal moves.
 */
async function completeSigning(c, { clientId, proposalId, me, code, presetCode, fullName = null, partyRole = null, markImageB64 = null, ip = null, userAgent = null, lang = "en", origin = null, slug = null }) {
  const row = await owned(c, { clientId, proposalId });
  assertOpen(row);
  if (!DIGITAL.includes(presetCode)) throw new AppError("PRESET_NOT_ALLOWED", "Choose a stamp or a drawn signature", 422);
  const party = await openParty(c, { proposalId, email: me.email });
  if (!party) throw new AppError("SIGNING_NOT_STARTED", "Start signing first", 409);

  const token = await tokenFor(c, party.party_id);
  await signing.verifyOtp(c, { token, code, ip, userAgent });
  const signed = await signing.complete(c, {
    token, presetCode, fullName, partyRole, markImageB64, ip, userAgent, lang: langOf(lang), origin, slug,
  });
  if (!signed || signed.signed !== true) {
    throw new AppError("SIGNING_INCOMPLETE", "The signature could not be completed", 409);
  }

  await proposalService.accept(c, { id: proposalId, actor: {} });
  await audit(c, {
    actorUserId: null, action: "proposal.accepted_in_portal", moduleKey: proposalEvents.MODULE,
    entityRef: entityRef(proposalId),
    after: { by: me.email, signed: true, verify_code: signed.verify_code || null },
    ip,
  });
  return { accepted: true, signature: await signatureOf(c, proposalId) };
}

/** Accept without a signature — only where the tenant offers no digital card. */
async function accept(c, { clientId, proposalId, me, ip = null, lang = "en" }) {
  const row = await owned(c, { clientId, proposalId });
  assertOpen(row);
  if ((await digitalCards(c, langOf(lang))).length) {
    throw new AppError("SIGNATURE_REQUIRED", "This proposal is accepted by signing it", 409);
  }
  await proposalService.accept(c, { id: proposalId, actor: {} });
  await audit(c, {
    actorUserId: null, action: "proposal.accepted_in_portal", moduleKey: proposalEvents.MODULE,
    entityRef: entityRef(proposalId), after: { by: me.email, signed: false }, ip,
  });
  return { accepted: true, signature: null };
}

/**
 * Decline with a reason from the controlled list (the signing programme's
 * DECLINE vocabulary, so sales reads one set of reasons wherever a client said
 * no). An open signing request is declined with it.
 */
async function decline(c, { clientId, proposalId, me, reasonCode, note = null, lang = "en" }) {
  const row = await owned(c, { clientId, proposalId });
  assertOpen(row);
  const reasons = await presets.reasons(c, { kind: "DECLINE" });
  const chosen = reasons.find((r) => r.reason_code === reasonCode);
  if (!chosen) {
    throw new AppError("UNKNOWN_DECLINE_REASON", "Choose a reason from the list", 422, { available: reasons.map((r) => r.reason_code) });
  }
  const party = await openParty(c, { proposalId, email: me.email });
  if (party) {
    await signing.declineSigning(c, { token: await tokenFor(c, party.party_id), reasonCode, note, lang: langOf(lang) });
  }
  await proposalService.transition(c, { id: proposalId, to: "REJECTED", actor: {} });
  const reason = `${langOf(lang) === "fr" ? chosen.label_fr : chosen.label_en}${note ? ` — ${String(note).slice(0, 400)}` : ""}`;
  await audit(c, {
    actorUserId: null, action: "proposal.declined_in_portal", moduleKey: proposalEvents.MODULE,
    entityRef: entityRef(proposalId), after: { by: me.email, reason_code: reasonCode, reason },
  });
  // Sales hears it with the reason, not just that the status changed.
  await emitEvent(c, {
    eventTypeKey: "proposal.declined_by_client", moduleKey: proposalEvents.MODULE, entityRef: entityRef(proposalId),
    actorUserId: null, payload: { client_id: clientId, doc_number: row.doc_number, reason_code: reasonCode, reason },
  });
  return { declined: true };
}

/** How many proposals wait for this client's answer — the Home card. */
async function pendingCount(c, { clientId }) {
  const { rows } = await c.query(
    "SELECT COUNT(*)::int AS n FROM proposal WHERE client_id = $1 AND status = 'SENT'",
    [clientId],
  );
  return rows[0] ? rows[0].n : 0;
}

module.exports = {
  list, get, pdf, startSigning, resendCode, completeSigning, accept, decline, pendingCount, validUntil, DIGITAL,
};
