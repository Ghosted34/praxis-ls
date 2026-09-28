/**
 * A client's account manager card (client portal PR 3, 14200): who looks after
 * the client, chosen with the employee picker — people with a login only,
 * because an account manager is someone a client's message must reach — and
 * removed only after a confirmation that says where the messages go instead.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen } from "@/test/screen-harness";

const calls = vi.hoisted(() => [] as { path: string; method?: string; body?: unknown }[]);

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  const base = await apiClientMock();
  return {
    ...base,
    tenant: (path: string, opts?: { method?: string; body?: unknown }) => {
      calls.push({ path, method: opts?.method, body: opts?.body });
      return base.tenant(path);
    },
  };
});

import { AccountManagerCard } from "./account-manager";

const AWA = { user_id: "u-awa", name: "Awa Ndiaye", job_title: "Key account manager", email: "awa@praxis.test", employee_id: "e-awa", reachable: true };
const EMPLOYEES = [
  { employee_id: "e-paul", full_name: "Paul Mbida", job_title: "Operations", account_user_id: "u-paul" },
  // No login: an alert could never reach them, so the picker does not offer them.
  { employee_id: "e-ines", full_name: "Inès Fouda", job_title: "Driver", account_user_id: null },
];

const mount = (manager: unknown, onChange = vi.fn()) => {
  renderScreen(<AccountManagerCard clientId="c1" onChange={onChange} />, {
    routes: {
      "/clients/c1/account-manager": { client_id: "c1", manager },
      // Not /employees: the people who assign hold the Client inbox, not the
      // employee master, so the picker searches the narrow candidates read.
      "/clients/account-manager-candidates": EMPLOYEES,
    },
  });
  return onChange;
};

const writes = () => calls.filter((c) => c.method === "PUT");

beforeEach(() => {
  calls.length = 0;
});

describe("the account manager card", () => {
  it("names who looks after the client, with their job", async () => {
    mount(AWA);
    expect(await screen.findByText("Awa Ndiaye")).toBeInTheDocument();
    expect(screen.getByText("Key account manager")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toBeInTheDocument();
    expect(screen.queryByText("No active login")).toBeNull();
  });

  it("says when the manager can no longer be reached", async () => {
    mount({ ...AWA, reachable: false });
    expect(await screen.findByText("No active login")).toBeInTheDocument();
  });

  it("says where messages go while nobody is named", async () => {
    mount(null);
    expect(await screen.findByText("Nobody yet — messages go to the client inbox team")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("assigns someone with a login through the employee picker", async () => {
    const user = userEvent.setup();
    const onChange = mount(null);
    await user.click(await screen.findByRole("button", { name: "Assign" }));
    await user.click(screen.getByRole("combobox"));

    expect(await screen.findByRole("option", { name: /Paul Mbida/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Inès Fouda/ })).toBeNull();
    // Searched where sales and operations are allowed to look — never the
    // employee master, which they do not hold.
    expect(calls.some((c) => c.path.startsWith("/clients/account-manager-candidates?"))).toBe(true);
    expect(calls.some((c) => c.path.startsWith("/employees"))).toBe(false);

    await user.click(screen.getByRole("option", { name: /Paul Mbida/ }));
    expect(writes()).toEqual([{ path: "/clients/c1/account-manager", method: "PUT", body: { user_id: "u-paul" } }]);
    expect(await screen.findByText("Account manager saved")).toBeInTheDocument();
    expect(onChange).toHaveBeenCalled();
  });

  it("removes one only once confirmed", async () => {
    const user = userEvent.setup();
    mount(AWA);
    await user.click(await screen.findByRole("button", { name: "Remove" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Remove the account manager?")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Keep" }));
    expect(writes()).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));
    expect(writes()).toEqual([{ path: "/clients/c1/account-manager", method: "PUT", body: { user_id: null } }]);
    expect(await screen.findByText("Account manager removed")).toBeInTheDocument();
  });
});
