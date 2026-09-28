/**
 * External portal auth + scoped data (PRD §11.1). basePath /portal (distinct from
 * the staff-facing /portals in the portal module).
 *
 *   PUBLIC                POST /portal/auth/login
 *                         POST /portal/auth/forgot   (always 200)
 *                         POST /portal/auth/accept   (invite/reset token)
 *   PORTAL USER (token)   GET  /portal/me
 *                         GET  /portal/client   (CLIENT grant)
 *                         GET  /portal/client/documents          (CLIENT grant)
 *                         GET  /portal/client/documents/:id/download (CLIENT grant)
 *                         GET  /portal/investor (INVESTOR grant)
 *                         GET  /portal/auditor  (AUDITOR grant)
 *                         GET/POST /portal/auditor/data-room     (AUDITOR grant)
 *                         GET  /portal/auditor/data-room/:id     (AUDITOR grant)
 *                         GET  /portal/auditor/data-room/:id/documents/:docId/download (AUDITOR grant)
 *   STAFF (MOD-67)        GET  /portal/data-room
 *                         POST /portal/data-room/:id/documents
 *                         POST /portal/data-room/:id/answer
 *                         GET  /portal/users
 *                         POST /portal/users
 *                         POST /portal/users/invite
 *                         POST /portal/users/:id/password
 *                         POST /portal/users/:id/status
 *
 * feature: null so the public login isn't feature-gated by the module loader.
 */
"use strict";
const express = require("express");
const { authMiddleware } = require("../../middleware/auth");
const { requirePermission } = require("../../middleware/rbac");
const { portalAuth, portalScope, portalClientAdmin } = require("./portal_auth.middleware");
const { requireFeature } = require("../../middleware/feature-gate");
const { singleFile } = require("../../shared/http/upload.middleware");
const c = require("./portal_auth.controller");
// Names match what the write-route validator gate recognises (`controller` /
// `validator` / `c` / `v`) — a chain named `controller.` or `validator.` reads as unvalidated.
const controller = require("../portal/portal.controller");
const v = require("./portal_auth.validator");
// The client portal redesign (14150): home, shipments, requests, billing,
// proof of payment, the client's own team — and the staff half of each.
const pc = require("../portal/portal_client.controller");
// SEC-C3, 2026-08-04. The portal is the INTERNET-FACING auth tier — external
// clients, investors and auditors — and it was the least protected: no limiter
// on any of the three public routes, and (SEC-H6) an 8-character password
// policy with no complexity or breach check behind them. The password policy is
// a separate fix; this closes the unlimited-guessing half.
const {
  loginLimiter, forgotLimiter, resetLimiter, refreshLimiter, makeLimiter,
  webauthnLimiter, webauthnOptionsLimiter,
} = require("../../shared/http/rate-limit");

// Emailed sign-in codes (14150). Its own bucket rather than `forgot`'s: both are
// mail-sending endpoints a stranger can hit, and sharing one budget would let a
// flood of code requests lock out a real password reset from the same office.
const codeLimiter = makeLimiter({ name: "portal-code", max: 8 });

const router = express.Router();

// Public. `forgot` always answers 200 (no account enumeration); `accept` consumes
// a one-time token from an invite or reset mail and returns a live portal token.
router.post("/auth/login", loginLimiter, v.login, c.login);
router.post("/auth/forgot", forgotLimiter, v.forgot, c.forgot);
// `accept` is a token-guessing surface, same shape as staff reset-password.
router.post("/auth/accept", resetLimiter, v.accept, c.accept);
// Trusted-device sessions ("keep me signed in", 14150). Refresh and logout take
// the refresh token in the body — possession of it IS the credential.
router.post("/auth/refresh", refreshLimiter, v.refresh, c.refresh);
router.post("/auth/logout", v.logout, c.logout);
// Sign in with a six-digit code by email instead of a password. `code` always
// answers 200, exactly like `forgot`.
router.post("/auth/code", codeLimiter, v.codeRequest, c.requestCode);
router.post("/auth/code/verify", loginLimiter, v.codeVerify, c.verifyCode);
// Face ID / fingerprint. Options are public and read nothing; verify is the
// sign-in. Registration needs a signed-in portal user with a FRESH token.
router.post("/auth/passkey/login/options", webauthnOptionsLimiter, v.passkeyLoginOptions, c.passkeyLoginOptions);
router.post("/auth/passkey/login/verify", webauthnLimiter, v.passkeyLoginVerify, c.passkeyLoginVerify);
router.post("/auth/passkey/register/options", portalAuth(), c.passkeyRegisterOptions);
router.post("/auth/passkey/register/verify", webauthnLimiter, portalAuth(), v.passkeyRegisterVerify, c.passkeyRegisterVerify);
router.get("/auth/passkeys", portalAuth(), c.passkeys);
router.delete("/auth/passkeys/:id", portalAuth(), c.deletePasskey);
router.get("/auth/sessions", portalAuth(), c.sessions);
router.post("/auth/sessions/:id/revoke", portalAuth(), c.revokeSession);

// Portal user (external, token-scoped)
router.get("/me", portalAuth(), c.me);
router.get("/client", portalAuth("CLIENT"), c.client);
/*
 * The client team's access scope (14150) is checked per AREA: OPS routes carry
 * shipments and paperwork, BILL routes carry money. A colleague given only one
 * of the two gets a 403 on the other, and the home summary below is assembled
 * per scope instead of being refused, so nobody opens the portal to an error.
 */
const OPS = portalScope("OPERATIONS");
const BILL = portalScope("BILLING");
router.get("/client/dossier/:dossierId", portalAuth("CLIENT"), OPS, c.clientChain);
// The invoice as the printed copy groups it, plus what is left to pay and the
// account to pay it into (14150) — a superset of what this route returned.
router.get("/client/invoice/:invoiceId", portalAuth("CLIENT"), BILL, pc.invoice);
router.get("/client/invoice/:invoiceId/pdf", portalAuth("CLIENT"), BILL, pc.invoicePdf);
router.get("/client/home", portalAuth("CLIENT"), pc.home);
router.get("/client/shipments", portalAuth("CLIENT"), OPS, pc.shipments);
router.get("/client/shipments/:id", portalAuth("CLIENT"), OPS, pc.shipment);
// What we are waiting for from the client — documents and answers. Uploads
// are MULTIPART (`singleFile` before the validator: multer fills req.body).
router.get("/client/requests", portalAuth("CLIENT"), OPS, pc.requests);
router.get("/client/document-types", portalAuth("CLIENT"), OPS, pc.documentTypes);
router.post("/client/requests/:id/upload", portalAuth("CLIENT"), OPS, singleFile("file"), v.requestUpload, pc.uploadForRequest);
router.post("/client/requests/:id/answer", portalAuth("CLIENT"), OPS, v.requestAnswer, pc.answerRequest);
router.get("/client/requests/:id/file", portalAuth("CLIENT"), OPS, pc.requestFile);
router.post("/client/documents", portalAuth("CLIENT"), OPS, singleFile("file"), v.shareDocument, pc.shareDocument);
// Billing and "I have paid".
router.get("/client/billing", portalAuth("CLIENT"), BILL, pc.billing);
router.post("/client/payment-proofs", portalAuth("CLIENT"), BILL, singleFile("file"), v.paymentProof, pc.submitProof);
router.get("/client/payment-proofs/:id/file", portalAuth("CLIENT"), BILL, pc.proofFile);
// The client's own team: anyone on it may see it, only its admins change it.
router.get("/client/team", portalAuth("CLIENT"), pc.team);
router.post("/client/team", portalAuth("CLIENT"), portalClientAdmin, v.teamInvite, pc.teamInvite);
router.post("/client/team/:id", portalAuth("CLIENT"), portalClientAdmin, v.teamUpdate, pc.teamUpdate);
router.post("/client/team/:id/remove", portalAuth("CLIENT"), portalClientAdmin, v.empty, pc.teamRemove);
// Document vault — the client's own client-visible documents (PRD §11.1).
// The list is scoped to their dossiers + client filings; the download re-checks
// ownership + visibility in SQL before streaming bytes. Handlers live on the
// portal module controller (they need the grant-scoped clientId helper).
router.get("/client/documents", portalAuth("CLIENT"), OPS, controller.clientDocuments);
router.get("/client/documents/:id/download", portalAuth("CLIENT"), OPS, controller.clientDocumentDownload);
// Q tickets — the client raises a query against a milestone and it stays in
// the system, which is the whole reason this exists rather than an email.
router.get("/client/tickets", portalAuth("CLIENT"), OPS, c.tickets);
router.get("/client/tickets/:id", portalAuth("CLIENT"), OPS, c.ticket);
router.post("/client/tickets", portalAuth("CLIENT"), OPS, v.raiseTicket, c.raiseTicket);
router.post("/client/tickets/:id/replies", portalAuth("CLIENT"), OPS, v.replyTicket, c.replyTicket);
router.get("/investor", portalAuth("INVESTOR"), c.investor);
router.get("/auditor", portalAuth("AUDITOR"), c.auditor);
// Auditor data room (PRD §5.2) — the auditor's requests and the documents
// staff answered with. Scoped to the grant identity, like every portal route.
const ctrl = require("../audit_room/audit_room.controller");
const validator = require("../audit_room/audit_room.validator");
router.get("/auditor/data-room", portalAuth("AUDITOR"), ctrl.list);
router.post("/auditor/data-room", portalAuth("AUDITOR"), validator.create, ctrl.create);
router.get("/auditor/data-room/:id", portalAuth("AUDITOR"), validator.id, ctrl.detail);
router.get("/auditor/data-room/:id/documents/:docId/download", portalAuth("AUDITOR"), validator.idDoc, ctrl.download);
// Client portal — onboarding command centre, secure messaging + certified
// PDF export, and self-service quoting (PRD §11.1). All scoped to the grant's
// client_id (controller `clientId(req)`); `export` is a static path so it is
// declared before any :id-shaped route would shadow it.
router.get("/client/onboarding", portalAuth("CLIENT"), controller.clientOnboarding);
router.get("/client/messages", portalAuth("CLIENT"), controller.clientMessages);
router.post("/client/messages", portalAuth("CLIENT"), v.message, controller.sendClientMessage);
router.get("/client/messages/export", portalAuth("CLIENT"), controller.exportClientChat);
router.get("/client/quote-requests", portalAuth("CLIENT"), controller.clientQuoteRequests);
router.post("/client/quote-requests", portalAuth("CLIENT"), v.portalQuote, controller.createClientQuote);
// Staff management — invite/manage external users. IAM & user access (MOD-67).
const M = "MOD-67";
router.get("/users", authMiddleware, requirePermission(M, "view"), c.listUsers);
router.post("/users", authMiddleware, requirePermission(M, "create"), v.create, c.createUser);
// Invite = create-or-find + email a set-password link. Takes no password: staff
// must never choose an external party's credentials. Doubles as "resend".
router.post("/users/invite", authMiddleware, requirePermission(M, "create"), v.invite, c.invite);
router.post("/users/:id/password", authMiddleware, requirePermission(M, "edit"), v.password, c.setPassword);
router.post("/users/:id/status", authMiddleware, requirePermission(M, "edit"), v.status, c.setStatus);

// Staff: manage the data room — list every request, attach vault documents,
// mark answered. Same gate (MOD-67) as the portal users/grants above.
router.get("/data-room", authMiddleware, requirePermission(M, "view"), ctrl.listStaff);
router.get("/data-room/:id", authMiddleware, requirePermission(M, "view"), validator.id, ctrl.detailStaff);
router.post("/data-room/:id/documents", authMiddleware, requirePermission(M, "edit"), validator.attach, ctrl.attach);
router.post("/data-room/:id/answer", authMiddleware, requirePermission(M, "edit"), validator.id, ctrl.answer);

// Staff: client portal support — the account team's side of the thread and the
// onboarding checklist. Same gate (MOD-67).
router.get("/messages", authMiddleware, requirePermission(M, "view"), controller.staffMessages);
router.post("/messages", authMiddleware, requirePermission(M, "edit"), v.staffMessage, controller.staffSendMessage);
router.get("/onboarding", authMiddleware, requirePermission(M, "view"), controller.staffOnboarding);
router.post("/onboarding/:clientId/:stepKey", authMiddleware, requirePermission(M, "edit"), validator.toggle, controller.staffToggleOnboarding);

// Staff: what we asked clients for, and what they sent (14150). Operations
// (MOD-29, the client-portal module) asks and reviews; finance (MOD-52,
// receivables) confirms or rejects a payment claim. Confirming drafts a
// receipt, so it needs the same `create` grant a receipt does.
const PORTAL_CLIENT = requireFeature("portal.client");
router.get("/client-requests", authMiddleware, PORTAL_CLIENT, requirePermission("MOD-29", "view"), pc.staffRequests);
// What staff may ask for — the same registry the client picks from.
router.get("/client-requests/document-types", authMiddleware, PORTAL_CLIENT, requirePermission("MOD-29", "view"), pc.documentTypes);
router.post("/client-requests", authMiddleware, PORTAL_CLIENT, requirePermission("MOD-29", "edit"), v.staffCreateRequest, pc.staffCreateRequest);
router.post("/client-requests/:id/review", authMiddleware, PORTAL_CLIENT, requirePermission("MOD-29", "edit"), v.staffReviewRequest, pc.staffReviewRequest);
router.get("/client-requests/:id/file", authMiddleware, PORTAL_CLIENT, requirePermission("MOD-29", "view"), pc.staffRequestFile);
router.get("/payment-proofs", authMiddleware, PORTAL_CLIENT, requirePermission("MOD-52", "view"), pc.staffProofs);
router.post("/payment-proofs/:id/confirm", authMiddleware, PORTAL_CLIENT, requirePermission("MOD-52", "create"), v.staffConfirmProof, pc.staffConfirmProof);
router.post("/payment-proofs/:id/reject", authMiddleware, PORTAL_CLIENT, requirePermission("MOD-52", "edit"), v.staffRejectProof, pc.staffRejectProof);
router.get("/payment-proofs/:id/file", authMiddleware, PORTAL_CLIENT, requirePermission("MOD-52", "view"), pc.staffProofFile);

module.exports = { basePath: "/portal", feature: null, router };
