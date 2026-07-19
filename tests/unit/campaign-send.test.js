"use strict";
// Campaign send fan-out (MOD-22, session 8). The service is unit-tested with the
// repo, event emitter and job queue mocked, so we assert the orchestration:
// guards, sender From-formatting, per-subscriber enqueue, and the queued count.
jest.mock("../../src/modules/sales/marketing_campaign/marketing_campaign.repo");
jest.mock("../../src/shared/events/emit", () => ({ emitEvent: jest.fn(), audit: jest.fn() }));
jest.mock("../../src/jobs/queue-producer", () => ({ enqueue: jest.fn().mockResolvedValue({}) }));

const repo = require("../../src/modules/sales/marketing_campaign/marketing_campaign.repo");
const { enqueue } = require("../../src/jobs/queue-producer");
const service = require("../../src/modules/sales/marketing_campaign/marketing_campaign.service");

const client = {}; // unused — repo is mocked

describe("campaign send fan-out", () => {
  beforeEach(() => jest.clearAllMocks());

  test("queues one email per active subscriber, using the template's sender as From", async () => {
    repo.get.mockResolvedValue({ campaign_id: "c1", name: "Newsletter", status: "ACTIVE" });
    repo.getTemplate.mockResolvedValue({ template_id: "t1", subject: "Hello", body_html: "<p>hi</p>", from_sender_id: "s1" });
    repo.getSender.mockResolvedValue({ sender_id: "s1", from_name: "Praxis LS", from_address: "news@ex.cm" });
    repo.listActiveSubscriberEmails.mockResolvedValue([{ email: "a@ex.cm" }, { email: "b@ex.cm" }]);

    const res = await service.sendCampaign(client, { id: "c1", templateId: "t1", tenantMeta: { slug: "t" }, env: "live", actor: { user_id: "u1" } });

    expect(res).toEqual({ campaign_id: "c1", template_id: "t1", queued: 2 });
    expect(enqueue).toHaveBeenCalledTimes(2);
    const [queue, , payload] = enqueue.mock.calls[0];
    expect(queue).toBe("email");
    expect(payload.to).toBe("a@ex.cm");
    expect(payload.subject).toBe("Hello");
    expect(payload.from).toBe('"Praxis LS" <news@ex.cm>');
    expect(payload.tenantMeta).toEqual({ slug: "t" });
    expect(payload.env).toBe("live");
  });

  test("no sender → no From override; subject falls back to the campaign name", async () => {
    repo.get.mockResolvedValue({ campaign_id: "c1", name: "Promo", status: "ACTIVE" });
    repo.getTemplate.mockResolvedValue({ template_id: "t1", subject: null, body_html: "", from_sender_id: null });
    repo.listActiveSubscriberEmails.mockResolvedValue([{ email: "a@ex.cm" }]);

    await service.sendCampaign(client, { id: "c1", templateId: "t1", tenantMeta: {}, env: "live", actor: {} });

    const [, , payload] = enqueue.mock.calls[0];
    expect(payload.subject).toBe("Promo");
    expect(payload.from).toBeUndefined();
    expect(repo.getSender).not.toHaveBeenCalled();
  });

  test("ENDED campaign is rejected and queues nothing", async () => {
    repo.get.mockResolvedValue({ campaign_id: "c1", name: "Old", status: "ENDED" });
    await expect(service.sendCampaign(client, { id: "c1", templateId: "t1" })).rejects.toMatchObject({ code: "CAMPAIGN_ENDED" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("missing campaign → NOT_FOUND", async () => {
    repo.get.mockResolvedValue(null);
    await expect(service.sendCampaign(client, { id: "x", templateId: "t1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("unknown template → BAD_TEMPLATE", async () => {
    repo.get.mockResolvedValue({ campaign_id: "c1", name: "N", status: "ACTIVE" });
    repo.getTemplate.mockResolvedValue(null);
    await expect(service.sendCampaign(client, { id: "c1", templateId: "bad" })).rejects.toMatchObject({ code: "BAD_TEMPLATE" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("merge fields are substituted per recipient in subject and body", async () => {
    repo.get.mockResolvedValue({ campaign_id: "c1", name: "Newsletter", status: "ACTIVE" });
    repo.getTemplate.mockResolvedValue({ template_id: "t1", subject: "Hi {{name}}", body_html: "<p>Hello {{name}} ({{email}}) — {{campaign}}</p>", from_sender_id: null });
    repo.listActiveSubscriberEmails.mockResolvedValue([
      { email: "amina@ex.cm", name: "Amina" },
      { email: "bruno@ex.cm", name: null },
    ]);

    await service.sendCampaign(client, { id: "c1", templateId: "t1", tenantMeta: {}, env: "live", actor: {} });

    const [, , first] = enqueue.mock.calls[0];
    expect(first.subject).toBe("Hi Amina");
    expect(first.html).toBe("<p>Hello Amina (amina@ex.cm) — Newsletter</p>");

    // No name on the row → fall back to the email's local part, never "Hello ,".
    const [, , second] = enqueue.mock.calls[1];
    expect(second.subject).toBe("Hi bruno");
    expect(second.html).toContain("Hello bruno (bruno@ex.cm)");
  });

  test("merge values are HTML-escaped in the body but not in the subject", async () => {
    repo.get.mockResolvedValue({ campaign_id: "c1", name: "N", status: "ACTIVE" });
    repo.getTemplate.mockResolvedValue({ template_id: "t1", subject: "Hi {{name}}", body_html: "<p>{{name}}</p>", from_sender_id: null });
    // Subscriber names come from the public subscribe endpoint — untrusted.
    repo.listActiveSubscriberEmails.mockResolvedValue([{ email: "x@ex.cm", name: '<script>alert(1)</script>' }]);

    await service.sendCampaign(client, { id: "c1", templateId: "t1" });

    const [, , payload] = enqueue.mock.calls[0];
    expect(payload.html).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
    expect(payload.html).not.toContain("<script>");
    expect(payload.subject).toBe("Hi <script>alert(1)</script>");
  });

  test("CRLF in a merge value can't inject a header via the subject", async () => {
    repo.get.mockResolvedValue({ campaign_id: "c1", name: "N", status: "ACTIVE" });
    repo.getTemplate.mockResolvedValue({ template_id: "t1", subject: "Hi {{name}}", body_html: "", from_sender_id: null });
    repo.listActiveSubscriberEmails.mockResolvedValue([{ email: "x@ex.cm", name: "Eve\r\nBcc: evil@ex.cm" }]);

    await service.sendCampaign(client, { id: "c1", templateId: "t1" });

    const [, , payload] = enqueue.mock.calls[0];
    expect(payload.subject).toBe("Hi Eve Bcc: evil@ex.cm");
    expect(payload.subject).not.toMatch(/[\r\n]/);
  });

  test("unknown tokens are left intact so typos are visible", async () => {
    repo.get.mockResolvedValue({ campaign_id: "c1", name: "N", status: "ACTIVE" });
    repo.getTemplate.mockResolvedValue({ template_id: "t1", subject: "Hi {{firstname}}", body_html: "<p>{{nope}}</p>", from_sender_id: null });
    repo.listActiveSubscriberEmails.mockResolvedValue([{ email: "x@ex.cm", name: "X" }]);

    await service.sendCampaign(client, { id: "c1", templateId: "t1" });

    const [, , payload] = enqueue.mock.calls[0];
    expect(payload.subject).toBe("Hi {{firstname}}");
    expect(payload.html).toBe("<p>{{nope}}</p>");
  });

  test("no active subscribers → queued 0", async () => {
    repo.get.mockResolvedValue({ campaign_id: "c1", name: "N", status: "DRAFT" });
    repo.getTemplate.mockResolvedValue({ template_id: "t1", subject: "S", body_html: "b", from_sender_id: null });
    repo.listActiveSubscriberEmails.mockResolvedValue([]);

    const res = await service.sendCampaign(client, { id: "c1", templateId: "t1" });
    expect(res.queued).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
