"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission, requireCeo } = require("../../../middleware/rbac");
const { requireFeature } = require("../../../middleware/feature-gate");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { z } = require("zod");
const { body } = require("../../../shared/http/validate");
const { audit } = require("../../../shared/events/emit");
const vis = require("./visibility");
const archive = require("./archive-chain");
const secure = require("./secure-link");
const threadRepo = require("../mail/thread.repo");

const M = "MOD-72";
const router = express.Router();
router.use(authMiddleware);
const actor = (req) => req.user || { user_id: null };

router.post("/threads/:id/claim", requireFeature("mail.shared_inbox"), requirePermission(M, "edit"),
  body(z.object({}).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb(async (c) => {
      const { rows } = await c.query(
        `UPDATE email_thread SET assigned_user_id=$2, assigned_at=now()
          WHERE email_thread_id=$1 AND assigned_user_id IS NULL
          RETURNING *, participants::text[] AS participants`,
        [req.params.id, actor(req).user_id],
      );
      if (!rows[0]) throw new AppError("ALREADY_CLAIMED", "Someone else already claimed this thread.", 409);
      return rows[0];
    }),
  })));

router.post("/threads/:id/assign", requireFeature("mail.shared_inbox"), requirePermission(M, "edit"),
  body(z.object({ user_id: z.string().uuid() }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => c.query(
      `UPDATE email_thread SET assigned_user_id=$2, assigned_at=now()
        WHERE email_thread_id=$1
        RETURNING *, participants::text[] AS participants`,
      [req.params.id, req.body.user_id],
    ).then((r) => r.rows[0])),
  })));

router.post("/threads/:id/status", requireFeature("mail.shared_inbox"), requirePermission(M, "edit"),
  body(z.object({ status: z.enum(["OPEN", "PENDING", "RESOLVED"]) }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => c.query(
      `UPDATE email_thread SET work_status=$2,
              resolved_at = CASE WHEN $2='RESOLVED' THEN now() ELSE resolved_at END
        WHERE email_thread_id=$1
        RETURNING *, participants::text[] AS participants`,
      [req.params.id, req.body.status],
    ).then((r) => r.rows[0])),
  })));

router.post("/threads/:id/snooze", requireFeature("mail.followup"), requirePermission(M, "edit"),
  body(z.object({ due_at: z.string(), note: z.string().max(500).optional() }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => c.query(
      `INSERT INTO email_followup (email_thread_id, user_id, kind, due_at, note)
       VALUES ($1,$2,'SNOOZE',$3,$4) RETURNING *`,
      [req.params.id, actor(req).user_id, req.body.due_at, req.body.note || null],
    ).then((r) => r.rows[0])),
  })));

router.post("/threads/:id/followup", requireFeature("mail.followup"), requirePermission(M, "edit"),
  body(z.object({ due_at: z.string(), kind: z.enum(["NO_REPLY", "SEQUENCE_STEP"]).default("NO_REPLY"), note: z.string().max(500).optional() }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => c.query(
      `INSERT INTO email_followup (email_thread_id, user_id, kind, due_at, note, cancel_on_reply)
       VALUES ($1,$2,$3,$4,$5, true) RETURNING *`,
      [req.params.id, actor(req).user_id, req.body.kind, req.body.due_at, req.body.note || null],
    ).then((r) => r.rows[0])),
  })));

router.post("/secure-links", requireFeature("mail.secure_links"), requirePermission(M, "create"),
  body(z.object({
    target_kind: z.enum(["VAULT_DOC", "GENERATED_PDF"]),
    target_ref: z.string().min(1).max(200),
    entity_ref: z.string().max(128).optional(),
    label: z.string().max(200).optional(),
    days: z.coerce.number().int().min(1).max(90).optional(),
  }).strict()),
  asyncHandler(async (req, res) => {
    const token = secure.mintToken();
    const days = req.body.days || 7;
    const row = await req.identityDb((c) => c.query(
      `INSERT INTO secure_link (token_hash, target_kind, target_ref, entity_ref, label, created_by, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' days')::interval) RETURNING *`,
      [secure.hashToken(token), req.body.target_kind, req.body.target_ref, req.body.entity_ref || null, req.body.label || null, actor(req).user_id, days],
    ).then((r) => r.rows[0]));
    return res.status(201).json({ data: { ...row, token, path: `/public/secure/${token}` } });
  }));

router.post("/secure-links/:id/revoke", requireFeature("mail.secure_links"), requirePermission(M, "edit"),
  body(z.object({}).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => c.query(
      `UPDATE secure_link SET revoked_at=now() WHERE secure_link_id=$1 RETURNING *`,
      [req.params.id],
    ).then((r) => r.rows[0])),
  })));

router.patch("/threads/:id/visibility", requireFeature("mail.archive"), requirePermission(M, "edit"),
  body(z.object({ visibility: z.enum(["PRIVATE", "TEAM", "COMPANY"]) }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => c.query(
      `UPDATE email_thread SET visibility=$2 WHERE email_thread_id=$1
        RETURNING *, participants::text[] AS participants`,
      [req.params.id, req.body.visibility],
    ).then((r) => r.rows[0])),
  })));

/**
 * Break-glass (§9.5). God-Mode only — `requireCeo`, not a MOD-72 grant, because
 * the whole point is that no ordinary mail permission opens a Private thread.
 *
 * It RETURNS THE THREAD. The previous shape wrote the ledger row and answered
 * `{ ok: true }`, which reads as a working audit trail while granting nothing:
 * the caller still could not see the thread, so in practice the endpoint was
 * never used and the ledger stayed empty. Access and the ledger row are written
 * in the same transaction and in that order — the row lands BEFORE the body is
 * read, so a crash mid-request cannot produce an unlogged read.
 */
router.post("/threads/:id/breakglass", requireCeo(),
  body(z.object({ reason: z.string().trim().min(3).max(500) }).strict()),
  asyncHandler(async (req, res) => {
    const data = await req.identityDb(async (c) => {
      await audit(c, {
        actorUserId: actor(req).user_id, action: "mail.breakglass.read",
        moduleKey: M, entityRef: `email_thread:${req.params.id}`,
        after: { reason: req.body.reason }, isSensitive: true,
      });
      const thread = await threadRepo.getThreadUnrestricted(c, req.params.id);
      if (!thread) throw new AppError("NOT_FOUND", "conversation not found", 404);
      return { ...thread, breakglass: true, ledgered: true };
    });
    return res.json({ data });
  }));

/**
 * Verify the chain — and say honestly what was verified.
 *
 * `archive.verify([])` returns `{ ok: true }`, which is correct about the chain
 * and dangerously misleading as an answer to "is our archive sound?". For the
 * whole of the PR-2→PR-5 merge nothing wrote `email_archive`, so this endpoint
 * reported a green tick over an empty table to anyone who asked. `coverage` is
 * therefore part of the answer: a chain of 0 rows against 40 000 messages is a
 * failure of the archive, not a pass, and the response now says so in a shape
 * an auditor can read.
 */
router.get("/archive/verify", requireFeature("mail.archive"), requirePermission("MOD-70", "view"),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb(async (c) => {
      const { rows } = await c.query(`SELECT seq, content_hash, chain_hash, prev_hash FROM email_archive ORDER BY seq`);
      const chain = archive.verify(rows);
      const { rows: cov } = await c.query(
        `SELECT (SELECT count(*) FROM email_message)::int AS messages,
                (SELECT count(*) FROM email_archive)::int AS archived`,
      );
      const { messages, archived } = cov[0] || { messages: 0, archived: 0 };
      const complete = messages === archived;
      return {
        ...chain,
        coverage: { messages, archived, unarchived: messages - archived, complete },
        // One field a human can act on without reading the other five.
        verdict: !chain.ok ? "CHAIN_BROKEN" : complete ? "SOUND" : "INCOMPLETE",
      };
    }),
  })));

module.exports = { basePath: "/mail", feature: null, router, visibilityClause: vis.clause };
