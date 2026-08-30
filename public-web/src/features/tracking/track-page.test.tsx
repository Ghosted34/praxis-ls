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
    await waitFor(() =>
      expect(screen.getByText(en.site.trackPage.lastUpdate)).toBeInTheDocument(),
    );
    const stamp = document.querySelector("time");
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
