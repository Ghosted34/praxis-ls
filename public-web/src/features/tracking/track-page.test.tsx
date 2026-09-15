import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BrandingProvider } from "@/app/branding";
import { TrackPage } from "@/features/tracking/track-page";
import { en } from "@/lib/i18n-dict";
import type { TrackingResult } from "@/lib/tracking-api";

/**
 * Every outcome of the tracking lookup, reachable and designed.
 *
 * `doc/PUBLIC_WEB_PLAN.md` WS1 accepts this page only when each state can be
 * shown deliberately, so each case here IS that fixture: idle, loading, found,
 * found-but-empty, not-found, rate-limited, failed. The acceptance criterion the
 * cases are written against is not "it renders" — it is that a visitor can tell
 * the states apart, which is why the assertions are on the sentences rather than
 * on the markup.
 *
 * The two that would be easiest to get wrong, and are therefore asserted from
 * both sides:
 *
 *   · a file with no client-visible stages must NOT read as an unknown
 *     reference. A client whose file was opened this morning is in this state.
 *   · the rate limit must not offer a retry. Retrying is the thing it is asking
 *     the visitor to stop doing, and a button labelled "try again" invites it.
 */

const RESULT: TrackingResult = {
  reference: "SBL-OPS-2026-0142",
  computed_status: "IN_PROGRESS",
  service_type: {
    key: "SEA_FREIGHT_IMPORT",
    name_fr: "Fret maritime import",
    name_en: "Sea freight import",
    mode: "SEA",
  },
  last_update: "2026-03-03T10:00:00.000Z",
  current_stage: null,
  origin: "Shanghai",
  destination: "Douala",
  progress: { completed: 2, total: 4, percent: 50 },
  milestones: [
    {
      code: "PRE_ALERT",
      label: "Pre-alert",
      public_state: "COMPLETED",
      is_complete: true,
      is_current: false,
      due_date: null,
      completed_at: "2026-03-01T10:00:00.000Z",
      location: "Shanghai",
      stage_reference: null,
      progress_note: null,
    },
    {
      code: "VESSEL_ARRIVED",
      label: "Vessel arrived",
      public_state: "COMPLETED",
      is_complete: true,
      is_current: false,
      due_date: null,
      completed_at: "2026-03-03T10:00:00.000Z",
      location: "Douala",
      stage_reference: null,
      progress_note: null,
    },
    {
      code: "DECLARATION_LODGED",
      label: "Declaration lodged",
      public_state: "CURRENT",
      is_complete: false,
      is_current: true,
      due_date: "2026-03-05T00:00:00.000Z",
      completed_at: null,
      location: null,
      stage_reference: null,
      progress_note: "Awaiting the assessment notice.",
    },
    {
      code: "DELIVERY",
      label: "Delivery",
      public_state: "UPCOMING",
      is_complete: false,
      is_current: false,
      due_date: null,
      completed_at: null,
      location: null,
      stage_reference: null,
      progress_note: null,
    },
  ],
};

/** One response for the one request this page makes. */
const answer = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      }),
  );

/** The tracking calls a stub received. `BrandingProvider` fetches too, and a
 *  bare call count would silently pass or fail on that instead. */
const tracked = (mock: { mock: { calls: unknown[][] } }): string[] =>
  mock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes("/public/tracking/"));

async function mount(search: string) {
  const view = render(
    <BrandingProvider>
      <MemoryRouter initialEntries={[`/public/track${search}`]}>
        <TrackPage />
      </MemoryRouter>
    </BrandingProvider>,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return view;
}

beforeEach(() => {
  vi.stubGlobal("fetch", answer({ data: RESULT }));
});
afterEach(() => vi.unstubAllGlobals());

describe("the ?ref= handoff", () => {
  it("looks up nothing and prompts, with no reference in the URL", async () => {
    // The hero widget on every other page writes ?ref=; arriving without one is
    // a visitor who came here directly. Branding still loads — the assertion is
    // that the TRACKING endpoint was not called, not that nothing was.
    const fetchMock = answer({ data: RESULT });
    vi.stubGlobal("fetch", fetchMock);
    await mount("");
    expect(tracked(fetchMock)).toHaveLength(0);
    expect(screen.getByText(en.site.track.empty)).toBeInTheDocument();
  });

  it("looks up the reference the URL carries, exactly", async () => {
    // Exact, not fuzzy: there is no partial match behind this endpoint, so a
    // page that trimmed or upper-cased on the way out would produce a
    // not-found the visitor could not explain.
    const fetchMock = answer({ data: RESULT });
    vi.stubGlobal("fetch", fetchMock);
    await mount("?ref=SBL-OPS-2026-0142");
    await waitFor(() => expect(tracked(fetchMock)).toHaveLength(1));
    expect(tracked(fetchMock)[0]).toContain(
      "/api/tenant/public/tracking/SBL-OPS-2026-0142",
    );
  });
});

describe("a reference that resolves", () => {
  it("shows the reference, the route and the service", async () => {
    await mount("?ref=SBL-OPS-2026-0142");
    await waitFor(() =>
      expect(screen.getByText("SBL-OPS-2026-0142")).toBeInTheDocument(),
    );
    expect(screen.getByText("Shanghai")).toBeInTheDocument();
    expect(screen.getByText("Douala")).toBeInTheDocument();
    expect(screen.getByText("Sea freight import")).toBeInTheDocument();
  });

  it("draws the progress bar from the API's own percentage", async () => {
    // Their site cannot draw this — it has no such field.
    await mount("?ref=SBL-OPS-2026-0142");
    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "50");
  });

  it("shows every visible stage, each with its own state", async () => {
    await mount("?ref=SBL-OPS-2026-0142");
    await waitFor(() =>
      expect(screen.getByText("Declaration lodged")).toBeInTheDocument(),
    );
    // Scoped to the timeline: the summary pill above it reads the file's
    // overall status, which shares wording with the current stage on purpose.
    const timeline = within(
      screen.getByRole("list", { name: en.site.trackPage.timeline }),
    );
    expect(timeline.getAllByText(en.states.milestone.completed)).toHaveLength(2);
    expect(timeline.getAllByText(en.states.milestone.current)).toHaveLength(1);
    expect(timeline.getAllByText(en.states.milestone.upcoming)).toHaveLength(1);
  });

  it("dates the last update from the API, not from now", async () => {
    await mount("?ref=SBL-OPS-2026-0142");
    const label = await screen.findByText(en.site.trackPage.lastUpdate);
    /*
     * The `<time>` INSIDE THE LAST-UPDATE LINE, not the first one on the page.
     *
     * This was `document.querySelector("time")` and it stopped meaning what it
     * said the moment §8.1's verdict plate added a second `<time>` above it for
     * the scheduled date. It kept passing for a while by accident of ordering,
     * which is the failure mode a positional locator always has: it asserts
     * "some time element" while reading as "the last-update time".
     */
    const stamp = label.parentElement?.querySelector("time");
    expect(stamp).toHaveAttribute("dateTime", "2026-03-03T10:00:00.000Z");
  });

  it("says so plainly when nothing has completed yet", async () => {
    // Rather than printing the file's creation date under "last update".
    vi.stubGlobal(
      "fetch",
      answer({
        data: {
          ...RESULT,
          computed_status: "PENDING",
          last_update: null,
          progress: { completed: 0, total: 4, percent: 0 },
        },
      }),
    );
    await mount("?ref=SBL-OPS-2026-0142");
    await waitFor(() =>
      expect(
        screen.getByText(en.site.trackPage.lastUpdateNone),
      ).toBeInTheDocument(),
    );
  });

  it("renders a file the desk has not classified", async () => {
    // service_type is nullable; the page must not require a mode.
    vi.stubGlobal("fetch", answer({ data: { ...RESULT, service_type: null } }));
    await mount("?ref=SBL-OPS-2026-0142");
    await waitFor(() =>
      expect(screen.getByText("SBL-OPS-2026-0142")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Sea freight import")).not.toBeInTheDocument();
  });

  it("says the file is finished when every visible stage is done", async () => {
    vi.stubGlobal(
      "fetch",
      answer({
        data: {
          ...RESULT,
          computed_status: "COMPLETED",
          progress: { completed: 4, total: 4, percent: 100 },
        },
      }),
    );
    await mount("?ref=SBL-OPS-2026-0142");
    await waitFor(() =>
      expect(screen.getByText(en.site.trackPage.closed)).toBeInTheDocument(),
    );
  });
});

describe("a file with no client-visible stages", () => {
  it("says the file has no stages yet — NOT that the reference is unknown", async () => {
    // The distinction §3.3 exists to protect. A client whose file was opened
    // this morning is in exactly this state.
    vi.stubGlobal(
      "fetch",
      answer({
        data: {
          ...RESULT,
          computed_status: "PENDING",
          last_update: null,
          progress: { completed: 0, total: 0, percent: 0 },
          milestones: [],
        },
      }),
    );
    await mount("?ref=SBL-OPS-2026-0142");
    await waitFor(() =>
      expect(screen.getByText(en.site.trackPage.noStages)).toBeInTheDocument(),
    );
    expect(screen.queryByText(en.site.track.notFound)).not.toBeInTheDocument();
    // The reference still resolved, so the summary is still shown.
    expect(screen.getByText("SBL-OPS-2026-0142")).toBeInTheDocument();
  });
});

describe("a reference nobody recognises", () => {
  it("answers in its own words, not as a failure", async () => {
    vi.stubGlobal(
      "fetch",
      answer({ error: { code: "NOT_FOUND", message: "Shipment not found" } }, 404),
    );
    await mount("?ref=NOPE");
    await waitFor(() =>
      expect(screen.getByText(en.site.track.notFound)).toBeInTheDocument(),
    );
    // Not an error, and not an alert() — the two things WS1 forbids here.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("the rate limit", () => {
  it("is distinguishable from a missing shipment", async () => {
    // The twelfth colleague of the day must not conclude their cargo vanished.
    vi.stubGlobal(
      "fetch",
      answer({ error: { code: "RATE_LIMITED", message: "Slow down" } }, 429),
    );
    await mount("?ref=SBL-OPS-2026-0142");
    await waitFor(() =>
      expect(screen.getByText(en.site.track.limited)).toBeInTheDocument(),
    );
    expect(screen.queryByText(en.site.track.notFound)).not.toBeInTheDocument();
  });

  it("offers no retry, because retrying is the problem", async () => {
    vi.stubGlobal(
      "fetch",
      answer({ error: { code: "RATE_LIMITED", message: "Slow down" } }, 429),
    );
    await mount("?ref=SBL-OPS-2026-0142");
    await waitFor(() =>
      expect(screen.getByText(en.site.track.limited)).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: en.common.retry }),
    ).not.toBeInTheDocument();
  });
});

describe("the lookup failing", () => {
  it("is inline, retryable, and quotes the request id", async () => {
    vi.stubGlobal(
      "fetch",
      answer({ error: { code: "ERROR", message: "boom" } }, 500, {
        "X-Request-Id": "req-42",
      }),
    );
    await mount("?ref=SBL-OPS-2026-0142");
    const alert = await screen.findByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: en.common.retry }),
    ).toBeInTheDocument();
    expect(screen.getByText("req-42")).toBeInTheDocument();
  });

  it("retries the same reference when asked", async () => {
    // A fresh Response per call, and routed on the URL: a single Response
    // instance is consumed by whichever request reads it first — here that is
    // BrandingProvider, and the page under test would then see a locked body
    // and fail for a reason that has nothing to do with retrying.
    let attempts = 0;
    const fetchMock = vi.fn(async (url: unknown) => {
      const failing =
        String(url).includes("/public/tracking/") && ++attempts === 1;
      return new Response(
        JSON.stringify(
          failing ? { error: { code: "ERROR", message: "boom" } } : { data: RESULT },
        ),
        {
          status: failing ? 500 : 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    await mount("?ref=SBL-OPS-2026-0142");
    const retry = await screen.findByRole("button", { name: en.common.retry });
    await act(async () => {
      fireEvent.click(retry);
    });
    await waitFor(() =>
      expect(screen.getByText("SBL-OPS-2026-0142")).toBeInTheDocument(),
    );
    expect(tracked(fetchMock)).toHaveLength(2);
  });

  it("shows no request id for a 404, which is an answer and not a fault", async () => {
    vi.stubGlobal(
      "fetch",
      answer({ error: { code: "NOT_FOUND", message: "nope" } }, 404, {
        "X-Request-Id": "req-99",
      }),
    );
    await mount("?ref=NOPE");
    await waitFor(() =>
      expect(screen.getByText(en.site.track.notFound)).toBeInTheDocument(),
    );
    expect(screen.queryByText("req-99")).not.toBeInTheDocument();
  });
});

/**
 * ── §8.1: THE ONE FACT FIRST ───────────────────────────────────────────────
 *
 * The guide's demand for this page is an ORDERING one — "status and ETA above
 * everything, at display size, before the timeline" — and ordering is the kind
 * of thing that reads as done in a screenshot and quietly reverts on the next
 * refactor. Both halves are asserted here against the DOM's own document order
 * rather than against a class name, because a class can be renamed and the
 * question these tests protect is which of two facts a visitor meets first.
 */
describe("the answer comes before the record (§8.1)", () => {
  it("puts the status above the reference in document order", async () => {
    await mount("?ref=SBL-OPS-2026-0142");
    const status = await screen.findByText(en.site.trackPage.verdictMoving);
    const reference = screen.getByText("SBL-OPS-2026-0142");
    // Node.compareDocumentPosition: FOLLOWING means `reference` comes after
    // `status`. This is the inversion the section asks for — the old layout had
    // the reference as the heading and the status as a pill beside it.
    expect(
      status.compareDocumentPosition(reference) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("puts the status above the timeline heading", async () => {
    await mount("?ref=SBL-OPS-2026-0142");
    const status = await screen.findByText(en.site.trackPage.verdictMoving);
    const timeline = screen.getByRole("heading", {
      name: en.site.trackPage.timeline,
    });
    expect(
      status.compareDocumentPosition(timeline) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("states a scheduled date only where the desk entered one", async () => {
    // The fixture's one outstanding due date is the CURRENT stage's, 2026-03-05.
    await mount("?ref=SBL-OPS-2026-0142");
    const label = await screen.findByText(en.site.trackPage.scheduled);
    const when = label.parentElement?.querySelector("time");
    expect(when).toHaveAttribute("dateTime", "2026-03-05T00:00:00.000Z");
  });

  it("INVENTS NO ETA when the desk has scheduled nothing", async () => {
    /*
     * The N12 case, and the reason this page states a scheduled date rather
     * than an "estimated arrival". There is no feed behind this page: strip the
     * due dates and there is nothing to derive an arrival from, so the page
     * must say so rather than computing one from transit averages or from the
     * remaining stage count.
     */
    vi.stubGlobal(
      "fetch",
      answer({
        data: {
          ...RESULT,
          current_stage: null,
          milestones: RESULT.milestones.map((m) => ({ ...m, due_date: null })),
        },
      }),
    );
    await mount("?ref=SBL-OPS-2026-0142");
    expect(
      await screen.findByText(en.site.trackPage.noSchedule),
    ).toBeInTheDocument();
    expect(screen.queryByText(en.site.trackPage.scheduled)).toBeNull();
  });
});

/**
 * ── §8.1: THE TIMELINE AS A SPATIAL OBJECT ─────────────────────────────────
 *
 * Three states, three elevations, and the rail lit only where the cargo has
 * been. The classes carry the geometry (`--lift`, `--depth`) so asserting on
 * them is asserting on the depth model, not on decoration.
 */
describe("the timeline is spatial (§8.1)", () => {
  it("gives each stage the elevation its state earns", async () => {
    const { container } = await mount("?ref=SBL-OPS-2026-0142");
    await screen.findByRole("heading", { name: en.site.trackPage.timeline });
    expect(container.querySelectorAll(".track-stage-done")).toHaveLength(2);
    expect(container.querySelectorAll(".track-stage-now")).toHaveLength(1);
    expect(container.querySelectorAll(".track-stage-next")).toHaveLength(1);
  });

  it("lights the rail only on legs the cargo has completed", async () => {
    const { container } = await mount("?ref=SBL-OPS-2026-0142");
    await screen.findByRole("heading", { name: en.site.trackPage.timeline });
    // Four stages → three rails. Two completed stages light their leg; the
    // current one does not, because the cargo has not travelled it yet.
    expect(container.querySelectorAll(".track-rail")).toHaveLength(3);
    expect(container.querySelectorAll(".track-rail-lit")).toHaveLength(2);
  });

  it("carries the file's OWN mode colour, and none at all when unclassified", async () => {
    const { container, unmount } = await mount("?ref=SBL-OPS-2026-0142");
    const lit = container.querySelector(".track-verdict") as HTMLElement;
    expect(lit.style.getPropertyValue("--mode")).toBe("var(--mode-sea)");
    unmount();

    /*
     * An unclassified file leaves `--mode` UNSET rather than falling back to a
     * mode. The CSS then reaches the tenant's own accent, which is the honest
     * answer — a file the desk has not classified is not secretly a sea file,
     * and a positional colour must never appear where the page states a fact
     * about a specific shipment (`service-identity.ts`).
     */
    vi.stubGlobal("fetch", answer({ data: { ...RESULT, service_type: null } }));
    const plain = await mount("?ref=SBL-OPS-2026-0142");
    const unlit = plain.container.querySelector(".track-verdict") as HTMLElement;
    expect(unlit.style.getPropertyValue("--mode")).toBe("");
  });
});

/**
 * ── §8.1: THE OUTCOMES ARE DESIGNED, NOT A SENTENCE ────────────────────────
 *
 * "A wrong reference is the most common outcome on this page and it currently
 * gets the least design." What makes the new screen worth the change is not
 * that it is bigger — it is that it echoes the reference back and says what the
 * miss does NOT mean.
 */
describe("the not-found screen (§8.1)", () => {
  const missing = () =>
    vi.stubGlobal(
      "fetch",
      answer({ error: { code: "NOT_FOUND", message: "no" } }, 404),
    );

  it("echoes the reference that was actually tried", async () => {
    missing();
    await mount("?ref=SBL-OPS-2026-9999");
    await screen.findByText(en.site.track.notFound);
    // So somebody reading over a shoulder can spot the transposed digit.
    expect(screen.getByText("SBL-OPS-2026-9999")).toBeInTheDocument();
  });

  it("says the miss is not a statement about the cargo", async () => {
    missing();
    await mount("?ref=SBL-OPS-2026-9999");
    expect(
      await screen.findByText(en.site.trackPage.notFoundNotLost),
    ).toBeInTheDocument();
  });

  it("does not announce itself, unlike the failure", async () => {
    /*
     * `role="alert"` is assertive and interrupts whatever is being read. A
     * wrong reference is an ANSWER the visitor asked for and will reach by
     * reading on; a request that failed is not. Getting this backwards is how a
     * screen reader becomes something people turn down.
     */
    missing();
    await mount("?ref=SBL-OPS-2026-9999");
    await screen.findByText(en.site.track.notFound);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the failure plate does not repeat itself", () => {
  it("shows the server's sentence only when it adds something", async () => {
    /*
     * `messageFor` falls back to `errors.loadFailed` when the server sends no
     * specific message. With that string ALSO as the plate's title, the screen
     * read the identical sentence twice at two sizes — correct in each half,
     * wrong as a composition, and invisible to every assertion that checked
     * only that the message was present. Found in a screenshot.
     */
    vi.stubGlobal(
      "fetch",
      answer({ error: { code: "ERROR", message: "" } }, 500),
    );
    await mount("?ref=SBL-OPS-2026-0142");
    await screen.findByText(en.site.trackPage.failedTitle);
    // The generic sentence must not ALSO appear as the body.
    expect(screen.queryAllByText(en.errors.loadFailed)).toHaveLength(0);
  });

  it("never prints a 500's server text to a stranger", async () => {
    /*
     * `PublicApiError.isPublicMessage` passes a server sentence through only
     * for offline, not-found and rate-limited — each of which has its own
     * screen. Everything else gets the dictionary's sentence and the detail
     * goes to the console. This pins that: a server that leaks a stack trace,
     * a table name or an internal path into `message` must not have it
     * rendered on a public page.
     */
    vi.stubGlobal(
      "fetch",
      answer(
        { error: { code: "ERROR", message: "relation \"insight_article\" does not exist" } },
        500,
      ),
    );
    await mount("?ref=SBL-OPS-2026-0142");
    await screen.findByText(en.site.trackPage.failedTitle);
    expect(screen.queryByText(/insight_article/)).toBeNull();
  });
});

describe("the offline case, which is the one that DOES add a sentence", () => {
  it("prints the offline message rather than the generic fallback", async () => {
    /*
     * `isPublicMessage` is true for status 0, and a network failure lands on
     * the general failure plate rather than on not-found or rate-limited. It is
     * the one failure where the body says something the title does not: the
     * problem is the connection, not the reference the visitor typed.
     */
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await mount("?ref=SBL-OPS-2026-0142");
    await screen.findByText(en.site.trackPage.failedTitle);
    expect(screen.getByText(en.errors.network)).toBeInTheDocument();
  });
});
