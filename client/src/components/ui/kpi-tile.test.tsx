/**
 * KpiRow / KpiTile — the strip, and the 208px tile that is not allowed back.
 *
 * WHAT WENT WRONG. `KpiTile`'s stacked layout carried `basis-[13rem]`, and
 * `basis-*` compiles to `flex-basis` — a MAIN-SIZE property. Above `sm` the row
 * was `flex-row`, where that is a width and correct. Below `sm` it was
 * `flex-col`, where the same declaration is a HEIGHT: every tile was 208px tall
 * plus `flex-grow`, so a five-tile strip measured ~1100px on a 780px-tall phone
 * and the record's tab strip sat an entire screen below the fold.
 *
 * jsdom has no layout engine, so this cannot be asserted as a measurement. What
 * it CAN assert is the structure that produces the measurement — the row is a
 * grid below `md` and a divided flex row from `md` up, and no tile in the
 * compact branch carries a basis at all. That is the shape of the fix; a future
 * edit that reintroduces `flex-col` on the row fails here rather than on
 * somebody's phone.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { KpiRow, KpiTile } from "./kpi-tile";

function stubCompact() {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => vi.unstubAllGlobals());

const strip = (
  <KpiRow stack>
    <KpiTile label="Outstanding" value="30,000,000.00 XAF" />
    <KpiTile label="Overdue" value="0.00 XAF" hint="oldest 12/03/2026" />
  </KpiRow>
);

describe("KpiRow · the phone layout", () => {
  it("is a two-column grid below md, never a column of fixed-basis tiles", () => {
    stubCompact();
    const { container } = render(strip);
    const row = container.firstElementChild as HTMLElement;

    expect(row.className).toContain("grid-cols-2");
    // The defect in one assertion: `flex-col` is what turned the tile's
    // horizontal basis into a 208px height.
    expect(row.className).not.toContain("flex-col");
    for (const tile of Array.from(row.children)) {
      expect(tile.className).not.toContain("basis-");
    }
  });

  it("keeps both the figure and the word for it — no truncated label", () => {
    stubCompact();
    render(strip);
    expect(screen.getByText("30,000,000.00 XAF")).toBeInTheDocument();
    expect(screen.getByText("Outstanding")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("shows a chevron only on a tile that actually drills in", () => {
    stubCompact();
    const { container } = render(
      <KpiRow stack>
        <KpiTile label="Overdue" value="0.00 XAF" onClick={() => {}} />
        <KpiTile label="Credit available" value="5,000,000.00 XAF" />
      </KpiRow>,
    );

    const [drill, inert] = Array.from(
      container.firstElementChild!.children,
    ) as HTMLElement[];
    expect(drill.querySelector("svg")).not.toBeNull();
    expect(inert.querySelector("svg")).toBeNull();
  });
});

describe("KpiRow · the desktop strip", () => {
  it("is still the divided row it has always been", () => {
    const { container } = render(strip);
    const row = container.firstElementChild as HTMLElement;

    expect(row.className).toContain("divide-x");
    expect(row.className).not.toContain("grid-cols-2");
  });

  it("keeps the basis that gives each tile its fair share of the row", () => {
    const { container } = render(strip);
    const [first] = Array.from(
      container.firstElementChild!.children,
    ) as HTMLElement[];
    expect(first.className).toContain("basis-[13rem]");
  });
});

describe("KpiTile", () => {
  it("is a real button when it drills in, and inert when it does not", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <KpiRow>
        <KpiTile label="Overdue" value="3" onClick={onClick} />
        <KpiTile label="Credit available" value="5" />
      </KpiRow>,
    );

    await user.click(screen.getByRole("button", { name: "Open Overdue" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Credit available/ })).toBeNull();
  });

  it("carries the default accent on a desktop tile", () => {
    const { container } = render(
      <KpiRow stack>
        <KpiTile label="Overdue" value="3" />
      </KpiRow>,
    );
    const tile = container.querySelector("div > div") as HTMLElement;
    // The desktop strip's tile IS the row's segment: no border of its own.
    expect(tile.className).not.toContain("border-l-[3px]");
  });
});

describe("KpiTile · the phone card", () => {
  it("marks a figure as DATA with the brand-blue edge, not with the action orange", () => {
    stubCompact();
    const { container } = render(
      <KpiRow stack>
        <KpiTile label="Outstanding" value="3" />
      </KpiRow>,
    );
    const tile = container.firstElementChild!.firstElementChild as HTMLElement;

    expect(tile.className).toContain("border-l-[3px]");
    expect(tile.className).toContain("border-l-brand-blue");
    // A tile is not a button, whatever colour it wears: orange on this screen
    // means "you can press this".
    expect(tile.tagName).not.toBe("BUTTON");
  });

  it("keeps a semantic tone meaning what it means", () => {
    stubCompact();
    const { container } = render(
      <KpiRow stack>
        <KpiTile label="Overdue" value="3" tone="bad" />
      </KpiRow>,
    );
    const tile = container.firstElementChild!.firstElementChild as HTMLElement;
    expect(tile.className).toContain("border-l-[rgb(var(--bad))]");
    expect(tile.className).not.toContain("border-l-brand-blue");
  });
});
