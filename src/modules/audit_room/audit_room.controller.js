/** Auditor data-room controllers — wired into portal_auth.routes (/portal). */
"use strict";
const { asyncHandler } = require("../../utils/errors");
const service = require("./audit_room.service");

/** The auditor's identity, from the portal grant (never from the caller). */
const email = (req) => req.portal && req.portal.user && req.portal.user.email;

module.exports = {
  // Auditor (portalAuth("AUDITOR"))
  list: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.listForAuditor(c, { email: email(req) })) })),
  create: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await req.tenantDb((c) => service.createRequest(c, { email: email(req), note: req.body.note })) })),
  detail: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.detailForAuditor(c, { email: email(req), roomId: req.params.id })) })),
  download: asyncHandler(async (req, res) => {
    const { doc, buffer } = await req.tenantDb((c) => service.downloadDoc(c, { email: email(req), roomId: req.params.id, docId: req.params.docId }));
    const name = doc.original_name || `${doc.doc_type || "document"}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/[^\w.-]+/g, "_")}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(buffer);
  }),

  // Staff (authMiddleware + MOD-67)
  listStaff: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.listForStaff(c)) })),
  detailStaff: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.detailForStaff(c, { roomId: req.params.id })) })),
  attach: asyncHandler(async (req, res) =>
    res.status(201).json({ data: await req.tenantDb((c) => service.attach(c, { roomId: req.params.id, docId: req.body.doc_id, actor: req.user || {} })) })),
  answer: asyncHandler(async (req, res) =>
    res.json({ data: await req.tenantDb((c) => service.answer(c, { roomId: req.params.id, actor: req.user || {} })) })),
};
