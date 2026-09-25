/**
 * F10 (calls audit PR-6): the Comms hub offers a Calls tab only while the
 * tenant has calls on. The answer comes from /smartcomm/calls/capabilities,
 * the same read the phone icon uses.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderScreen } from "@/test/screen-harness";

vi.mock("@/lib/api-client", async () => {
  const { apiClientMock } = await import("@/test/screen-harness");
  return apiClientMock();
});
vi.mock("@/lib/comms-socket", () => ({
  getCommsSocket: () => ({ on: () => {}, off: () => {} }),
}));

import { CommsHub } from "./hub";
import { resetCallCapabilities } from "./call/call-capabilities";

const renderHub = (calls: boolean) =>
  renderScreen(<CommsHub />, {
    path: "/comms/signatures",
    pattern: "/comms/:section",
    routes: {
      "/smartcomm/calls/capabilities": { calls, can_dial: calls, recording: false, settings_admin: false },
    },
  });

describe("the Comms hub's Calls tab (F10)", () => {
  beforeEach(() => resetCallCapabilities());

  it("is there when the tenant has calls on", async () => {
    renderHub(true);
    expect(await screen.findByRole("link", { name: "Calls" })).toBeInTheDocument();
  });

  it("is not offered when calls are off", async () => {
    renderHub(false);
    await screen.findByRole("link", { name: "Signatures" });
    // Let the capability read land before asserting its absence.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("link", { name: "Calls" })).not.toBeInTheDocument();
  });
});
