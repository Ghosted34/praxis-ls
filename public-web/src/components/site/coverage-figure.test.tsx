import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CoverageFigure } from "@/components/site/coverage-figure";
import "@/lib/i18n";
import { en } from "@/lib/i18n-dict";
import type { PublicEntity } from "@/lib/site-api";

/**
 * §8.5's office/coverage figure.
 *
 * What is asserted here is mostly about RESTRAINT, because that is where this
 * component can go wrong. Everything it draws has to correspond to a row the
 * tenant wrote: one node per office, one node per named place, one line per
 * relationship they actually recorded. A figure that interpolates — a country
 * inferred from a code, a link drawn because two offices are near each other —
 * is the N12 failure on the page where a stranger is deciding whether to trust
 * this company with cargo.
 */

const ENTITY = (over: Partial<PublicEntity> = {}): PublicEntity => ({
  id: "e1",
  code: "SLS",
  legal_name: "Smart Logistics & Services Ltd",
  trading_name: "Smart Logistics",
  country_code: "CM",
  coverage: [
    { country_code: "CM", label_fr: "Cameroun", label_en: "Cameroon" },
    { country_code: "TD", label_fr: "Tchad", label_en: "Chad" },
  ],
  ...over,
});

describe("the coverage figure (§8.5)", () => {
  it("draws one line per relationship the tenant recorded", () => {
    const { container } = render(<CoverageFigure entities={[ENTITY()]} />);
    // One office, two covered places → two links. Never a link the data does
    // not carry.
    expect(container.querySelectorAll(".coverage-link")).toHaveLength(2);
    expect(container.querySelectorAll(".coverage-office")).toHaveLength(1);
  });

  it("names places in the tenant's own words, never from a country code", () => {
    render(<CoverageFigure entities={[ENTITY()]} />);
    expect(screen.getByText("Cameroon")).toBeInTheDocument();
    expect(screen.getByText("Chad")).toBeInTheDocument();
    // "CM" is a code, not a place name, and it must not reach the page.
    expect(screen.queryByText("CM")).toBeNull();
    expect(screen.queryByText("TD")).toBeNull();
  });

  it("drops a coverage row with no label rather than printing its code", () => {
    const { container } = render(
      <CoverageFigure
        entities={[
          ENTITY({
            coverage: [
              { country_code: "CM", label_fr: "Cameroun", label_en: "Cameroon" },
              { country_code: "GA", label_fr: "", label_en: "" },
            ],
          }),
        ]}
      />,
    );
    expect(container.querySelectorAll(".coverage-link")).toHaveLength(1);
    expect(screen.queryByText("GA")).toBeNull();
  });

  it("collapses a place two offices share into one node", () => {
    // Two lines into one node states "both of these cover Chad". Two nodes
    // would state that there are two Chads.
    const { container } = render(
      <CoverageFigure
        entities={[
          ENTITY(),
          ENTITY({
            id: "e2",
            trading_name: "Smart Logistics Chad",
            coverage: [{ country_code: "TD", label_fr: "Tchad", label_en: "Chad" }],
          }),
        ]}
      />,
    );
    expect(container.querySelectorAll(".coverage-office")).toHaveLength(2);
    // 2 places (Cameroon, Chad), not 3.
    expect(container.querySelectorAll(".coverage-node")).toHaveLength(4);
    expect(container.querySelectorAll(".coverage-link")).toHaveLength(3);
  });

  it("renders NOTHING when no entity is public-enabled", () => {
    // The default state for every new tenant (13787). No "our network" heading
    // over white space.
    const { container } = render(<CoverageFigure entities={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("says so plainly when there are offices but no published coverage", () => {
    // An office IS an answer to "where are you". A blank second column would
    // read as a page that failed to load half of itself.
    render(<CoverageFigure entities={[ENTITY({ coverage: [] })]} />);
    expect(
      screen.getByText(en.site.contact.coverageNone),
    ).toBeInTheDocument();
  });

  it("keeps every office and place as real text, not only as marks", () => {
    // The drawing is `role="img"` with one label; the content it draws is text
    // in the DOM, so a screen reader gets the facts rather than a description
    // of a picture of the facts.
    const { container } = render(<CoverageFigure entities={[ENTITY()]} />);
    const labels = container.querySelector(".coverage-labels") as HTMLElement;
    expect(within(labels).getByText("Smart Logistics")).toBeInTheDocument();
    expect(within(labels).getByText("Cameroon")).toBeInTheDocument();
  });

  it("falls back to the legal name when there is no trading name", () => {
    render(<CoverageFigure entities={[ENTITY({ trading_name: null })]} />);
    expect(
      screen.getByText("Smart Logistics & Services Ltd"),
    ).toBeInTheDocument();
  });
});
