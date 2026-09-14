"use strict";

/**
 * Support & Feedback conversation (0105) — the invariants that matter.
 *
 * What this proves, end to end, against an in-memory platform DB:
 *   · a tenant reply to a resolved ticket REOPENS it (the resolution was
 *     premature) — and an open ticket keeps its status;
 *   · attachments are two-stage: uploaded unlinked, linked by the create/
 *     reply call, and a link with the wrong count 422s rather than half-
 *     attaching;
 *   · uploads are image-only and size-capped, on both sides;
 *   · a tenant can never read another tenant's attachment — the read
 *     resolves through the ticket, and a miss is a 404, not a 403 (the same
 *     rule Q-tickets applies to dossiers: "not found" is the only answer);
 *   · the tenant's read strips internal replies at the SQL — the mock
 *     honours the clause the service wrote, so the test fails if the clause
 *     ever leaves the query;
 *   · a Praxis reply audits, and a PUBLIC reply notifies the raiser through
 *     the tenant's own pipeline while an INTERNAL one never reaches it —
 *     and a ticket with no raiser email notifies nobody without erroring.
 */

jest.mock("../../src/services/platform/db", () => {
  const tickets = new Map();
  const replies = new Map();
  const attachments = new Map();
  const tenants = new Map();
  const auditLog = [];
  let seq = 0;
  // UUID-SHAPED, NOT `t_1`. Every id column here is `uuid DEFAULT
  // gen_random_uuid()`, and the API validators reject anything that is not a
  // UUID — so an id this mock hands back has to survive `z.string().uuid()`
  // for a test to be able to send it through a real validated route. The
  // prefix letter is kept in the first block so a failure is still readable.
  const uid = (p) => {
    seq += 1;
    const tag = p.charCodeAt(0).toString(16).padStart(2, "0");
    return `000000${tag}-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  };

  const query = jest.fn(async (sql, params = []) => {
    /* ── platform.support_ticket ── */
    if (sql.startsWith("INSERT INTO platform.support_ticket (tenant_id")) {
      const [tenant_id, raised_by_email, kind, title, body, context] = params;
      const row = {
        ticket_id: uid("t"), tenant_id, raised_by_email, kind, title, body, context,
        status: "NEW", csat: null, created_at: "t0", updated_at: "t0",
      };
      tickets.set(row.ticket_id, row);
      return { rows: [row] };
    }
    if (sql.startsWith("SELECT * FROM platform.support_ticket WHERE tenant_id=$1 AND ticket_id=$2")) {
      return { rows: [tickets.get(params[1])].filter(Boolean) };
    }
    if (sql.startsWith("UPDATE platform.support_ticket SET status='NEW' WHERE ticket_id=$1")) {
      const t = tickets.get(params[0]);
      if (t) t.status = "NEW";
      return { rows: [t].filter(Boolean) };
    }
    if (sql.startsWith("UPDATE platform.support_ticket SET csat=$3 WHERE tenant_id=$1")) {
      const t = tickets.get(params[1]);
      if (!t || t.tenant_id !== params[0] || !["SHIPPED", "DECLINED"].includes(t.status)) {
        return { rows: [] };
      }
      t.csat = params[2];
      return { rows: [t] };
    }
    if (sql.startsWith("UPDATE platform.support_ticket SET status = $2 WHERE ticket_id=$1")) {
      const t = tickets.get(params[0]);
      if (t) t.status = params[1];
      return { rows: [t].filter(Boolean) };
    }
    if (sql.startsWith("SELECT st.*")) {
      // platform-side read (the tenant list carries a LATERAL join the
      // platform SELECT does not)
      const byId = sql.includes("WHERE st.ticket_id = $1");
      const all = [...tickets.values()].filter((t) =>
        byId ? t.ticket_id === params[0] : true,
      );
      return {
        rows: all.map((t) => ({
          ...t,
          tenant_slug: (tenants.get(t.tenant_id) || {}).slug || "slug",
          tenant_name: (tenants.get(t.tenant_id) || {}).display_name || "Tenant",
        })),
      };
    }

    /* ── platform.support_ticket_reply ── */
    if (sql.startsWith("INSERT INTO platform.support_ticket_reply (ticket_id, author_side, author_label, body, is_internal)")) {
      const [ticket_id, author_label, body, is_internal] = params;
      const row = {
        reply_id: uid("r"), ticket_id, author_side: "PRAXIS", author_label, body,
        is_internal: !!is_internal, created_at: "t1",
      };
      replies.set(row.reply_id, row);
      return { rows: [row] };
    }
    if (sql.startsWith("INSERT INTO platform.support_ticket_reply (ticket_id, author_side, author_label, body)")) {
      const [ticket_id, author_label, body] = params;
      const row = {
        reply_id: uid("r"), ticket_id, author_side: "TENANT", author_label, body,
        is_internal: false, created_at: "t1",
      };
      replies.set(row.reply_id, row);
      return { rows: [row] };
    }
    if (sql.startsWith("SELECT reply_id, author_side, author_label, body, is_internal, created_at")) {
      // TENANT read: the clause that keeps internal notes off the portal.
      const internal = sql.includes("is_internal = false");
      let rows = [...replies.values()].filter((r) => r.ticket_id === params[0]);
      if (internal) rows = rows.filter((r) => !r.is_internal);
      return { rows: rows.sort((a, b) => a.created_at.localeCompare(b.created_at)) };
    }
    if (sql.startsWith("SELECT reply_id, ticket_id, author_side")) {
      // platform read: everything, including internal.
      const rows = [...replies.values()].filter((r) => r.ticket_id === params[0]);
      return { rows: rows.sort((a, b) => a.created_at.localeCompare(b.created_at)) };
    }

    /* ── platform.support_attachment ── */
    if (sql.startsWith("UPDATE platform.support_attachment SET ticket_id=$1, reply_id=$2")) {
      const [, reply_id, ids, tenant_id] = params;
      const rows = [];
      for (const id of ids) {
        const a = attachments.get(id);
        if (a && a.tenant_id === tenant_id && !a.ticket_id && !a.reply_id) {
          a.ticket_id = params[0];
          a.reply_id = reply_id;
          rows.push(a);
        }
      }
      return { rows };
    }
    if (sql.startsWith("UPDATE platform.support_attachment SET reply_id=$2")) {
      const ids = params[2];
      const rows = [];
      for (const id of ids) {
        const a = attachments.get(id);
        if (a && a.ticket_id === params[0] && !a.reply_id) {
          a.reply_id = params[1];
          rows.push(a);
        }
      }
      return { rows };
    }
    if (sql.startsWith("INSERT INTO platform.support_attachment (tenant_id, storage_key")) {
      const [tenant_id, storage_key, file_name, mime_type, byte_size, created_by_email] = params;
      const row = {
        attachment_id: uid("a"), ticket_id: null, reply_id: null, tenant_id,
        storage_key, file_name, mime_type, byte_size, created_by_email, created_at: "t2",
      };
      attachments.set(row.attachment_id, row);
      return { rows: [row] };
    }
    if (sql.startsWith("INSERT INTO platform.support_attachment (ticket_id, tenant_id")) {
      const [ticket_id, tenant_id, storage_key, file_name, mime_type, byte_size, created_by_email] = params;
      const row = {
        attachment_id: uid("a"), ticket_id, reply_id: null, tenant_id,
        storage_key, file_name, mime_type, byte_size, created_by_email, created_at: "t2",
      };
      attachments.set(row.attachment_id, row);
      return { rows: [row] };
    }
    if (sql.startsWith("SELECT a.*")) {
      const a = attachments.get(params[0]);
      const t = a && a.ticket_id ? tickets.get(a.ticket_id) : null;
      return { rows: a ? [{ ...a, ticket_tenant: t ? t.tenant_id : null }] : [] };
    }
    if (sql.startsWith("SELECT attachment_id, ticket_id, reply_id, file_name")) {
      // Two shapes share this prefix: the tenant's scoped read
      // (tenant_id=$1 AND ticket_id=$2) and the platform's by-ticket read.
      const byTicket = sql.includes("WHERE tenant_id=$1 AND ticket_id=$2")
        ? [...attachments.values()].filter((a) => a.tenant_id === params[0] && a.ticket_id === params[1])
        : [...attachments.values()].filter((a) => a.ticket_id === params[0]);
      return { rows: byTicket };
    }
    if (sql.startsWith("SELECT * FROM platform.support_attachment WHERE attachment_id=$1")) {
      const a = attachments.get(params[0]);
      return { rows: a ? [a] : [] };
    }

    /* ── platform.tenant / audit ── */
    if (sql.startsWith("SELECT tenant_id, slug FROM platform.tenant WHERE tenant_id = $1")) {
      const t = tenants.get(params[0]);
      return { rows: t ? [{ tenant_id: t.tenant_id, slug: t.slug }] : [] };
    }
    if (sql.startsWith("INSERT INTO platform.platform_audit")) {
      auditLog.push(params);
      return { rows: [] };
    }

    return { rows: [] };
  });

  return {
    query,
    __tickets: tickets,
    __replies: replies,
    __attachments: attachments,
    __tenants: tenants,
    __audit: auditLog,
  };
});

jest.mock("../../src/services/storage.service", () => {
  const store = new Map();
  return {
    put: jest.fn(async (buffer, { key, contentType }) => {
      store.set(key, { buffer, contentType });
      return { key, size: buffer.length, content_type: contentType };
    }),
    get: jest.fn(async (key) => {
      const hit = store.get(key);
      if (!hit) throw new Error(`no such object: ${key}`);
      return hit.buffer;
    }),
    __store: store,
  };
});

jest.mock("../../src/services/platform/entitlement.service", () => ({
  statusFor: jest.fn(async () => []),
}));
jest.mock("../../src/services/tenant/registry.service", () => ({
  resolveBySlug: jest.fn(async () => null),
  withTenantConnection: jest.fn(async (_meta, _env, fn) => fn({
    query: jest.fn(async () => ({ rows: [] })),
  })),
}));
jest.mock("../../src/modules/notification/notification.service", () => ({
  notify: jest.fn(async () => ({ notification_id: "n1" })),
}));

const db = require("../../src/services/platform/db");
const storage = require("../../src/services/storage.service");
const registry = require("../../src/services/tenant/registry.service");
const notifications = require("../../src/modules/notification/notification.service");
const tenantSvc = require("../../src/modules/dashboard/support/support.service");
const platformSvc = require("../../src/services/platform/support.service");
// The WIRE seam: the real Zod validators and the real controllers, so a test
// exercises the same key spellings an HTTP request does. Every other test in
// this file calls the services directly, which is exactly why the
// validator→service key mismatch below survived a green suite.
const tenantValidator = require("../../src/modules/dashboard/support/support.validator");
const tenantCtrl = require("../../src/modules/dashboard/support/support.controller");
const platformValidator = require("../../src/modules/platform/platform.validator");
const platformCtrl = require("../../src/modules/platform/platform.controller");

const TENANT_A = "tenant_a";
const TENANT_B = "tenant_b";

function seedTenant() {
  db.__tenants.set(TENANT_A, { tenant_id: TENANT_A, slug: "alpha", display_name: "Alpha" });
  db.__tenants.set(TENANT_B, { tenant_id: TENANT_B, slug: "beta", display_name: "Beta" });
}

function seedTicket({ status = "NEW", email = "ops@alpha.com", tenant = TENANT_A } = {}) {
  const row = {
    ticket_id: `t_seed_${db.__tickets.size}`, tenant_id: tenant, raised_by_email: email,
    kind: "BUG", title: "Export fails", body: "It breaks", context: {},
    status, csat: null, created_at: "t0", updated_at: "t0",
  };
  db.__tickets.set(row.ticket_id, row);
  return row;
}

const IMG = { buffer: Buffer.from("img-bytes"), mimetype: "image/png", originalname: "shot.png" };

beforeEach(() => {
  db.__tickets.clear();
  db.__replies.clear();
  db.__attachments.clear();
  db.__audit.length = 0;
  storage.__store.clear();
  seedTenant();
  registry.resolveBySlug.mockClear();
  registry.withTenantConnection.mockClear();
  notifications.notify.mockClear();
});

describe("tenant side — replies reopen, attachments link", () => {
  test("a reply to a SHIPPED ticket reopens it at NEW", async () => {
    const t = seedTicket({ status: "SHIPPED" });
    const out = await tenantSvc.reply(TENANT_A, "ops@alpha.com", t.ticket_id, { body: "It broke again" });
    expect(out.status).toBe("NEW");
    expect(db.__tickets.get(t.ticket_id).status).toBe("NEW");
    const reply = [...db.__replies.values()][0];
    expect(reply).toMatchObject({ author_side: "TENANT", author_label: "ops@alpha.com", is_internal: false });
  });

  test("a reply to an open ticket leaves the status alone", async () => {
    const t = seedTicket({ status: "IN_PROGRESS" });
    const out = await tenantSvc.reply(TENANT_A, "ops@alpha.com", t.ticket_id, { body: "still broken" });
    expect(out.status).toBe("IN_PROGRESS");
  });

  test("create links its screenshots; a mismatched id 422s", async () => {
    const up = await tenantSvc.upload(TENANT_A, "ops@alpha.com", IMG);
    const ticket = await tenantSvc.create(TENANT_A, "ops@alpha.com", {
      kind: "BUG", title: "Broken", body: "x", context: {},
      attachmentIds: [up.attachment_id],
    });
    const linked = db.__attachments.get(up.attachment_id);
    expect(linked.ticket_id).toBe(ticket.ticket_id);

    const other = await tenantSvc.upload(TENANT_A, "ops@alpha.com", IMG);
    await expect(
      tenantSvc.create(TENANT_A, "ops@alpha.com", {
        kind: "BUG", title: "Broken again", body: "", context: {},
        attachmentIds: [other.attachment_id, "does-not-exist"],
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  test("a tenant's get() never sees internal replies — the clause does the work", async () => {
    const t = seedTicket();
    // Plant one public and one internal reply straight into the store.
    db.__replies.set("r_pub", {
      reply_id: "r_pub", ticket_id: t.ticket_id, author_side: "PRAXIS",
      author_label: "Praxis", body: "fixed", is_internal: false, created_at: "t1",
    });
    db.__replies.set("r_int", {
      reply_id: "r_int", ticket_id: t.ticket_id, author_side: "PRAXIS",
      author_label: "Praxis", body: "broker says red channel", is_internal: true, created_at: "t2",
    });
    const detail = await tenantSvc.get(TENANT_A, t.ticket_id);
    expect(detail.replies.map((r) => r.reply_id)).toEqual(["r_pub"]);
  });

  test("uploads are image-only and capped at 10 MB", async () => {
    await expect(
      tenantSvc.upload(TENANT_A, "ops@alpha.com", { ...IMG, mimetype: "application/pdf" }),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      tenantSvc.upload(TENANT_A, "ops@alpha.com", {
        ...IMG,
        buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
      }),
    ).rejects.toMatchObject({ status: 413 });
    const ok = await tenantSvc.upload(TENANT_A, "ops@alpha.com", IMG);
    expect(ok.mime_type).toBe("image/png");
    expect(storage.put).toHaveBeenCalled();
  });

  test("one tenant cannot read another tenant's attachment", async () => {
    const t = seedTicket({ tenant: TENANT_A });
    const up = await tenantSvc.upload(TENANT_A, "ops@alpha.com", IMG);
    await tenantSvc.create(TENANT_A, "ops@alpha.com", {
      kind: "BUG", title: "Broken", body: "", context: {}, attachmentIds: [up.attachment_id],
    });
    void t;
    await expect(tenantSvc.attachmentBytes(TENANT_B, "user@beta.com", up.attachment_id))
      .rejects.toMatchObject({ status: 404 });
    const mine = await tenantSvc.attachmentBytes(TENANT_A, "ops@alpha.com", up.attachment_id);
    expect(mine.mime).toBe("image/png");
  });
});

describe("platform side — the answer, the note, the notification", () => {
  test("a public reply audits and notifies the raiser through the tenant pipeline", async () => {
    const t = seedTicket({ email: "ops@alpha.com" });
    registry.resolveBySlug.mockResolvedValue({ tenant_id: TENANT_A, slug: "alpha" });
    // The tenant user exists and is found by email.
    registry.withTenantConnection.mockImplementation(async (_meta, _env, fn) =>
      fn({
        query: jest.fn(async (sql) =>
          sql.includes("FROM app_user")
            ? { rows: [{ user_id: "u1", full_name: "Ops Person" }] }
            : { rows: [] },
        ),
      }),
    );

    await platformSvc.reply(t.ticket_id, { body: "Clear your cache, then export again.", isInternal: false }, "actor_1");

    expect(db.__audit).toHaveLength(1);
    expect(db.__audit[0]).toEqual(["actor_1", TENANT_A, "support.reply", t.ticket_id, { internal: false }]);
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "u1",
        title: "Praxis replied to your ticket",
        entityRef: `support_ticket:${t.ticket_id}`,
      }),
    );
  });

  test("an internal note never notifies", async () => {
    const t = seedTicket();
    await platformSvc.reply(t.ticket_id, { body: "broker says red channel", isInternal: true }, "actor_1");
    expect(notifications.notify).not.toHaveBeenCalled();
    const reply = [...db.__replies.values()][0];
    expect(reply.is_internal).toBe(true);
  });

  test("no raiser email means no notification attempt, no error", async () => {
    const t = seedTicket({ email: null });
    await platformSvc.reply(t.ticket_id, { body: "fixed", isInternal: false }, "actor_1");
    expect(registry.resolveBySlug).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  test("a notification failure never sinks the reply", async () => {
    const t = seedTicket();
    registry.resolveBySlug.mockRejectedValue(new Error("platform store down"));
    const out = await platformSvc.reply(t.ticket_id, { body: "fixed", isInternal: false }, "actor_1");
    expect(out.body).toBe("fixed");
    expect(db.__audit).toHaveLength(1);
  });

  test("the console's upload is image-only too", async () => {
    const t = seedTicket();
    await expect(platformSvc.uploadAttachment(t.ticket_id, { ...IMG, mimetype: "text/html" }, null))
      .rejects.toMatchObject({ status: 415 });
    const ok = await platformSvc.uploadAttachment(t.ticket_id, IMG, "admin@praxis.local");
    expect(ok.ticket_id).toBe(t.ticket_id);
    expect(ok.created_by_email).toBe("admin@praxis.local");
  });

  test("the platform read carries internal replies the tenant read strips", async () => {
    const t = seedTicket();
    db.__replies.set("r_int", {
      reply_id: "r_int", ticket_id: t.ticket_id, author_side: "PRAXIS",
      author_label: "Admin", body: "internal thought", is_internal: true, created_at: "t2",
    });
    const detail = await platformSvc.get(t.ticket_id);
    expect(detail.replies).toHaveLength(1);
    expect(detail.replies[0].is_internal).toBe(true);
  });
});

/**
 * THE WIRE SEAM — validator → controller → service.
 *
 * Everything above calls the services directly, in the services' own spelling
 * (`attachmentIds`, `isInternal`). An HTTP request does not: it arrives in the
 * wire spelling (`attachment_ids`, `internal`), goes through a Zod schema that
 * STRIPS UNKNOWN KEYS, and only then reaches the service. If the two spellings
 * disagree and nothing translates, the service silently reads `undefined` and
 * falls back to its default — with every unit test above still green.
 *
 * That is not a hypothetical. Both of these shipped broken:
 *   · `attachment_ids` never became `attachmentIds`, so `linkAttachments`
 *     returned at its first line and every screenshot a tenant attached was
 *     uploaded, shown at 100%, linked to nothing, and reaped six hours later;
 *   · `internal` never became `isInternal`, so a Praxis operator's internal
 *     note was written as a PUBLIC reply and then pushed to the tenant by
 *     in-app, email and push — while the console said "Internal note added".
 *
 * These tests drive the real validator and the real controller so the seam
 * itself is covered. If someone re-spreads `req.body` into a service call,
 * they fail here.
 */
describe("the wire seam — validator and controller key mapping", () => {
  /** Run the real validator middleware; throw whatever it passes to next(). */
  function validate(mod, key, body) {
    const req = { body };
    let failure = null;
    mod.validate(key)(req, null, (e) => { if (e) failure = e; });
    if (failure) throw failure;
    return req;
  }

  /** Minimal express `res` — enough for the handlers under test. */
  function fakeRes() {
    const res = {
      statusCode: 200,
      body: null,
      status(c) { this.statusCode = c; return this; },
      json(p) { this.body = p; return this; },
    };
    return res;
  }

  async function callTenant(handler, req) {
    const res = fakeRes();
    await handler(req, res, (e) => { if (e) throw e; });
    return res;
  }

  test("tenant create: `attachment_ids` off the wire actually links the screenshot", async () => {
    const up = await tenantSvc.upload(TENANT_A, "ops@alpha.com", IMG);
    expect(db.__attachments.get(up.attachment_id).ticket_id).toBeNull();

    const req = validate(tenantValidator, "create", {
      kind: "BUG",
      title: "Export is broken",
      body: "see the screenshot",
      attachment_ids: [up.attachment_id],
    });
    req.tenant = { tenant_id: TENANT_A };
    req.user = { email: "ops@alpha.com" };

    const res = await callTenant(tenantCtrl.create, req);
    expect(res.statusCode).toBe(201);
    const ticketId = res.body.data.ticket_id;
    expect(db.__attachments.get(up.attachment_id).ticket_id).toBe(ticketId);
  });

  test("tenant reply: `attachment_ids` off the wire links to the reply", async () => {
    const t = seedTicket({ status: "IN_PROGRESS" });
    const up = await tenantSvc.upload(TENANT_A, "ops@alpha.com", IMG);

    const req = validate(tenantValidator, "reply", {
      body: "here is what it looks like now",
      attachment_ids: [up.attachment_id],
    });
    req.tenant = { tenant_id: TENANT_A };
    req.user = { email: "ops@alpha.com" };
    req.params = { id: t.ticket_id };

    const res = await callTenant(tenantCtrl.reply, req);
    const replyId = res.body.data.reply_id;
    const linked = db.__attachments.get(up.attachment_id);
    expect(linked.reply_id).toBe(replyId);
    expect(linked.ticket_id).toBe(t.ticket_id);
  });

  test("console reply: `internal: true` off the wire stays internal and notifies nobody", async () => {
    const t = seedTicket({ email: "ops@alpha.com" });
    registry.resolveBySlug.mockResolvedValue({ tenant_id: TENANT_A, slug: "alpha" });

    const req = validate(platformValidator, "ticketReply", {
      body: "broker says red channel, do not tell the tenant yet",
      internal: true,
    });
    req.params = { id: t.ticket_id };
    req.platformUser = { platform_user_id: "pu_1", full_name: "Triager", email: "triage@praxis.local" };

    const res = await callTenant(platformCtrl.supportReply, req);
    expect(res.statusCode).toBe(201);
    expect(res.body.data.is_internal).toBe(true);
    expect([...db.__replies.values()][0].is_internal).toBe(true);
    // The whole point: no in-app row, no email, no push.
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(db.__audit[0][4]).toEqual({ internal: true });
  });

  test("console reply: a public reply off the wire still notifies the raiser", async () => {
    const t = seedTicket({ email: "ops@alpha.com" });
    registry.resolveBySlug.mockResolvedValue({ tenant_id: TENANT_A, slug: "alpha" });
    registry.withTenantConnection.mockImplementation(async (_meta, _env, fn) =>
      fn({
        query: jest.fn(async (sql) =>
          sql.includes("FROM app_user")
            ? { rows: [{ user_id: "u1", full_name: "Ops Person" }] }
            : { rows: [] },
        ),
      }),
    );

    const req = validate(platformValidator, "ticketReply", {
      body: "Clear your cache, then export again.",
      internal: false,
    });
    req.params = { id: t.ticket_id };
    req.platformUser = { platform_user_id: "pu_1", full_name: "Triager", email: "triage@praxis.local" };

    const res = await callTenant(platformCtrl.supportReply, req);
    expect(res.body.data.is_internal).toBe(false);
    expect(res.body.data.author_label).toBe("Triager");
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  test("console reply: `attachment_ids` off the wire links to the reply", async () => {
    const t = seedTicket({ email: null }); // no raiser → no notification path
    const up = await platformSvc.uploadAttachment(t.ticket_id, IMG, "triage@praxis.local");
    expect(db.__attachments.get(up.attachment_id).reply_id).toBeNull();

    const req = validate(platformValidator, "ticketReply", {
      body: "Here is the setting to change.",
      attachment_ids: [up.attachment_id],
    });
    req.params = { id: t.ticket_id };
    req.platformUser = { platform_user_id: "pu_1", full_name: "Triager", email: "triage@praxis.local" };

    const res = await callTenant(platformCtrl.supportReply, req);
    expect(db.__attachments.get(up.attachment_id).reply_id).toBe(res.body.data.reply_id);
  });
});
