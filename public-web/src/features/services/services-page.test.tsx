import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { BrandingProvider } from "@/app/branding";
import {
  ServicesIndexPage,
  ServiceDetailPage,
} from "@/features/services/services-page";
import { __resetServiceCache } from "@/lib/use-services";
import type { ServiceCard, ServiceProfile } from "@/lib/services-api";

/**
 * §8.2 — the services index and detail entrances.
 *
 * Both pages shipped as a bare `<h1>` on white, which §8's whole premise
 * forbids. What is asserted here is not "there is a band": it is the three
 * things that make the band worth having and that would revert silently.
 *
 *   · The index headline paints IMMEDIATELY. Every page in §8 opens with a
 *     staged headline and `.staged-word` starts invisible, so F-17's +691 ms is
 *     one missing prop away on every route.
 *   · The detail band is lit by THIS SERVICE'S mode, so the page a visitor
 *     lands on is recognisably the card they clicked.
 *   · The identity code is NOT painted in the mode colour on that band. It is
 *     11px type on carbon and `--mode-rail` measures 3.68:1 there — an AA
 *     failure on one service kind out of four, which is exactly the sort that
 *     survives a review of three screenshots.
 */

const CARD = (over: Partial<ServiceCard> = {}): ServiceCard => ({
  service_type_id: "st-1",
  slug_fr: "fret-maritime",
  slug_en: "sea-freight",
  name_fr: "Fret maritime",
  name_en: "Sea freight",
  mode: "SEA",
  enquiry_shape: "ROUTE",
  short_description_fr: "Import et export par conteneur.",
  short_description_en: "Container import and export.",
  claim_fr: null,
  claim_en: null,
  accent: "PRIMARY",
  cover_url: null,
  icon_url: null,
  has_video: false,
  sort_order: 1,
  published_month: null,
  ...over,
});

const PROFILE = (over: Partial<ServiceProfile> = {}): ServiceProfile =>
  ({
    ...CARD(),
    slug: "sea-freight",
    long_description_fr: null,
    long_description_en: null,
    highlights_fr: [],
    highlights_en: [],
    coverage_fr: null,
    coverage_en: null,
    meta_title_fr: null,
    meta_title_en: null,
    meta_description_fr: null,
    meta_description_en: null,
    gallery_urls: [],
    faq: [],
    related: [],
    alternates: { en: "sea-freight", fr: "fret-maritime" },
    ...over,
  }) as unknown as ServiceProfile;

/** Route the stub on URL: `BrandingProvider` fetches too, and a single Response
 *  instance is consumed by whichever request reads it first. */
function stub(index: ServiceCard[], profile: ServiceProfile | null) {
  return vi.fn(async (url: unknown) => {
    const u = String(url);
    const body = u.includes("/public/services/")
      ? { data: profile }
      : u.includes("/public/services")
        ? { data: { groups: [{ key: null, name_fr: null, name_en: null, icon: null, services: index }] } }
        : { data: {} };
    return new Response(JSON.stringify(body), {
      status: profile === null && u.includes("/public/services/") ? 404 : 200,
      headers: { "content-type": "application/json" },
    });
  });
}

async function mountIndex() {
  const view = render(
    <BrandingProvider>
      <MemoryRouter initialEntries={["/public/services"]}>
        <ServicesIndexPage />
      </MemoryRouter>
    </BrandingProvider>,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return view;
}

async function mountDetail(slug = "sea-freight") {
  const view = render(
    <BrandingProvider>
      <MemoryRouter initialEntries={[`/public/services/${slug}`]}>
        <Routes>
          <Route
            path="/public/services/:slug"
            element={<ServiceDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </BrandingProvider>,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return view;
}

beforeEach(() => {
  __resetServiceCache();
  vi.stubGlobal("fetch", stub([CARD()], PROFILE()));
});
afterEach(() => {
  vi.unstubAllGlobals();
  __resetServiceCache();
});

describe("the services index entrance (§8.2)", () => {
  it("opens with a designed band, not a bare heading on white", async () => {
    const { container } = await mountIndex();
    expect(container.querySelector(".band-hero")).not.toBeNull();
    const h1 = screen.getByRole("heading", { level: 1 });
    // The band contains the h1 — a band that sits beside the heading is not an
    // entrance, it is decoration next to one.
    expect(container.querySelector(".band-hero")?.contains(h1)).toBe(true);
  });

  it("paints the headline immediately, per F-17", async () => {
    const { container } = await mountIndex();
    const words = container.querySelectorAll(".staged-word");
    expect(words.length).toBeGreaterThan(0);
    /*
     * `paintImmediately` adds `.staged-word-lit`, which sets `opacity: 1` from
     * the first frame. Without it every word starts at `opacity: 0`, LCP waits
     * for the entrance, and the 691 ms F-17 measured comes back — on every one
     * of §8's six routes at once.
     */
    for (const w of words) expect(w.classList).toContain("staged-word-lit");
  });

  it("puts the grid at depth rung 2, one listener per pillar", async () => {
    const { container } = await mountIndex();
    // The stage carries the perspective; each card carries the rotation and its
    // own centre. A card with no `--cx` turns toward the middle of the grid
    // rather than toward the pointer, which looks like the effect working.
    expect(container.querySelectorAll(".tilt-stage")).toHaveLength(1);
    const card = container.querySelector(".tilt-card") as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.style.getPropertyValue("--cx")).not.toBe("");
  });
});

describe("the service detail entrance (§8.2)", () => {
  it("is lit by the service's own mode", async () => {
    const { container } = await mountDetail();
    const band = container.querySelector(".band-service") as HTMLElement;
    expect(band).not.toBeNull();
    expect(band.style.getPropertyValue("--mode")).toBe("var(--mode-sea)");
  });

  it("never paints the identity code in the mode colour", async () => {
    /*
     * The measurement, not a preference: 11px type on carbon is held to 4.5:1
     * and the four modes are 5.17 / 6.33 / 6.57 / 3.68. `--mode-rail` fails.
     * The mode still lights the band, where it is a wash and not type — and
     * `check:contrast` pins those four at the 3:1 non-text floor.
     */
    const { container } = await mountDetail();
    const code = container.querySelector("span.font-mono") as HTMLElement;
    expect(code).not.toBeNull();
    expect(code.className).toContain("--hero-foreground");
    expect(code.getAttribute("style") || "").not.toContain("--mode");
  });

  it("uses the tenant's cover as the band's ground, under the scrim", async () => {
    vi.stubGlobal(
      "fetch",
      stub([CARD()], PROFILE({ cover_url: "/media/cover.jpg" })),
    );
    const { container } = await mountDetail();
    const band = container.querySelector(".band-service") as HTMLElement;
    const image = band.querySelector("img") as HTMLImageElement;
    expect(image).not.toBeNull();
    expect(image.getAttribute("src")).toBe("/media/cover.jpg");
    // Never a bare photograph under copy: hero.tsx derives the floor (α ≥ 0.87
    // where copy sits) against the worst case a tenant can upload.
    expect(band.querySelector(".band-service-scrim")).not.toBeNull();
  });

  it("is a complete entrance with no cover at all — today's normal case", async () => {
    // §6.3's upload control is still unbuilt, so `cover_url` is null for every
    // tenant. A band that only works once somebody uploads a photograph is a
    // band that does not work.
    const { container } = await mountDetail();
    const band = container.querySelector(".band-service") as HTMLElement;
    expect(band.querySelector("img")).toBeNull();
    // The entrance is still complete: the plate, the eyebrow and the name.
    expect(band.querySelector(".eyebrow")).not.toBeNull();
    expect(
      screen.getByRole("heading", { level: 1, name: /Sea freight/ }),
    ).toBeInTheDocument();
  });
});
