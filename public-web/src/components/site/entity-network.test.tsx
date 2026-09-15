import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EntityNetwork, buildEntityGraph } from "@/components/site/entity-network";
import "@/lib/i18n";
import type { PublicEntity } from "@/lib/site-api";

/**
 * The entity network (§9.2).
 *
 * ── THE REDACTION ASSERTION IS THE IMPORTANT ONE ──────────────────────────
 *
 * §9.7: "Entity endpoint redaction re-verified **against the rendered page** —
 * no statutory identifier reaches the DOM."
 *
 * `tests/unit/site-public-redaction.test.js` already asserts that on the
 * serialised response body. This asserts it one layer further out, which is
 * what §9.7 actually asks for: a component handed a row that CARRIES those
 * fields — as a stray refactor of the endpoint's allow-list would produce —
 * must still not print them. The two together cover both directions: the server
 * does not send them, and the client would not draw them if it did.
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
  summary: { fr: "Transitaire à Douala.", en: "Freight forwarder in Douala." },
  focus: [{ label_fr: "Fret maritime", label_en: "Sea freight", mode: "sea" }],
  cover_id: null,
  cover_variants: null,
  leaders: [],
  ...over,
});

describe("buildEntityGraph", () => {
  it("joins two companies only where they share a country CODE", () => {
    const { links } = buildEntityGraph([
      ENTITY({ id: "a", country_code: "CM", coverage: [{ country_code: "TD" }] }),
      ENTITY({ id: "b", country_code: "TD", coverage: [] }),
    ]);
    expect(links).toEqual([{ from: 0, to: 1, shared: 1 }]);
  });

  it("draws no chord between companies that do not overlap", () => {
    // Two subsidiaries that share no ground are two nodes on a ring, which is
    // the truth about them. A network drawing that joined them anyway would be
    // asserting a relationship nobody recorded.
    const { links } = buildEntityGraph([
      ENTITY({ id: "a", country_code: "CM", coverage: [] }),
      ENTITY({ id: "b", country_code: "SN", coverage: [] }),
    ]);
    expect(links).toEqual([]);
  });

  it("counts a country once however many rows mention it", () => {
    const { nodes } = buildEntityGraph([
      ENTITY({
        country_code: "CM",
        coverage: [{ country_code: "CM" }, { country_code: "cm" }, { country_code: "TD" }],
      }),
    ]);
    // The entity's own country and its coverage rows are one set, case-folded.
    expect(nodes[0].codes.sort()).toEqual(["CM", "TD"]);
  });
});

describe("the rendered network (§9.2)", () => {
  it("prints no statutory identifier, even when handed one", () => {
    // The row below carries fields the public endpoint does not send. If a
    // refactor ever widened that allow-list, this is the test that catches it
    // in the DOM rather than in a code review.
    const leaky = {
      ...ENTITY(),
      rccm: "RCCM-CM-DLA-2021-B-9999",
      niu: "NIU-M012345678901X",
      legal_form: "SARL",
      share_capital: 250000000,
      governance: { board: ["A Person"] },
    } as unknown as PublicEntity;

    const { container } = render(<EntityNetwork entities={[leaky]} />);
    const dom = container.innerHTML;
    expect(dom).toContain("Smart Logistics");
    expect(dom).not.toContain("RCCM-CM-DLA-2021-B-9999");
    expect(dom).not.toContain("NIU-M012345678901X");
    expect(dom).not.toContain("250000000");
    expect(dom).not.toContain("SARL");
    expect(dom).not.toContain("A Person");
  });

  it("prints the tenant's own words for a place, never the country code", () => {
    render(<EntityNetwork entities={[ENTITY()]} />);
    expect(screen.getByText(/Cameroon/)).toBeInTheDocument();
    // "CM" is a code, not a place name. D-17's rule: our country names under
    // our borders is a claim about somebody else's market.
    expect(screen.queryByText("CM")).toBeNull();
  });

  it("shows the legal name under the trading name only when they differ", () => {
    const { container: differs } = render(<EntityNetwork entities={[ENTITY()]} />);
    expect(differs.querySelector(".entity-legal")?.textContent).toBe(
      "Smart Logistics & Services Ltd",
    );

    const { container: same } = render(
      <EntityNetwork entities={[ENTITY({ trading_name: "Smart Logistics & Services Ltd" })]} />,
    );
    // Otherwise the card says the same name twice, which reads as a bug.
    expect(same.querySelector(".entity-legal")).toBeNull();
  });

  it("draws no ring for a single company, and still renders its card", () => {
    // A ring with one node on it is a dot, and a dot presented as "our network"
    // is a claim the data does not support. One company is a perfectly good
    // About page.
    const { container } = render(<EntityNetwork entities={[ENTITY()]} />);
    expect(container.querySelector(".entity-stage")).toBeNull();
    expect(container.querySelectorAll(".entity-card")).toHaveLength(1);
  });

  it("makes the figure the single tab stop and every node untabbable", () => {
    // F-19: a roving `tabindex="0"` reads correctly and behaves wrongly —
    // Escape returns focus to the figure and the very next Tab lands back
    // inside the scene. Every node is programmatically focusable and out of the
    // tab sequence.
    const { container } = render(
      <EntityNetwork entities={[ENTITY({ id: "a" }), ENTITY({ id: "b", country_code: "TD" })]} />,
    );
    expect(container.querySelector("svg")).toHaveAttribute("tabindex", "0");
    const nodes = [...container.querySelectorAll(".entity-node")];
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) expect(n).toHaveAttribute("tabindex", "-1");
  });

  it("renders each entity's own leaders through the group renderer", () => {
    render(
      <EntityNetwork
        entities={[
          ENTITY({
            leaders: [
              {
                id: "l1",
                name: "Awa Diallo",
                role: { fr: "Directrice pays", en: "Country Manager" },
                bio: { fr: "", en: "" },
                photo_id: null,
                photo_variants: null,
                linkedin_url: null,
              },
            ],
          }),
        ]}
      />,
    );
    // §6.7: one table, one renderer, both tiers — so a country manager and a
    // group chief executive cannot end up looking like different kinds of
    // person.
    expect(screen.getByText("Awa Diallo")).toBeInTheDocument();
    expect(screen.getByText("Country Manager")).toBeInTheDocument();
  });

  it("renders nothing at all when no entity is public", () => {
    // `public_enabled` is off until somebody turns it on (13787), so this is
    // the default state for every new tenant.
    const { container } = render(<EntityNetwork entities={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
