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

/* ── the cover image (CE-24, audit §5) ──────────────────────────────────────
 *
 * The audit's finding, closed here: "There is no focused `entity-network`
 * test asserting that a non-null `cover_id` produces the expected
 * `<picture>`/`srcset` and that a missing derivative falls back safely."
 *
 * The ladder is what the ROW records, never a constant in the renderer: sharp
 * never upscales, so a 700 px cover has no 1600 rung, and a `srcset` naming
 * one would be a 404 per visitor per image — the browser has already
 * committed to the candidate it picked. Every test below feeds the component
 * a RECORDED ladder and asserts the DOM names exactly those rungs.
 */
describe("the entity card's cover (CE-24)", () => {
  const COVER_ID = "44444444-4444-4444-4444-444444444444";
  const url = (rest: string) => `/api/tenant/public/site/media/${COVER_ID}${rest}`;

  it("renders a <picture> with one <source> per recorded format, from recorded rungs only", () => {
    const { container } = render(
      <EntityNetwork
        entities={[
          ENTITY({
            cover_id: COVER_ID,
            cover_variants: { widths: [480, 960], formats: ["avif", "webp"] },
          }),
        ]}
      />,
    );
    const picture = container.querySelector(".entity-cover picture");
    expect(picture).not.toBeNull();

    const sources = [...(picture?.querySelectorAll("source") || [])];
    expect(sources).toHaveLength(2);
    expect(sources[0]).toHaveAttribute("type", "image/avif");
    expect(sources[0]).toHaveAttribute(
      "srcset",
      `${url("/480.avif")} 480w, ${url("/960.avif")} 960w`,
    );
    expect(sources[1]).toHaveAttribute("type", "image/webp");
    expect(sources[1]).toHaveAttribute(
      "srcset",
      `${url("/480.webp")} 480w, ${url("/960.webp")} 960w`,
    );

    // The original is the <img> the sources sit over — the fallback a browser
    // that understands neither format paints, and the only URL that is always
    // valid because the serve route's owner join is the same condition that
    // published the id.
    const img = picture?.querySelector("img");
    expect(img).toHaveAttribute("src", url(""));
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
    // The company's own name, from our dictionary — never the tenant's prose.
    expect(img).toHaveAttribute("alt", "Smart Logistics");
  });

  it("omits a <source> entirely when the format was never written", () => {
    // A cover whose AVIF encoding failed on upload records webp only. An empty
    // srcset would be a candidate Safari commits to and then fails to load.
    const { container } = render(
      <EntityNetwork
        entities={[
          ENTITY({
            cover_id: COVER_ID,
            cover_variants: { widths: [480], formats: ["webp"] },
          }),
        ]}
      />,
    );
    const sources = [
      ...(container.querySelectorAll(".entity-cover picture source") || []),
    ];
    expect(sources).toHaveLength(1);
    expect(sources[0]).toHaveAttribute("type", "image/webp");
  });

  it("falls back to the original alone when the ladder is null", () => {
    // `public_media_variants` is null for a document uploaded before 13789
    // and for one whose derivatives all failed to encode. Both mean the same
    // thing to a renderer: serve the original.
    const { container } = render(
      <EntityNetwork
        entities={[ENTITY({ cover_id: COVER_ID, cover_variants: null })]}
      />,
    );
    const picture = container.querySelector(".entity-cover picture");
    expect(picture?.querySelectorAll("source")).toHaveLength(0);
    expect(picture?.querySelector("img")).toHaveAttribute("src", url(""));
  });

  it("draws no cover plate at all when there is no cover", () => {
    const { container } = render(
      <EntityNetwork entities={[ENTITY({ cover_id: null, cover_variants: null })]} />,
    );
    expect(container.querySelector(".entity-cover")).toBeNull();
    // The card itself still stands: a company with no photograph is not a
    // company with no card.
    expect(container.querySelectorAll(".entity-card")).toHaveLength(1);
  });
});

/* ── the addresses (Decision Q2, CE-28) ────────────────────────────────────
 *
 * The registered office is published by the same precedence the letterhead
 * uses; a second address only through the explicit marker and its label. The
 * DOM side of that contract: the canonical line is drawn under OUR label, an
 * operational line is drawn under the TENANT'S, and a label-less row — which
 * the server refuses — is skipped here too, so a widened payload cannot put
 * an uninterpretable address on the page.
 */
describe("the entity card's addresses (Q2, CE-28)", () => {
  it("shows the registered address under the registered-address label", () => {
    render(
      <EntityNetwork
        entities={[
          ENTITY({ registered_address: "1030 Avenue Douala Manga Bell, 00237 Douala, CM" }),
        ]}
      />,
    );
    expect(screen.getByText("Registered address")).toBeInTheDocument();
    expect(
      screen.getByText("1030 Avenue Douala Manga Bell, 00237 Douala, CM"),
    ).toBeInTheDocument();
  });

  it("omits the block entirely when no address is recorded", () => {
    render(<EntityNetwork entities={[ENTITY()]} />);
    expect(screen.queryByText("Registered address")).toBeNull();
  });

  it("shows an explicitly published second address under the tenant's own label", () => {
    render(
      <EntityNetwork
        entities={[
          ENTITY({
            registered_address: "1030 Avenue Douala Manga Bell, 00237 Douala, CM",
            other_addresses: [
              {
                label: { fr: "Bureau opérationnel", en: "Operations desk" },
                line: "12 Rue de la Gare, Yaoundé",
              },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("Operations desk")).toBeInTheDocument();
    expect(screen.getByText("12 Rue de la Gare, Yaoundé")).toBeInTheDocument();
  });

  it("never draws a second address a label did not vouch for", () => {
    // The belt behind the server's braces: 13963's CHECK makes the row below
    // impossible at the database, and a renderer that drew it anyway would
    // put a line on a public page that says nothing about what it is.
    const { container } = render(
      <EntityNetwork
        entities={[
          ENTITY({
            other_addresses: [
              { label: { fr: null, en: null }, line: "12 Rue de la Gare, Yaoundé" },
              { label: { fr: "", en: "" }, line: "Zone Industrielle" },
            ],
          }),
        ]}
      />,
    );
    expect(container.innerHTML).not.toContain("12 Rue de la Gare");
    expect(container.innerHTML).not.toContain("Zone Industrielle");
  });

  it("carries no address internals into the DOM, even when handed them", () => {
    // The server sends `{ label, line }` and nothing else; this is the DOM
    // twin of the serialised-body assertion in site-public-redaction.test.js.
    const leaky = {
      ...ENTITY(),
      other_addresses: [
        {
          address_id: "a-ops",
          type: "TRADING",
          is_public: true,
          public_label_fr: "Bureau",
          label: { fr: "Bureau opérationnel", en: "Operations desk" },
          line: "12 Rue de la Gare, Yaoundé",
        },
      ],
    } as unknown as PublicEntity;
    const { container } = render(<EntityNetwork entities={[leaky]} />);
    const dom = container.innerHTML;
    expect(dom).toContain("Operations desk");
    expect(dom).not.toMatch(/address_id|"TRADING"|is_public|public_label_fr/);
  });
});
