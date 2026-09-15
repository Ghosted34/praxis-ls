import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LeaderCard, LeaderGrid, monogram } from "@/components/site/leader-card";
import "@/lib/i18n";
import type { PublicLeader } from "@/lib/site-api";

/**
 * Leadership (§9.3).
 *
 * The assertions here are about the two failures this component can produce
 * that nobody would notice in review: a portrait that is not there rendering as
 * something, and a row of links a screen-reader user cannot tell apart.
 */

const LEADER = (over: Partial<PublicLeader> = {}): PublicLeader => ({
  id: "l1",
  name: "Timothée MASSOMBA",
  role: { fr: "Directeur général", en: "Chief Executive Officer" },
  bio: { fr: "Vingt ans dans le fret.", en: "Twenty years in freight." },
  photo_id: null,
  photo_variants: null,
  linkedin_url: null,
  ...over,
});

describe("monogram", () => {
  it("takes the first and last initials", () => {
    expect(monogram("Timothée MASSOMBA")).toBe("TM");
    expect(monogram("Awa Diallo Ndiaye")).toBe("AN");
  });

  it("takes one initial from a single name", () => {
    expect(monogram("Prince")).toBe("P");
  });

  it("does not split an accented character in half", () => {
    // `split("")` on "Émile" yields two UTF-16 code units for one grapheme, so
    // the first "letter" prints as a replacement character. `Array.from`
    // iterates code points.
    expect(monogram("Émile Fofana")).toBe("ÉF");
  });

  it("is empty for an empty name rather than throwing", () => {
    expect(monogram("")).toBe("");
    expect(monogram("   ")).toBe("");
  });
});

describe("the leader card (§9.3)", () => {
  it("renders a monogram, never a stock silhouette, when there is no portrait", () => {
    const { container } = render(<LeaderCard leader={LEADER()} />);
    expect(container.querySelector(".leader-monogram")?.textContent).toBe("TM");
    // N12: no image at all rather than a picture of somebody who is not this
    // person.
    expect(container.querySelector("img")).toBeNull();
  });

  it("emits a srcset only for the formats the document actually has", () => {
    const { container } = render(
      <LeaderCard
        leader={LEADER({
          photo_id: "doc-1",
          // WebP only — the AVIF encode failed, which the service records
          // truthfully rather than assuming a fixed ladder.
          photo_variants: { widths: [480, 960], formats: ["webp"] },
        })}
      />,
    );
    const sources = [...container.querySelectorAll("source")];
    expect(sources.map((s) => s.getAttribute("type"))).toEqual(["image/webp"]);
    // And only the widths that exist. A `srcset` naming 1600 would be a 404
    // per visitor, because the browser has already committed to its pick.
    expect(sources[0].getAttribute("srcSet") ?? sources[0].getAttribute("srcset")).toContain("480.webp 480w");
    expect(sources[0].getAttribute("srcSet") ?? sources[0].getAttribute("srcset")).not.toContain("1600");
  });

  it("emits no source at all when the document has no ladder", () => {
    const { container } = render(
      <LeaderCard leader={LEADER({ photo_id: "doc-1", photo_variants: null })} />,
    );
    // Safari treats an empty srcset as a candidate and then fails it, so the
    // `<source>` is omitted rather than emitted empty.
    expect(container.querySelectorAll("source")).toHaveLength(0);
    expect(container.querySelector("img")?.getAttribute("src")).toContain("doc-1");
  });

  it("names the person in the portrait's alt text", () => {
    render(<LeaderCard leader={LEADER({ photo_id: "doc-1" })} />);
    expect(screen.getByAltText(/Timothée MASSOMBA/)).toBeInTheDocument();
  });

  it("gives every LinkedIn link its own accessible name", () => {
    render(
      <LeaderGrid
        leaders={[
          LEADER({ id: "a", name: "Awa Diallo", linkedin_url: "https://www.linkedin.com/in/a" }),
          LEADER({ id: "b", name: "Paul Eyenga", linkedin_url: "https://www.linkedin.com/in/b" }),
        ]}
      />,
    );
    // Not two links called "LinkedIn". A screen-reader user listing the links
    // on this page has to be able to tell whose is whose.
    expect(screen.getByRole("link", { name: /Awa Diallo/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Paul Eyenga/ })).toBeInTheDocument();
  });

  it("opens an external profile with noopener AND noreferrer", () => {
    render(<LeaderCard leader={LEADER({ linkedin_url: "https://www.linkedin.com/in/a" })} />);
    const link = screen.getByRole("link", { name: /MASSOMBA/ });
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("puts an ordinary bio behind a native disclosure", () => {
    const { container } = render(<LeaderCard leader={LEADER()} />);
    // `<details>` is keyboard-operable and announced with no ARIA of ours,
    // which matters because this content arrives after paint.
    expect(container.querySelector("details")).toBeInTheDocument();
    expect(container.querySelector("summary")).toBeInTheDocument();
  });

  it("shows the featured message outright, with no disclosure to open", () => {
    // §9.1 calls the CEO message "the single most credible asset in the
    // programme". Hiding it behind a click would be hiding the one paragraph
    // the page exists to carry.
    const { container } = render(<LeaderCard featured leader={LEADER()} />);
    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByText("Twenty years in freight.")).toBeInTheDocument();
  });

  it("renders nothing at all for an empty tier", () => {
    // Not a heading over white space. An absence is not a claim.
    const { container } = render(<LeaderGrid leaders={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
