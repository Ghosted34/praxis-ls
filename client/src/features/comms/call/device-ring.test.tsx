/**
 * Can this device ring? (calls audit A15, PR-4 step 9) — the check, the
 * one-time prompt, and Settings → Calls → This device with its Test ring.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@/components/ui/toast";
import type { DeviceRingStatus } from "./device-ring-check";


function status(over: Partial<DeviceRingStatus> = {}): DeviceRingStatus {
  return {
    permission: "granted", subscribed: true, endpoint: "https://push.example/abc",
    installed: false, ios: false, soundBlocked: false, ...over,
  };
}

/* ── The one-time prompt ──────────────────────────────────────────────── */

const M = vi.hoisted(() => ({
  status: null as DeviceRingStatus | null,
  enable: vi.fn(async () => ({ ok: true as const, outcome: "synced" as const })),
  testRing: vi.fn(),
}));
vi.mock("./device-ring-check", async (orig) => ({
  ...(await orig<typeof import("./device-ring-check")>()),
  checkDeviceRing: async () => M.status,
}));
vi.mock("@/lib/push-sync", async (orig) => ({
  ...(await orig<typeof import("@/lib/push-sync")>()),
  enablePushOnThisDevice: () => M.enable(),
  syncPushSubscription: async () => "synced",
}));

async function renderPrompt(callsAvailable: boolean | null) {
  const { CallRingPrompt } = await import("./call-ring-prompt");
  return render(
    <MemoryRouter>
      <ToastProvider>
        <CallRingPrompt callsAvailable={callsAvailable} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("the 'Allow this device to ring' prompt", () => {
  afterEach(() => {
    localStorage.removeItem("praxis.call-ring-prompt-dismissed");
    M.enable.mockClear();
  });

  it("asks a person who can take calls on a device that cannot ring closed, and the button asks the browser", async () => {
    M.status = status({ permission: "default", subscribed: false, endpoint: null });
    await renderPrompt(true);
    const allow = await screen.findByRole("button", { name: "Allow calls to ring here" });
    await act(async () => {
      fireEvent.click(allow);
    });
    expect(M.enable).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Allow this device to ring for calls" })).toBeNull());
  });

  it("on an iPhone in the browser it explains Add to Home Screen instead of a button that cannot work", async () => {
    M.status = status({ permission: "unsupported", subscribed: null, endpoint: null, ios: true });
    await renderPrompt(true);
    expect(await screen.findByText(/Add to Home Screen/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Allow calls to ring here" })).toBeNull();
  });

  it("says nothing to someone who cannot take calls, or on a device that already rings", async () => {
    M.status = status({ permission: "default", subscribed: false, endpoint: null });
    const { container } = await renderPrompt(false);
    await Promise.resolve();
    expect(container.textContent).toBe("");

    M.status = status();
    const again = await renderPrompt(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(again.container.textContent).toBe("");
  });

  it("'Not now' is remembered on this device", async () => {
    M.status = status({ permission: "default", subscribed: false, endpoint: null });
    await renderPrompt(true);
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(localStorage.getItem("praxis.call-ring-prompt-dismissed")).toBe("1");
  });
});

/* ── Settings → Calls → This device ───────────────────────────────────── */

async function renderCard(s: DeviceRingStatus, testRing = vi.fn(async () => ({ sent: 1, failed: 0, total: 1 }))) {
  const { DeviceRingCard } = await import("@/features/settings/device-ring-card");
  render(<DeviceRingCard check={async () => s} testRing={testRing} />);
  await screen.findByText("This device");
  return testRing;
}

describe("This device (Settings → Calls)", () => {
  it("a device that can ring says so, and the test ring goes to this device's endpoint", async () => {
    const testRing = await renderCard(status());
    expect(screen.getByText("Calls ring on this device, even with the app closed.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send a test ring" }));
    });
    expect(testRing).toHaveBeenCalledWith("https://push.example/abc");
    expect(await screen.findByText(/Test ring sent/)).toBeTruthy();
  });

  it("says when the test ring arrived (the service worker tells the page)", async () => {
    const target = new EventTarget();
    Object.defineProperty(window.navigator, "serviceWorker", { configurable: true, value: target });
    try {
      await renderCard(status());
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Send a test ring" }));
      });
      await act(async () => {
        target.dispatchEvent(Object.assign(new Event("message"), { data: { type: "praxis:call-test" } }));
      });
      expect(await screen.findByText(/Received on this device/)).toBeTruthy();
    } finally {
      Object.defineProperty(window.navigator, "serviceWorker", { configurable: true, value: undefined });
    }
  });

  it("each missing line has its fix, and no test ring without a registration", async () => {
    await renderCard(status({ permission: "default", subscribed: false, endpoint: null, soundBlocked: true }));
    expect(screen.getByText("Not allowed yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Allow" })).toBeTruthy();
    expect(screen.getByText("Silent until you tap the page")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tap to enable ring sound" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send a test ring" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("an iPhone that is not installed is told how to install", async () => {
    await renderCard(status({ permission: "unsupported", subscribed: null, endpoint: null, ios: true }));
    expect(screen.getByText("Required on iPhone and iPad")).toBeTruthy();
    expect(screen.getByText(/tap Share, then Add to Home Screen/)).toBeTruthy();
  });

  it("a device that is not registered is told why the test ring did not go", async () => {
    await renderCard(status(), vi.fn(async () => ({ sent: 0, failed: 0, total: 0, reason: "no registered devices" })));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send a test ring" }));
    });
    expect(await screen.findByText(/not registered for push/)).toBeTruthy();
  });
});
