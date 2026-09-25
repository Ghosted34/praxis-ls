/**
 * Comms → Setup → Test calls (calls audit PR-7): the button follows the
 * server's cap (and says when the next run is available), a run reports the
 * device's steps and shows the server's verdict with a copyable report, and
 * past runs open.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/ui/toast";
import type { DiagRun } from "@/lib/smartcomm-api";
import { ApiError } from "@/lib/api-client";

const A = vi.hoisted(() => ({
  cap: { limit: 3, used: 0, remaining: 3, next_available_at: null as string | null },
  runs: [] as unknown[],
  start: vi.fn(),
  get: vi.fn(),
  report: vi.fn(),
  finish: vi.fn(),
}));
vi.mock("@/lib/smartcomm-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/smartcomm-api")>()),
  listDiagRuns: async () => ({ runs: A.runs, cap: A.cap }),
  startDiagRun: (...a: unknown[]) => A.start(...a),
  getDiagRun: (...a: unknown[]) => A.get(...a),
  reportDiagStep: (...a: unknown[]) => A.report(...a),
  finishDiagRun: (...a: unknown[]) => A.finish(...a),
  diagRing: async () => ({ nonce: "n1", result: { sent: 1, failed: 0, total: 1 } }),
  diagIce: async () => ({ iceServers: [], turnConfigured: true }),
  uploadDiagPart: async () => A.start.mock.results[0]?.value,
  ackDiagSignal: async () => ({}),
}));
vi.mock("@/lib/comms-socket", () => ({ getCommsSocket: () => ({ on: vi.fn(), off: vi.fn() }) }));

import { TestCallsTab } from "./test-calls";
import type { DeviceDeps } from "./test-calls-runner";

const STEPS = [
  "Server and worker", "Schedules", "Live signals", "Ring to this device", "Microphone", "Audio",
  "Connection", "Recording", "Transcription", "Summary", "Clean-up",
];
function runOf(status: DiagRun["status"], over: Partial<Record<number, object>> = {}): DiagRun {
  return {
    run_id: "r1", user_id: "me", env: "live", started_at: "2026-09-25T09:00:00Z", finished_at: status === "RUNNING" ? null : "2026-09-25T09:02:00Z",
    status,
    steps: STEPS.map((title, i) => ({ key: title as never, n: i + 1, title, status: status === "RUNNING" ? "pending" : "pass", ...(over[i + 1] || {}) })),
    report: status === "RUNNING" ? null : "Praxis LS — Test calls report\nRun: r1\nResult: " + status,
  };
}

/** Device steps that succeed at once, with no browser APIs. */
const quick: DeviceDeps = {
  checkRing: async () => ({ permission: "granted", subscribed: true, endpoint: "https://push.test/e", installed: true, ios: false, soundBlocked: false }),
  waitForRing: async () => true,
  getMic: async () => ({ getTracks: () => [] }) as unknown as MediaStream,
  peakLevel: async () => 0.3,
  canPlay: async () => true,
  noiseFilter: async () => ({ status: "on", reason: null, inPeak: 0.3, outPeak: 0.2 }),
  stunAddress: async () => true,
  relayCall: async () => ({ connected: true, stats: { rttMs: 50, jitterMs: 2, lossPct: 0 } }),
  record: async () => [1, 2, 3].map((index) => ({ index, blob: new Blob(["x"]), durationMs: 3000, mimeType: "audio/webm" })),
  decodes: async () => true,
  now: () => Date.now(),
};

const renderTab = () => render(<ToastProvider><TestCallsTab deps={quick} /></ToastProvider>);

beforeEach(() => {
  A.cap = { limit: 3, used: 0, remaining: 3, next_available_at: null };
  A.runs = [];
  A.start.mockReset().mockResolvedValue(runOf("RUNNING"));
  A.report.mockReset().mockResolvedValue(runOf("RUNNING"));
  A.finish.mockReset().mockResolvedValue(runOf("RUNNING"));
  A.get.mockReset().mockResolvedValue(runOf("FAILED", { 9: { status: "fail", code: "GROQ_FAILED", cause: "EN clip via Groq: 401" } }));
});

describe("Test calls", () => {
  it("says how many runs are left today", async () => {
    renderTab();
    expect(await screen.findByText("3 of 3 runs left today for your company.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run the test" })).toBeEnabled();
  });

  it("with the cap used, the button is off and the next run's time is named", async () => {
    A.cap = { limit: 3, used: 3, remaining: 0, next_available_at: "2026-09-26T09:00:00Z" };
    renderTab();
    expect(await screen.findByText(/All 3 of today's runs are used\. The next is available 26 Sept 2026/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run the test" })).toBeDisabled();
  });

  it("a run reports the device's steps, then shows the verdict, the red step and the report", async () => {
    renderTab();
    await userEvent.click(await screen.findByRole("button", { name: "Run the test" }));
    await waitFor(() => expect(A.finish).toHaveBeenCalledWith("r1"));
    const stepReports = A.report.mock.calls.filter((c) => typeof c[1] === "string");
    expect(stepReports.map((c) => [c[1], c[2].status])).toEqual([
      ["ring", "pass"], ["microphone", "pass"], ["audio", "pass"], ["connection", "pass"],
    ]);
    expect(await screen.findByText("EN clip via Groq: 401")).toBeInTheDocument();
    // The run's verdict and the step's own pill.
    expect(screen.getAllByText("Failed", { selector: ".status" })).toHaveLength(2);
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(11);
    expect(screen.getByRole("button", { name: "Copy report" })).toBeInTheDocument();
  });

  it("a refused start (the cap reached meanwhile) is said, not swallowed", async () => {
    A.start.mockRejectedValue(new ApiError("DIAGNOSTICS_DAILY_CAP", "Test calls are limited to 3 runs a day for your company.", 429));
    renderTab();
    await userEvent.click(await screen.findByRole("button", { name: "Run the test" }));
    expect(await screen.findByText(/limited to 3 runs a day/)).toBeInTheDocument();
  });

  it("past runs open", async () => {
    A.runs = [{ run_id: "r1", user_id: "me", user_name: "Awa Diallo", env: "live", started_at: "2026-09-24T08:00:00Z", finished_at: null, status: "PASSED" }];
    A.get.mockResolvedValue(runOf("PASSED"));
    renderTab();
    await userEvent.click(await screen.findByRole("button", { name: /24 Sept 2026/ }));
    expect(await screen.findByRole("list", { name: "Test steps" })).toBeInTheDocument();
  });
});
