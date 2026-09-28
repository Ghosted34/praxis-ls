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
 *   4. The team is told: the file's owners and the MD, or — with nobody
 *      owning the thread — the people who answer the portal. Once a minute per
 *      thread, not once a line.
 */

let mockRepo;
let mockNotified = [];
let mockVaultCalls = [];
let mockHolders = [];
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
  recipientsWithPermission: async () => mockHolders,
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
    staffAudience: async (c, { dossier }) => ({ owners: dossier ? [dossier.owner_ops_id, dossier.owner_sales_id] : [], md: ["md-1"] }),
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
  it("alerts the file's owners and the MD about a shipment's thread", async () => {
    await chat.send(client, { clientId: "c1", me: ME, scope: "ALL", thread: SHIP.dossier_id, body: "Hello" });
    expect(mockNotified.map((n) => n.userId).sort()).toEqual(["md-1", "ops-1", "sales-1"]);
    expect(mockNotified[0]).toMatchObject({ category: "comms", title: "Acme Trading · PRX-1", body: "Hello" });
    // One claim per person per thread: five quick lines are one ping.
    expect(mockNotified[0].dedupeKey).toBe(`chat:c1:${SHIP.dossier_id}:${mockNotified[0].userId}`);
  });

  it("alerts the portal's answerers when nobody owns the thread", async () => {
    await chat.send(client, { clientId: "c1", me: ME, scope: "ALL", thread: "general", location: { lat: 1, lng: 2 } });
    expect(mockNotified.map((n) => n.userId).sort()).toEqual(["md-1", "support-1"]);
    expect(mockNotified[0].body).toBe("Shared a location");
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
});
