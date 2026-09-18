import { describe, expect, it } from "vitest";
import { legacyWorkspaceDestination } from "./legacy-route";

describe("Workspace legacy query-tab adapter", () => {
  it("translates a legacy task deep link to the canonical path", () => {
    expect(legacyWorkspaceDestination("?tab=tasks&task=task-1&audience=team")).toBe(
      "/workspace/tasks?task=task-1&audience=team",
    );
  });

  it("translates a legacy Calendar deep link and preserves view state", () => {
    expect(legacyWorkspaceDestination("?tab=calendar&event=event-1&view=week")).toBe(
      "/workspace/calendar?event=event-1&view=week",
    );
  });

  it("uses the explicit Today alias", () => {
    expect(legacyWorkspaceDestination("?tab=today")).toBe("/workspace/today");
  });

  it("does not redirect a canonical landing URL or an unknown tab", () => {
    expect(legacyWorkspaceDestination("")).toBeNull();
    expect(legacyWorkspaceDestination("?tab=analytics")).toBeNull();
  });
});
