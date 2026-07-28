/** Unit tests for the template resolver + doc_type registry (GAP_FIXES_PLAN §5.1/§5.2). */
"use strict";

// Isolate the resolver from env/storage/DB so the suite is hermetic.
jest.mock("../config/env", () => ({ config: {} }));
jest.mock("./storage.service", () => ({
  put: async (buffer, { key }) => ({ key, public_url: "/media/" + key, size: buffer.length, content_type: "application/pdf" }),
  get: async () => Buffer.from("PDF"),
}));
jest.mock("./documents/document.service", () => ({ capture: async () => ({ doc_id: "d1" }) }));

const pdf = require("./pdf.service");
const { assertDocType, isDocType } = require("../modules/vault/document_vault/document_vault.types");

// A fake tenant client whose `setting` lookup returns whatever we stage.
function fakeClient(template) {
  return {
    query: async (_sql, params) => {
      // getSetting: SELECT value FROM setting WHERE section=$1 AND key=$2
      if (params && params[0] === "document_template") {
        return { rows: template === undefined ? [] : [{ value: template }] };
      }
      // renderAndStore -> documents.capture -> repo.getByRef (SELECT ... LIMIT 1)
      // and the eventual INSERT/UPDATE. Return empty so capture takes the insert path.
      return { rows: [] };
    },
  };
}

describe("doc_type registry", () => {
  test("known types pass, null passes (placeholder), unknown throws", () => {
    expect(assertDocType("FINAL_INVOICE")).toBe("FINAL_INVOICE");
    expect(assertDocType(null)).toBeNull();
    expect(isDocType("QUOTATION")).toBe(true);
    expect(() => assertDocType("NOPE")).toThrow(/Unknown doc_type/);
  });
});

describe("interpolate", () => {
  test("resolves nested paths and escapes HTML", () => {
    const out = pdf.interpolate("Hi {{client.name}} <{{amount}}>", { client: { name: "A&B" }, amount: 10 });
    expect(out).toBe("Hi A&amp;B <10>");
  });
  test("missing values render empty", () => {
    expect(pdf.interpolate("x{{nope}}y", {})).toBe("xy");
  });
});

describe("cssVarsBlock", () => {
  test("builds :root block, ignores non-objects", () => {
    expect(pdf.cssVarsBlock({ brand: "#123", pad: "8px" })).toBe("<style>:root{--brand: #123; --pad: 8px;}</style>");
    expect(pdf.cssVarsBlock(null)).toBe("");
    expect(pdf.cssVarsBlock([1, 2])).toBe("");
  });
});

describe("renderDocType template contract", () => {
  const base = { docType: "FINAL_INVOICE", entityRef: "invoice:1", key: "t/doc.pdf", data: {}, render: async () => Buffer.from("PDF") };

  test("rejects unknown doc_type before touching settings", async () => {
    await expect(pdf.renderDocType(fakeClient(), { ...base, docType: "BOGUS" })).rejects.toMatchObject({ code: "UNKNOWN_DOC_TYPE" });
  });

  test("no template configured -> NOT_CONFIGURED", async () => {
    await expect(pdf.renderDocType(fakeClient(undefined), base)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });

  test("draft template refuses to render", async () => {
    await expect(pdf.renderDocType(fakeClient({ name: "Inv", status: "draft", body_html: "<p>x</p>" }), base))
      .rejects.toMatchObject({ code: "TEMPLATE_NOT_PUBLISHED", status: 409 });
  });

  test("published template renders + captures", async () => {
    const out = await pdf.renderDocType(
      fakeClient({ name: "Inv", status: "published", body_html: "<h1>{{title}}</h1>", css_vars: { brand: "#000" } }),
      { ...base, data: { title: "Hello" } },
    );
    expect(out).toHaveProperty("content_hash");
    expect(out.verify).toMatch(/^praxis:\/\/verify\/invoice:1/);
  });
});
