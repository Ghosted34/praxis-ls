import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AnnouncementsBand } from "./announcements-band";
import * as api from "@/lib/insights-api";

/**
 * The announcements band (§7.2).
 *
 * ── THE TWO THINGS WORTH TESTING ───────────────────────────────────────────
 *
 * 1. THAT IT IS ABSENT. "No band when nothing is pinned" is the requirement
 *    most likely to be broken by a well-meaning later edit — somebody adds a
 *    skeleton, or an empty state, and the homepage of every tenant who has
 *    never pinned anything grows a hole. Four of these tests are that one rule
 *    from four directions.
 *
 * 2. THAT IT IS NOT A MARQUEE. The failure mode of a moving band is a
 *    duplicated DOM: content rendered twice so the loop looks seamless, which
 *    puts every link in the tab order twice and reads every headline to a
 *    screen reader twice. That is invisible in a screenshot and obvious to
 *    anybody using the page without a mouse.
 */

const card = (over: Partial<api.InsightCard> = {}): api.InsightCard => ({
  slug_fr: "nouveau-corridor",
  slug_en: "new-corridor",
  title_fr: "Nouveau corridor Douala–N’Djamena",
  title_en: "New Douala–N’Djamena corridor",
  excerpt_fr: "Départs hebdomadaires.",
  excerpt_en: "Weekly departures.",
  tags: [],
  published_at: "2026-09-01T09:00:00.000Z",
  has_cover: false,
  cover_id: null,
  author: null,
  kind: "announcement",
  pinned_until: new Date(Date.now() + 86400e3 * 30).toISOString(),
  ...over,
});

const answer = (pinned: api.InsightCard[]) =>
  vi.spyOn(api, "listAnnouncements").mockResolvedValue({
    pinned,
    articles: pinned,
    tags: [],
    page: 1,
    per_page: 9,
    total: pinned.length,
    has_more: false,
  });

const draw = () =>
  render(
    <MemoryRouter>
      <AnnouncementsBand />
    </MemoryRouter>,
  );

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("when there is nothing to announce", () => {
  it("renders nothing at all when no pin is live", async () => {
    // Not an empty state, not a placeholder, not a heading with nothing under
    // it. Most tenants will never pin anything and their homepage must look
    // designed rather than unfinished.
    answer([]);
    const { container } = draw();
    await waitFor(() => expect(api.listAnnouncements).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing while the read is still in flight", async () => {
    // No skeleton. A skeleton that resolves to nothing is a layout shift on the
    // second band of the page, which is an LCP problem as well as an ugly one.
    vi.spyOn(api, "listAnnouncements").mockReturnValue(new Promise(() => {}));
    const { container } = draw();
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the read fails", async () => {
    // A tenant without the website package answers FEATURE_DISABLED here. That
    // is a configuration state, not an outage, and it draws no band and no
    // error.
    vi.spyOn(api, "listAnnouncements").mockRejectedValue(new Error("nope"));
    const { container } = draw();
    await waitFor(() => expect(api.listAnnouncements).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("drops a pin whose date has already passed, even if the server sent it", async () => {
    // The SQL filters on `pinned_until > now()`, but a payload can outlive its
    // pin in a cache or a service worker. Drawing a lapsed notice is exactly
    // the staleness 13784 chose a timestamp to prevent.
    answer([card({ pinned_until: new Date(Date.now() - 1000).toISOString() })]);
    const { container } = draw();
    await waitFor(() => expect(api.listAnnouncements).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });
});

describe("when something is pinned", () => {
  it("draws the band with the announcement in it", async () => {
    answer([card()]);
    draw();
    expect(await screen.findByRole("region")).toBeTruthy();
    expect(screen.getByText(/Douala/)).toBeTruthy();
  });

  it("renders each announcement EXACTLY ONCE — it is not a marquee", async () => {
    // The duplicated-DOM trick that makes a seamless loop puts every link in
    // the tab order twice and reads every headline twice. The DOM here is the
    // list, so the tab order is the list.
    const three = [
      card({ slug_en: "a", title_en: "Alpha", title_fr: "Alpha" }),
      card({ slug_en: "b", title_en: "Beta", title_fr: "Beta" }),
      card({ slug_en: "c", title_en: "Gamma", title_fr: "Gamma" }),
    ];
    answer(three);
    draw();
    await screen.findByRole("region");
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    // One link per announcement, plus the band's own "view more".
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });

  it("is ambient, not urgent — aria-live is off", async () => {
    // §7.2 names it. A polite live region on a band that scrolls would have a
    // screen reader announcing headlines the reader did not ask for.
    answer([card()]);
    draw();
    await screen.findByRole("region");
    expect(screen.getByRole("list").getAttribute("aria-live")).toBe("off");
  });

  it("shows an announcement with no slug as text, not as a dead link", async () => {
    // The headline IS the notice, so it is still worth showing; a link to
    // nowhere is not.
    answer([card({ slug_fr: null, slug_en: null })]);
    draw();
    await screen.findByRole("region");
    expect(screen.getByText(/Douala/)).toBeTruthy();
    // Only the band's own "view more" remains.
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("does not re-slice the server's cap", async () => {
    // The cap is five and it is applied in SQL. A client-side slice would be a
    // cap this app enforces for itself and nobody else — and would hide a
    // server bug rather than showing it.
    const five = [1, 2, 3, 4, 5].map((n) =>
      card({ slug_en: `s${n}`, title_en: `Notice ${n}`, title_fr: `Avis ${n}` }),
    );
    answer(five);
    draw();
    await screen.findByRole("region");
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });
});

describe("under reduced motion", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  });

  it("becomes a static wrapped list, and schedules no frames", async () => {
    // Not a slower drift — no drift, and no horizontal scroller to have to
    // operate. §1.2 rule 1.
    const raf = vi.spyOn(window, "requestAnimationFrame");
    answer([card()]);
    draw();
    await screen.findByRole("region");
    const list = screen.getByRole("list");
    expect(list.className).toContain("flex-wrap");
    expect(list.className).not.toContain("overflow-x-auto");
    expect(raf).not.toHaveBeenCalled();
  });
});
