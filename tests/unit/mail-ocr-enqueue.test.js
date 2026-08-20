/**
 * WHEN AN ATTACHMENT GETS READ, AND — MOSTLY — WHEN IT DOES NOT (§8.6).
 *
 * ── THE FINDING THAT MADE THIS FILE ─────────────────────────────────────────
 *
 * `jobs/handlers/mail-ocr-extract.js` was written, registered in `workers.js`,
 * and enqueued by nothing. The commit that removed the last orphan TABLE
 * introduced an orphan WORKER, which is the same defect in a shape the existing
 * gates could not see: `workers.js` is where you go to check whether a job
 * exists, so registration alone reads as finished.
 *
 * ── EVERYTHING ELSE HERE IS ABOUT COST ──────────────────────────────────────
 *
 * A vision call is billed per page. The naive wiring — extract every attachment
 * on ingest — charges a tenant for reading three months of historical receipts
 * on the day they connect a mailbox, and nobody authorised that. So the queue
 * path is narrow, and each narrowing is a test below, because every one of them
 * is a line somebody could delete in good faith while "making the feature work
 * properly".
 *
 * The first sync case is the expensive one. `folder.last_sync_at` is null
 * exactly once per folder and that pass can be ninety days deep.
 */
"use strict";

jest.mock("../../src/jobs/queue", () => ({ enqueue: jest.fn(async () => ({})) }));

const fs = require("fs");
const path = require("path");
const { enqueue } = require("../../src/jobs/queue");
const ocrQueue = require("../../src/modules/mail/assist/ocr.enqueue");

function fakeClient(answers = []) {
  const calls = [];
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      const hit = answers.find((a) => a.match.test(text));
      return { rows: hit ? hit.rows : [] };
    },
  };
}

const ON = { match: /feature_key = 'mail\.ocr'/, rows: [{ state: "on" }] };
const ATTACHMENTS = (...files) => ({
  match: /FROM email_attachment a/,
  rows: files.map((filename, i) => ({ email_attachment_id: `a-${i}`, filename })),
});
const CTX = { tenantMeta: { slug: "acme" }, env: "live" };
const call = (over = {}) => ({ messageId: "m-1", subject: "Notre facture", ctx: CTX, ...over });

beforeEach(() => jest.clearAllMocks());

/* ── It is enqueued at all ────────────────────────────────────────────────── */

describe("the worker is actually reachable", () => {
  test("a financial attachment is queued", async () => {
    const c = fakeClient([ON, ATTACHMENTS("facture_bollore.pdf")]);
    const out = await ocrQueue.forMessage(c, call());
    expect(out.queued).toBe(1);
    expect(enqueue).toHaveBeenCalledWith(
      "mail-ocr-extract",
      "extract",
      expect.objectContaining({ attachmentId: "a-0", tenantMeta: CTX.tenantMeta, env: "live" }),
      expect.anything(),
    );
  });

  test("one job per attachment, so the unit of retry is the unit of cost", async () => {
    const c = fakeClient([ON, ATTACHMENTS("facture.pdf", "recu.pdf", "cheque_1.jpg")]);
    expect((await ocrQueue.forMessage(c, call())).queued).toBe(3);
    expect(enqueue).toHaveBeenCalledTimes(3);
  });

  test("one attempt, because every retry is billable", async () => {
    const c = fakeClient([ON, ATTACHMENTS("facture.pdf")]);
    await ocrQueue.forMessage(c, call());
    expect(enqueue.mock.calls[0][3]).toMatchObject({ attempts: 1 });
    // A vendor that is down stays down for longer than three exponential
    // backoffs, and a FAILED row is visible in the review queue anyway.
  });
});

/* ── The four narrowings ──────────────────────────────────────────────────── */

describe("what is deliberately NOT extracted", () => {
  test("NOTHING during a first sync", async () => {
    const c = fakeClient([ON, ATTACHMENTS("facture.pdf")]);
    const out = await ocrQueue.forMessage(c, call({ isFirstSync: true }));
    // The single most expensive mistake available here: a 90-day backfill of a
    // busy mailbox, every invoice in it billed to a tenant who connected a
    // mailbox five minutes ago.
    expect(out).toEqual({ queued: 0, skipped: "first sync" });
    expect(enqueue).not.toHaveBeenCalled();
    expect(c.calls).toHaveLength(0);
  });

  test("nothing when mail.ocr is off, and it fails CLOSED", async () => {
    const off = fakeClient([{ match: /feature_key = 'mail\.ocr'/, rows: [{ state: "off" }] }]);
    expect((await ocrQueue.forMessage(off, call())).skipped).toBe("mail.ocr off");

    const missing = fakeClient([]);
    expect((await ocrQueue.forMessage(missing, call())).skipped).toBe("mail.ocr off");

    const broken = { query: async () => { throw new Error("relation feature_state missing"); } };
    expect((await ocrQueue.forMessage(broken, call())).skipped).toBe("mail.ocr off");
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("mail.ocr is its OWN switch, separate from mail.ai", async () => {
    const c = fakeClient([ON, ATTACHMENTS("facture.pdf")]);
    await ocrQueue.forMessage(c, call());
    // A tenant can reasonably want drafting and not want their scanned
    // invoices sent to a vision vendor. One flag for both would make that
    // choice unavailable.
    expect(c.calls[0].text).toMatch(/'mail\.ocr'/);
    expect(c.calls[0].text).not.toMatch(/'mail\.ai'/);
  });

  test("nothing that does not already look like a financial document", async () => {
    const c = fakeClient([ON, ATTACHMENTS("container_seal_photo.jpg", "signature.png")]);
    // A photo of a container seal has no fields to extract, and we would be
    // billed for finding that out.
    expect((await ocrQueue.forMessage(c, call({ subject: "photos" }))).queued).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("nothing already extracted — the query says so, not the caller", async () => {
    const c = fakeClient([ON, ATTACHMENTS("facture.pdf")]);
    await ocrQueue.forMessage(c, call());
    expect(c.calls[1].text).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM attachment_extraction/);
  });

  test("nothing with no stored bytes", async () => {
    const c = fakeClient([ON, ATTACHMENTS("facture.pdf")]);
    await ocrQueue.forMessage(c, call());
    expect(c.calls[1].text).toMatch(/a\.vault_id IS NOT NULL/);
  });

  test("nothing without a tenant to run it against", async () => {
    const c = fakeClient([ON]);
    expect((await ocrQueue.forMessage(c, call({ ctx: {} }))).skipped).toBe("no tenant context");
  });
});

/* ── It never breaks a sync ───────────────────────────────────────────────── */

describe("extraction is an enrichment, never a liability", () => {
  test("a dead queue does not fail the message", async () => {
    enqueue.mockRejectedValue(new Error("redis unreachable"));
    const c = fakeClient([ON, ATTACHMENTS("facture.pdf")]);
    await expect(ocrQueue.forMessage(c, call())).resolves.toEqual({ queued: 0 });
  });

  test("an unlistable attachment table does not fail the message", async () => {
    const c = {
      query: async (text) => {
        if (/feature_key = 'mail\.ocr'/.test(text)) return { rows: [{ state: "on" }] };
        throw new Error("relation attachment_extraction does not exist");
      },
    };
    await expect(ocrQueue.forMessage(c, call())).resolves.toMatchObject({ queued: 0 });
  });

  test("the ingest path swallows it too", () => {
    const svc = fs.readFileSync(
      path.resolve(__dirname, "../../src/modules/mail/mail/mail.service.js"), "utf8",
    );
    const at = svc.indexOf("ocrQueue.forMessage(");
    expect(at).toBeGreaterThan(-1);
    // A queue that is down must not stop a mailbox syncing.
    expect(svc.slice(at, at + 400)).toMatch(/\.catch\(/);
  });

  test("the sync handler passes the tenant through, or none of this can run", () => {
    const handler = fs.readFileSync(
      path.resolve(__dirname, "../../src/jobs/handlers/mail-sync.js"), "utf8",
    );
    expect(handler).toMatch(/tenantMeta,\s*env/);
  });

  test("the first-sync flag comes from the FOLDER, not from a guess", () => {
    const svc = fs.readFileSync(
      path.resolve(__dirname, "../../src/modules/mail/mail/mail.service.js"), "utf8",
    );
    expect(svc).toMatch(/isFirstSync: !folder\.last_sync_at/);
  });
});
