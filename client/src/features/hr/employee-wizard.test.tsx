/**
 * NEW EMPLOYEE — the three-step hire.
 *
 * WHAT THESE PIN
 *
 *   - The progress bar is a real progressbar, and it moves. A coloured div that
 *     only a sighted user can read is not a progress indicator.
 *   - Only the name blocks. Every other field can be left, because a wizard that
 *     refuses to let you past step two gets an invented CNI number — and an
 *     invented one is worse than a blank, which is at least countable.
 *   - The maiden name appears only where one exists. « Née SPECIMEN Epse EXEMPLE »
 *     is a married woman's two names; asking everybody gets the field filled
 *     with the surname they already typed.
 *   - The payload carries the whole contract: the civil identity, the terms, the
 *     documents and the standing pay lines, in ONE call. Three calls would leave
 *     an employee half-created when the second failed.
 *   - The gross is the base plus the cash allowances, and it is shown before
 *     saving. Article 3 of a contract is a table that has to add up.
 *   - "Provision" is handed to the caller, not navigated to from inside — it
 *     leaves the HR area, and the screen that owns the route decides that.
 *   - The working week is a GRID, and the sentence the contract prints is
 *     derived from it. A remote Friday was unrecordable while that was one free
 *     text field, and a line typed separately from the days drifts from them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

const createEmployee = vi.fn();
const employeeReadinessRequirements = vi.fn();

vi.mock("@/lib/hr-api", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/hr-api")>("@/lib/hr-api");
  return {
    ...actual,
    createEmployee: (...a: unknown[]) => createEmployee(...a),
    employeeReadinessRequirements: (...a: unknown[]) =>
      employeeReadinessRequirements(...a),
  };
});

import { ApiError } from "@/lib/api-client";
import { EmployeeWizard } from "./employee-wizard";

/** A slice of the server's real list — enough to score a draft against. */
const REQUIREMENTS = {
  fields: [
    { key: "full_name", label: "Full name", group: "identity", severity: "required" },
    { key: "place_of_birth", label: "Place of birth", group: "identity", severity: "required" },
    { key: "father_name", label: "Father's name", group: "identity", severity: "required" },
    { key: "staff_no", label: "Matricule", group: "employment", severity: "required" },
    { key: "cnps_number", label: "CNPS number", group: "employment", severity: "recommended" },
  ],
  documents: [
    { code: "EMP_ID_CARD", label: "ID card / passport", severity: "required" },
    // `when` and `needs` are the driving-licence rule, and they ride on the
    // SERVED list rather than being copied into the bundle — see the block at
    // the bottom of this file for what they buy.
    {
      code: "EMP_DRIVING_LICENCE",
      label: "Driving licence (number and validity)",
      severity: "required",
      when: "is_driver",
      needs: ["document_number", "issued_on", "expires_on"],
    },
  ],
};

const setup = () => userEvent.setup({ delay: null });
const onSaved = vi.fn();
const onClose = vi.fn();

const render = () =>
  renderScreen(<EmployeeWizard onClose={onClose} onSaved={onSaved} />, {
    routes: {
      "/entities": [{ entity_id: "e1", legal_name: "SMART LOGISTICS & SERVICES LIMITED" }],
      "/employees": [
        { employee_id: "m1", full_name: "Timothée MASSOMBA", job_title: "Directeur Général" },
      ],
      "/currencies": [
        { code: "XAF", name: "CFA franc BEAC", is_base: true },
        { code: "EUR", name: "Euro" },
      ],
      "/scopes/options": [],
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  employeeReadinessRequirements.mockResolvedValue(REQUIREMENTS);
  createEmployee.mockResolvedValue({ employee_id: "emp-9", full_name: "SPECIMEN Marie" });
});

const nameBox = () => screen.getByLabelText(/^Full name/i);

describe("the progress bar", () => {
  it("is a real progressbar, and it advances with the steps", async () => {
    const u = setup();
    render();
    const bar = await screen.findByRole("progressbar", { name: /Progress through/i });
    expect(bar).toHaveAttribute("aria-valuenow", "33");
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    expect(bar).toHaveAttribute("aria-valuenow", "67");
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    expect(bar).toHaveAttribute("aria-valuenow", "100");
  });

  it("counts the contract fields the SERVER says are required, and only those", async () => {
    // Four required entries in the fixture; the matricule is excluded because
    // the server allocates it, so the meter can actually reach its total.
    render();
    expect(await screen.findByText(/0\/4 contract fields filled/i)).toBeInTheDocument();
  });

  it("moves as facts are typed", async () => {
    const u = setup();
    render();
    await screen.findByText(/0\/4 contract fields filled/i);
    await u.type(nameBox(), "SPECIMEN Marie Claire");
    await u.type(screen.getByLabelText(/Place of birth/i), "BAFIA");
    expect(await screen.findByText(/2\/4 contract fields filled/i)).toBeInTheDocument();
  });
});

describe("what blocks and what does not", () => {
  it("saving is refused with no name, and allowed with nothing else", async () => {
    const u = setup();
    render();
    await u.click(await screen.findByRole("button", { name: /Continue/i }));
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    const save = screen.getByRole("button", { name: /Save/i });
    expect(save).toBeDisabled();
  });

  it("a name alone is enough to reach a saved record", async () => {
    const u = setup();
    render();
    await u.type(await nameBox(), "SPECIMEN Marie Claire");
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.click(screen.getByRole("button", { name: /Save/i }));
    expect(createEmployee).toHaveBeenCalledTimes(1);
    expect(createEmployee.mock.calls[0][0]).toMatchObject({
      full_name: "SPECIMEN Marie Claire",
    });
  });

  it("says what is still missing rather than refusing the save", async () => {
    const u = setup();
    render();
    await u.type(await nameBox(), "A B");
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    expect(screen.getByText(/cannot produce a contract yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Place of birth/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save/i })).toBeEnabled();
  });
});

describe("the maiden name only exists where one does", () => {
  it("is hidden by default", async () => {
    render();
    await screen.findByLabelText(/^Full name/i);
    expect(screen.queryByLabelText(/Maiden name/i)).not.toBeInTheDocument();
  });

  it("stays hidden for a married man", async () => {
    const u = setup();
    render();
    await u.selectOptions(await screen.findByLabelText(/^Gender/i), "MALE");
    await u.selectOptions(screen.getByLabelText(/Marital status/i), "MARRIED");
    expect(screen.queryByLabelText(/Maiden name/i)).not.toBeInTheDocument();
  });

  it("stays hidden for a single woman", async () => {
    const u = setup();
    render();
    await u.selectOptions(await screen.findByLabelText(/^Gender/i), "FEMALE");
    await u.selectOptions(screen.getByLabelText(/Marital status/i), "SINGLE");
    expect(screen.queryByLabelText(/Maiden name/i)).not.toBeInTheDocument();
  });

  it("appears for a married woman — the « Née … Epse … » case", async () => {
    const u = setup();
    render();
    await u.selectOptions(await screen.findByLabelText(/^Gender/i), "FEMALE");
    await u.selectOptions(screen.getByLabelText(/Marital status/i), "MARRIED");
    expect(screen.getByLabelText(/Maiden name/i)).toBeInTheDocument();
  });
});

describe("the payload", () => {
  it("carries the civil identity the contract's clause names", async () => {
    const u = setup();
    render();
    await u.type(await nameBox(), "SPECIMEN Marie Claire");
    await u.type(screen.getByLabelText(/Place of birth/i), "BAFIA");
    await u.type(screen.getByLabelText(/Father's name/i), "SPECIMEN Jean");
    await u.type(screen.getByLabelText(/Mother's name/i), "EXEMPLE Rose");
    await u.type(screen.getByLabelText(/^Number/i), "000000000");
    await u.type(screen.getByLabelText(/Issued at/i), "CE00");
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.click(screen.getByRole("button", { name: /Save/i }));
    expect(createEmployee.mock.calls[0][0]).toMatchObject({
      full_name: "SPECIMEN Marie Claire",
      place_of_birth: "BAFIA",
      father_name: "SPECIMEN Jean",
      mother_name: "EXEMPLE Rose",
      id_document_number: "000000000",
      id_document_issued_at: "CE00",
    });
  });

  it("omits an untouched field rather than sending an empty string", async () => {
    // "" in a column prints as "" in a contract — « Né le  à  » — instead of
    // being detectably absent.
    const u = setup();
    render();
    await u.type(await nameBox(), "A B");
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.click(screen.getByRole("button", { name: /Save/i }));
    const body = createEmployee.mock.calls[0][0];
    expect(body.place_of_birth).toBeUndefined();
    expect(body.mother_name).toBeUndefined();
  });

  it("sends the standing pay lines with the hire, in one call", async () => {
    const u = setup();
    render();
    await u.type(await nameBox(), "A B");
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.type(screen.getByLabelText(/Base salary/i), "600000");
    await u.click(screen.getByRole("button", { name: /Add a line/i }));
    await u.type(screen.getByLabelText(/^Label/i), "Prime de responsabilité");
    await u.type(screen.getByLabelText(/^Amount/i), "50000");
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.click(screen.getByRole("button", { name: /Save/i }));
    expect(createEmployee).toHaveBeenCalledTimes(1);
    const body = createEmployee.mock.calls[0][0];
    expect(body.base_salary).toBe(600000);
    expect(body.allowances).toEqual([
      expect.objectContaining({ label: "Prime de responsabilité", amount: 50000 }),
    ]);
  });

  it("shows the gross the contract will print, before it is saved", async () => {
    const u = setup();
    render();
    await u.type(await nameBox(), "A B");
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.type(screen.getByLabelText(/Base salary/i), "600000");
    await u.click(screen.getByRole("button", { name: /Add a line/i }));
    await u.type(screen.getByLabelText(/^Label/i), "Prime");
    await u.type(screen.getByLabelText(/^Amount/i), "50000");
    // 600,000 + 50,000 = 650,000 — the figure in Article 3.
    expect(screen.getByText(/650[\s\u00a0\u202f]?000/)).toBeInTheDocument();
  });

  it("drops an allowance row that was added and never filled in", async () => {
    const u = setup();
    render();
    await u.type(await nameBox(), "A B");
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.click(screen.getByRole("button", { name: /Add a line/i }));
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.click(screen.getByRole("button", { name: /Save/i }));
    expect(createEmployee.mock.calls[0][0].allowances).toEqual([]);
  });
});

describe("handing over to provisioning", () => {
  it("asks for a login when there is an address to invite, and says so", async () => {
    const u = setup();
    render();
    await u.type(await nameBox(), "A B");
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.type(screen.getByLabelText(/Work email/i), "florence@smartls.cm");
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    // The button names the outcome, so nobody is surprised by the navigation.
    await u.click(screen.getByRole("button", { name: /Save and provision/i }));
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ employee_id: "emp-9" }),
      true,
    );
  });

  it("cannot provision without an email, and explains why", async () => {
    const u = setup();
    render();
    await u.type(await nameBox(), "A B");
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    expect(
      screen.getByLabelText(/Provision a login for this person/i),
    ).toBeDisabled();
    await u.click(screen.getByRole("button", { name: /Save employee/i }));
    expect(onSaved).toHaveBeenCalledWith(expect.anything(), false);
  });
});

describe("an oversized scan", () => {
  it("is refused in the browser, before a minute is spent uploading it", async () => {
    const u = setup();
    render();
    await u.type(await nameBox(), "A B");
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.click(screen.getByRole("button", { name: /Continue/i }));

    // A 9 MB phone photograph. The API's ceiling is ~6 MB, and finding that out
    // after base64-encoding it over a mobile connection is the failure mode.
    const big = new File(["x"], "cni.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: 9 * 1024 * 1024 });
    const input = screen.getAllByLabelText(/PNG, JPG, WebP or PDF/i)[0];
    await u.upload(input as HTMLInputElement, big);

    expect(await screen.findByText(/the limit is 6 MB/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save/i })).toBeDisabled();
    expect(createEmployee).not.toHaveBeenCalled();
  });
});

describe("when the save fails", () => {
  it("shows the rejection and returns to the step the FIELD is on", async () => {
    const u = setup();
    createEmployee.mockRejectedValue(
      new ApiError("VALIDATION_ERROR", "Invalid body", 422, {
        date_of_birth: ["Use a date in the form YYYY-MM-DD"],
      }),
    );
    render();
    await u.type(await nameBox(), "A B");
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.click(screen.getByRole("button", { name: /Save/i }));
    expect(
      await screen.findByText(/Use a date in the form YYYY-MM-DD/i),
    ).toBeInTheDocument();
    // Back on step 1, where the offending field lives — not two steps away.
    expect(screen.getByLabelText(/^Full name/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("returns to the employment step when that is where the field is", async () => {
    const u = setup();
    createEmployee.mockRejectedValue(
      new ApiError("VALIDATION_ERROR", "Invalid body", 422, {
        base_salary: ["Expected number"],
      }),
    );
    render();
    await u.type(await nameBox(), "A B");
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.click(screen.getByRole("button", { name: /Save/i }));
    await screen.findByText(/Expected number/i);
    expect(screen.getByLabelText(/Base salary/i)).toBeInTheDocument();
  });

  it("stays where it is when the rejection names no field", async () => {
    // A 500 or a network error says nothing about which step is wrong, and
    // throwing the operator back to step 1 for it loses their place for nothing.
    const u = setup();
    createEmployee.mockRejectedValue(
      new ApiError("SERVER_ERROR", "Something went wrong.", 500),
    );
    render();
    await u.type(await nameBox(), "A B");
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.click(screen.getByRole("button", { name: /Save/i }));
    await screen.findByText(/Something went wrong/i);
    expect(
      screen.getByLabelText(/Provision a login for this person/i),
    ).toBeInTheDocument();
  });
});

describe("the working week", () => {
  /** Step 2 is where the grid lives. */
  const toEmployment = async (u: ReturnType<typeof setup>) => {
    await u.type(await nameBox(), "SPECIMEN Marie Claire");
    await u.click(screen.getByRole("button", { name: /Continue/i }));
  };

  it("opens on a nine-to-five, Monday to Friday, and says what will be printed", async () => {
    const u = setup();
    render();
    await toEmployment(u);
    // The default is the answer for most hires; the ones it is wrong for are
    // the ones somebody is paying attention to anyway.
    expect(screen.getByText("Mon–Fri, 09:00–17:00")).toBeInTheDocument();
    expect(screen.getByText(/40 hours a week/)).toBeInTheDocument();
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) {
      expect(screen.getByRole("button", { name: day })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }
    expect(screen.getByRole("button", { name: "Sat" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("records a day worked from home, and says so in the printed line", async () => {
    const u = setup();
    render();
    await toEmployment(u);
    await u.selectOptions(
      screen.getByLabelText(/Friday — worked from/i),
      "REMOTE",
    );
    expect(
      screen.getByText("Mon–Thu 09:00–17:00; Fri 09:00–17:00 (remote)"),
    ).toBeInTheDocument();
    expect(screen.getByText(/· Hybrid/)).toBeInTheDocument();
  });

  it("sends the grid, and the line derived from it, on the hire", async () => {
    const u = setup();
    render();
    await toEmployment(u);
    await u.click(screen.getByRole("button", { name: "Sat" }));
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.click(screen.getByRole("button", { name: /Save/i }));

    const body = createEmployee.mock.calls[0][0];
    expect(body.work_schedule.days).toHaveLength(7);
    expect(
      body.work_schedule.days.filter((d: { worked: boolean }) => d.worked),
    ).toHaveLength(6);
    // The API re-derives this from the grid on write; sending it keeps the
    // readiness meter honest about a field that IS filled in.
    expect(body.working_hours).toBe("Mon–Sat, 09:00–17:00");
  });
});

/**
 * THE DRIVING LICENCE — the second thing that blocks this wizard.
 *
 * The header of employee-wizard.tsx says nothing blocks except the name, and
 * the reasoning holds for every field it was written about: refusing to let
 * somebody past step two produces an invented CNI number, and an invented one
 * is worse than a blank because a blank is countable.
 *
 * `is_driver` is not one of those fields. It is an assignment — it puts this
 * person in the fleet dispatch pool — and there is no half-answer to invent:
 * the operator is either holding the licence or they are not, and if they are
 * not, the honest record is one with the box unticked. These tests pin BOTH
 * halves: that it blocks, and that the exception did not leak into anything
 * else on the step.
 */
describe("the driving licence", () => {
  const drives = () => screen.getByRole("checkbox", { name: /This person drives/ });

  /** Name typed, on step 3, with the drives box ticked on the way through. */
  async function toDocuments(u: ReturnType<typeof setup>, { driver = true } = {}) {
    render();
    await u.type(await nameBox(), "SPECIMEN Marie Claire");
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    if (driver) await u.click(drives());
    await u.click(screen.getByRole("button", { name: /Continue/i }));
  }

  it("is not one of the slots until somebody drives", async () => {
    const u = setup();
    await toDocuments(u, { driver: false });
    // The exact string: the slot's own heading. A regex would also match the
    // "still missing" list, which is a different assertion.
    expect(screen.queryByText("Driving licence")).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Licence number/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Save/i })).toBeEnabled();
  });

  it("appears the moment the box is ticked, and blocks the save", async () => {
    const u = setup();
    await toDocuments(u);
    expect(screen.getByText("Driving licence")).toBeInTheDocument();
    expect(
      screen.getByText(/Required — this person drives/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save/i })).toBeDisabled();
    // A disabled Save with no sentence beside it is a dead end.
    expect(screen.getByText(/Still needed:/i).textContent).toMatch(
      /licence number.*valid from.*valid until/,
    );
  });

  it("counts against the meter only for a driver", async () => {
    const u = setup();
    render();
    await u.type(await nameBox(), "SPECIMEN Marie Claire");
    // Three required fields (the matricule is server-allocated, so excluded)
    // plus the ID card = 4 before the box; the licence makes it 5.
    await screen.findByText(/1\/4 contract fields filled/i);
    await u.click(screen.getByRole("button", { name: /Continue/i }));
    await u.click(drives());
    expect(await screen.findByText(/1\/5 contract fields filled/i)).toBeInTheDocument();
  });

  it("saves once the number and both dates are given — with no scan", async () => {
    const u = setup();
    await toDocuments(u);

    await u.type(screen.getByRole("textbox", { name: /Licence number/i }), "CM-000-123");
    // Day-first and masked as you type: eight digits, not an ISO string.
    await u.type(screen.getByRole("textbox", { name: /Valid from/i }), "14052021");
    await u.type(screen.getByRole("textbox", { name: /Valid until/i }), "14052031");

    const save = screen.getByRole("button", { name: /Save/i });
    expect(save).toBeEnabled();
    await u.click(save);

    expect(createEmployee).toHaveBeenCalledTimes(1);
    const body = createEmployee.mock.calls[0][0];
    expect(body.is_driver).toBe(true);
    expect(body.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          document_type_code: "EMP_DRIVING_LICENCE",
          document_number: "CM-000-123",
          issued_on: "2021-05-14",
          expires_on: "2031-05-14",
          // 12764's rule, unchanged: a scan is a verification gate, not a
          // creation gate. The bytes are never what blocks.
          file_data_url: null,
        }),
      ]),
    );
  });

  it("keeps what was typed when the box is unticked and ticked again", async () => {
    const u = setup();
    await toDocuments(u);
    await u.type(screen.getByRole("textbox", { name: /Licence number/i }), "CM-000-123");

    // Back to step 2, untick, forward again. Re-typing a licence because you
    // went to check something is the kind of small cruelty forms get away with.
    await u.click(screen.getByRole("button", { name: /Back/i }));
    await u.click(drives());
    await u.click(drives());
    await u.click(screen.getByRole("button", { name: /Continue/i }));

    expect(screen.getByRole("textbox", { name: /Licence number/i })).toHaveValue(
      "CM-000-123",
    );
  });
});
