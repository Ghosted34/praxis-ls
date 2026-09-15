"use strict";
jest.mock("../../src/modules/smartcomm/smartcomm.schedule.repo");
jest.mock("../../src/modules/smartcomm/smartcomm.repo");
jest.mock("../../src/shared/events/emit", () => ({ emitEvent: jest.fn(), audit: jest.fn(), resolveActorId: jest.fn() }));
const queue = require("../../src/modules/smartcomm/smartcomm.schedule.repo");
const repo = require("../../src/modules/smartcomm/smartcomm.repo");
const schedule = require("../../src/modules/smartcomm/smartcomm.schedule.service");
const comms = require("../../src/modules/smartcomm/smartcomm.service");
const { schemas } = require("../../src/modules/smartcomm/smartcomm.validator");
const actor = { user_id: "sender" };
const future = () => new Date(Date.now() + 3600000).toISOString();
const client = () => ({ query: jest.fn(async () => ({ rows: [] })) });
beforeEach(() => {
  jest.resetAllMocks();
  repo.findMember.mockResolvedValue({ user_id: "sender" });
  repo.insertMessage.mockResolvedValue({ message_id: "posted", group_id: "group", body: "hello" });
  repo.memberUserIds.mockResolvedValue([]);
  queue.sender.mockResolvedValue(actor);
});

describe("durable scheduled chat", () => {
  test("rejects past/invalid dates, timezones and schedules more than a year ahead", () => {
    for (const send_at of ["bad", new Date(0).toISOString(), new Date(Date.now() + 400 * 86400000).toISOString()]) expect(() => schedule.validateTime({ send_at, timezone: "UTC" })).toThrow();
    expect(() => schedule.validateTime({ send_at: future(), timezone: "not/a-zone" })).toThrow();
    expect(() => schedule.validateTime({ send_at: future(), timezone: "Africa/Lagos" })).not.toThrow();
  });
  test("requires real membership and refuses sandbox delivery", async () => {
    const args = { groupId: "group", actor, data: { body: "hello", send_at: future(), timezone: "UTC" }, env: "sandbox" };
    await expect(schedule.create(client(), args)).rejects.toThrow(/LIVE/);
    repo.findMember.mockResolvedValue(null);
    await expect(schedule.create(client(), { ...args, env: "live" })).rejects.toThrow(/member/);
    expect(queue.insert).not.toHaveBeenCalled();
  });
  test("a lost-response retry recovers a schedule even after its send time has passed", async () => {
    const row = { group_id: "group", body: "hello", attachments: [], reply_to: null, send_at: new Date(0).toISOString(), timezone: "UTC", status: "SENT" };
    queue.findRequest.mockResolvedValue(row);
    await expect(schedule.create(client(), { groupId: "group", actor, env: "live", data: { ...row, request_id: "same-key" } })).resolves.toBe(row);
    expect(queue.insert).not.toHaveBeenCalled();
    await expect(schedule.create(client(), { groupId: "group", actor, env: "live", data: { ...row, body: "different", request_id: "same-key" } })).rejects.toThrow(/already used/);
  });
  test("validates media and reply against this channel before queueing", async () => {
    queue.mediaAllowed.mockResolvedValue(false);
    await expect(schedule.validateAttachments(client(), "group", [{ attachment_kind: "MEDIA", media_id: "foreign" }])).rejects.toThrow(/conversation/);
    repo.getMessage.mockResolvedValue({ group_id: "other" });
    await expect(schedule.validateAttachments(client(), "group", [], "reply")).rejects.toThrow(/conversation/);
  });
  test("sends uploaded files and record references and stamps SENT before COMMIT", async () => {
    const c = client();
    const attachments = [{ attachment_kind: "MEDIA", media_id: "media" }, { attachment_kind: "ERP", erp_kind: "CLIENT", erp_id: "client" }];
    queue.claim.mockResolvedValueOnce({ group_id: "group", sender_user_id: "sender", body: "hello", attachments });
    queue.mediaAllowed.mockResolvedValue(true);
    await comms.postMessage(c, { scheduleId: "scheduled" });
    expect(repo.addAttachment).toHaveBeenCalledTimes(2);
    expect(queue.sent).toHaveBeenCalledWith(c, "scheduled", "posted");
    const commitCall = c.query.mock.calls.findIndex(([sql]) => sql === "COMMIT");
    expect(queue.sent.mock.invocationCallOrder[0]).toBeLessThan(c.query.mock.invocationCallOrder[commitCall]);
    expect(queue.sender).toHaveBeenCalledWith(c, "sender", "group");
  });
  test("a replay or competing worker cannot create a duplicate", async () => {
    queue.claim.mockResolvedValue(null);
    await expect(comms.postMessage(client(), { scheduleId: "already-sent" })).resolves.toBeNull();
    expect(repo.insertMessage).not.toHaveBeenCalled();
  });
  test("revoked send rights roll back without posting", async () => {
    const c = client();
    queue.claim.mockResolvedValue({ group_id: "group", sender_user_id: "sender" });
    queue.sender.mockResolvedValue(null);
    await expect(comms.postMessage(c, { scheduleId: "scheduled" })).rejects.toThrow(/permission/);
    expect(c.query).toHaveBeenCalledWith("ROLLBACK");
    expect(repo.insertMessage).not.toHaveBeenCalled();
    expect(queue.sent).not.toHaveBeenCalled();
  });
  test("attachment/database failures roll back message and schedule together", async () => {
    const c = client();
    queue.claim.mockResolvedValue({ group_id: "group", sender_user_id: "sender", body: "hello", attachments: [{ attachment_kind: "ERP", erp_kind: "CLIENT", erp_id: "id" }] });
    repo.addAttachment.mockRejectedValue(new Error("database unavailable"));
    await expect(comms.postMessage(c, { scheduleId: "scheduled" })).rejects.toThrow(/database/);
    expect(c.query).toHaveBeenCalledWith("ROLLBACK");
    expect(c.query).not.toHaveBeenCalledWith("COMMIT");
    expect(queue.sent).not.toHaveBeenCalled();
  });
  test("cancellation and rescheduling cannot alter sent or foreign rows", async () => {
    queue.change.mockResolvedValue(null);
    await expect(schedule.change(client(), { id: "foreign", actor, data: { cancel: true } })).rejects.toThrow(/not found/);
    const sqlRepo = jest.requireActual("../../src/modules/smartcomm/smartcomm.schedule.repo");
    const c = client();
    await sqlRepo.change(c, "id", "sender", { cancel: true });
    expect(c.query.mock.calls[0][0]).toMatch(/sender_user_id = \$2 AND status IN \('PENDING','FAILED'\)/);
  });
  test("retry updates cannot overwrite a concurrent reschedule", async () => {
    const sqlRepo = jest.requireActual("../../src/modules/smartcomm/smartcomm.schedule.repo");
    const c = client();
    await sqlRepo.fail(c, "id", false, "retry", "version");
    expect(c.query.mock.calls[0][0]).toMatch(/AND updated_at = \$4/);
    expect(c.query.mock.calls[0][1][3]).toBe("version");
  });
  test("retry versions keep PostgreSQL microseconds instead of round-tripping a JS Date", async () => {
    const sqlRepo = jest.requireActual("../../src/modules/smartcomm/smartcomm.schedule.repo");
    const c = client();
    await sqlRepo.due(c);
    expect(c.query.mock.calls[0][0]).toContain("updated_at::text AS update_version");
  });
  test("creation requires an idempotency key and bounded payload", () => {
    expect(schemas.scheduled.safeParse({ body: "hi", send_at: future(), timezone: "UTC" }).success).toBe(false);
  });
});

describe("personal quick phrases and edits", () => {
  test("creation always belongs to its author, not a client-supplied owner", async () => {
    await comms.createQuickReply(client(), { actor, data: { label: "Hello", body: "Hi", shared: true } });
    expect(repo.createQuickReply.mock.calls[0][1].owner_user_id).toBe("sender");
    expect(schemas.quickReply.safeParse({ label: "x", body: "y", shared: true }).success).toBe(false);
  });
  test("foreign phrase edits/deletes fail and SQL is owner-scoped", async () => {
    repo.updateQuickReply.mockResolvedValue(null);
    repo.deleteQuickReply.mockResolvedValue(null);
    await expect(comms.updateQuickReply(client(), { id: "foreign", actor, patch: { body: "oops" } })).rejects.toThrow(/not found/);
    await expect(comms.deleteQuickReply(client(), { id: "foreign", actor })).rejects.toThrow(/not found/);
    const actual = jest.requireActual("../../src/modules/smartcomm/smartcomm.repo");
    const c = client();
    await actual.updateQuickReply(c, "id", { body: "Hi" }, "sender");
    await actual.deleteQuickReply(c, "id", "sender");
    for (const [sql, args] of c.query.mock.calls) { expect(sql).toMatch(/owner_user_id = \$2/); expect(args[1]).toBe("sender"); }
  });
  test("a former member cannot edit their old message", async () => {
    repo.getMessage.mockResolvedValue({ sender_user_id: "sender", group_id: "group" });
    repo.findMember.mockResolvedValue(null);
    await expect(comms.editMessage(client(), { messageId: "m", actor, body: "edit" })).rejects.toThrow(/member/);
    expect(repo.editMessage).not.toHaveBeenCalled();
  });
});
