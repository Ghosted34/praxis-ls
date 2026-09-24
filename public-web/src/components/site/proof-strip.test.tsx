import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ProofStrip } from "@/components/site/proof-strip";
import { __resetSitePageCache } from "@/lib/use-site-page";
import { en } from "@/lib/i18n-dict";

/**
 * The band that is allowed not to exist.
 *
 * A figures strip is the one thing on a marketing page worth the most when it
 * is true and costing the most when it is not, so the properties asserted here
 * are the ones that keep it honest in a white-label product:
 *
 *   1. NOTHING IS INVENTED. Every visible word and number comes from the
 *      tenant's own blocks. There is no default set of figures, and a tenant
 *      who has authored none gets no band — not a row of dashes, not "coming
 *      soon", which is the same harm in the honest direction.
 *   2. THE SERVER'S NUMBER WINS. `site_content.service.js` has already replaced
 *      a bound stat's literal with the live value before it answers, and the
 *      renderer shows what it was handed rather than re-deciding.
 */

const page = (blocks: unknown[]) => ({ key: "home", blocks });

const counters = (items: unknown[]) => ({
  block_id: "b1",
  type: "stat_counters",
  content: { items },
});

/**
 * The three figures the HERO takes off the top of the list, so that whatever a
 * test puts after them is what reaches THIS band.
 *
 * ── WHY EVERY FIGURE TEST BELOW NOW GOES THROUGH THIS ─────────────────────
 *
 * The strip used to read the first four `stat_counters`. The hero now carries a
 * baseline rail of the first three and this band renders the remainder, so one
 * ordered list feeds two bands and no figure is printed twice in a screenful.
 *
 * That makes a one-item fixture a test of the HERO, not of this band — it would
 * assert an empty strip while passing for the wrong reason. Padding is the
 * smaller change than re-pointing each test: every assertion below is still
 * about the property it was written for (the server's number wins, the label
 * falls back FR↔EN, the band is a named landmark), and only the fixture moved.
 *
 * The padding is deliberately unlike anything a test asserts on, so a fixture
 * leaking into an expectation fails loudly instead of matching by accident.
 */
const promoted = (items: unknown[]) =>
  counters([
    { label: { fr: "Rail un", en: "Rail one" }, value: 901 },
    { label: { fr: "Rail deux", en: "Rail two" }, value: 902 },
    { label: { fr: "Rail trois", en: "Rail three" }, value: 903 },
    ...items,
  ]);

const chips = (items: unknown[]) => ({
  block_id: "b2",
  type: "stat_chips",
  content: { items },
});

let payload: unknown = null;
let status = 200;

const mount = async () => {
  const view = render(<ProofStrip />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return view;
};

beforeEach(() => {
  status = 200;
  payload = null;
  /* The home page is fetched ONCE per page load and shared — the hero, this
     strip, the how-it-works list and the quote band all override from the same
     row, and four private effects would be four requests for one page. The
     promise therefore lives in module scope, which survives between tests: the
     first case here 404s, and every case after it would read that cached null
     and render nothing. Resetting is what makes each `payload` above the answer
     to its own test rather than to whichever ran first. */
  __resetSitePageCache();
  // Settled on first render, so `CountUp` shows the figure rather than a frame
  // loop's opening zero — the same path a reader with reduced motion takes.
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("reduce"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify(
            status === 200
              ? { data: payload }
              : { error: { code: "NOT_FOUND", message: "no" } },
          ),
          { status, headers: { "content-type": "application/json" } },
        ),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("a tenant who has authored nothing", () => {
  it("gets no band at all when the home page does not exist", async () => {
    // The normal case for most tenants, and for every tenant on day one.
    status = 404;
    const { container } = await mount();
    expect(container).toBeEmptyDOMElement();
  });

  it("gets no band when the page exists but carries no stat block", async () => {
    // A published home page is not consent to publish figures. The band is the
    // blocks, and nothing else on the page stands in for them.
    payload = page([{ block_id: "b9", type: "hero", content: {} }]);
    const { container } = await mount();
    expect(container).toBeEmptyDOMElement();
  });
});

describe("a tenant who has", () => {
  it("shows the figure the server resolved, with its unit and its label", async () => {
    payload = page([
      promoted([
        {
          label: { fr: "Volume géré", en: "CBM managed" },
          unit: "CBM",
          value: 41850,
        },
      ]),
    ]);
    await mount();
    // Grouping is the reader's locale's business; the digits are ours.
    expect(screen.getByText(/41.?850/)).toBeInTheDocument();
    expect(screen.getByText("CBM")).toBeInTheDocument();
    expect(screen.getByText("CBM managed")).toBeInTheDocument();
  });

  it("names the band, so it is a landmark rather than a region", async () => {
    payload = page([
      promoted([{ label: { fr: "Dossiers", en: "Files" }, value: 12 }]),
    ]);
    await mount();
    expect(
      screen.getByRole("region", { name: en.site.proof.stripLabel }),
    ).toBeInTheDocument();
  });

  it("shows credentials without any figures at all", async () => {
    // The two blocks are independent: a tenant with memberships and no numbers
    // still has something to say on the first screen.
    payload = page([
      chips([
        { label: { fr: "Certification" }, value: { fr: "ISO 9001:2015" } },
      ]),
    ]);
    await mount();
    expect(screen.getByText("ISO 9001:2015")).toBeInTheDocument();
    expect(screen.getByText("Certification")).toBeInTheDocument();
  });

  it("leaves the hero's three alone, and draws only what is left", async () => {
    /* THE SPLIT, ASSERTED FROM THIS SIDE.
 
       Both halves matter and they fail in opposite directions. If this band
       started reading from the top again, a tenant's two headline numbers
       would appear twice within one screenful — which a visitor reads as the
       site being broken rather than as emphasis. If the slice were off by one,
       a figure would vanish from the page entirely, and nothing else in the
       tree would notice because both bands render "what they were given".
 
       Four figures in, one figure out, and it is the FOURTH. */
    payload = page([
      promoted([{ label: { fr: "Quatrième", en: "Fourth" }, value: 44 }]),
    ]);
    await mount();
    expect(screen.getByText("Fourth")).toBeInTheDocument();
    for (const promotedLabel of ["Rail one", "Rail two", "Rail three"]) {
      expect(screen.queryByText(promotedLabel)).toBeNull();
    }
  });

  it("is absent when the tenant authored exactly the three the hero takes", async () => {
    // Not an empty strip and not a hairline with nothing under it: the band
    // renders nothing at all, exactly as it does for a tenant with no figures.
    // This is the common case once a tenant has filled the rail.
    payload = page([promoted([])]);
    const { container } = await mount();
    expect(container).toBeEmptyDOMElement();
  });

  it("falls back to the other language rather than to a blank", async () => {
    // FR is required upstream and EN is optional, so a half-translated block is
    // the normal case — and blanking a label because of it would make the
    // published band worse than the untranslated one.
    payload = page([
      promoted([{ label: { fr: "Clients servis", en: null }, value: 40 }]),
    ]);
    await mount();
    expect(screen.getByText("Clients servis")).toBeInTheDocument();
  });
});
