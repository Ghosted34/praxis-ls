"use strict";
const service = require("./portal.service");
const { asyncHandler, AppError } = require("../../utils/errors");
const actor = (req) => req.user || { user_id: null };

/**
 * The scope for a portal data route comes from the GRANT, never from the
 * caller. `portalAuth("CLIENT")` resolved the portal_access row for the token
 * and put its client_id on `req.portal.clientId`; trusting a query parameter
 * here would let any CLIENT-granted user read another client's dossiers by
 * passing their id — the exact "scope: only the client's own data" promise
 * the portal exists to keep.
 */
const clientId = (req) => {
  const id = req.portal && req.portal.clientId;
  if (!id) throw new AppError("CLIENT_REQUIRED", "A CLIENT portal grant with a client scope is required", 422);
  return id;
};

module.exports = {
  listAccess: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.listAccess(c, req.query)) })),
  grant: asyncHandler(async (req, res) => { const b = req.body; res.status(201).json({ data: await req.tenantDb((c) => service.grantAccess(c, { portal: b.portal, subjectEmail: b.subject_email, clientId: b.client_id, expiresAt: b.expires_at, actor: actor(req) })) }); }),
  revoke: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.revokeAccess(c, { id: req.params.id, actor: actor(req) })) })),
  check: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.checkAccess(c, { email: req.query.email, portal: req.query.portal })) })),
  client: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.clientView(c, { clientId: clientId(req) })) })),
  clientChain: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.clientChain(c, { clientId: clientId(req), dossierId: req.params.dossierId })) })),
  clientDocuments: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.clientDocuments(c, { clientId: clientId(req) })) })),
  clientDocumentDownload: asyncHandler(async (req, res) => {
    const { doc, buffer } = await req.tenantDb((c) => service.clientDocumentDownload(c, { clientId: clientId(req), docId: req.params.id }));
    const name = doc.original_name || `${doc.doc_type_code || doc.doc_type || "document"}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/[^\w.-]+/g, "_")}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(buffer);
  }),
  investor: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.investorView(c, { params: req.query })) })),
  auditor: asyncHandler(async (req, res) => res.json({ data: await req.tenantDb((c) => service.auditorView(c, { params: req.query })) })),
};
