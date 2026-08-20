"use strict";

const { extract, iso6346Valid } = require("../../src/modules/mail/binding/binding.extract");

describe("ISO 6346 check digit", () => {
  test("CSQU3054383 is a known-valid container", () => {
    expect(iso6346Valid("CSQU3054383")).toBe(true);
  });
  test("a wrong check digit produces no suggestion", () => {
    expect(iso6346Valid("CSQU3054380")).toBe(false);
  });
  test("a short token is refused", () => {
    expect(iso6346Valid("ABCD123")).toBe(false);
  });
});

describe("extract", () => {
  const world = {
    dossiers: [{ dossier_id: "d1", ref: "SLAS-2026-0042", container_no: "CSQU3054383", bl_awb: "123-45678901" }],
    invoices: [{ invoice_id: "i1", doc_number: "INV-2026-0311" }],
    contacts: [{ email: "ops@maersk.cm", entity_ref: "client:c1", label: "Maersk" }],
    domains: [{ domain: "agent.net", entity_ref: "client:c2", label: "Shared agent" }],
  };

  test("a dossier ref in the subject is 0.97 and does not invent a binding", () => {
    const s = extract({ subject: "Re: SLAS-2026-0042 demurrage" }, world);
    const hit = s.find((x) => x.signal === "DOSSIER_REF");
    expect(hit).toMatchObject({ entity_ref: "dossier:d1", confidence: 0.97, matched_text: "SLAS-2026-0042" });
  });

  test("a container that fails the check digit produces no CONTAINER_NO suggestion", () => {
    const s = extract({ subject: "CSQU3054380 sitting at the gate" }, world);
    expect(s.filter((x) => x.signal === "CONTAINER_NO")).toHaveLength(0);
  });

  test("a valid container that resolves to a dossier is 0.90", () => {
    const s = extract({ subject: "CSQU3054383 arrived" }, world);
    expect(s.find((x) => x.signal === "CONTAINER_NO")).toMatchObject({
      entity_ref: "dossier:d1", confidence: 0.9,
    });
  });

  test("quoted history is down-weighted", () => {
    const s = extract({
      body_text: "Thanks.\n> Please quote SLAS-2026-0042",
    }, world);
    const hit = s.find((x) => x.signal === "DOSSIER_REF");
    expect(hit.confidence).toBeLessThan(0.97);
    expect(hit.confidence).toBe(0.582);
  });

  test("sender domain is deliberately weak (0.55)", () => {
    const s = extract({ from_address: "x@agent.net" }, world);
    expect(s.find((x) => x.signal === "SENDER_DOMAIN").confidence).toBe(0.55);
  });

  test("exact sender address is 0.85", () => {
    const s = extract({ from_address: "ops@maersk.cm" }, world);
    expect(s.find((x) => x.signal === "SENDER_ADDRESS").confidence).toBe(0.85);
  });

  test("an already-bound thread inherits at 0.99", () => {
    const s = extract({ subject: "hello" }, { existingBinding: { entity_ref: "client:c1", entity_label: "Maersk" } });
    expect(s[0]).toMatchObject({ signal: "THREAD_HISTORY", confidence: 0.99, entity_ref: "client:c1" });
  });
});
