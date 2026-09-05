/**
 * SECURITY › USERS — creating a login.
 *
 * WHAT THESE PIN
 *
 *   - The DEFAULT path can be submitted. "Create user" gated on
 *     `password.length < 8` whether or not a password was being set — and the
 *     default is an invitation, where the field is hidden and the password is
 *     necessarily "". So the form's own default could not be submitted at all,
 *     with a disabled button and nothing on screen saying why.
 *   - The password rules shown are the ones the SERVER enforces. The hint said
 *     eight characters and the gate agreed with it; `password-policy.js` wants
 *     twelve plus complexity. An administrator could type eight, watch the form
 *     accept them, and get back a 422 naming five rules nobody had mentioned.
 *   - The employee list is a searchable picker over name, matricule and email,
 *     and it says who already has a login — `app_user.employee_id` has no
 *     unique constraint, so a second account is otherwise one silent click.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiClientMock,
  authContextMock,
  renderScreen,
} from "@/test/screen-harness";

const posts: { path: string; init?: { method?: string; body?: unknown } }[] = [];

vi.mock("@/lib/api-client", async () => {
  const base = await apiClientMock();
  return {
    ...base,
    tenant: (path: string, init?: { method?: string; body?: unknown }) => {
      if (init?.method) posts.push({ path, init });
      return base.tenant(path);
    },
  };
});
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { UsersPage } from "./users";

const STAFF = [
  {
    employee_id: "e-1",
    full_name: "Marie NGO",
    staff_no: "SLAS-014",
    job_title: "Comptable",
    email: "marie@tenant.cm",
    status: "PENDING",
    has_account: false,
  },
  {
    employee_id: "e-2",
    full_name: "Paul ATANGANA",
    staff_no: "SLAS-002",
    job_title: "Chauffeur",
    email: "paul@tenant.cm",
    status: "ACTIVE",
    has_account: true,
  },
];

const setup = () => userEvent.setup({ delay: null });

const render = () =>
  renderScreen(<UsersPage />, {
    routes: {
      "/users": [],
      "/users/employees": STAFF,
      "/roles": [{ role_id: "r-1", name: "Accountant" }],
      "/capabilities": [],
    },
  });

/** The dialog, scoped — the page behind it has an "Email" column header and a
 *  search box of its own, so an unscoped query matches three things. */
const dialog = () => within(screen.getByRole("dialog"));

const openNew = async (u: ReturnType<typeof setup>) => {
  render();
  await u.click(await screen.findByRole("button", { name: /New user/i }));
  const d = dialog();
  await u.type(d.getByLabelText(/^Full name/i), "Marie NGO");
  // By role, not by label: "Email them an invitation…" is a checkbox in the
  // same dialog whose accessible name also starts with "Email".
  await u.type(d.getByRole("textbox", { name: /^Email/i }), "marie@tenant.cm");
  return d;
};

beforeEach(() => {
  posts.length = 0;
  vi.clearAllMocks();
});

describe("creating a login by invitation", () => {
  it("can actually be submitted — the default path is not gated on a password", async () => {
    const u = setup();
    await openNew(u);
    const create = dialog().getByRole("button", { name: /Create user/i });
    expect(create).toBeEnabled();
    await u.click(create);
    expect(posts[0].init?.body).toMatchObject({
      email: "marie@tenant.cm",
      invite: true,
    });
    // Exactly one of the two ever reaches the API: a password riding along with
    // an invitation would be a second, unknown way in.
    expect(posts[0].init?.body).not.toHaveProperty("password");
  });
});

describe("the password path", () => {
  it("wants the server's twelve, not the eight the hint used to claim", async () => {
    const u = setup();
    await openNew(u);
    await u.click(
      dialog().getByRole("checkbox", { name: /Email them an invitation/i }),
    );
    const box = dialog().getByLabelText(/^Password/i);
    await u.type(box, "Passw0rd!");
    // Nine characters, and every other rule met — refused on length alone.
    expect(dialog().getByRole("button", { name: /Create user/i })).toBeDisabled();
    expect(dialog().getByText(/At least 12 characters/i)).toBeInTheDocument();
    await u.type(box, "xyz");
    expect(dialog().getByRole("button", { name: /Create user/i })).toBeEnabled();
  });

  it("refuses twelve characters that miss a rule", async () => {
    const u = setup();
    await openNew(u);
    await u.click(
      dialog().getByRole("checkbox", { name: /Email them an invitation/i }),
    );
    await u.type(dialog().getByLabelText(/^Password/i), "abcdefghijklmnop");
    expect(dialog().getByRole("button", { name: /Create user/i })).toBeDisabled();
  });
});

describe("the employee picker", () => {
  it("finds somebody by matricule, not just by the start of their name", async () => {
    const u = setup();
    await openNew(u);
    await u.click(dialog().getByRole("button", { name: /Linked employee/i }));
    await u.type(screen.getByLabelText(/Search employees/i), "SLAS-014");
    const list = screen.getByRole("listbox", { name: /Linked employee/i });
    expect(within(list).getByText("Marie NGO")).toBeInTheDocument();
    expect(within(list).queryByText("Paul ATANGANA")).not.toBeInTheDocument();
  });

  it("offers somebody who has not started yet — that is who you provision", async () => {
    // PENDING employees were filtered out by `is_active = true`, which is
    // derived from status: the one moment you provision a new hire is the one
    // moment they were missing from the list.
    const u = setup();
    await openNew(u);
    await u.click(dialog().getByRole("button", { name: /Linked employee/i }));
    const list = screen.getByRole("listbox", { name: /Linked employee/i });
    expect(within(list).getByText("Marie NGO")).toBeInTheDocument();
    expect(within(list).getByText(/Not started/i)).toBeInTheDocument();
  });

  it("marks who already has a login, and warns when one is chosen", async () => {
    const u = setup();
    await openNew(u);
    await u.click(dialog().getByRole("button", { name: /Linked employee/i }));
    const list = screen.getByRole("listbox", { name: /Linked employee/i });
    expect(within(list).getByText(/Has a login/i)).toBeInTheDocument();
    await u.click(within(list).getByText("Paul ATANGANA"));
    expect(
      dialog().getByText(/already has a login/i),
    ).toBeInTheDocument();
  });

  it("carries the chosen employee onto the account", async () => {
    const u = setup();
    await openNew(u);
    await u.click(dialog().getByRole("button", { name: /Linked employee/i }));
    await u.click(
      within(screen.getByRole("listbox", { name: /Linked employee/i })).getByText(
        "Marie NGO",
      ),
    );
    await u.click(dialog().getByRole("button", { name: /Create user/i }));
    expect(posts[0].init?.body).toMatchObject({ employee_id: "e-1" });
  });
});
