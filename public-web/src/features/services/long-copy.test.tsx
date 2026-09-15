import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LongCopy, splitSections, headingId } from "./long-copy";

/**
 * The one that matters is "collapsed still ships".
 *
 * Progressive disclosure on a page whose whole purpose is to be indexed is only
 * safe while the folded text is in the served HTML. React that rendered open
 * sections only would look identical in a screenshot and quietly delete most of
 * an eleven-thousand-character page from every crawler — so it is pinned here
 * rather than left to the next person's judgement.
 */

const STRUCTURED = [
  "An opening paragraph before any heading.",
  "",
  "## From Origin Pickup to Airport",
  "",
  "A successful international air shipment begins long before the airport.",
  "",
  "## Export Documentation and Customs",
  "",
  "International air freight requires accurate documentation.",
  "",
  "## Destination Handling and Final Delivery",
  "",
  "When the aircraft arrives, the shipment still has stages to complete.",
].join("\n");

describe("splitSections", () => {
  it("splits on h2 only, keeping the intro separate", () => {
    const { intro, sections } = splitSections(STRUCTURED);
    expect(intro).toBe("An opening paragraph before any heading.");
    expect(sections.map((s) => s.title)).toEqual([
      "From Origin Pickup to Airport",
      "Export Documentation and Customs",
      "Destination Handling and Final Delivery",
    ]);
  });

  it("leaves h3 inside the section it belongs to", () => {
    const { sections } = splitSections("## Top\nbody\n### Sub\nmore");
    expect(sections).toHaveLength(1);
    expect(sections[0].body).toContain("### Sub");
  });

  it("does not treat a ## inside a fenced block as a heading", () => {
    const { sections } = splitSections("## Real\n```\n## not a heading\n```\n");
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("Real");
  });

  it("derives an ASCII anchor from the heading text, not its position", () => {
    // A shared link has to survive the author inserting a section above it.
    expect(headingId("Opérations à destination", 4)).toBe(
      "s-operations-a-destination",
    );
    expect(headingId("From Origin Pickup to Airport", 0)).toBe(
      "s-from-origin-pickup-to-airport",
    );
  });
});

describe("LongCopy", () => {
  it("keeps every collapsed section in the DOM — the SEO guarantee", () => {
    const { container } = render(<LongCopy text={STRUCTURED} />);

    // Two of the three sections are shut...
    const details = Array.from(container.querySelectorAll("details"));
    expect(details).toHaveLength(3);
    expect(details.filter((d) => d.open)).toHaveLength(1);

    // ...and every word is still served.
    expect(container.textContent).toContain(
      "International air freight requires accurate documentation.",
    );
    expect(container.textContent).toContain(
      "When the aircraft arrives, the shipment still has stages to complete.",
    );
  });

  it("gives the page a real heading outline", () => {
    render(<LongCopy text={STRUCTURED} />);
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual([
      "From Origin Pickup to Airport",
      "Export Documentation and Customs",
      "Destination Handling and Final Delivery",
    ]);
    // The hero owns the only h1 (N10).
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("offers a contents list that opens the section it jumps to", async () => {
    const user = userEvent.setup();
    const { container } = render(<LongCopy text={STRUCTURED} />);

    // i18n is not booted in unit tests, so `t()` yields the key. That the key
    // exists in BOTH languages is `npm run check:i18n`'s job, not this test's.
    const nav = screen.getByRole("navigation", {
      name: "site.servicesPage.onThisPage",
    });
    const link = within(nav).getByRole("link", {
      name: "Export Documentation and Customs",
    });
    // A real href, so it works shared and without JavaScript.
    expect(link.getAttribute("href")).toBe("#s-export-documentation-and-customs");

    const target = container.querySelector<HTMLDetailsElement>(
      "#s-export-documentation-and-customs",
    )!;
    expect(target.open).toBe(false);
    await user.click(link);
    expect(target.open).toBe(true);
  });

  it("shows no contents list below three sections — furniture, not navigation", () => {
    render(<LongCopy text={"## One\nbody\n\n## Two\nbody"} />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("leaves short unstructured copy exactly as it was", () => {
    const plain = "One paragraph.\n\nTwo paragraphs.";
    const { container } = render(<LongCopy text={plain} />);
    // No folds invented for copy that does not need them.
    expect(container.querySelectorAll("details")).toHaveLength(0);
    expect(container.textContent).toContain("Two paragraphs.");
  });

  it("folds long unstructured copy without inventing headings for it", () => {
    // Every seeded page is in this state: real prose, no `##` anywhere. It may
    // get a fold; it must never get a heading the tenant did not write.
    const paras = Array.from({ length: 8 }, (_, i) => `Paragraph number ${i + 1}.`);
    const { container } = render(<LongCopy text={paras.join("\n\n")} />);

    expect(container.querySelectorAll("details")).toHaveLength(1);
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    // Folded, but still served.
    expect(container.textContent).toContain("Paragraph number 8.");
  });
});
