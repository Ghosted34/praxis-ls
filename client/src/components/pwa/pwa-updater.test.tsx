/**
 * PwaUpdater — the "Update" button must never be dead.
 *
 * The reported bug was a banner whose button did nothing: clicked five times,
 * no reaction, and the only escape was Ctrl+F5. Two independent causes, both in
 * the paths vite-plugin-pwa/workbox-window drive by default:
 *
 *   1. `messageSkipWaiting()` is a silent no-op when `registration.waiting` is
 *      null — no error, no reload.
 *   2. The plugin's reload is gated on `event.isUpdate`, which is latched at
 *      registration as `Boolean(navigator.serviceWorker.controller)`. Ctrl+F5
 *      bypasses the SW, so the page loads uncontrolled and `isUpdate` is false
 *      — meaning the hard refresh users do to escape the bug is precisely what
 *      arms it for next time.
 *
 * These tests assert the outcome the user actually cares about, in every SW
 * state: a click ends in a reload.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const needRefreshState = { current: true };

// Stand in for the plugin's virtual module. It reports "an update is ready" but
// deliberately exposes no working reload of its own — the component must not
// depend on one.
vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({
    offlineReady: [false, vi.fn()],
    needRefresh: [needRefreshState.current, vi.fn()],
    updateServiceWorker: vi.fn(),
  }),
}));

vi.mock("@/app/branding/branding-context", () => ({
  useBranding: () => ({ pwa: { updateButton: "Update", updateTitle: null, updateBody: null } }),
}));

import { PwaUpdater } from "./pwa-updater";

/** Minimal ServiceWorker stub that records what it was told. */
function makeWorker(state = "installed") {
  const listeners: Record<string, ((e?: unknown) => void)[]> = {};
  return {
    state,
    postMessage: vi.fn(),
    addEventListener: (type: string, fn: () => void) => {
      (listeners[type] ??= []).push(fn);
    },
    fire: (type: string) => (listeners[type] ?? []).forEach((f) => f()),
  };
}

function installSwMock(registration: unknown) {
  const controllerChange: (() => void)[] = [];
  const sw = {
    controller: null,
    getRegistration: vi.fn().mockResolvedValue(registration),
    addEventListener: (type: string, fn: () => void) => {
      if (type === "controllerchange") controllerChange.push(fn);
    },
  };
  Object.defineProperty(navigator, "serviceWorker", { value: sw, configurable: true, writable: true });
  return { sw, fireControllerChange: () => controllerChange.forEach((f) => f()) };
}

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  needRefreshState.current = true;
  reload = vi.fn();
  Object.defineProperty(window, "location", {
    value: { ...window.location, reload },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PwaUpdater — clicking Update always reloads", () => {
  it("skip-waits the parked worker and reloads when it takes control", async () => {
    const waiting = makeWorker();
    const { fireControllerChange } = installSwMock({ waiting, installing: null });

    render(<PwaUpdater />);
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" }));

    // Nothing has reloaded yet — we wait for control to change hands so the new
    // build serves the next load, rather than the old worker serving stale HTML.
    expect(reload).not.toHaveBeenCalled();

    fireControllerChange();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads immediately when there is no waiting worker (bug 1: the silent no-op)", async () => {
    installSwMock({ waiting: null, installing: null });

    render(<PwaUpdater />);
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    // The old path posted nothing and returned; the button was simply dead.
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it("reloads even if control never changes hands (backstop)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const waiting = makeWorker();
    installSwMock({ waiting, installing: null });

    render(<PwaUpdater />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(waiting.postMessage).toHaveBeenCalled());
    expect(reload).not.toHaveBeenCalled();

    // controllerchange never fires — a wedged worker. The click must still land.
    await vi.advanceTimersByTimeAsync(1600);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("waits for a still-downloading worker, then skip-waits it", async () => {
    const installing = makeWorker("installing");
    installSwMock({ waiting: null, installing });

    render(<PwaUpdater />);
    await userEvent.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() => expect(navigator.serviceWorker.getRegistration).toHaveBeenCalled());
    expect(installing.postMessage).not.toHaveBeenCalled();

    installing.state = "installed";
    installing.fire("statechange");
    expect(installing.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("reloads exactly once even if the user clicks repeatedly", async () => {
    const waiting = makeWorker();
    const { fireControllerChange } = installSwMock({ waiting, installing: null });

    render(<PwaUpdater />);
    const btn = screen.getByRole("button", { name: "Update" });
    await userEvent.click(btn);

    // The button reports it is working, so a click is never ambiguous.
    await waitFor(() => expect(screen.getByRole("button", { name: "Updating…" })).toBeDisabled());

    fireControllerChange();
    fireControllerChange();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
