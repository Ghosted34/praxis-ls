import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ProofStrip } from "@/components/site/proof-strip";
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
      counters([
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
      counters([{ label: { fr: "Dossiers", en: "Files" }, value: 12 }]),
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

  it("falls back to the other language rather than to a blank", async () => {
    // FR is required upstream and EN is optional, so a half-translated block is
    // the normal case — and blanking a label because of it would make the
    // published band worse than the untranslated one.
    payload = page([
      counters([{ label: { fr: "Clients servis", en: null }, value: 40 }]),
    ]);
    await mount();
    expect(screen.getByText("Clients servis")).toBeInTheDocument();
  });
});
