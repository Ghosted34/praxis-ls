"use strict";

/**
 * §5.8 criterion 1 — A RENDERED DOCUMENT CONTAINS A SCANNABLE QR.
 *
 * This is the visible half of the whole programme, and it is the assertion that
 * would have caught the original defect: `template.service` passed the renderer
 * a custom-scheme string with no hash in it, `kit.footer` printed that string as
 * TEXT, and no Praxis PDF has ever carried a QR image at all. Everything looked
 * wired — there was a `verify` parameter, a `show.qr` config flag, a footer
 * branch that read them — and nothing at the end of it resolved.
 *
 * So the test renders the real HTML through the real registry and looks for the
 * symbol, the code and the host. Reading the plumbing is what let the defect
 * survive; this reads the output.
 */

jest.mock("../../src/services/storage.service", () => ({
  put: jest.fn().mockResolvedValue({ key: "vault/x.pdf", public_url: "/media/vault/x.pdf", size: 10 }),
  get: jest.fn().mockRejectedValue(new Error("no logo")),
}));
jest.mock("../../src/services/documents/document.service", () => ({
  capture: jest.fn().mockResolvedValue({ doc_id: "doc-1" }),
}));

const templateSvc = require("../../src/modules/documents/template/template.service");
const kit = require("../../src/services/documents/templates/kit");
const verifyLink = require("../../src/services/signatures/verify-link");
const sigRepo = require("../../src/modules/vault/document_signature/document_signature.repo");

const CODE = "A4B7K92MXQ1P";

const SIGNATURE = {
  signature_id: "sig-1",
  entity_ref: "final_invoice:inv-1",
  doc_type: "FINAL_INVOICE",
  verify_code: CODE,
  revoked_at: null,
};

/**
 * The rendered document WITHOUT its stylesheet.
 *
 * `kit.shell` inlines the whole stylesheet into the HTML, and that stylesheet
 * legitimately contains `.foot-vfy` and a worked example of a grouped code in a
 * comment. A grep over the raw string therefore finds the verification block on
 * a document that does not have one — which is the assertion inverted, and it
 * cost this file a round. Everything here is a claim about what PRINTS.
 */
const body = (html) => String(html).replace(/<style>[\s\S]*?<\/style>/g, "");

/** A tenant connection that answers only what the render path asks it. */
const makeClient = () => ({
  query: async () => ({ rows: [] }),
});

afterEach(() => jest.restoreAllMocks());

describe("a signed document carries a real QR", () => {
  /*
   * `pdf.renderAndStore` is stubbed so the assertion is on the HTML the
   * renderer was HANDED. Letting it through would launch Chromium to prove a
   * string is present in a string — slow here, and a hard dependency on a
   * browser in a job that does not install one (ci-local lists the Chromium
   * download among the gates it cannot honestly run).
   */
  test("the HTML handed to the renderer carries an inline <svg> and the code", async () => {
    jest.spyOn(sigRepo, "listByRef").mockResolvedValue([SIGNATURE]);
    jest.spyOn(templateSvc, "loadRecord").mockResolvedValue(null);
    const pdf = require("../../src/services/pdf.service");
    let captured = "";
    jest.spyOn(pdf, "renderAndStore").mockImplementation(async (_c, { html }) => {
      captured = html;
      return { key: "k", public_url: "/u", doc_id: "doc-1", content_hash: "a".repeat(64) };
    });

    await templateSvc.generate(makeClient(), {
      docType: "FINAL_INVOICE", recordId: "inv-1", origin: "https://smartls.praxisls.com", actor: {},
    });

    const printed = body(captured);
    // The symbol, as INLINE SVG — not an <img>, not a data URI. Puppeteer
    // rasterises inline SVG at print resolution; a bitmap gets resampled.
    //
    // The element is authored at 22mm and the foot's CSS narrows it to 20mm:
    // one QR renderer, two homes, each sized where it lives (kit.verifyBlock).
    expect(printed).toMatch(/<svg[^>]*width="22mm"/);
    expect(printed).toMatch(/shape-rendering="crispEdges"/);
    expect(printed).not.toContain("<img");
    // The code, grouped, for someone who cannot scan it.
    expect(printed).toContain("A4B7-K92M-XQ1P");
    // And where to type it.
    expect(printed).toContain("smartls.praxisls.com");
  });

  test("the artifact hash is written BACK onto the signature after the render", async () => {
    // The ordering that makes verification possible: the verify code exists
    // before the render (so it can be inside the bytes), the artifact hash only
    // after (so it covers them). Two hashes, two moments, neither circular.
    jest.spyOn(sigRepo, "listByRef").mockResolvedValue([SIGNATURE]);
    jest.spyOn(templateSvc, "loadRecord").mockResolvedValue(null);
    const setArtifact = jest.spyOn(sigRepo, "setArtifact").mockResolvedValue(SIGNATURE);
    const pdf = require("../../src/services/pdf.service");
    jest.spyOn(pdf, "renderAndStore").mockResolvedValue({
      key: "k", public_url: "/u", doc_id: "doc-9", content_hash: "b".repeat(64),
    });

    await templateSvc.generate(makeClient(), {
      docType: "FINAL_INVOICE", recordId: "inv-1", origin: "https://smartls.praxisls.com", actor: {},
    });

    expect(setArtifact).toHaveBeenCalledWith(expect.anything(), {
      id: "sig-1", documentVaultId: "doc-9", artifactHash: "b".repeat(64),
    });
  });

  test("a write-back failure does not lose the vaulted PDF", async () => {
    jest.spyOn(sigRepo, "listByRef").mockResolvedValue([SIGNATURE]);
    jest.spyOn(templateSvc, "loadRecord").mockResolvedValue(null);
    jest.spyOn(sigRepo, "setArtifact").mockRejectedValue(new Error("db gone"));
    const pdf = require("../../src/services/pdf.service");
    jest.spyOn(pdf, "renderAndStore").mockResolvedValue({
      key: "k", public_url: "/u", doc_id: "doc-9", content_hash: "c".repeat(64),
    });

    // The document exists and is vaulted by the time the write-back runs. The
    // consequence of a miss is narrow and self-healing: the portal reports the
    // artifact verdict as "not recorded" rather than wrongly.
    const out = await templateSvc.generate(makeClient(), {
      docType: "FINAL_INVOICE", recordId: "inv-1", origin: "https://smartls.praxisls.com", actor: {},
    });
    expect(out.doc_id).toBe("doc-9");
  });
});

describe("an UNSIGNED document carries no QR", () => {
  test("no signature means no verification block", async () => {
    jest.spyOn(sigRepo, "listByRef").mockResolvedValue([]);
    jest.spyOn(templateSvc, "loadRecord").mockResolvedValue(null);
    const pdf = require("../../src/services/pdf.service");
    let captured = "";
    jest.spyOn(pdf, "renderAndStore").mockImplementation(async (_c, { html }) => {
      captured = html;
      return { key: "k", public_url: "/u", doc_id: "d", content_hash: "d".repeat(64) };
    });

    await templateSvc.generate(makeClient(), {
      docType: "FINAL_INVOICE", recordId: "inv-2", origin: "https://smartls.praxisls.com", actor: {},
    });

    // Honest, not a gap: there is nothing to verify, and a symbol that resolves
    // to a 404 teaches readers that the tenant's QR codes do not work.
    expect(body(captured)).not.toContain("foot-vfy");
    expect(body(captured)).not.toContain("<svg");
  });

  test("a REVOKED signature is not printed on a fresh render either", async () => {
    // The portal keeps answering "revoked" for a PDF printed before the
    // revocation — that is why the row survives. A document rendered AFTER it
    // must not advertise a credential the tenant has withdrawn.
    jest.spyOn(sigRepo, "listByRef").mockResolvedValue([{ ...SIGNATURE, revoked_at: new Date() }]);
    jest.spyOn(templateSvc, "loadRecord").mockResolvedValue(null);
    const pdf = require("../../src/services/pdf.service");
    let captured = "";
    jest.spyOn(pdf, "renderAndStore").mockImplementation(async (_c, { html }) => {
      captured = html;
      return { key: "k", public_url: "/u", doc_id: "d", content_hash: "e".repeat(64) };
    });

    await templateSvc.generate(makeClient(), {
      docType: "FINAL_INVOICE", recordId: "inv-3", origin: "https://smartls.praxisls.com", actor: {},
    });
    expect(body(captured)).not.toContain("A4B7-K92M-XQ1P");
    expect(body(captured)).not.toContain("<svg");
  });
});

describe("the seal and the foot agree, because they share one renderer", () => {
  test("both print the same grouped code from the same context", async () => {
    const ctx = await verifyLink.verifyContext(null, { code: CODE, slug: "smartls" });
    const seal = kit.sealBlock({
      forParty: "SMART LOGISTICS SARL", signerName: "Jean Mbarga", signedAt: "2026-08-20 14:35 WAT",
      method: "Verified by email code", code: ctx.code, qrSvg: ctx.qrSvg,
    }, { language: "en" });
    const foot = kit.footer({ legal_name: "Smart Logistics SARL" }, { show: { qr: true }, language: "en" }, ctx);

    expect(seal).toContain("A4B7-K92M-XQ1P");
    expect(foot).toContain("A4B7-K92M-XQ1P");
    expect(seal).toContain('class="vfy"');
    expect(foot).toContain('class="vfy"');
  });

  test("the seal still prints no verdict and no IP", () => {
    // §3.12's hard rules. A static PDF cannot know it is valid — validity
    // depends on amendment and revocation, both of which happen after printing.
    const seal = kit.sealBlock({
      forParty: "X", signerName: "Y", signedAt: "now", method: "Verified by email code",
      code: CODE, qrSvg: "<svg></svg>",
    }, { language: "en" });
    expect(seal).not.toMatch(/VALID|VALIDE|✓/);
    expect(seal).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
  });
});
