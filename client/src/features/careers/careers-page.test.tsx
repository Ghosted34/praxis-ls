/**
 * The public careers page, as a candidate meets it.
 *
 * WHAT THESE PIN
 *
 *   - The advert renders as MARKDOWN. The drafting model writes headings and
 *     bullets and the admin's own preview shows them formatted, so a candidate
 *     was reading `## Accountant` and `- Prepare financial statements` as
 *     literal text — on the one page in the product a stranger sees.
 *   - The page SCROLLS. `html, body, #root` are `overflow: hidden` globally
 *     because the app shell owns a single scroll container; this page renders
 *     outside the shell, so it has to own one itself or every advert is clipped
 *     at the fold with no scrollbar to hint there is more.
 *   - A Test posting says so, in the candidate's terms.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const getVacancy = vi.fn();
vi.mock("@/lib/careers-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/careers-api")>(
      "@/lib/careers-api",
    );
  return { ...actual, getVacancy: (...a: unknown[]) => getVacancy(...a) };
});
vi.mock("@/app/branding/branding-context", () => ({
  useBranding: () => ({ branding: { name: "Smart Logistics", logoUrl: null } }),
}));

import { CareersPage } from "./careers-page";

const ROLE = {
  token: "tok",
  title: "Accountant",
  skills_required: [],
  description:
    "## Accountant\n\nWe are hiring.\n\n### Responsibilities\n- Keep the books\n- Reconcile transactions",
};

function view(role: Record<string, unknown> = ROLE) {
  getVacancy.mockResolvedValue(role);
  return render(
    <MemoryRouter initialEntries={["/careers/tok"]}>
      <Routes>
        <Route path="/careers/:token" element={<CareersPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("the public careers page", () => {
  it("renders the advert as markdown, not as its own source", async () => {
    view();
    // The heading is a heading…
    expect(
      await screen.findByRole("heading", { name: "Responsibilities" }),
    ).toBeInTheDocument();
    // …and the hashes and hyphens are gone from the text.
    expect(screen.queryByText(/^## Accountant/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^- Keep the books/)).not.toBeInTheDocument();
    expect(screen.getByText("Keep the books")).toBeInTheDocument();
  });

  it("owns a scroll container, because nothing above it does", async () => {
    const { container } = view();
    await screen.findByRole("heading", { name: "Responsibilities" });
    // Not a style preference: with `overflow: hidden` on #root and no scroller
    // here, everything below the fold is unreachable.
    expect((container.firstChild as HTMLElement).className).toContain(
      "overflow-y-auto",
    );
  });

  it("tells a reader when the posting is only a test", async () => {
    view({ ...ROLE, environment: "sandbox" });
    expect(await screen.findByText(/test posting/i)).toBeInTheDocument();
  });

  it("says nothing about environments on a live role", async () => {
    view({ ...ROLE, environment: "live" });
    await screen.findByRole("heading", { name: "Responsibilities" });
    expect(screen.queryByText(/test posting/i)).not.toBeInTheDocument();
  });
});
