"use strict";

const service = require("./signature_public.service");
const mail = require("../signature_request/signature_request.mail");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { originForSlug } = require("../../../services/signatures/verify-link");

/**
 * ⚠ EVERY HANDLER READS THROUGH `req.tenantDbIn("live", …)`, NEVER `req.tenantDb`.
 *
 * `req.tenantDb` resolves the environment from the `X-Praxis-Env` header,
 * which on a route with no session means the anonymous visitor chooses it. A
 * counterparty sending `X-Praxis-Env: sandbox` would be signing a SANDBOX
 * document — a signature that looks real to the person who gave it and exists
 * nowhere the tenant will ever look. The environment a request runs in is a
 * signed-in user's choice, not the internet's.
 *
 * proposal_public.routes.js and the verification portal carry the same pin for
 * the same reason.
 */
const live = (req, fn) => req.tenantDbIn("live", fn);

const token = (req) => req.validatedParams.token;
const lang = (req) => (req.body && req.body.lang) || req.validatedQuery.lang || "fr";

/**
 * §3.13 — captured from the connection, never from a header a caller controls.
 * `req.ip` is the address nginx actually saw: server.js sets a trust-proxy HOP
 * COUNT rather than `true`, which is what stops a client rotating its own
 * rate-limit key with a forged X-Forwarded-For.
 */
const wire = (req) => ({ ip: req.ip, userAgent: req.get("user-agent") || null });

/** The host the certificate's verification link should point at. */
const origin = (req) =>
  (req.tenant && req.tenant.slug ? originForSlug(req.tenant.slug) : `${req.protocol}://${req.get("host")}`);

/**
 * The mailer handed to the chain advance on an EXTERNAL completion.
 *
 * PR-4 found this missing and it mattered: `advance` dispatches the next
 * party's link only through a `sendEmail` it is given, and this controller
 * gave it none — so after a counterparty signed, the next party in the chain
 * was marked SENT with a token minted and nowhere delivered, and the tenant's
 * "send next link" button could not find them, because it looks for PENDING
 * parties. The chain advanced and stopped, silently, at the second signature.
 *
 * Same dispatcher shape as the internal dispatch (signature_request
 * controller): the plaintext token goes into exactly one email and nowhere
 * else, and the host is the tenant's own — the link must resolve on the
 * domain the request arrived on.
 */
const chainMailer = (req, client) => async ({ party, request, token, language }) => {
  const url = `${origin(req)}/sign/${encodeURIComponent(token)}`;
  const { subject, html, text } = mail.signingLinkEmail({
    party, request, url,
    tenantName: (req.tenant && req.tenant.name) || "",
    language,
  });
  await mail.send(client, {
    to: party.email, subject, html, text,
    entityRef: request.entity_ref, sendPoint: "signature.request",
  });
};

module.exports = {
  resolve: asyncHandler(async (req, res) => {
    const data = await live(req, (c) => service.resolve(c, { token: token(req), lang: lang(req) }));
    // Never cached by a proxy: the menu is resolved per render precisely
    // because a tenant can switch a card off, and a cached page would keep
    // offering it.
    res.set("Cache-Control", "no-store");
    res.json({ data });
  }),

  sendOtp: asyncHandler(async (req, res) => {
    const tenantName = (req.tenant && req.tenant.name) || "";
    const data = await live(req, (c) => service.sendOtp(c, { token: token(req), lang: lang(req), tenantName }));
    res.json({ data });
  }),

  verifyOtp: asyncHandler(async (req, res) => {
    const data = await live(req, (c) => service.verifyOtp(c, {
      token: token(req), code: req.body.code, ...wire(req),
    }));
    res.json({ data });
  }),

  complete: asyncHandler(async (req, res) => {
    const b = req.body;
    const data = await live(req, (c) => service.complete(c, {
      token: token(req),
      presetCode: b.preset_code,
      signReason: b.sign_reason || null,
      markImageB64: b.mark_image_b64 || null,
      fullName: b.full_name || null,
      partyRole: b.party_role === undefined ? null : b.party_role,
      lang: lang(req),
      origin: origin(req),
      slug: (req.tenant && req.tenant.slug) || null,
      // The next party's link, when the chain advances on this signature.
      // See chainMailer for why this used to be missing.
      sendEmail: chainMailer(req, c),
      ...wire(req),
    }));
    res.status(201).json({ data });
  }),

  decline: asyncHandler(async (req, res) => {
    const data = await live(req, (c) => service.declineSigning(c, {
      token: token(req), reasonCode: req.body.reason_code, note: req.body.note || null, lang: lang(req),
    }));
    res.json({ data });
  }),

  /**
   * Stream the PDF being signed.
   *
   * The VAULTED bytes, never a re-render: a re-render produces different bytes
   * (Puppeteer stamps /CreationDate) and therefore a different artifact hash,
   * so the signer would be looking at a file that will never match the one the
   * portal verifies (§1.3(e)).
   */
  document: asyncHandler(async (req, res) => {
    const out = await live(req, async (c) => {
      const { request } = await service.resolveToken(c, token(req));
      if (!request.document_vault_id) {
        throw new AppError("NOT_READY", "This document has not been rendered yet.", 409);
      }
      const vault = require("../document_vault/document_vault.service");
      const { buffer } = await vault.fetchBytes(c, request.document_vault_id);
      return { buffer, docType: request.doc_type };
    });
    res
      .type("application/pdf")
      .set("Cache-Control", "no-store")
      .set("Content-Disposition", `inline; filename="${out.docType.toLowerCase()}.pdf"`)
      .send(out.buffer);
  }),
};
