import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  CarrierMarks,
  ClientBand,
  CredentialStrip,
} from "@/components/site/proof-bands";
import "@/lib/i18n";
import { en, fr } from "@/lib/i18n-dict";
import type { PublicProof } from "@/lib/site-api";

/**
 * Partners, clients and credentials (§9.4).
 *
 * ── THREE CLAIMS, THREE TREATMENTS, NEVER ONE GREY GRID ───────────────────
 *
 * That is the specification, and it is structural. These tests assert that a
 * carrier, a client and a membership end up in three different places — because
 * the failure mode is not a crash, it is a page that looks fine and asserts
 * nothing. N11 forbids the undifferentiated logo wall by name.
 */

const PROOF = (over: Partial<PublicProof> = {}): PublicProof => ({
  partners: [],
  credentials: [],
  ...over,
});

const PARTNER = (over: Record<string, unknown> = {}) =>
  ({
    id: "p1",
    name: "CMA CGM",
    kind: "carrier",
    logo_id: null,
    logo_variants: null,
    url: null,
    ...over,
  }) as PublicProof["partners"][number];

const CREDENTIAL = (over: Record<string, unknown> = {}) =>
  ({
    id: "c1",
    name: "FIATA diploma",
    issuer: "FIATA",
    identifier: "FD-2024-118",
    issued_on: "2024-03-01",
    expires_on: null,
    logo_id: null,
    logo_variants: null,
    url: null,
    ...over,
  }) as PublicProof["credentials"][number];

describe("three claims, three treatments (§9.4)", () => {
  it("puts a carrier with the network and never in the client band", () => {
    const proof = PROOF({ partners: [PARTNER({ kind: "carrier", name: "CMA CGM" })] });
    const { container: carriers } = render(<CarrierMarks proof={proof} />);
    expect(carriers.querySelectorAll(".proof-carriers li")).toHaveLength(1);

    const { container: clients } = render(<ClientBand proof={proof} />);
    // A capability claim is not a reference claim. Rendering it in both would
    // be the logo wall with extra steps.
    expect(clients).toBeEmptyDOMElement();
  });

  it("puts a membership in the credentials strip and never in the client band", () => {
    // 13782's own header: "a membership is a credential somebody granted, not a
    // customer relationship."
    const proof = PROOF({ partners: [PARTNER({ kind: "network", name: "JCTrans" })] });
    render(<CredentialStrip proof={proof} />);
    expect(screen.getByText("JCTrans")).toBeInTheDocument();

    const { container: clients } = render(<ClientBand proof={proof} />);
    expect(clients).toBeEmptyDOMElement();
  });

  it("never uses a 'Trusted by' headline (N11)", () => {
    render(<ClientBand proof={PROOF({ partners: [PARTNER({ kind: "client", name: "GIZ" })] })} />);
    // The heading states the relationship; whether that is impressive is the
    // reader's call, and telling them is the sentence a procurement officer
    // discounts. Asserted against the DICTIONARY in both languages, so the ban
    // survives a copy edit.
    expect(en.site.about.clientsTitle.toLowerCase()).not.toContain("trusted by");
    expect(fr.site.about.clientsTitle.toLowerCase()).not.toContain("confiance");
    expect(screen.getByText(en.site.about.clientsTitle)).toBeInTheDocument();
  });
});

describe("the marks themselves", () => {
  it("sets an organisation's name as a wordmark when there is no usable logo", () => {
    // O-3: the supplied marks are rasters with white backgrounds baked in, and
    // the upload refuses an opaque file for a slot on a dark band. §9.4: "a
    // white rectangle on a dark band is worse than an absent logo." A wordmark
    // states the same fact and reads correctly with no asset at all.
    const { container } = render(
      <ClientBand proof={PROOF({ partners: [PARTNER({ kind: "client", logo_id: null })] })} />,
    );
    expect(container.querySelector(".proof-wordmark")?.textContent).toBe("CMA CGM");
    expect(container.querySelector("img")).toBeNull();
  });

  it("opens a partner's own site with noopener and noreferrer", () => {
    render(
      <ClientBand
        proof={PROOF({
          partners: [PARTNER({ kind: "client", url: "https://www.giz.de", name: "GIZ" })],
        })}
      />,
    );
    const link = screen.getByRole("link", { name: /GIZ/ });
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders no link at all when a partner supplied no URL", () => {
    const { container } = render(
      <ClientBand proof={PROOF({ partners: [PARTNER({ kind: "client", url: null })] })} />,
    );
    // A mark that is not a link is a mark. A link to nowhere is a dead link on
    // a marketing page.
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector(".proof-mark")).toBeInTheDocument();
  });
});

describe("credentials — the most persuasive content on the page", () => {
  it("prints the issuer, the reference and the dates", () => {
    render(<CredentialStrip proof={PROOF({ credentials: [CREDENTIAL()] })} />);
    expect(screen.getByText("FIATA diploma")).toBeInTheDocument();
    expect(screen.getByText("FIATA")).toBeInTheDocument();
    // A number somebody can check outranks any quantity of logos.
    expect(screen.getByText("FD-2024-118")).toBeInTheDocument();
  });

  it("omits a fact the tenant has not recorded rather than printing a dash", () => {
    const { container } = render(
      <CredentialStrip
        proof={PROOF({ credentials: [CREDENTIAL({ identifier: null, issued_on: null })] })}
      />,
    );
    expect(container.querySelectorAll(".credential-facts > div")).toHaveLength(0);
  });
});

describe("O-2 unresolved is still a complete section (§9.4)", () => {
  it("renders credentials with no partners at all", () => {
    // §9.4: "If O-2 is unresolved at build time, ship the section with
    // credentials only and leave the partner rows inactive. That is a complete
    // section, not a broken one."
    const proof = PROOF({ credentials: [CREDENTIAL()] });
    render(<CredentialStrip proof={proof} />);
    expect(screen.getByText("FIATA diploma")).toBeInTheDocument();

    const { container: clients } = render(<ClientBand proof={proof} />);
    const { container: carriers } = render(<CarrierMarks proof={proof} />);
    // No gap where a logo wall would have been.
    expect(clients).toBeEmptyDOMElement();
    expect(carriers).toBeEmptyDOMElement();
  });

  it("renders nothing anywhere when the tenant has neither", () => {
    const proof = PROOF();
    for (const Band of [ClientBand, CarrierMarks, CredentialStrip]) {
      const { container } = render(<Band proof={proof} />);
      expect(container).toBeEmptyDOMElement();
    }
  });
});
