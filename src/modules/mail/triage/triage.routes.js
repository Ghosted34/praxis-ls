"use strict";
const express = require("express");
const { authMiddleware } = require("../../../middleware/auth");
const { requirePermission, requireCeo } = require("../../../middleware/rbac");
const { requireFeature } = require("../../../middleware/feature-gate");
const { asyncHandler, AppError } = require("../../../utils/errors");
const { z } = require("zod");
const { common } = require("@praxis/shared");
const { body } = require("../../../shared/http/validate");
const { audit } = require("../../../shared/events/emit");
const vis = require("./visibility");
const archive = require("./archive-chain");
const secureLinks = require("./secure-link.service");
const workflow = require("./workflow.service");
const threadRepo = require("../mail/thread.repo");
// C-1/C-4. The four writes below (claim/assign/status/visibility) already did
// their own `getThread` gate — the FN-2 lesson, applied to four of eleven
// thread-scoped routes in this file. This is the same check, hoisted so the
// other seven cannot be forgotten, and so a route added tomorrow is caught by
// `tests/security/mail-route-visibility.test.js` rather than by an audit.
const { requireVisibleThread } = require("../mail/visible");

const M = "MOD-72";
const router = express.Router();
router.use(authMiddleware);
const actor = (req) => req.user || { user_id: null };

router.post("/threads/:id/claim", requireFeature("mail.shared_inbox"), requirePermission(M, "edit"), requireVisibleThread(),
  body(z.object({}).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb(async (c) => {
      // Claiming reads the thread back, so it is a READ in the §9.5 sense and
      // must be visibility-gated like every other read — otherwise a Private
      // thread's subject and participants leak through `RETURNING *`. A thread
      // the caller cannot see answers NOT_FOUND, identical to one that does
      // not exist, because the endpoint must not be an oracle for either.
      if (!(await threadRepo.getThread(c, actor(req).user_id, req.params.id))) {
        throw new AppError("NOT_FOUND", "conversation not found", 404);
      }
      // The race-safe half: ONE conditional statement, so two claimants cannot
      // both win. The visibility predicate rides along in case the thread was
      // made PRIVATE between the gate read and this write.
      const { rows } = await c.query(
        `UPDATE email_thread t SET assigned_user_id=$2, assigned_at=now()
           FROM email_connection c
          WHERE t.email_thread_id=$1 AND t.email_connection_id=c.email_connection_id
            AND assigned_user_id IS NULL
            AND (${vis.clause("$2")})
          RETURNING t.*, t.participants::text[] AS participants`,
        [req.params.id, actor(req).user_id],
      );
      if (!rows[0]) throw new AppError("ALREADY_CLAIMED", "Someone else already claimed this thread.", 409);
      return rows[0];
    }),
  })));

router.post("/threads/:id/assign", requireFeature("mail.shared_inbox"), requirePermission(M, "edit"), requireVisibleThread(),
  body(z.object({ user_id: z.string().uuid() }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb(async (c) => {
      if (!(await threadRepo.getThread(c, actor(req).user_id, req.params.id))) {
        throw new AppError("NOT_FOUND", "conversation not found", 404);
      }
      const { rows } = await c.query(
        `UPDATE email_thread t SET assigned_user_id=$2, assigned_at=now()
           FROM email_connection c
          WHERE t.email_thread_id=$1 AND t.email_connection_id=c.email_connection_id
            AND (${vis.clause("$3")})
          RETURNING t.*, t.participants::text[] AS participants`,
        [req.params.id, req.body.user_id, actor(req).user_id],
      );
      return rows[0];
    }),
  })));

router.post("/threads/:id/status", requireFeature("mail.shared_inbox"), requirePermission(M, "edit"), requireVisibleThread(),
  body(z.object({ status: z.enum(["OPEN", "PENDING", "RESOLVED"]) }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb(async (c) => {
      if (!(await threadRepo.getThread(c, actor(req).user_id, req.params.id))) {
        throw new AppError("NOT_FOUND", "conversation not found", 404);
      }
      const { rows } = await c.query(
        `UPDATE email_thread t SET work_status=$2,
                resolved_at = CASE WHEN $2='RESOLVED' THEN now() ELSE resolved_at END
           FROM email_connection c
          WHERE t.email_thread_id=$1 AND t.email_connection_id=c.email_connection_id
            AND (${vis.clause("$3")})
          RETURNING t.*, t.participants::text[] AS participants`,
        [req.params.id, req.body.status, actor(req).user_id],
      );
      return rows[0];
    }),
  })));

router.post("/threads/:id/snooze", requireFeature("mail.followup"), requirePermission(M, "edit"), requireVisibleThread(),
  body(z.object({ due_at: z.string(), note: z.string().max(500).optional() }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => c.query(
      `INSERT INTO email_followup (email_thread_id, user_id, kind, due_at, note)
       VALUES ($1,$2,'SNOOZE',$3,$4) RETURNING *`,
      [req.params.id, actor(req).user_id, req.body.due_at, req.body.note || null],
    ).then((r) => r.rows[0])),
  })));

router.post("/threads/:id/followup", requireFeature("mail.followup"), requirePermission(M, "edit"), requireVisibleThread(),
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
    // H-5. `GENERATED_PDF` was accepted here and had no renderer behind it:
    // `fetchTarget` returned a stub with no buffer, so the public download
    // answered 404 "This link has expired or been revoked" — a false statement
    // about a link that was perfectly valid — while still recording a view and
    // incrementing view_count. An admin could hand a client a permanently
    // broken link whose error message pointed at the wrong cause.
    //
    // Refused at MINT rather than at download, because that is where the
    // operator is standing and where a 422 can say something useful. Restore
    // the kind here on the day a renderer exists, not before.
    target_kind: z.enum(["VAULT_DOC"]),
    target_ref: z.string().min(1).max(200),
    entity_ref: z.string().max(128).optional(),
    label: z.string().max(200).optional(),
    days: z.coerce.number().int().min(1).max(90).optional(),
  }).strict()),
  asyncHandler(async (req, res) => res.status(201).json({
    // The token is returned exactly once and is never recoverable — only its
    // SHA-256 is stored. "Resend the link" mints a new one.
    data: await req.identityDb((c) => secureLinks.mint(c, {
      targetKind: req.body.target_kind,
      targetRef: req.body.target_ref,
      entityRef: req.body.entity_ref || null,
      label: req.body.label || null,
      days: req.body.days || 7,
    }, actor(req))),
  })));

router.post("/secure-links/:id/revoke", requireFeature("mail.secure_links"), requirePermission(M, "edit"),
  body(z.object({}).strict()),
  asyncHandler(async (req, res) => {
    const row = await req.identityDb((c) => secureLinks.revoke(c, req.params.id));
    if (!row) throw new AppError("NOT_FOUND", "link not found, or already revoked", 404);
    return res.json({ data: row });
  }));

/* ── Soft locks (§9.2) ─────────────────────────────────────────────────────
 *
 * POST is both "take" and "heartbeat" — one call for the client to poll every
 * 30s while typing. It never fails when a colleague holds the lock; it returns
 * theirs, and the composer says who and for how long. §9.2: advisory, never a
 * hard block, because a stale lock that stops a customer reply going out is
 * worse than a duplicated one. */
router.post("/threads/:id/lock", requireFeature("mail.shared_inbox"), requirePermission(M, "edit"), requireVisibleThread(),
  body(z.object({}).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => workflow.takeLock(c, req.params.id, actor(req))),
  })));

router.delete("/threads/:id/lock", requireFeature("mail.shared_inbox"), requirePermission(M, "edit"), requireVisibleThread(),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => workflow.releaseLock(c, req.params.id, actor(req))),
  })));

/* ── SLA policy and the business calendar (§9.2) ───────────────────────────
 *
 * Editing either clears the computed due dates so the next sweep re-applies
 * them to the threads already in the queue — see workflow.service. */
router.get("/sla-policies", requireFeature("mail.shared_inbox"), requirePermission(M, "view"),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => workflow.listPolicies(c)) })));

router.post("/sla-policies", requireFeature("mail.shared_inbox"), requirePermission(M, "edit"),
  body(z.object({
    name: z.string().trim().min(1).max(120),
    email_connection_id: z.string().uuid().nullish(),
    applies_to_vip: z.boolean().optional(),
    first_response_minutes: z.coerce.number().int().min(1).max(100000),
    resolution_minutes: z.coerce.number().int().min(1).max(1000000),
    business_hours_only: z.boolean().optional(),
    is_active: z.boolean().optional(),
  }).strict()),
  asyncHandler(async (req, res) => res.status(201).json({
    data: await req.identityDb((c) => workflow.createPolicy(c, req.body, actor(req))),
  })));

router.patch("/sla-policies/:id", requireFeature("mail.shared_inbox"), requirePermission(M, "edit"),
  body(z.object({
    name: z.string().trim().min(1).max(120).optional(),
    email_connection_id: z.string().uuid().nullish(),
    applies_to_vip: z.boolean().optional(),
    first_response_minutes: z.coerce.number().int().min(1).max(100000).optional(),
    resolution_minutes: z.coerce.number().int().min(1).max(1000000).optional(),
    business_hours_only: z.boolean().optional(),
    is_active: z.boolean().optional(),
  }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => workflow.updatePolicy(c, req.params.id, req.body, actor(req))),
  })));

router.get("/business-hours", requireFeature("mail.shared_inbox"), requirePermission(M, "view"),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => workflow.getCalendar(c)) })));

router.put("/business-hours", requireFeature("mail.shared_inbox"), requirePermission(M, "edit"),
  body(z.object({
    hours: z.array(z.object({
      day_of_week: z.coerce.number().int().min(0).max(6),
      opens_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
      closes_at: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
      timezone: common.ianaTimezone.optional(),
    }).strict()).max(7),
  }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => workflow.putBusinessHours(c, req.body.hours, actor(req))),
  })));

router.put("/holidays", requireFeature("mail.shared_inbox"), requirePermission(M, "edit"),
  body(z.object({
    holidays: z.array(z.object({
      holiday_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      name: z.string().max(120).optional(),
    }).strict()).max(200),
  }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => workflow.putHolidays(c, req.body.holidays, actor(req))),
  })));

/* ── Follow-ups (§9.3) ─────────────────────────────────────────────────────
 *
 * Both scoped to the caller. A snooze is a promise the product made to ONE
 * person; a colleague cancelling it means the thread never returns for someone
 * still expecting it. */
router.get("/followups", requireFeature("mail.followup"), requirePermission(M, "view"),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => workflow.listFollowups(c, actor(req))) })));

router.delete("/followup/:id", requireFeature("mail.followup"), requirePermission(M, "edit"),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => workflow.cancelFollowup(c, req.params.id, actor(req))),
  })));

/* ── Thread sharing (§9.5) ─────────────────────────────────────────────────
 *
 * The escape valve that makes PRIVATE usable. Without it the only way to bring
 * a colleague in is to widen the thread to TEAM, and a visibility model whose
 * only granularity is "me" or "everyone" gets set to everyone. */
/* ── Per-thread sharing (§9.5) — C-1 ───────────────────────────────────────
 *
 * This was the programme's most serious defect, and it was three lines long.
 *
 * `email_thread_share` is a READ GRANT: the §9.5 predicate treats a share row
 * as sight of a PRIVATE thread. `shareThread` inserted one for any thread id
 * and any user id, with no check that the caller could see the thread and no
 * check that they had any standing to hand it out. So any MOD-72 *edit* user
 * could POST `{user_id: <themselves>}` against any thread id in the tenant and
 * read a Private conversation on the next GET. Break-glass exists for exactly
 * that access, is CEO-only, and writes an immutable-ledger row BEFORE it reads;
 * `shareThread` was its unledgered twin, available to every operator.
 *
 * Both halves are now gated:
 *   - `requireVisibleThread()` — you cannot share, unshare or enumerate the
 *     shares of a thread you cannot yourself see. That alone closes the
 *     self-grant, because an invisible thread 404s before the INSERT.
 *   - the service additionally requires the caller be the thread's OWNER or a
 *     current sharee, so a TEAM member cannot widen a colleague's PRIVATE
 *     thread to someone the owner never chose.
 */
router.get("/threads/:id/shares", requireFeature("mail.archive"), requirePermission(M, "view"), requireVisibleThread(),
  asyncHandler(async (req, res) => res.json({ data: await req.identityDb((c) => workflow.listShares(c, req.params.id, actor(req))) })));

router.post("/threads/:id/share", requireFeature("mail.archive"), requirePermission(M, "edit"), requireVisibleThread(),
  body(z.object({ user_id: z.string().uuid() }).strict()),
  asyncHandler(async (req, res) => res.status(201).json({
    data: await req.identityDb((c) => workflow.shareThread(c, req.params.id, req.body.user_id, actor(req))),
  })));

router.delete("/threads/:id/share/:userId", requireFeature("mail.archive"), requirePermission(M, "edit"), requireVisibleThread(),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => workflow.unshareThread(c, req.params.id, req.params.userId, actor(req))),
  })));

/* ── Verified domains (§9.7) ───────────────────────────────────────────────
 *
 * POST can only ever write ADMIN_VERIFIED. OBSERVED accrues from correspondence
 * and confers nothing; an API able to set it would let the ingest path launder
 * itself into trust. */
router.get("/verified-domains", requireFeature("mail.antispoof"), requirePermission(M, "view"),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => workflow.listVerifiedDomains(c, {
      partyKind: req.query.party_kind ? String(req.query.party_kind).toUpperCase() : null,
      partyId: req.query.party_id || null,
    })),
  })));

router.post("/verified-domains", requireFeature("mail.antispoof"), requirePermission(M, "edit"),
  body(z.object({
    party_kind: z.enum(["CLIENT", "SUPPLIER", "client", "supplier"]),
    party_id: z.string().uuid(),
    domain: z.string().trim().min(3).max(253),
  }).strict()),
  asyncHandler(async (req, res) => res.status(201).json({
    data: await req.identityDb((c) => workflow.verifyDomain(c, {
      partyKind: req.body.party_kind, partyId: req.body.party_id, domain: req.body.domain,
    }, actor(req))),
  })));

router.delete("/verified-domains/:id", requireFeature("mail.antispoof"), requirePermission(M, "edit"),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => workflow.unverifyDomain(c, req.params.id, actor(req))),
  })));

/* ── Bounces (§9.8) ────────────────────────────────────────────────────────
 *
 * `/bounces/check` is what the composer calls before a send, so "we emailed the
 * invoice three times" ends at the first attempt rather than the fourth. */
router.get("/bounces", requireFeature("mail.core"), requirePermission(M, "view"),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => workflow.listBounces(c, {
      limit: req.query.limit, recipient: req.query.recipient || null,
      type: req.query.type ? String(req.query.type).toUpperCase() : null,
    })),
  })));

router.post("/bounces/check", requireFeature("mail.composer"), requirePermission(M, "view"),
  body(z.object({ addresses: z.array(z.string().max(320)).max(100) }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => workflow.addressStatus(c, req.body.addresses)),
  })));

/* ── Secure links (§9.4) ───────────────────────────────────────────────────── */
router.get("/secure-links", requireFeature("mail.secure_links"), requirePermission(M, "view"),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => secureLinks.list(c, {
      entityRef: req.query.entity_ref || null,
      includeExpired: req.query.include_expired === "true",
    })),
  })));

router.get("/secure-links/:id/views", requireFeature("mail.secure_links"), requirePermission(M, "view"),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb((c) => secureLinks.views(c, req.params.id)),
  })));

router.patch("/threads/:id/visibility", requireFeature("mail.archive"), requirePermission(M, "edit"), requireVisibleThread(),
  body(z.object({ visibility: z.enum(["PRIVATE", "TEAM", "COMPANY"]) }).strict()),
  asyncHandler(async (req, res) => res.json({
    data: await req.identityDb(async (c) => {
      // Changing visibility also RETURNS the thread, and widening a PRIVATE
      // thread you could not see to TEAM would be the shortest route into it —
      // so the caller must already be able to read it.
      if (!(await threadRepo.getThread(c, actor(req).user_id, req.params.id))) {
        throw new AppError("NOT_FOUND", "conversation not found", 404);
      }
      const { rows } = await c.query(
        `UPDATE email_thread t SET visibility=$2
           FROM email_connection c
          WHERE t.email_thread_id=$1 AND t.email_connection_id=c.email_connection_id
            AND (${vis.clause("$3")})
          RETURNING t.*, t.participants::text[] AS participants`,
        [req.params.id, req.body.visibility, actor(req).user_id],
      );
      return rows[0];
    }),
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
