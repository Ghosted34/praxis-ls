import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AboutPage } from "@/features/about/about-page";
import "@/lib/i18n";

/**
 * The About page (§9.1), end to end against stubbed reads.
 *
 * ── THE TWO THINGS THIS FILE EXISTS FOR ───────────────────────────────────
 *
 * 1. §9.7: "Entity endpoint redaction re-verified **against the rendered
 *    page** — no statutory identifier reaches the DOM." `entity-network.test`
 *    asserts that of the component; this asserts it of the PAGE, with the
 *    payload arriving through `fetch` exactly as it does in a browser. The two
 *    together plus `site-public-redaction.test.js` cover the read, the
 *    component and the page.
 *
 * 2. THE EMPTY STATE, which is the state every new tenant is in. A tenant who
 *    has written nothing must get a short page, not a broken one — no headings
 *    over white space, no "coming soon" (N12), no error plate for what is
 *    simply an absence.
 */

const ABOUT = {
  headline: { fr: "Votre partenaire", en: "Your partner" },
  summary: { fr: "Transitaire à Douala.", en: "Freight forwarder in Douala." },
  mission: { fr: "Déplacer le fret correctement.", en: "To move cargo well." },
  vision: { fr: "", en: "" },
  principles: [{ label_fr: "Rigueur", label_en: "Rigour", text_en: "Every file checked." }],
  esg: {},
  timeline: [
    { year: 2021, label_fr: "Création", label_en: "Founded", text_en: "Douala." },
    { year: 2024, label_fr: "Licence", label_en: "First licence", text_en: "Brokerage." },
  ],
  founded_year: 2021,
  headquarters: "Douala, Cameroon",
  leaders: [
    {
      id: "l1",
      name: "Timothée MASSOMBA",
      role: { fr: "Directeur général", en: "Chief Executive Officer" },
      bio: { fr: "Vingt ans.", en: "Twenty years in freight." },
      photo_id: null,
      photo_variants: null,
      linkedin_url: null,
    },
  ],
};

const SECRETS = {
  rccm: "RCCM-CM-DLA-2021-B-9999",
  niu: "NIU-M012345678901X",
  permission: "Verbal OK from Awa at their marketing desk, 3 Feb 2026",
};

/** An entity row carrying fields the public endpoint does not send — what a
 *  widened allow-list would look like on the wire. */
const LEAKY_ENTITY = {
  id: "e1",
  code: "SLS",
  legal_name: "Smart Logistics & Services Ltd",
  trading_name: "Smart Logistics",
  country_code: "CM",
  coverage: [{ country_code: "CM", label_fr: "Cameroun", label_en: "Cameroon" }],
  summary: { fr: "Transitaire.", en: "Forwarder." },
  focus: [{ label_en: "Sea freight", mode: "sea" }],
  cover_id: null,
  cover_variants: null,
  leaders: [],
  rccm: SECRETS.rccm,
  niu: SECRETS.niu,
  legal_form: "SARL",
  share_capital: 250000000,
  governance: { board: ["A Person"] },
};

/** Route each public read to its own answer. A path nobody stubbed answers 404,
 *  so a request this page makes and this test did not declare fails loudly
 *  rather than silently resolving. */
function stubReads(answers: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(typeof input === "string" ? input : (input as Request).url ?? input);
      for (const [fragment, data] of Object.entries(answers)) {
        if (url.includes(fragment)) {
          return new Response(JSON.stringify({ data }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      }
      return new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), { status: 404 });
    }),
  );
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <AboutPage />
    </MemoryRouter>,
  );

afterEach(() => vi.unstubAllGlobals());

describe("the About page (§9.1)", () => {
  it("renders the group story, the anchor message and the timeline", async () => {
    stubReads({
      "/site/about": ABOUT,
      "/site/entities": [],
      "/site/partners": { partners: [], credentials: [] },
    });
    const { container } = renderPage();

    await waitFor(() => expect(screen.getByText("To move cargo well.")).toBeInTheDocument());
    expect(screen.getByText("Timothée MASSOMBA")).toBeInTheDocument();
    // The anchor's message is shown outright, not behind a disclosure.
    expect(screen.getByText("Twenty years in freight.")).toBeInTheDocument();
    expect(screen.getByText("Douala, Cameroon")).toBeInTheDocument();
    expect(screen.getByText("First licence")).toBeInTheDocument();
    expect(screen.getByText("Rigour")).toBeInTheDocument();

    /* "Founded" is deliberately asserted through the TIMELINE rather than by
       text alone, because it appears twice on a fully-populated page: once as
       the hero's own fact label (ours, translated) and once as this tenant's
       name for their 2021 entry (theirs, not translated). Both are correct;
       an unscoped `getByText` is what is wrong. */
    const timeline = container.querySelector(".timeline");
    expect(within(timeline as HTMLElement).getByText("Founded")).toBeInTheDocument();
    expect(within(timeline as HTMLElement).getByText("2021")).toBeInTheDocument();
  });

  it("orders the timeline by year, whatever order the tenant dragged it into", async () => {
    stubReads({
      "/site/about": {
        ...ABOUT,
        timeline: [
          { year: 2026, label_en: "Chad corridor" },
          { year: 2021, label_en: "Founded" },
          { year: 2024, label_en: "First licence" },
        ],
      },
      "/site/entities": [],
      "/site/partners": { partners: [], credentials: [] },
    });
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByText("Chad corridor")).toBeInTheDocument());
    // §9.1 draws this as depth, so a tenant who added their founding year after
    // three later entries must not get a timeline that runs backwards.
    const years = [...container.querySelectorAll(".timeline-year")].map((el) =>
      el.textContent?.replace(/\D/g, ""),
    );
    expect(years).toEqual(["2021", "2024", "2026"]);
  });

  it("drops a timeline entry with no year rather than guessing its position", async () => {
    stubReads({
      "/site/about": {
        ...ABOUT,
        timeline: [{ year: 2021, label_en: "Founded" }, { label_en: "Someday" }],
      },
      "/site/entities": [],
      "/site/partners": { partners: [], credentials: [] },
    });
    const { container } = renderPage();
    await waitFor(() => expect(container.querySelector(".timeline")).toBeTruthy());
    // A scrubbed timeline gives every entry a position; an entry with no date
    // has no position that is not invented.
    expect(screen.queryByText("Someday")).toBeNull();
    expect(container.querySelectorAll(".timeline-entry")).toHaveLength(1);
  });
});

describe("§9.7 — redaction, re-verified against the rendered page", () => {
  it("prints no statutory identifier, cap table or governance data", async () => {
    stubReads({
      "/site/about": ABOUT,
      "/site/entities": [LEAKY_ENTITY],
      "/site/partners": { partners: [], credentials: [] },
    });
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByText("Smart Logistics")).toBeInTheDocument());

    const dom = container.innerHTML;
    expect(dom).not.toContain(SECRETS.rccm);
    expect(dom).not.toContain(SECRETS.niu);
    expect(dom).not.toContain("250000000");
    expect(dom).not.toContain("SARL");
    expect(dom).not.toContain("A Person");
  });

  it("prints no partner's permission note", async () => {
    stubReads({
      "/site/about": ABOUT,
      "/site/entities": [],
      "/site/partners": {
        // The note is never in the payload — `publicPartners` builds an
        // explicit object. This is the second layer: even handed one, nothing
        // draws it.
        partners: [
          {
            id: "p1",
            name: "GIZ",
            kind: "client",
            logo_id: null,
            logo_variants: null,
            url: null,
            permission_note: SECRETS.permission,
          },
        ],
        credentials: [],
      },
    });
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByText("GIZ")).toBeInTheDocument());
    expect(container.innerHTML).not.toContain(SECRETS.permission);
    expect(container.innerHTML).not.toContain("permission_note");
  });
});

describe("the empty state every new tenant is in", () => {
  it("renders a short page, not a broken one, when the tenant has written nothing", async () => {
    stubReads({
      "/site/about": {
        headline: {}, summary: {}, mission: {}, vision: {},
        principles: [], esg: {}, timeline: [],
        founded_year: null, headquarters: null, leaders: [],
      },
      "/site/entities": [],
      "/site/partners": { partners: [], credentials: [] },
    });
    const { container } = renderPage();

    // The hero is the empty state: the page's own heading, always true.
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
    // And nothing else claims anything. No band heading over white space.
    expect(container.querySelectorAll(".timeline")).toHaveLength(0);
    expect(container.querySelectorAll(".leader-card")).toHaveLength(0);
    expect(container.querySelectorAll(".entity-card")).toHaveLength(0);
    expect(container.querySelectorAll(".credential-row")).toHaveLength(0);
    // N12: never a placeholder claim.
    expect(container.innerHTML).not.toMatch(/coming soon/i);
  });

  it("renders the same short page when every read fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
    // A marketing page that says "could not load our history" is worse than a
    // marketing page that is one section shorter.
    expect(container.innerHTML).not.toMatch(/failed|error|try again/i);
  });

  it("has exactly one h1", async () => {
    stubReads({
      "/site/about": ABOUT,
      "/site/entities": [LEAKY_ENTITY],
      "/site/partners": { partners: [], credentials: [] },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("Timothée MASSOMBA")).toBeInTheDocument());
    // §1.2 rule 3, and the one heading rule the whole app inherits from the
    // ERP's own audit rather than rediscovering.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
