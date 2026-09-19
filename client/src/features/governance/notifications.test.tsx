/**
 * The Preferences matrix — what these tests pin, and why.
 *
 * 1. THE DEFAULTS ARE THE SERVER'S, SAID OUT LOUD. A checkbox that shows
 *    "off" while emails go out is a switch nobody believes afterwards, so the
 *    Email column's default is drawn from the same shared rule the server
 *    hands to its preference read (notification-email-default.js). Tasks is
 *    the one opt-out category — the people a task notifies are the people
 *    already on it — and this is the assertion that catches the rule being
 *    wired into the delivery path but not the matrix, or vice versa.
 *
 * 2. AN OPT-OUT IS STILL A CHOICE. Unticking Email for Tasks must WRITE the
 *    preference row, because "the default changed" is not "the user asked" —
 *    the row is what beats the default on the server.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { authContextMock, renderScreen } from "@/test/screen-harness";
import * as apiClient from "@/lib/api-client";

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  const { vi } = await import("vitest");
  const mod = await apiClientMock();
  return { ...mod, tenant: vi.fn(mod.tenant), api: vi.fn(mod.api) };
});
vi.mock("@/app/auth/auth-context", async () => authContextMock());

import { NotificationsPage } from "./notifications";

/** The catalog the backend endpoint serves (GET /notifications/categories).
 *  Served by the route rather than imported, because the client consumes it
 *  over the wire — the fallback list is only for when that endpoint is down. */
const CATALOG = [
  { key: "security", label: "Security", security: true },
  { key: "approvals", label: "Approvals", security: false },
  { key: "comms", label: "Mail & Messages", security: false },
  { key: "finance", label: "Finance", security: false },
  { key: "operations", label: "Operations", security: false },
  { key: "tasks", label: "Tasks", security: false },
  { key: "sales", label: "Sales & CRM", security: false },
  { key: "compliance", label: "Compliance", security: false },
  { key: "system", label: "System", security: false },
];

type Call = [string, { method?: string; body?: Record<string, unknown> }?];
const calls = () => (apiClient.tenant as unknown as { mock: { calls: Call[] } }).mock.calls;

const show = () =>
  renderScreen(<NotificationsPage />, {
    path: "/governance/notifications",
    routes: {
      "/notifications": [],
      "/notifications/preferences": [],
      "/notifications/categories": CATALOG,
    },
  });

async function openPreferences(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("radio", { name: "Preferences" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("email defaults in the Preferences matrix", () => {
  it("shows Email ON for Tasks by default — the one opt-out category", async () => {
    const user = userEvent.setup();
    show();
    await openPreferences(user);
    expect(
      await screen.findByRole("checkbox", { name: "Email — Tasks" }),
    ).toBeChecked();
  });

  it("shows Email OFF for every opt-in category", async () => {
    const user = userEvent.setup();
    show();
    await openPreferences(user);
    // In-app is on for everything; email stays opt-in everywhere except tasks.
    for (const label of ["Email — Operations", "Email — Finance", "Email — Sales & CRM"]) {
      expect(screen.getByRole("checkbox", { name: label })).not.toBeChecked();
    }
    expect(screen.getByRole("checkbox", { name: "In-app — Tasks" })).toBeChecked();
  });

  it("writes the opt-out row when Tasks email is unticked and saved", async () => {
    const user = userEvent.setup();
    show();
    await openPreferences(user);
    await user.click(await screen.findByRole("checkbox", { name: "Email — Tasks" }));
    await user.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() => {
      const put = calls().find(
        (c) => String(c[0]) === "/notifications/preferences" && c[1]?.method === "PUT",
      );
      expect(put).toBeTruthy();
      const prefs = (put?.[1]?.body as { preferences: { channel: string; category: string; enabled: boolean }[] })
        .preferences;
      expect(prefs).toContainEqual({ channel: "EMAIL", category: "tasks", enabled: false });
    });
  });
});
