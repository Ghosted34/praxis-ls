import { describe, expect, it } from "vitest";
import { moveBlock, nudge, type Layout } from "./letterhead-layout";

const p = (id: string, row: number, col = 0, order = 0) => ({ id, row, col, order, span: 12 });

// The footer as it ships: every block stacked in row 0, column 0.
const base = (): Layout => ({
  version: 1,
  header: [p("logo", 0, 0, 0), p("company_name", 0, 5, 0), p("rule", 2, 0, 0)],
  footer: [p("identifiers", 0, 0, 0), p("payment", 0, 0, 1), p("footer_note", 0, 0, 2)],
});
const ids = (list: { id: string; order?: number }[]) =>
  [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((x) => x.id);

describe("letterhead layout (meeting 5 — the bank block would not move down)", () => {
  it("down moves the payment block past the next block in its stack", () => {
    const next = nudge(base(), "payment", 1);
    expect(ids(next.footer)).toEqual(["identifiers", "footer_note", "payment"]);
  });

  it("down from the bottom of the stack gives it a row of its own", () => {
    const once = nudge(nudge(base(), "payment", 1), "payment", 1);
    const pay = once.footer.find((x) => x.id === "payment")!;
    expect(pay.row).toBe(1);
  });

  it("up from the footer's top walks into the header", () => {
    const next = nudge(base(), "identifiers", -1);
    expect(next.header.map((x) => x.id)).toContain("identifiers");
    expect(next.footer.map((x) => x.id)).not.toContain("identifiers");
  });

  it("a drop lands in the zone it was dropped on, at the bottom of the cell", () => {
    const next = moveBlock(base(), "payment", { zone: "header", row: 2, col: 0 });
    const pay = next.header.find((x) => x.id === "payment")!;
    expect(pay.row).toBe(2);
    expect(pay.order).toBe(1);
    expect(next.footer.map((x) => x.id)).not.toContain("payment");
  });
});
