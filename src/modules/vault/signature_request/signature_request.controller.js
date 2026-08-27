"use strict";

const service = require("./signature_request.service");
const candidates = require("./signature_request.candidates");
const mail = require("./signature_request.mail");
const { asyncHandler } = require("../../../utils/errors");
const { originForSlug } = require("../../../services/signatures/verify-link");

const lang = (req) => (req.validatedQuery && req.validatedQuery.lang) || (req.body && req.body.lang) || "fr";

/**
 * The host a signing link resolves on.
 *
 * Same reasoning as the QR's host (services/signatures/verify-link.js): a
 * tenant is reached at its OWN subdomain, so by the time this handler runs the
 * request has already proved which host this tenant answers on. `req.tenant`
 * is preferred over the Host header where present, because the tenant's slug
 * is what the host resolver actually matched.
 */
const origin = (req) =>
  (req.tenant && req.tenant.slug ? originForSlug(req.tenant.slug) : `${req.protocol}://${req.get("host")}`);

/**
 * The mailer handed to `dispatch`, closing over the request so the service
 * stays free of HTTP. Injected rather than imported inside the service for the
 * same reason `pdf.renderAndStore` takes a `render`: a chain test must be able
 * to advance without a transport.
 */
const dispatcher = (req, client) => async ({ party, request, token, language }) => {
  const url = `${origin(req)}/sign/${encodeURIComponent(token)}`;
  const tenantName = (req.tenant && req.tenant.name) || "";
  const { subject, html, text } = mail.signingLinkEmail({ party, request, url, tenantName, language });
  await mail.send(client, {
    to: party.email, subject, html, text,
    entityRef: request.entity_ref, sendPoint: "signature.request",
  });
};

module.exports = {
  list: asyncHandler(async (req, res) => {
    const { entity_ref: entityRef, status } = req.validatedQuery;
    res.json({ data: await req.tenantDb((c) => service.list(c, { entityRef, status })) });
  }),

  /**
   * Who may be asked to sign this document.
   *
   * `view`-gated on the route: it lists addresses the tenant already holds, to
   * the same people who can already read the record. It is what keeps the
   * sending screen from having to type one (§6.3, and the note in
   * signature_request.candidates.js).
   */
  candidates: asyncHandler(async (req, res) => {
    const { entity_ref: entityRef, doc_type: docType } = req.validatedQuery;
    res.json({ data: await req.tenantDb((c) => candidates.list(c, { docType, entityRef })) });
  }),

  get: asyncHandler(async (req, res) => {
    res.json({ data: await req.tenantDb((c) => service.get(c, req.params.id, { language: lang(req) })) });
  }),

  create: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await req.tenantDb((c) => service.create(c, {
      entityRef: b.entity_ref,
      docType: b.doc_type,
      parties: b.parties,
      message: b.message || null,
      requireCertified: b.require_certified === true,
      allowPaper: b.allow_paper !== false,
      expiresInDays: b.expires_in_days,
      actor: req.user || {},
      language: lang(req),
    }));
    res.status(201).json({ data });
  }),

  dispatch: asyncHandler(async (req, res) => {
    const data = await req.tenantDb(async (c) => {
      const out = await service.dispatch(c, {
        id: req.params.id, actor: req.user || {}, language: lang(req),
        sendEmail: dispatcher(req, c),
      });
      // The plaintext token is NOT returned to the caller. It went into the
      // email and nowhere else — a sender who could read it back could sign as
      // the counterparty, which is the whole thing the peppered store prevents.
      return { party: out.party };
    });
    res.json({ data });
  }),

  /**
   * The Certificate of Completion for a finished chain.
   *
   * Generates it if the completion path could not — that path is best-effort
   * against the SIGNATURE (a renderer hiccup must not lose an act that has
   * legally happened), so this is where a missing certificate is recovered.
   * Idempotent on request_id, so pressing it twice returns the same doc_id and
   * the same bytes.
   */
  certificate: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.generateCertificate(c, {
      id: req.params.id, origin: origin(req), language: lang(req),
    }));
    res.json({ data });
  }),

  void: asyncHandler(async (req, res) => {
    const data = await req.tenantDb((c) => service.voidRequest(c, {
      id: req.params.id, reason: req.body.reason || null, actor: req.user || {},
    }));
    res.json({ data });
  }),
};
