"use strict";

/**
 * 14170 — the client chat: General and one thread per shipment, with photos,
 * PDFs, voice notes and location pins.
 *
 *   1. General is always there; a colleague given Billing only never sees,
 *      reads or downloads from a shipment's thread.
 *   2. A message needs something in it; a stage it names must be on its
 *      shipment; a shipment it names must be the client's own.
 *   3. A voice note is stored only if its bytes are audio.
 *   4. The team is told (PR 3): the client's account manager and the file's
 *      owners, and the MD always; with none of the first two reachable, the
 *      people who hold the Client inbox (MOD-64C). Once a minute per thread,
 *      not once a line, and the link opens the conversation in the inbox.
 *   5. The Client inbox: waiting first, and Mine is the clients I look after
 *      and the files I own.
 */

let mockRepo;
let mockNotified = [];
let mockVaultCalls = [];
let mockHolders = [];
let mockHolderAsks = [];
let mockManager = [];
let mockStored = {};

jest.mock("../../src/modules/portal/portal_chat.repo", () => {
  const real = jest.requireActual("../../src/modules/portal/portal_chat.repo");
  return new Proxy({}, {
    get: (_t, name) => {
      if (name === "threadKey") return real.threadKey;
      return (...args) => {
        if (!mockRepo[name]) throw new Error(`repo.${String(name)} not mocked`);
        return mockRepo[name](...args);
      };
    },
  });
});
jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({
  createDocument: async (c, opts) => {
    mockVaultCalls.push(opts);
    return { doc_id: `doc-${mockVaultCalls.length}` };
  },
}));
jest.mock("../../src/modules/notification/notification.service", () => ({
  notify: async (c, n) => {
    mockNotified.push(n);
    return { notification_id: "n" };
  },
}));
jest.mock("../../src/modules/notification/notification.repo", () => ({
  recipientsWithPermission: async (c, moduleKey, action) => {
    mockHolderAsks.push([moduleKey, action]);
    return mockHolders;
  },
}));
jest.mock("../../src/services/storage.service", () => ({
  get: async (key) => {
    if (mockStored[key]) return mockStored[key];
    throw new Error("missing");
  },
}));
jest.mock("../../src/services/image-pipeline.service", () => ({
  derivativeKey: (k, v, f) => `${k.replace(/\.[a-z]+$/, "")}.${v}.${f}`,
  ensureDerivative: async () => null,
}));
jest.mock("../../src/shared/events/emit", () => ({
  emitEvent: async () => {},
  resolveActorId: async (c, id) => id || null,
}));

const chat = require("../../src/modules/portal/portal_chat.service");

// SAVEPOINT resolving is what `atomically` reads as "already in a transaction",
// so the unit runs inline — the transaction itself is the helper's own test.
const client = { query: jest.fn(async () => ({ rows: [{ name: "Acme Trading" }] })) };
const ME = { portal_user_id: "pu-1", email: "marie@acme.cm" };
const SHIP = { dossier_id: "11111111-1111-4111-8111-111111111111", ref: "PRX-1", owner_ops_id: "ops-1", owner_sales_id: "sales-1" };
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(40, 1)]);

let inserted;

beforeEach(() => {
  mockNotified = [];
  mockVaultCalls = [];
  mockHolders = ["support-1"];
  mockHolderAsks = [];
  mockManager = [];
  mockStored = {};
  inserted = { messages: [], attachments: [], reads: [] };
  mockRepo = {
    threads: async () => [
      { dossier_id: SHIP.dossier_id, dossier_ref: "PRX-1", message_id: "m2", body: "Container out?", direction: "STAFF", created_at: "2026-09-28T09:00:00Z", unread: 2 },
    ],
    unreadTotal: async (c, q) => (q.shipments ? 3 : 1),
    clientDossier: async (c, { clientId, dossierId }) => (clientId === "c1" && dossierId === SHIP.dossier_id ? SHIP : null),
    clientMilestone: async (c, { milestoneId }) => (milestoneId === "22222222-2222-4222-8222-222222222222" ? { milestone_instance_id: milestoneId, label: "Arrivée", label_en: "Arrival" } : null),
    messages: async () => [],
    insertMessage: async (c, m) => {
      const row = { message_id: `m-${inserted.messages.length + 1}`, created_at: "2026-09-28T10:00:00Z", ...m, direction: m.direction, body: m.body };
      inserted.messages.push(m);
      return row;
    },
    insertAttachment: async (c, a) => {
      inserted.attachments.push(a);
      return a;
    },
    markRead: async (c, r) => {
      inserted.reads.push(r);
    },
    markStaffRead: async () => 1,
    // The repo returns ACTIVE logins only; an owner who left is simply absent.
    staffAudience: async (c, { clientId, dossier }) => ({
      manager: clientId === "c1" ? mockManager : [],
      owners: dossier ? [dossier.owner_ops_id, dossier.owner_sales_id].filter(Boolean) : [],
      md: ["md-1"],
    }),
    attachment: async (c, { attachmentId, clientId }) => {
      if (attachmentId !== "a1") return null;
      if (clientId && clientId !== "c1") return null;
      return { attachment_id: "a1", kind: "IMAGE", dossier_id: SHIP.dossier_id, storage_path: "tenant_x/vault/doc_1.jpg", file_name: "seal.jpg", mime_type: "image/jpeg" };
    },
  };
});

describe("threads", () => {
  it("always offers General first, then the shipments", async () => {
    const list = await chat.threads(client, { clientId: "c1", me: ME, scope: "ALL" });
    expect(list.map((t) => t.thread)).toEqual(["general", SHIP.dossier_id]);
    expect(list[0].last).toBeNull();
    expect(list[1]).toMatchObject({ unread: 2, last: { preview: "Container out?", kind: "TEXT", mine: false } });
  });

  it("gives a Billing-only colleague General and nothing else", async () => {
    const list = await chat.threads(client, { clientId: "c1", me: ME, scope: "BILLING" });
    expect(list.map((t) => t.thread)).toEqual(["general"]);
    await expect(chat.messages(client, { clientId: "c1", me: ME, scope: "BILLING", thread: SHIP.dossier_id })).rejects.toMatchObject({ code: "PORTAL_SCOPE" });
    await expect(chat.clientAttachment(client, { clientId: "c1", scope: "BILLING", attachmentId: "a1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await chat.unread(client, { clientId: "c1", me: ME, scope: "BILLING" })).toBe(1);
  });

  it("refuses another company's shipment", async () => {
    await expect(chat.messages(client, { clientId: "c2", me: ME, scope: "ALL", thread: SHIP.dossier_id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("sending", () => {
  it("refuses a message with nothing in it", async () => {
    await expect(chat.send(client, { clientId: "c1", me: ME, scope: "ALL", thread: "general", body: "   " })).rejects.toMatchObject({ code: "EMPTY_MESSAGE" });
  });

  it("files a text under the shipment, as this person, and reads the thread for them", async () => {
    await chat.send(client, { clientId: "c1", me: ME, scope: "ALL", thread: SHIP.dossier_id, body: " Is it out of port? " });
    expect(inserted.messages[0]).toMatchObject({ direction: "CLIENT", body: "Is it out of port?", dossierId: SHIP.dossier_id, portalUserId: "pu-1", authorEmail: "marie@acme.cm" });
    expect(inserted.reads[0]).toMatchObject({ portalUserId: "pu-1", dossierId: SHIP.dossier_id });
  });

  it("names a stage only if it is on the shipment, and never on General", async () => {
    const stage = "22222222-2222-4222-8222-222222222222";
    await chat.send(client, { clientId: "c1", me: ME, scope: "ALL", thread: SHIP.dossier_id, body: "Delayed?", milestoneId: stage });
    expect(inserted.messages[0].milestoneId).toBe(stage);
    await expect(chat.send(client, { clientId: "c1", me: ME, scope: "ALL", thread: SHIP.dossier_id, body: "x", milestoneId: "33333333-3333-4333-8333-333333333333" })).rejects.toMatchObject({ code: "MILESTONE_MISMATCH" });
    await expect(chat.send(client, { clientId: "c1", me: ME, scope: "ALL", thread: "general", body: "x", milestoneId: stage })).rejects.toMatchObject({ code: "MILESTONE_MISMATCH" });
  });

  it("sends a pin with no words", async () => {
    await chat.send(client, { clientId: "c1", me: ME, scope: "ALL", thread: "general", location: { lat: 4.05, lng: 9.7, label: "Warehouse B" } });
    expect(inserted.messages[0]).toMatchObject({ body: "", location: { lat: 4.05, lng: 9.7 } });
  });

  it("stores a photo in the vault as a client file awaiting review", async () => {
    const file = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]), mimetype: "image/jpeg", originalname: "seal.jpg" };
    await chat.send(client, { clientId: "c1", me: ME, scope: "ALL", thread: SHIP.dossier_id, file, meta: { width: 1200, height: 900 } });
    expect(mockVaultCalls[0]).toMatchObject({ status: "PENDING", sniff: true, clientId: "c1", allowedTypes: ["image/jpeg", "image/png", "image/webp"] });
    // Not filed against the shipment: a chat photo is not one of its documents.
    expect(mockVaultCalls[0].dossierId).toBeUndefined();
    expect(inserted.attachments[0]).toMatchObject({ kind: "IMAGE", width: 1200, height: 900, docId: "doc-1" });
  });
});

describe("voice notes", () => {
  it("recognises what MediaRecorder produces, and nothing else", () => {
    expect(chat.sniffAudio(WEBM)).toBe("audio/webm");
    expect(chat.sniffAudio(Buffer.from("OggS\0\0\0\0\0\0\0\0\0\0"))).toBe("audio/ogg");
    expect(chat.sniffAudio(Buffer.from("\0\0\0\x18ftypM4A \0\0\0\0"))).toBe("audio/mp4");
    expect(chat.sniffAudio(Buffer.from("%PDF-1.7 hello world"))).toBeNull();
  });

  it("stores a real recording, codec parameter and all", async () => {
    const file = { buffer: WEBM, mimetype: "audio/webm;codecs=opus", originalname: "voice.webm" };
    await chat.send(client, { clientId: "c1", me: ME, scope: "ALL", thread: "general", file, meta: { durationMs: 7300 } });
    expect(mockVaultCalls[0]).toMatchObject({ sniff: false, file: expect.objectContaining({ mimetype: "audio/webm" }) });
    expect(inserted.attachments[0]).toMatchObject({ kind: "VOICE", durationMs: 7300, mimeType: "audio/webm" });
  });

  it("refuses bytes that are not audio, and a note over five minutes", async () => {
    const fake = { buffer: Buffer.from("%PDF-1.7 not a recording"), mimetype: "audio/webm", originalname: "x.webm" };
    await expect(chat.send(client, { clientId: "c1", me: ME, scope: "ALL", thread: "general", file: fake })).rejects.toMatchObject({ code: "BAD_FILE" });
    const long = { buffer: WEBM, mimetype: "audio/webm", originalname: "x.webm" };
    await expect(chat.send(client, { clientId: "c1", me: ME, scope: "ALL", thread: "general", file: long, meta: { durationMs: 6 * 60 * 1000 } })).rejects.toMatchObject({ code: "VOICE_TOO_LONG" });
    expect(inserted.messages).toHaveLength(0);
  });
});

describe("telling the team", () => {
  it("alerts the account manager, the file's owners and the MD about a shipment's thread", async () => {
    mockManager = ["am-1"];
    await chat.send(client, { clientId: "c1", me: { ...ME, full_name: "Marie Nguema" }, scope: "ALL", thread: SHIP.dossier_id, body: "Hello" });
    expect(mockNotified.map((n) => n.userId).sort()).toEqual(["am-1", "md-1", "ops-1", "sales-1"]);
    // Which colleague at the client wrote — not only which company.
    expect(mockNotified[0]).toMatchObject({ category: "comms", title: "Acme Trading · PRX-1", body: "Marie Nguema: Hello" });
    // One claim per person per thread: five quick lines are one ping.
    expect(mockNotified[0].dedupeKey).toBe(`chat:c1:${SHIP.dossier_id}:${mockNotified[0].userId}`);
    // The link opens the conversation itself, in the Client inbox.
    expect(mockNotified[0].url).toBe(`/comms/clients?client=c1&thread=${SHIP.dossier_id}`);
    // Somebody holds it, so the inbox is not asked.
    expect(mockHolderAsks).toEqual([]);
  });

  it("brings a General message to the account manager and the MD, not the whole inbox", async () => {
    mockManager = ["am-1"];
    await chat.send(client, { clientId: "c1", me: ME, scope: "ALL", thread: "general", body: "Can you quote Douala to Bangui?" });
    expect(mockNotified.map((n) => n.userId).sort()).toEqual(["am-1", "md-1"]);
    expect(mockNotified[0].url).toBe("/comms/clients?client=c1&thread=general");
    expect(mockHolderAsks).toEqual([]);
  });

  it("alerts the Client inbox when nobody looks after the client or owns the thread", async () => {
    await chat.send(client, { clientId: "c1", me: ME, scope: "ALL", thread: "general", location: { lat: 1, lng: 2 } });
    expect(mockNotified.map((n) => n.userId).sort()).toEqual(["md-1", "support-1"]);
    // A login with no name yet is named by its address.
    expect(mockNotified[0].body).toBe("marie@acme.cm: Shared a location");
    // The inbox's own permission — not MOD-67, the administrators'.
    expect(mockHolderAsks).toEqual([["MOD-64C", "edit"]]);
  });

  it("falls back to the inbox when the file's owners have left and nobody looks after the client", async () => {
    mockRepo.clientDossier = async () => ({ ...SHIP, owner_ops_id: null, owner_sales_id: null });
    await chat.send(client, { clientId: "c1", me: ME, scope: "ALL", thread: SHIP.dossier_id, body: "Anyone?" });
    expect(mockNotified.map((n) => n.userId).sort()).toEqual(["md-1", "support-1"]);
    expect(mockHolderAsks).toEqual([["MOD-64C", "edit"]]);
  });

  it("tells a person once, whichever of the roles they hold", async () => {
    mockManager = ["ops-1"];
    mockHolders = ["ops-1", "md-1"];
    await chat.send(client, { clientId: "c1", me: ME, scope: "ALL", thread: SHIP.dossier_id, body: "Hello" });
    expect(mockNotified.map((n) => n.userId).sort()).toEqual(["md-1", "ops-1", "sales-1"]);
  });
});

describe("attachments", () => {
  it("serves a photo's preview inline, and nothing of another company's", async () => {
    mockStored["tenant_x/vault/doc_1.preview.webp"] = Buffer.from("webp");
    const out = await chat.clientAttachment(client, { clientId: "c1", scope: "ALL", attachmentId: "a1", size: "preview" });
    expect(out).toMatchObject({ type: "image/webp", inline: true });
    await expect(chat.clientAttachment(client, { clientId: "c2", scope: "ALL", attachmentId: "a1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("falls back to the original when no preview exists", async () => {
    mockStored["tenant_x/vault/doc_1.jpg"] = Buffer.from("jpeg");
    const out = await chat.clientAttachment(client, { clientId: "c1", scope: "ALL", attachmentId: "a1", size: "preview" });
    expect(out).toMatchObject({ type: "image/jpeg", inline: true });
    expect(out.buffer.toString()).toBe("jpeg");
  });
});

describe("the team's side", () => {
  it("replies as the team, reads the thread, and never alerts itself", async () => {
    await chat.staffSend(client, { clientId: "c1", thread: SHIP.dossier_id, body: "Out this morning.", actor: { user_id: "ops-1" } });
    expect(inserted.messages[0]).toMatchObject({ direction: "STAFF", authorUserId: "ops-1", dossierId: SHIP.dossier_id });
    expect(mockNotified).toHaveLength(0);
  });

  it("shares a location with no words, as a client can (PR 3's reply tools)", async () => {
    await chat.staffSend(client, { clientId: "c1", thread: "general", location: { lat: 4.0435, lng: 9.6966, label: "Warehouse B" }, actor: { user_id: "ops-1" } });
    expect(inserted.messages[0]).toMatchObject({ direction: "STAFF", body: "", location: { lat: 4.0435, lng: 9.6966, label: "Warehouse B" } });
    await expect(chat.staffSend(client, { clientId: "c1", thread: "general", body: " ", actor: { user_id: "ops-1" } })).rejects.toMatchObject({ code: "EMPTY_MESSAGE" });
  });

  it("sends a voice note recorded in the ERP", async () => {
    const file = { buffer: WEBM, mimetype: "audio/webm;codecs=opus", originalname: "voice-note.webm" };
    await chat.staffSend(client, { clientId: "c1", thread: "general", file, meta: { durationMs: 4200 }, actor: { user_id: "ops-1" } });
    expect(mockVaultCalls[0]).toMatchObject({ status: "VERIFIED", sniff: false });
    expect(inserted.attachments[0]).toMatchObject({ kind: "VOICE", durationMs: 4200, mimeType: "audio/webm" });
  });
});

describe("the Client inbox", () => {
  const ROWS = [
    // Waiting: Acme wrote on a shipment and nobody has read it.
    { client_id: "c1", client_name: "Acme Trading", dossier_id: SHIP.dossier_id, dossier_ref: "PRX-1", body: "Is it out of port?", direction: "CLIENT", created_at: "2026-09-28T10:00:00Z", has_location: false, attachment_kind: null, unread: 2, waiting_since: "2026-09-28T09:58:00Z", owner_ops_id: "ops-1", owner_sales_id: "sales-1", manager_user_id: "am-1", manager_name: "Awa Ndiaye" },
    // Answered: our photo was the last word in Acme's General.
    { client_id: "c1", client_name: "Acme Trading", dossier_id: null, dossier_ref: null, body: "", direction: "STAFF", created_at: "2026-09-27T16:00:00Z", has_location: false, attachment_kind: "IMAGE", unread: 0, waiting_since: null, owner_ops_id: null, owner_sales_id: null, manager_user_id: "am-1", manager_name: "Awa Ndiaye" },
    // Nobody looks after Bois du Sud yet; its pin is waiting.
    { client_id: "c2", client_name: "Bois du Sud", dossier_id: null, dossier_ref: null, body: null, direction: "CLIENT", created_at: "2026-09-26T08:00:00Z", has_location: true, attachment_kind: null, unread: 1, waiting_since: "2026-09-26T08:00:00Z", owner_ops_id: null, owner_sales_id: null, manager_user_id: null, manager_name: null },
  ];

  beforeEach(() => {
    mockRepo.inbox = async () => ROWS;
  });

  it("lists every conversation, as the screen reads it", async () => {
    const out = await chat.staffInbox(client, { filter: "all", actor: { user_id: "am-1" } });
    expect(out.filter).toBe("all");
    expect(out.items.map((i) => `${i.client_id}:${i.thread}`)).toEqual([`c1:${SHIP.dossier_id}`, "c1:general", "c2:general"]);
    expect(out.items[0]).toMatchObject({
      client_name: "Acme Trading", dossier_ref: "PRX-1", unread: 2, waiting_since: "2026-09-28T09:58:00Z",
      last: { direction: "CLIENT", preview: "Is it out of port?", kind: "TEXT", at: "2026-09-28T10:00:00Z" },
      manager: { user_id: "am-1", name: "Awa Ndiaye" }, mine: true,
    });
    // A message with no words says what it is.
    expect(out.items[1].last).toMatchObject({ preview: null, kind: "IMAGE", direction: "STAFF" });
    expect(out.items[2]).toMatchObject({ manager: null, mine: false, last: { kind: "LOCATION" } });
  });

  it("counts all three filters whichever one is shown", async () => {
    const waiting = await chat.staffInbox(client, { filter: "waiting", actor: { user_id: "am-1" } });
    expect(waiting.counts).toEqual({ all: 3, waiting: 2, mine: 2 });
    expect(waiting.items.map((i) => i.client_id)).toEqual(["c1", "c2"]);
    expect(waiting.items.every((i) => i.unread > 0)).toBe(true);
  });

  it("makes Mine the clients I look after and the files I own", async () => {
    const asOwner = await chat.staffInbox(client, { filter: "mine", actor: { user_id: "sales-1" } });
    expect(asOwner.items.map((i) => i.thread)).toEqual([SHIP.dossier_id]);
    const asManager = await chat.staffInbox(client, { filter: "mine", actor: { user_id: "am-1" } });
    expect(asManager.items.map((i) => `${i.client_id}:${i.thread}`)).toEqual([`c1:${SHIP.dossier_id}`, "c1:general"]);
    const asNobody = await chat.staffInbox(client, { filter: "mine", actor: {} });
    expect(asNobody.items).toEqual([]);
    expect(asNobody.counts.mine).toBe(0);
  });

  it("shows everything for a filter it does not know", async () => {
    const out = await chat.staffInbox(client, { filter: "urgent", actor: { user_id: "am-1" } });
    expect(out.filter).toBe("all");
    expect(out.items).toHaveLength(3);
    expect(out.truncated).toBe(false);
  });

  it("says when the read hit its limit, so the counts are not presented as everything", async () => {
    let asked;
    mockRepo.inbox = async (c, opts) => {
      asked = opts;
      return Array.from({ length: opts.limit }, (_, i) => ({ ...ROWS[2], client_id: `c${i}` }));
    };
    const out = await chat.staffInbox(client, { filter: "all", actor: {} });
    expect(asked).toEqual({ limit: 300 });
    expect(out.truncated).toBe(true);
  });
});
