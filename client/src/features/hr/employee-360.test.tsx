/**
 * EDIT EMPLOYEE — the caret stays in the field you are typing in.
 *
 * WHAT THIS PINS, AND WHY IT IS WORTH A FILE
 *
 * The form was unusable and the cause was one line of nesting. `Section` — the
 * bordered fieldset that wraps all five groups of the form — was declared
 * INSIDE EditEmployeeForm's render body. A component declared there is a new
 * function object on every render, React reconciles by element type, and a
 * changed type is an unmount-and-remount rather than an update. So every
 * keystroke tore down the whole fieldset, destroyed the live <input> the caret
 * was in, and built a fresh one: you typed one character and focus was gone.
 *
 * Nothing else in the tree could have caught it. It is not a lint error (the
 * client has no eslint-plugin-react), it is not a type error, and it is not
 * visible in a render-once test — a screen that mounts, asserts its fields are
 * present and never types is green on a form nobody can fill in. It takes a
 * SECOND keystroke to see, because the first one still lands.
 *
 * Hence the assertions below: the DOM node survives typing (that is the defect,
 * stated exactly), and a whole word arrives (that is what the user reported).
 * Both fail on the old code; the second is the one whose failure message reads
 * like the bug report.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

const updateEmployee = vi.fn();
const employeeDocuments = vi.fn();
const addEmployeeDocument = vi.fn();
const updateEmployeeDocument = vi.fn();

vi.mock("@/lib/hr-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hr-api")>("@/lib/hr-api");
  return {
    ...actual,
    updateEmployee: (...a: unknown[]) => updateEmployee(...a),
    employeeDocuments: (...a: unknown[]) => employeeDocuments(...a),
    addEmployeeDocument: (...a: unknown[]) => addEmployeeDocument(...a),
    updateEmployeeDocument: (...a: unknown[]) => updateEmployeeDocument(...a),
    employeeReadinessRequirements: async () => REQUIREMENTS,
  };
});

import * as api from "@/lib/hr-api";
import { EditEmployeeForm } from "./employee-360";

/**
 * The server's requirement list, as `GET /employees/readiness-requirements`
 * serves it. `when` and `needs` are the licence rule, and they live on the
 * SERVED list rather than in this bundle so the form and the generator cannot
 * disagree about what a licence is.
 */
const REQUIREMENTS = {
  fields: [
    { key: "full_name", label: "Full name", group: "identity", severity: "required" },
  ],
  documents: [
    { code: "EMP_ID_CARD", label: "ID card / passport", severity: "required" },
    {
      code: "EMP_DRIVING_LICENCE",
      label: "Driving licence (number and validity)",
      severity: "required",
      when: "is_driver",
      needs: ["document_number", "issued_on", "expires_on"],
    },
  ],
};

/** The minimum a saved record needs — `draftFrom` defaults every other column. */
const EMPLOYEE = {
  employee_id: "emp-1",
  full_name: "Elisha Godwin",
  status: "ACTIVE",
} as api.Employee;

function openForm(employee: api.Employee = EMPLOYEE) {
  return renderScreen(
    <EditEmployeeForm
      employee={employee}
      onClose={() => {}}
      onSaved={() => {}}
    />,
    { routes: { "/entities": [], "/employees": [] } },
  );
}

describe("Edit employee — typing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    employeeDocuments.mockResolvedValue([]);
    updateEmployee.mockResolvedValue(EMPLOYEE);
  });

  it("keeps the caret in the field after a keystroke", async () => {
    const user = userEvent.setup();
    openForm();

    const input = await screen.findByRole("textbox", { name: /Full name/ });
    await user.click(input);
    expect(document.activeElement).toBe(input);

    await user.keyboard("s");

    // The defect, stated as precisely as it can be: with `Section` nested this
    // is a DIFFERENT element, and the one the caret was in has been thrown
    // away. Note it is ANY re-render that does it, not only a keystroke — with
    // the bug in place even the mount-time `/entities` response was enough, and
    // Radix's focus trap then parked the caret on the dialog's close button.
    // With Section at module scope no re-render can move it at all, which is
    // why every assertion here is deterministic rather than a race.
    expect(document.body.contains(input)).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("accepts a whole word, not just its first letter", async () => {
    const user = userEvent.setup();
    openForm();

    const input = await screen.findByRole("textbox", { name: /Full name/ });
    await user.clear(input);
    await user.type(input, "Elisha Godwin");

    // On the old code this stopped at "E": every character after the first was
    // typed into <body>, because the input it was aimed at no longer existed.
    expect(screen.getByRole("textbox", { name: /Full name/ })).toHaveValue(
      "Elisha Godwin",
    );
  });

  it("holds focus in a field in a different section", async () => {
    const user = userEvent.setup();
    openForm();

    // "Place of birth" lives in Identity, "Place of work" in The engagement —
    // a second section, so this pins the remount rather than one lucky field.
    const input = await screen.findByRole("textbox", { name: /Place of work/ });
    await user.click(input);
    await user.type(input, "Douala");

    expect(document.activeElement).toBe(input);
    expect(input).toHaveValue("Douala");
  });
});

/**
 * THE DRIVING LICENCE — "This person drives" is an assignment, not a note.
 *
 * Ticking it puts somebody in the fleet dispatch pool, and the next thing that
 * happens to a person in that pool is a vehicle being dispatched to them. So
 * the box cannot be ticked without the licence: its number and the window it is
 * valid for. The API refuses the same thing with DRIVER_LICENCE_REQUIRED; these
 * pin that the form refuses it FIRST, with the fields on screen, rather than
 * letting the operator discover it after a round trip.
 *
 * What is NOT required is the scan. That is 12764's rule — a scan is a
 * verification gate, not a creation gate — and the last test here is the one
 * that stops somebody "tidying up" by making the upload mandatory too.
 */
describe("Edit employee — the driving licence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    employeeDocuments.mockResolvedValue([]);
    updateEmployee.mockResolvedValue(EMPLOYEE);
    addEmployeeDocument.mockResolvedValue({ document_id: "doc-1" });
    updateEmployeeDocument.mockResolvedValue({ document_id: "doc-1" });
  });

  const drives = () => screen.getByRole("checkbox", { name: /This person drives/ });
  const save = () => screen.getByRole("button", { name: /Save changes/ });

  it("stays out of the way until the box is ticked", async () => {
    openForm();
    await screen.findByRole("textbox", { name: /Full name/ });

    expect(screen.queryByRole("textbox", { name: /Licence number/ })).toBeNull();
    expect(save()).toBeEnabled();
  });

  it("blocks the save and names what is still needed", async () => {
    const user = userEvent.setup();
    openForm();
    await screen.findByRole("textbox", { name: /Full name/ });

    await user.click(drives());

    expect(await screen.findByRole("textbox", { name: /Licence number/ })).toBeInTheDocument();
    expect(save()).toBeDisabled();
    // A disabled button with no sentence beside it is a dead end.
    const callout = screen.getByText(/Still needed:/);
    expect(callout.textContent).toMatch(/licence number/);
    expect(callout.textContent).toMatch(/valid from/);
    expect(callout.textContent).toMatch(/valid until/);
  });

  it("writes the licence BEFORE the flag, so a failure cannot strand a driver", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    addEmployeeDocument.mockImplementation(async () => {
      order.push("document");
      return { document_id: "doc-1" };
    });
    updateEmployee.mockImplementation(async () => {
      order.push("employee");
      return EMPLOYEE;
    });

    openForm();
    await screen.findByRole("textbox", { name: /Full name/ });
    await user.click(drives());

    await user.type(
      await screen.findByRole("textbox", { name: /Licence number/ }),
      "CM-000-123",
    );
    // `DateField` is day-first and masks as you type: eight digits, not an ISO
    // string. It stores the ISO date the API wants — see date-field.tsx.
    await user.type(screen.getByRole("textbox", { name: /Valid from/ }), "14052021");
    await user.type(screen.getByRole("textbox", { name: /Valid until/ }), "14052031");

    expect(save()).toBeEnabled();
    await user.click(save());

    await waitFor(() => expect(updateEmployee).toHaveBeenCalled());
    // Licence first. The other order leaves a driver in the dispatch pool with
    // no licence when the second call fails — the exact state being prevented.
    expect(order).toEqual(["document", "employee"]);
    expect(addEmployeeDocument.mock.calls[0][1]).toMatchObject({
      document_type_code: "EMP_DRIVING_LICENCE",
      document_number: "CM-000-123",
      issued_on: "2021-05-14",
      expires_on: "2031-05-14",
    });
    expect(updateEmployee.mock.calls[0][1]).toMatchObject({ is_driver: true });
  });

  it("amends the licence already on file rather than opening a second row", async () => {
    const user = userEvent.setup();
    employeeDocuments.mockResolvedValue([
      {
        document_id: "doc-existing",
        document_type_code: "EMP_DRIVING_LICENCE",
        document_number: "CM-OLD-1",
        issued_on: "2016-01-04",
        expires_on: "2026-01-04",
        has_file: true,
      },
    ]);

    openForm({ ...EMPLOYEE, is_driver: true } as api.Employee);

    // Seeded from the row on file, so a renewal is an edit and not a re-type.
    const number = await screen.findByRole("textbox", { name: /Licence number/ });
    await waitFor(() => expect(number).toHaveValue("CM-OLD-1"));
    expect(save()).toBeEnabled();

    await user.clear(number);
    await user.type(number, "CM-NEW-9");
    await user.click(save());

    await waitFor(() => expect(updateEmployeeDocument).toHaveBeenCalled());
    expect(addEmployeeDocument).not.toHaveBeenCalled();
    expect(updateEmployeeDocument.mock.calls[0][1]).toBe("doc-existing");
    expect(updateEmployeeDocument.mock.calls[0][2]).toMatchObject({
      document_number: "CM-NEW-9",
    });
  });

  it("does not require the scan — a licence recorded from paper saves", async () => {
    const user = userEvent.setup();
    openForm();
    await screen.findByRole("textbox", { name: /Full name/ });
    await user.click(drives());

    await user.type(
      await screen.findByRole("textbox", { name: /Licence number/ }),
      "CM-000-123",
    );
    // `DateField` is day-first and masks as you type: eight digits, not an ISO
    // string. It stores the ISO date the API wants — see date-field.tsx.
    await user.type(screen.getByRole("textbox", { name: /Valid from/ }), "14052021");
    await user.type(screen.getByRole("textbox", { name: /Valid until/ }), "14052031");

    // No file picked, and that is the point: 12764's rule is that a scan is a
    // verification gate, not a creation gate.
    expect(save()).toBeEnabled();
    await user.click(save());
    await waitFor(() => expect(updateEmployee).toHaveBeenCalled());
    expect(addEmployeeDocument.mock.calls[0][1].file_data_url).toBeNull();
  });
});
