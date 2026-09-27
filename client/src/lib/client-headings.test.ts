import { describe, it, expect } from "vitest";
import { groupByFamily, resolveHeading, OTHER_HEADING } from "./client-headings";

const REG = [
  { code: "CUSTOMS_FORMALITIES", name_fr: "Formalités Douanières", name_en: "Customs Formalities", sort_order: 10 },
  { code: "PORT_TERMINAL", name_fr: "Frais Portuaires et de Terminal", name_en: "Port & Terminal Charges", sort_order: 40 },
];
const C = { client_heading_code: "CUSTOMS_FORMALITIES", client_heading_fr: "Formalités Douanières", client_heading_en: "Customs Formalities" };

describe("client headings on screen — the twin of the printed grouping", () => {
  it("splits a mixed family into disbursements and fees, disbursements first", () => {
    const fams = groupByFamily(
      [
        { ...C, is_disbursement: false, label: "Clearance fee" },
        { ...C, is_disbursement: true, label: "Duties" },
        { ...C, is_disbursement: true, label: "Gate pass" },
      ],
      REG,
    );
    expect(fams.map((f) => [f.heading.key, f.nature, f.mixed, f.lines.map((l) => l.index)])).toEqual([
      ["CUSTOMS_FORMALITIES", "disbursement", true, [1, 2]],
      ["CUSTOMS_FORMALITIES", "service", true, [0]],
    ]);
  });

  it("an override stored as a registry code resolves to that heading", () => {
    expect(resolveHeading({ ...C, client_heading: "PORT_TERMINAL" }, REG).key).toBe("PORT_TERMINAL");
  });

  it("free text is a family of its own; nothing at all is Other Charges", () => {
    expect(resolveHeading({ client_heading: "DAP Douala–Bangui" }, REG)).toMatchObject({ custom: true, en: "DAP Douala–Bangui" });
    expect(resolveHeading({}, REG)).toBe(OTHER_HEADING);
  });
});
