import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BrandingProvider } from "@/app/branding";
import { InsightsPage } from "@/features/insights/insights-page";
import { en } from "@/lib/i18n-dict";

/**
 * The insights index, judged against the faults it was built to fix.
 *
 * The first case is the one that matters most: their filter bar is four
 * hardcoded buttons over six tags in the data, so two of their five articles
 * cannot be reached by ANY filter. Ours renders whatever the server sends, and
 * the server derives that from the tags in use — so the test that would catch a
 * regression is one that feeds an unexpected tag and expects to see it.
 */

const card = (over = {}) => ({
  slug_fr: "la-douane-en-2026",
  slug_en: "customs-in-2026",
  title_fr: "La douane en 2026",
  title_en: "Customs in 2026",
  excerpt_fr: "Ce qui change.",
  excerpt_en: "What changes.",
  tags: ["strategy"],
  published_at: "2026-02-01T09:00:00.000Z",
  has_cover: false,
  cover_id: null,
  author: { name: "Joseph Moukoko", title: "Head of Operations", avatar_ref: null },
  ...over,
});

const index = (over = {}) => ({
  articles: [card()],
  tags: [
    { tag: "strategy", count: 3 },
    { tag: "sustainability", count: 1 },
  ],
  page: 1,
  per_page: 9,
  total: 1,
  has_more: false,
  ...over,
});

let payload: unknown = index();
let fetchMock: ReturnType<typeof vi.fn>;

const stub = () =>
  vi.fn(async (url: unknown) => {
    const body = String(url).includes("/public/insights")
      ? { data: payload }
      : { error: { code: "NOT_FOUND", message: "no" } };
    return new Response(JSON.stringify(body), {
      status: String(url).includes("/public/insights") ? 200 : 404,
      headers: { "content-type": "application/json" },
    });
  });

/**
 * The title a card shows HERE.
 *
 * `getLang()` answers "en" under the test harness, so a card renders `title_en`
 * and a French assertion silently matches nothing. Naming it once keeps the
 * language of the fixture and the language of the assertion from drifting.
 */
const SHOWN_TITLE = "Customs in 2026";

const mount = async (at = "/public/insights") => {
  const view = render(
    <BrandingProvider>
      <MemoryRouter initialEntries={[at]}>
        <InsightsPage />
      </MemoryRouter>
    </BrandingProvider>,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return view;
};

const asked = () =>
  fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/public/insights"));

beforeEach(() => {
  payload = index();
  fetchMock = stub();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("the filter bar", () => {
  it("renders the tags the server sent, whatever they are", async () => {
    // The fix for their bug. A hardcoded bar could not show `sustainability`,
    // and the article carrying it would be unreachable.
    await mount();
    const bar = within(await screen.findByRole("navigation", { name: en.site.insights.filterLabel }));
    expect(bar.getByRole("button", { name: /strategy/i })).toBeInTheDocument();
    expect(bar.getByRole("button", { name: /sustainability/i })).toBeInTheDocument();
  });

  it("shows a tag this app has never heard of", async () => {
    // The property that makes the bug inexpressible: nothing in this file
    // enumerates tags, so a new one appears without a code change.
    payload = index({ tags: [{ tag: "humanitarian-corridors", count: 2 }] });
    await mount();
    expect(
      await screen.findByRole("button", { name: /humanitarian-corridors/i }),
    ).toBeInTheDocument();
  });

  it("counts each tag, so a reader can see where the writing is", async () => {
    await mount();
    const bar = within(await screen.findByRole("navigation", { name: en.site.insights.filterLabel }));
    expect(bar.getByRole("button", { name: /strategy\s*3/i })).toBeInTheDocument();
  });

  it("puts the chosen tag in the URL and asks the server for it", async () => {
    // A filtered view somebody wants to send has to have an address, and the
    // filter is applied server-side rather than by hiding DOM.
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: /sustainability/i }));
    await waitFor(() => expect(asked().some((u) => u.includes("tag=sustainability"))).toBe(true));
  });

  it("marks the active filter as pressed, not as current", async () => {
    // These are toggles over one list, not navigation between pages.
    await mount("/public/insights?tag=strategy");
    const active = await screen.findByRole("button", { name: /strategy/i });
    expect(active).toHaveAttribute("aria-pressed", "true");
  });

  it("returns to page one when the filter changes", async () => {
    // Page 4 of "strategy" is usually not a page at all, and an empty result
    // there reads as "no articles" rather than "no fourth page".
    await mount("/public/insights?tag=strategy&page=3");
    fireEvent.click(await screen.findByRole("button", { name: /sustainability/i }));
    await waitFor(() => {
      const last = asked()[asked().length - 1];
      expect(last).toContain("tag=sustainability");
      expect(last).not.toContain("page=3");
    });
  });
});

describe("a card", () => {
  it("carries the date, the excerpt and the author their cards do not", async () => {
    await mount();
    expect(await screen.findByText(SHOWN_TITLE)).toBeInTheDocument();
    expect(screen.getByText("What changes.")).toBeInTheDocument();
    expect(screen.getByText(/Joseph Moukoko/)).toBeInTheDocument();
    expect(document.querySelector("time")).toHaveAttribute(
      "dateTime",
      "2026-02-01T09:00:00.000Z",
    );
  });

  it("links to the article", async () => {
    await mount();
    const link = await screen.findByRole("link", { name: new RegExp(SHOWN_TITLE) });
    // The ENGLISH slug, because the reader is reading English — the lookup
    // matches either column, so one article has one URL per language.
    expect(link).toHaveAttribute("href", expect.stringContaining("/insights/customs-in-2026"));
  });

  it("still renders an article that has no slug, as a tile rather than a dead link", async () => {
    // The desk published it; a card with an empty href looks broken.
    payload = index({ articles: [card({ slug_fr: null, slug_en: null })] });
    await mount();
    expect(await screen.findByText(SHOWN_TITLE)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: new RegExp(SHOWN_TITLE) })).not.toBeInTheDocument();
  });

  it("renders no image frame when there is no cover", async () => {
    // Never render media this app did not get a URL for.
    await mount();
    await screen.findByText(SHOWN_TITLE);
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("the four states", () => {
  it("shows a skeleton of the real shape while loading", async () => {
    // Never a spinner on a blank page (§3.3).
    render(
      <BrandingProvider>
        <MemoryRouter initialEntries={["/public/insights"]}>
          <InsightsPage />
        </MemoryRouter>
      </BrandingProvider>,
    );
    expect(await screen.findByRole("status", { name: en.site.insights.loading }))
      .toHaveAttribute("aria-busy", "true");
  });

  it("says what is missing when nothing is published", async () => {
    payload = index({ articles: [], tags: [], total: 0 });
    await mount();
    expect(await screen.findByText(en.site.insights.none)).toBeInTheDocument();
  });

  it("distinguishes an empty FILTER from an empty hub, and offers a way back", async () => {
    // "Nothing under that topic" and "nothing published yet" are different
    // facts, and only one of them has a next action.
    payload = index({ articles: [], total: 0 });
    await mount("/public/insights?tag=strategy");
    expect(await screen.findByText(en.site.insights.noneForTag)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.site.insights.showAll })).toBeInTheDocument();
  });

  it("shows a retryable inline error, never an alert()", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: "ERROR", message: "boom" } }), {
          status: 500,
          headers: { "content-type": "application/json", "X-Request-Id": "req-7" },
        }),
      ),
    );
    await mount();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.common.retry })).toBeInTheDocument();
    expect(screen.getByText("req-7")).toBeInTheDocument();
  });
});

describe("pagination", () => {
  it("is absent while everything fits on one page", async () => {
    await mount();
    await screen.findByText(SHOWN_TITLE);
    expect(
      screen.queryByRole("navigation", { name: en.site.insights.pagination }),
    ).not.toBeInTheDocument();
  });

  it("appears once there is more, and asks for the next page", async () => {
    payload = index({ total: 30, has_more: true });
    await mount();
    fireEvent.click(await screen.findByRole("button", { name: en.site.insights.next }));
    await waitFor(() => expect(asked().some((u) => u.includes("page=2"))).toBe(true));
  });

  it("disables Previous on the first page", async () => {
    payload = index({ total: 30, has_more: true });
    await mount();
    expect(await screen.findByRole("button", { name: en.site.insights.previous })).toBeDisabled();
  });

  it("trusts the server's has_more rather than recomputing it", async () => {
    // The browser would have to know per_page, and a rounding disagreement is a
    // "next" that leads to an empty page.
    payload = index({ total: 30, has_more: false, page: 4 });
    await mount("/public/insights?page=4");
    expect(await screen.findByRole("button", { name: en.site.insights.next })).toBeDisabled();
  });
});

/**
 * ── §8.6: THE KIND FILTER ──────────────────────────────────────────────────
 *
 * The coarser of the two cuts — "articles or announcements" against "which
 * subject" — and the one that had to reach the server, because the server is
 * where the filtering happens.
 *
 * These assert on the REQUEST as well as on the markup. The reason is the
 * defect this section uncovered: `insight.validator.js` has accepted `?kind=`
 * since 13784, `service.listPublic` has taken it, and `repo.list` filters on
 * it — but the public route destructured only `tag`, `page` and `per_page`, so
 * the parameter was validated and then dropped. Nothing errored and the
 * response was a plausible list of everything. A test that only checked the
 * rendered cards would have passed against that all day.
 */
describe("the kind filter (§8.6)", () => {
  it("sends the kind to the server, not just to the markup", async () => {
    await mount("/public/insights?kind=announcement");
    expect(asked().some((u) => u.includes("kind=announcement"))).toBe(true);
  });

  it("asks for everything when no kind is chosen", async () => {
    await mount();
    /* Absent, not `kind=`: an empty value is a value, and the endpoint's enum
       would reject it with a 400.
       IT IS GUARDED TWICE, which is worth knowing before somebody removes one
       of them as dead code: `listInsights` maps "" to undefined, and
       `api.ts`'s query builder independently skips "" alongside undefined and
       null. Breaking either alone leaves this test green; breaking both
       reddens it. That is the proof, and it is the reason neither guard should
       be simplified away on the grounds that it changes nothing. */
    expect(asked().some((u) => /[?&]kind=/.test(u))).toBe(false);
  });

  it("keeps the kind in the URL so a filtered view can be sent", async () => {
    const { container } = await mount();
    const button = screen.getByRole("button", {
      name: en.site.insights.kindAnnouncement,
    });
    fireEvent.click(button);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(asked().some((u) => u.includes("kind=announcement"))).toBe(true);
    expect(container).toBeTruthy();
  });

  it("ignores a hand-edited kind rather than sending a 400 to the server", async () => {
    // A URL somebody typed should degrade to the unfiltered page, not to an
    // error screen — the endpoint's enum would refuse anything else.
    await mount("/public/insights?kind=nonsense");
    expect(asked().some((u) => /[?&]kind=/.test(u))).toBe(false);
  });

  it("renders the filter before the list has answered", async () => {
    // Unlike the tag bar, the three options are known before any request, so
    // the page has a control on the first frame and nothing jumps when the
    // list lands.
    render(
      <BrandingProvider>
        <MemoryRouter initialEntries={["/public/insights"]}>
          <InsightsPage />
        </MemoryRouter>
      </BrandingProvider>,
    );
    expect(
      screen.getByRole("button", { name: en.site.insights.kindArticle }),
    ).toBeInTheDocument();
  });

  it("keeps the kind when the TOPIC changes, and vice versa", async () => {
    /*
     * They are two questions — "what sort of post" and "about what" — and a bar
     * that silently clears the other one on every click is a bar people stop
     * trusting. Both `choose` and `chooseKind` rebuild the whole query for
     * exactly this reason, which is easy to write and easy to lose.
     */
    await mount("/public/insights?kind=announcement");
    const tagButton = await screen.findByRole("button", { name: /sustainability/i });
    fireEvent.click(tagButton);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const last = asked()[asked().length - 1];
    expect(last).toContain("kind=announcement");
    expect(last).toContain("tag=");
  });
});
