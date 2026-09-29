/**
 * The operations file's Tasks tab — what these pin, and why each one is a
 * defect that shipped.
 *
 * 1. THE TAB ASKS FOR ITS OWN FILE. The list is the Workspace list narrowed by
 *    `dossier_id`. (The 28 Sep defect — other files' tasks on a brand-new
 *    file's tab — was the server dropping that parameter; its regression test
 *    is `tests/unit/workspace-task-list-filters.test.js`. This half pins that
 *    the tab keeps asking.)
 *
 * 2. OPENING A TASK KEEPS THE REACH. The tab lists at "all", and the Tasks
 *    page reads its panel at its OWN audience, which defaults to "mine" — so a
 *    colleague's task opened from here as "Task not found". The link carries
 *    `audience=all` and the file.
 *
 * 3. WHAT YOU TYPE SURVIVES A RE-RENDER. The dialog re-seeds its form when its
 *    `initial` seed changes identity, and the tab passed a fresh object
 *    literal on every render — so the 360 re-rendering while the dialog was
 *    open (a refetch on returning to the app) wiped the title being typed.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { apiClientMock, authContextMock, renderScreen } from "@/test/screen-harness";
import * as apiClient from "@/lib/api-client";

vi.mock("@/lib/api-client", async () => apiClientMock());
vi.mock("@/app/auth/auth-context", async () => authContextMock());

const navigateSpy = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigateSpy,
}));

import { FileTasksTab } from "./file-tasks";

const FILE = "d-new-file";

const TASK = {
  task_id: "t-colleague",
  title: "Chase the delivery order",
  description: null,
  status: "TO_DO",
  priority: "HIGH",
  assigned_to: "u-colleague",
  assigned_to_name: "A. Colleague",
  created_by: "u-colleague",
  created_by_name: "A. Colleague",
  due_at: null,
  completed_at: null,
  is_personal: false,
  scope_id: null,
  reminder_minutes: null,
  remind_at: null,
  entity_type: null,
  entity_id: null,
  dossier_id: FILE,
  dossier_ref: "SFPRJ-NEW",
  dossier_client_name: null,
  milestone_instance_id: null,
  milestone_label: null,
  link_url: null,
  entity_label: null,
  has_link: false,
  subtask_count: 0,
  subtask_done_count: 0,
  created_at: "2026-09-28T08:00:00.000Z",
  updated_at: "2026-09-28T08:00:00.000Z",
  recurrence_rule: null,
};

const ROUTES = {
  "/workspace/tasks": [TASK],
  "/workspace/context": { timeZone: "Africa/Douala" },
};

beforeEach(() => navigateSpy.mockReset());

describe("Operations file — the Tasks tab", () => {
  it("asks the server for this file's tasks, at the widest reach", async () => {
    const spy = vi.spyOn(apiClient, "tenantPaged");
    renderScreen(<FileTasksTab fileId={FILE} />, { routes: ROUTES });
    await screen.findByText(TASK.title);
    const list = spy.mock.calls.map(([p]) => String(p)).find((p) => p.startsWith("/workspace/tasks?"));
    expect(list).toContain(`dossier_id=${FILE}`);
    expect(list).toContain("audience=all");
    spy.mockRestore();
  });

  it("opens a task at the reach it was listed at, on this file", async () => {
    const user = userEvent.setup();
    renderScreen(<FileTasksTab fileId={FILE} />, { routes: ROUTES });
    await user.click(await screen.findByText(TASK.title));

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    const url = new URL(String(navigateSpy.mock.calls[0][0]), "http://x");
    expect(url.pathname).toBe("/workspace/tasks");
    expect(url.searchParams.get("task")).toBe(TASK.task_id);
    expect(url.searchParams.get("audience")).toBe("all");
    expect(url.searchParams.get("dossier_id")).toBe(FILE);
  });

  it("keeps what was typed in the new-task form when the 360 re-renders", async () => {
    const user = userEvent.setup();
    let poke: () => void = () => {};
    function Parent() {
      const [, setN] = React.useState(0);
      poke = () => setN((n) => n + 1);
      return <FileTasksTab fileId={FILE} />;
    }
    renderScreen(<Parent />, { routes: ROUTES });

    await user.click(await screen.findByRole("button", { name: "New task on this file" }));
    const title = await screen.findByLabelText(/^Title/);
    // The seed runs once the tenant clock is known; wait for it so the
    // re-render below is the only thing that could reset the field.
    await waitFor(() => expect(title).toHaveValue(""));
    await user.type(title, "Get the delivery order signed");

    act(() => poke());
    act(() => poke());

    expect(screen.getByLabelText(/^Title/)).toHaveValue("Get the delivery order signed");
  });
});
