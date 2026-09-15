import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { CareersPage } from "./careers-page";
import { __resetSitePageCache } from "@/lib/use-site-page";
import "@/lib/i18n";

/**
 * The careers page, and specifically the state it is in most of the time (13792).
 *
 * ── WHAT THIS FILE IS ACTUALLY GUARDING ───────────────────────────────────
 *
 * A company of forty hires a handful of times a year, so an empty vacancy list
 * is this route's NORMAL state, not its edge case. What used to be rendered
 * there was a dashed box reading "No open roles right now / Please check back" —
 * on a white-label product, on the page a stranger forms their impression of the
 * tenant from.
 *
 * The three things below are each a decision that could be reverted by somebody
 * tidying up, and each would look harmless in a diff:
 *
 *   1. THE BUTTONS FOLLOW THE TENANT'S SWITCHES, both of which default OFF.
 *      Showing an application form to a tenant who never asked for one starts a
 *      pipeline nobody is reading; hiding one from a tenant who did makes the
 *      setting a lie.
 *   2. AN UNCONFIGURED TENANT STILL GETS SOMEWHERE TO GO. That is every tenant
 *      on day one, so the contact fallback is the commonest rendering of this
 *      band and not a corner of it.
 *   3. THE TENANT'S OWN BLOCKS RENDER WHETHER OR NOT ROLES ARE OPEN. Building
 *      "why work here" as empty-state decoration would mean the effort only
 *      ever reached the visitors who found nothing.
 */

const OFF = { open_applications: false, alerts_enabled: false, culture_tag: null };

const VACANCY = {
  token: "tok-1",
  title: "Customs declarant",
  department: "Customs",
  location: "Douala",
  employment_type: "FULL_TIME",
  skills_required: [],
  published_at: "2026-09-01",
  closes_on: null,
};

const CAREERS_BLOCKS = {
  key: "careers",
  blocks: [
    {
      block_id: "b1",
      type: "feature_list",
      content: {
        title: { fr: "Pourquoi nous", en: "Why work with us" },
        items: [
          {
            title: { fr: "Formation", en: "We train people" },
            text: { fr: "Chaque semaine.", en: "Every week, on the floor." },
          },
        ],
      },
    },
  ],
};

/**
 * Route each public read to its own answer. A path nobody stubbed answers 404,
 * so a request this page makes and this test did not declare fails loudly
 * rather than silently resolving.
 *
 * MOST SPECIFIC FRAGMENT FIRST. Matching is `url.includes(fragment)` and this
 * page reads three URLs that all end in the same word — `/careers`,
 * `/careers/settings/public` and `/public/site/pages/careers`. A bare
 * `/careers` entry declared first therefore answers the vacancy list to the
 * site-page read as well, and the tenant's blocks silently never arrive. Sorting
 * by length here rather than trusting the call sites to declare them in the
 * right order, because that is a footgun that only shows up as a missing band.
 */
function stubReads(answers: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(typeof input === "string" ? input : (input as Request).url ?? input);
      const byLength = Object.entries(answers).sort(
        ([a], [b]) => b.length - a.length,
      );
      for (const [fragment, data] of byLength) {
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
      <CareersPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  // The page cache is a module-level Map shared across renders, which is the
  // point of it in the app and a cross-test leak here.
  __resetSitePageCache();
});
afterEach(() => vi.unstubAllGlobals());

describe("the careers page with roles open", () => {
  it("lists them, and does not draw the not-hiring band", async () => {
    stubReads({
      "/careers/settings/public": OFF,
      "/careers": [VACANCY],
      "/site/pages/careers": CAREERS_BLOCKS,
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Customs declarant")).toBeInTheDocument(),
    );
    expect(screen.queryByText("No open roles right now")).not.toBeInTheDocument();
  });

  it("still renders the tenant's own blocks — they are not empty-state decoration", async () => {
    stubReads({
      "/careers/settings/public": OFF,
      "/careers": [VACANCY],
      "/site/pages/careers": CAREERS_BLOCKS,
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("Why work with us")).toBeInTheDocument(),
    );
    expect(screen.getByText("Every week, on the floor.")).toBeInTheDocument();
  });
});

describe("the careers page with nothing open", () => {
  it("gives an unconfigured tenant a contact route, not a dead end", async () => {
    stubReads({ "/careers/settings/public": OFF, "/careers": [] });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("No open roles right now")).toBeInTheDocument(),
    );
    // The claim that is true here and is not true of most careers pages.
    expect(
      screen.getByText(/closes itself on its date/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Get in touch" }),
    ).toBeInTheDocument();
    // Neither switch is on, so neither action is offered.
    expect(screen.queryByRole("button", { name: /Send your CV/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Tell me when a role opens/i }),
    ).not.toBeInTheDocument();
  });

  it("offers the CV form only when the tenant switched open applications on", async () => {
    stubReads({
      "/careers/settings/public": { ...OFF, open_applications: true },
      "/careers": [],
    });
    renderPage();

    const cta = await screen.findByRole("button", { name: /Send your CV/i });
    // No alert button: the two switches are independent, because a tenant may
    // want CVs without committing to write back to anybody.
    expect(
      screen.queryByRole("button", { name: /Tell me when a role opens/i }),
    ).not.toBeInTheDocument();

    await userEvent.click(cta);
    await waitFor(() =>
      expect(screen.getByText("Send us your CV")).toBeInTheDocument(),
    );
    /* `find*`, not `get*`: the candidate form is deferred (see
       candidate-form-lazy.tsx — it carries the upload engine, which is why the
       careers route fits its own budget). So this also asserts the thing the
       deferral could break, which is that the form ACTUALLY ARRIVES rather than
       leaving a placeholder where a CV box should be. */
    expect(
      await screen.findByLabelText(/The kind of work you are looking for/i),
    ).toBeInTheDocument();
    /* And the CV control, which is the shared `FileInput` rather than a copy of
       the upload engine — asserted by its LABEL, so the assertion survives the
       control being restyled and fails if the form ever grows its own picker
       again. */
    expect(await screen.findByLabelText("Your CV")).toBeInTheDocument();
  });

  it("offers the alert form only when the tenant switched alerts on", async () => {
    stubReads({
      "/careers/settings/public": { ...OFF, alerts_enabled: true },
      "/careers": [],
    });
    renderPage();

    const cta = await screen.findByRole("button", {
      name: /Tell me when a role opens/i,
    });
    expect(screen.queryByRole("button", { name: /Send your CV/i })).not.toBeInTheDocument();

    await userEvent.click(cta);
    await waitFor(() =>
      expect(screen.getByText("Hear about the next one")).toBeInTheDocument(),
    );
    // The consent line is part of the offer, not small print somewhere else.
    expect(
      screen.getByText("Used for job alerts and nothing else."),
    ).toBeInTheDocument();
  });

  it("offers both when both are on", async () => {
    stubReads({
      "/careers/settings/public": {
        open_applications: true,
        alerts_enabled: true,
        culture_tag: null,
      },
      "/careers": [],
    });
    renderPage();

    await screen.findByRole("button", { name: /Send your CV/i });
    expect(
      screen.getByRole("button", { name: /Tell me when a role opens/i }),
    ).toBeInTheDocument();
    // And the contact fallback steps aside — it is the answer for a tenant with
    // nothing to offer, not a third button.
    expect(screen.queryByRole("link", { name: "Get in touch" })).not.toBeInTheDocument();
  });

  it("treats a 404 on the vacancy list as an empty list, not a failure", async () => {
    // A tenant who has never published a role, or one without the package.
    stubReads({ "/careers/settings/public": OFF });
    renderPage();

    await waitFor(() =>
      expect(screen.getByText("No open roles right now")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
