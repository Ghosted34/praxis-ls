import { describe, it, expect } from "vitest";
import { dictLabel } from "./dict-label";

describe("dictLabel — a dictionary line in the reader's language", () => {
  const both = { label_en: "Additional Code AEC", label_fr: "Code Additionnel AEC", code: "#D001" };
  it("reads French to a French reader and English to everyone else", () => {
    expect(dictLabel(both, "fr")).toBe("Code Additionnel AEC");
    expect(dictLabel(both, "fr-FR")).toBe("Code Additionnel AEC");
    expect(dictLabel(both, "en")).toBe("Additional Code AEC");
  });
  it("falls back to the other language, then the code — never to nothing", () => {
    expect(dictLabel({ label_fr: "Frais", label_en: null }, "en")).toBe("Frais");
    expect(dictLabel({ label_en: "Fee", label_fr: "  " }, "fr")).toBe("Fee");
    expect(dictLabel({ code: "#E004" }, "fr")).toBe("#E004");
  });
});
