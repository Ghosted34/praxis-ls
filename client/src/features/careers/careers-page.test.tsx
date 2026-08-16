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
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const getVacancy = vi.fn();
const apply = vi.fn();
vi.mock("@/lib/careers-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/careers-api")>(
      "@/lib/careers-api",
    );
  return {
    ...actual,
    getVacancy: (...a: unknown[]) => getVacancy(...a),
    apply: (...a: unknown[]) => apply(...a),
  };
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

beforeEach(() => {
  vi.clearAllMocks();
  apply.mockResolvedValue({ received: true, reference: "A1B2C3", cv_attached: true });
});

/** Fill the two fields the form insists on, whatever the role asks for. */
async function fillIdentity(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Full name"), "Ada Mballa");
  await user.type(screen.getByLabelText("Email"), "ada@example.com");
}

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

describe("applying", () => {
  it("sends what was typed, splits the skills, and confirms with a reference", async () => {
    const user = userEvent.setup();
    view();
    await fillIdentity(user);
    await user.type(screen.getByLabelText(/Skills/), "Bookkeeping, Excel , ");
    await user.click(screen.getByRole("button", { name: /Send application/i }));

    expect(apply).toHaveBeenCalledWith(
      "tok",
      expect.objectContaining({
        full_name: "Ada Mballa",
        email: "ada@example.com",
        // Split here because the scorer matches these against the role's
        // required skills; blanks would be scored as a skill nobody can meet.
        skills: ["Bookkeeping", "Excel"],
      }),
    );
    // The one thing an applicant wants to know, answered plainly.
    expect(await screen.findByText(/Application received/)).toBeInTheDocument();
    expect(screen.getByText("A1B2C3")).toBeInTheDocument();
    expect(screen.getByText(/Your CV was attached/)).toBeInTheDocument();
  });

  it("attaches a CV as a data URL, with its filename", async () => {
    const user = userEvent.setup();
    view();
    await fillIdentity(user);
    const file = new File(["%PDF-1.4 hello"], "ada-cv.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("CV"), file);
    await user.click(screen.getByRole("button", { name: /Send application/i }));

    const body = apply.mock.calls[0][1];
    expect(body.cv_filename).toBe("ada-cv.pdf");
    expect(String(body.cv_data_url)).toMatch(/^data:application\/pdf;base64,/);
  });

  it("says so when the application went but the CV did not", async () => {
    const user = userEvent.setup();
    apply.mockResolvedValue({ received: true, reference: "Z9", cv_attached: false });
    view();
    await fillIdentity(user);
    await user.click(screen.getByRole("button", { name: /Send application/i }));

    // The server keeps the application when storage fails, so this is a real
    // state — and a candidate who thinks we have their CV when we do not is
    // a candidate lost.
    expect(await screen.findByText(/could not attach your CV/i)).toBeInTheDocument();
  });

  it("marks what this role insists on, before anything is written", async () => {
    const user = userEvent.setup();
    view({ ...ROLE, apply_config: { require_cover_letter: true } });
    await fillIdentity(user);

    expect(
      screen.getByLabelText("Your covering note (required)"),
    ).toBeInTheDocument();
    // Refused here rather than after the candidate has written everything and
    // pressed send, which is what the server alone would have done.
    expect(screen.getByRole("button", { name: /Send application/i })).toBeDisabled();

    await user.type(screen.getByLabelText("Your covering note (required)"), "I would like to apply.");
    expect(screen.getByRole("button", { name: /Send application/i })).toBeEnabled();
  });

  it("accepts the LinkedIn address people actually type", async () => {
    const user = userEvent.setup();
    view();
    await fillIdentity(user);
    const port = screen.getByLabelText(/Portfolio/);
    await user.type(port, "www.linkedin.com/in/elisha-godwin-a408543b2");
    // Blur is what repairs it, so `type="url"` has something valid to validate
    // when the form is submitted — otherwise the browser blocks with a native
    // "Please enter a URL" and the application is never sent.
    await user.tab();
    expect(port).toHaveValue(
      "https://www.linkedin.com/in/elisha-godwin-a408543b2",
    );

    await user.click(screen.getByRole("button", { name: /Send application/i }));
    expect(apply.mock.calls[0][1].portfolio_url).toBe(
      "https://www.linkedin.com/in/elisha-godwin-a408543b2",
    );
  });

  it("shows a rejected file's real reason rather than sending it", async () => {
    const user = userEvent.setup();
    view();
    await fillIdentity(user);
    // 9 MB — over the 8 MB cap, refused in the browser before it is read.
    const big = new File([new Uint8Array(9 * 1024 * 1024)], "huge.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("CV"), big);

    expect(await screen.findByText(/the limit is 8 MB/)).toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
  });
});
