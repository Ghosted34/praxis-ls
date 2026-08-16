/**
 * The vacancy editor — the screen a drafted advert lands in.
 *
 * WHAT THESE PIN
 *
 *   - Who wrote it is visible. A `template` draft is a real, editable advert
 *     that no model saw, and the failure worth preventing is somebody
 *     publishing it believing otherwise (0526's own words).
 *   - The advert is editable AS TEXT, and previewable as the markdown the
 *     careers page renders.
 *   - Save sends the whole shape — including the skills the AI scorer measures
 *     applicants against, which are typed as a list and must not be saved as
 *     one string.
 *   - An inverted salary band is refused HERE, with the message on the field,
 *     rather than by a CHECK constraint arriving as a 500.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

const updateVacancy = vi.fn();
const vacancyPlaceSearch = vi.fn();
vi.mock("@/lib/hr-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/hr-api")>("@/lib/hr-api");
  return {
    ...actual,
    updateVacancy: (...a: unknown[]) => updateVacancy(...a),
    vacancyPlaceSearch: (...a: unknown[]) => vacancyPlaceSearch(...a),
  };
});

import { VacancyEditor } from "./vacancy-editor";
import type { Vacancy } from "@/lib/hr-api";

// Typed as the real row, so a test can vary a field the editor added without
// the fixture's inferred shape refusing it.
const DRAFT: Vacancy = {
  vacancy_id: "v9",
  title: "Senior Stylist",
  department: "Salon",
  status: "DRAFT",
  employment_type: "Full-time",
  location: "Douala · On-site",
  headcount: 3,
  experience_years_min: 3,
  skills_required: ["Colour", "Cutting"],
  salary_min: 150000,
  salary_max: 250000,
  salary_currency: "XAF",
  ai_provider: "deepseek",
  description: "# Senior Stylist\n\nWe are hiring.",
};

function view(vacancy = DRAFT) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const r = renderScreen(
    <VacancyEditor vacancy={vacancy} onClose={onClose} onSaved={onSaved} />,
    {},
  );
  return { ...r, onSaved, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  updateVacancy.mockResolvedValue({ ...DRAFT, title: "Lead Stylist" });
  vacancyPlaceSearch.mockResolvedValue({
    status: "OK",
    query: "douala",
    results: [
      {
        provider_place_id: "p1",
        name: "Douala",
        formatted: "Douala, Littoral, Cameroon",
        region: "Littoral",
        country: "CM",
        latitude: 4.05,
        longitude: 9.7,
      },
    ],
  });
});

describe("the vacancy editor", () => {
  it("says which model drafted it", async () => {
    view();
    expect(await screen.findByText("Drafted by deepseek")).toBeInTheDocument();
    expect(screen.queryByText(/No AI wrote this/)).not.toBeInTheDocument();
  });

  it("warns, in full, when no model was reachable", async () => {
    view({ ...DRAFT, ai_provider: "template" });
    expect(await screen.findByText("No AI wrote this")).toBeInTheDocument();
    expect(screen.getByText(/read it closely before you publish/)).toBeInTheDocument();
  });

  it("previews the advert as the markdown the careers page renders", async () => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole("button", { name: "Preview" }));
    // The heading is rendered, not shown as literal `#`.
    expect(
      screen.getByRole("heading", { name: "Senior Stylist" }),
    ).toBeInTheDocument();
  });

  it("saves the advert, with the skills as a list", async () => {
    const user = userEvent.setup();
    const { onSaved } = view();
    // `Title` carries a required marker, so the label text is "Title *".
    await user.clear(screen.getByLabelText(/^Title/));
    await user.type(screen.getByLabelText(/^Title/), "Lead Stylist");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateVacancy).toHaveBeenCalledWith(
      "v9",
      expect.objectContaining({
        title: "Lead Stylist",
        headcount: 3,
        salary_min: 150000,
        salary_max: 250000,
        skills_required: ["Colour", "Cutting"],
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("refuses an inverted salary band on the field, not at the database", async () => {
    const user = userEvent.setup();
    view();
    const top = screen.getByLabelText("Salary to (XAF/month)");
    await user.clear(top);
    await user.type(top, "1000");

    expect(
      screen.getByText("The top of the band must not be below the bottom."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(updateVacancy).not.toHaveBeenCalled();
  });

  it("saves the working pattern, the address and the start date", async () => {
    const user = userEvent.setup();
    view();
    await user.type(screen.getByLabelText("Working hours"), "9am–5pm, Mon–Fri");
    await user.type(screen.getByLabelText("Days on-site"), "4");
    await user.type(screen.getByLabelText("City"), "Douala");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateVacancy).toHaveBeenCalledWith(
      "v9",
      expect.objectContaining({
        working_hours: "9am–5pm, Mon–Fri",
        days_on_site: 4,
        location_city: "Douala",
      }),
    );
  });

  it("clears a field rather than leaving the old value on the advert", async () => {
    const user = userEvent.setup();
    view({ ...DRAFT, working_hours: "9–5", days_on_site: 5 });
    await user.clear(screen.getByLabelText("Working hours"));
    await user.clear(screen.getByLabelText("Days on-site"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    // null, not undefined — undefined would be "leave it alone".
    const patch = updateVacancy.mock.calls[0][1];
    expect(patch.working_hours).toBeNull();
    expect(patch.days_on_site).toBeNull();
  });

  it("carries the confidential-salary flag and what applicants must send", async () => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getByLabelText("Keep the salary confidential"));
    await user.click(screen.getByLabelText("A covering note"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateVacancy).toHaveBeenCalledWith(
      "v9",
      expect.objectContaining({
        salary_hidden: true,
        apply_config: { require_cover_letter: true, require_portfolio: false },
      }),
    );
  });

  it("keeps the department scope it was given", async () => {
    const user = userEvent.setup();
    view({ ...DRAFT, scope_id: "scope-7" });
    // Saving without touching the department control must not unassign the
    // vacancy from the organigramme — `scope_id` is what record-level access
    // filters on and what the hire inherits.
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(updateVacancy.mock.calls[0][1].scope_id).toBe("scope-7");
  });

  it("fills city, region and country from the place search", async () => {
    const user = userEvent.setup();
    view();
    await user.type(screen.getByLabelText("Find a city"), "douala");
    await user.click(await screen.findByText("Douala, Littoral, Cameroon"));

    // The country arrives as an ISO code; an advert wants the word, which the
    // formatted line ends with.
    expect(screen.getByLabelText("City")).toHaveValue("Douala");
    expect(screen.getByLabelText("State / region")).toHaveValue("Littoral");
    expect(screen.getByLabelText("Country")).toHaveValue("Cameroon");
  });

  it("says WHY a search found nothing, and leaves the fields typeable", async () => {
    const user = userEvent.setup();
    vacancyPlaceSearch.mockResolvedValue({ status: "NO_KEY", results: [], query: "d" });
    view();
    await user.type(screen.getByLabelText("Find a city"), "douala");

    // A bare "no results" would turn an unconfigured provider into a recruiter
    // believing their own city does not exist.
    expect(await screen.findByText(/isn't configured/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("City"), "Douala");
    expect(screen.getByLabelText("City")).toHaveValue("Douala");
  });

  it("has no accessibility violations", async () => {
    const { container } = view();
    expect(await axe(container)).toHaveNoViolations();
  });
});
