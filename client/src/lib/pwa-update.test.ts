/**
 * Update detection — the toast must not depend on being in the room when the
 * browser finds a new build.
 *
 * The report: on a desktop the "New version available" toast appeared within a
 * second of a deploy; on a phone it took a logout, a login and a couple of
 * reloads. Each case below is one way a phone's lifecycle walked past
 * workbox-window's detection (see the header of `pwa-update.ts`), scripted
 * against a fake registration so the ORDER of events — which is the whole bug —
 * is under the test's control.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  __resetPwaUpdate,
  applyPendingUpdate,
  checkForUpdate,
  dismissUpdate,
  isUpdateReady,
  reportStagedBuild,
  startUpdateWatch,
  watchRegistration,
} from "./pwa-update";

type Listener = () => void;

class FakeTarget {
  private l: Record<string, Listener[]> = {};
  addEventListener(type: string, fn: Listener) {
    (this.l[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.l[type] = (this.l[type] ?? []).filter((f) => f !== fn);
  }
  fire(type: string) {
    (this.l[type] ?? []).slice().forEach((f) => f());
  }
}

class FakeWorker extends FakeTarget {
  postMessage = vi.fn();
  constructor(public state: string) {
    super();
  }
  to(state: string) {
    this.state = state;
    this.fire("statechange");
  }
}

class FakeRegistration extends FakeTarget {
  active: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  update = vi.fn(() => Promise.resolve(this));
  /** What the browser does when it finds a new build: set `installing`, then
   *  fire `updatefound` — whether or not anyone is listening yet. */
  find(worker: FakeWorker) {
    this.installing = worker;
    this.fire("updatefound");
  }
  /** The found build finishes downloading and parks. */
  park(worker: FakeWorker) {
    this.installing = null;
    this.waiting = worker;
    worker.to("installed");
  }
}

const asReg = (r: FakeRegistration) => r as unknown as ServiceWorkerRegistration;

function installNavigator(reg: FakeRegistration | undefined, controller = true) {
  const container = new FakeTarget() as FakeTarget & {
    controller: unknown;
    getRegistration: ReturnType<typeof vi.fn>;
  };
  container.controller = controller ? new FakeWorker("activated") : null;
  container.getRegistration = vi.fn().mockResolvedValue(reg);
  Object.defineProperty(navigator, "serviceWorker", {
    value: container,
    configurable: true,
    writable: true,
  });
  return container;
}

/** A registration for a page that already runs a build. */
function liveRegistration() {
  const reg = new FakeRegistration();
  reg.active = new FakeWorker("activated");
  return reg;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  __resetPwaUpdate();
});

afterEach(() => {
  __resetPwaUpdate();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a build the browser found before anyone was listening", () => {
  it("is announced when it is already PARKED as the page starts watching", () => {
    const reg = liveRegistration();
    reg.waiting = new FakeWorker("installed");

    watchRegistration(asReg(reg));

    expect(isUpdateReady()).toBe(true);
  });

  it("is tracked while still DOWNLOADING — the case workbox-window never looks at — and announced the moment it parks", () => {
    // The phone relaunched the app; the navigation's own check found the build
    // and fired `updatefound` while the page was still loading.
    const reg = liveRegistration();
    const found = new FakeWorker("installing");
    reg.find(found);

    watchRegistration(asReg(reg));
    // Not yet: a click now would have to sit and wait for the download.
    expect(isUpdateReady()).toBe(false);

    reg.park(found);
    expect(isUpdateReady()).toBe(true);
  });
});

describe("a build found while the page is open", () => {
  it("is announced once the build updatefound reported has downloaded", () => {
    const reg = liveRegistration();
    watchRegistration(asReg(reg));
    expect(isUpdateReady()).toBe(false);

    const found = new FakeWorker("installing");
    reg.find(found);
    expect(isUpdateReady()).toBe(false);

    reg.park(found);
    expect(isUpdateReady()).toBe(true);
  });

  it("is still heard on the SECOND deploy in the life of one page", () => {
    // workbox-window removes its own updatefound listener after the first
    // update it calls "external"; an installed phone app lives through many.
    const reg = liveRegistration();
    watchRegistration(asReg(reg));

    const first = new FakeWorker("installing");
    reg.find(first);
    reg.park(first);
    dismissUpdate();
    expect(isUpdateReady()).toBe(false);

    const second = new FakeWorker("installing");
    reg.find(second);
    reg.park(second);
    expect(isUpdateReady()).toBe(true);
  });
});

describe("what is NOT an update", () => {
  it("the first install of a page with no build yet is offline-ready, not 'new version'", () => {
    const reg = new FakeRegistration(); // nothing active
    watchRegistration(asReg(reg));

    const first = new FakeWorker("installing");
    reg.find(first);
    // On a first install `waiting` is set, briefly, on the way to activating.
    reg.park(first);

    expect(isUpdateReady()).toBe(false);
  });

  it("a download that fails never raises the toast", async () => {
    vi.useFakeTimers();
    const reg = liveRegistration();
    watchRegistration(asReg(reg));
    const broken = new FakeWorker("installing");
    reg.find(broken);
    expect(isUpdateReady()).toBe(false);

    reg.installing = null;
    broken.to("redundant");
    await vi.advanceTimersByTimeAsync(300);

    expect(isUpdateReady()).toBe(false);
  });

  it("a build replaced by a NEWER one keeps the toast", async () => {
    vi.useFakeTimers();
    const reg = liveRegistration();
    watchRegistration(asReg(reg));
    const older = new FakeWorker("installing");
    reg.find(older);
    reg.park(older);

    // The browser retires a parked build only once the newer one has itself
    // finished downloading and taken its place.
    const newer = new FakeWorker("installing");
    reg.find(newer);
    expect(isUpdateReady()).toBe(true);
    reg.park(newer);
    older.to("redundant");
    await vi.advanceTimersByTimeAsync(300);

    expect(isUpdateReady()).toBe(true);
  });
});

describe("dismissing", () => {
  it("stays dismissed for the same build, however often the app re-checks", () => {
    const reg = liveRegistration();
    const parked = new FakeWorker("installed");
    reg.waiting = parked;
    watchRegistration(asReg(reg));
    dismissUpdate();

    watchRegistration(asReg(reg));
    reportStagedBuild(); // the plugin catching up with the same build

    expect(isUpdateReady()).toBe(false);
  });
});

describe("checkForUpdate", () => {
  it("asks the registration to update, then announces what it found once it has downloaded", async () => {
    const reg = liveRegistration();
    installNavigator(reg);
    const found = new FakeWorker("installing");
    reg.update.mockImplementation(() => {
      // `update()` resolves once the new worker is INSTALLING; nothing fires
      // for a page whose updatefound listener was never attached.
      reg.installing = found;
      return Promise.resolve(reg);
    });

    await checkForUpdate({ force: true });

    expect(reg.update).toHaveBeenCalledTimes(1);
    expect(isUpdateReady()).toBe(false);
    reg.park(found);
    expect(isUpdateReady()).toBe(true);
  });

  it("never overlaps, and rate-limits automatic checks but not a person asking", async () => {
    const reg = liveRegistration();
    installNavigator(reg);

    await Promise.all([checkForUpdate(), checkForUpdate()]);
    expect(reg.update).toHaveBeenCalledTimes(1);

    await checkForUpdate(); // automatic, inside the floor
    expect(reg.update).toHaveBeenCalledTimes(1);

    await checkForUpdate({ force: true }); // a pull-to-refresh
    expect(reg.update).toHaveBeenCalledTimes(2);
  });

  it("recovers from an update() that never settles (a page frozen mid-check)", async () => {
    vi.useFakeTimers();
    const reg = liveRegistration();
    installNavigator(reg);
    reg.update.mockImplementationOnce(() => new Promise(() => {}));

    void checkForUpdate({ force: true });
    await vi.advanceTimersByTimeAsync(21_000);
    await checkForUpdate({ force: true });

    expect(reg.update).toHaveBeenCalledTimes(2);
  });

  it("swallows update()'s InvalidStateError — a failed check is benign", async () => {
    const reg = liveRegistration();
    installNavigator(reg);
    reg.update.mockRejectedValueOnce(new DOMException("invalid", "InvalidStateError"));

    await expect(checkForUpdate({ force: true })).resolves.toBeUndefined();
  });
});

describe("startUpdateWatch — the moments a phone gives us", () => {
  it("checks at launch, and again when the app comes back into view", async () => {
    const reg = liveRegistration();
    installNavigator(reg);

    const stop = startUpdateWatch();
    await flush();
    expect(reg.update).toHaveBeenCalledTimes(1);

    // Resumed from the background, long enough after the launch check.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(reg.update).toHaveBeenCalledTimes(2);

    stop();
  });

  it("keeps the toast when another window hands this one a newer build", () => {
    const reg = liveRegistration();
    const container = installNavigator(reg, true);

    const stop = startUpdateWatch();
    container.fire("controllerchange");

    expect(isUpdateReady()).toBe(true);
    stop();
  });

  it("does not call the first install's claim a new version", () => {
    const reg = new FakeRegistration();
    const container = installNavigator(reg, false);

    const stop = startUpdateWatch();
    container.fire("controllerchange");

    expect(isUpdateReady()).toBe(false);
    stop();
  });
});

describe("applyPendingUpdate — a click reloads at once", () => {
  let reload: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    reload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload },
      configurable: true,
      writable: true,
    });
  });

  it("never waits on a download: with nothing parked it reloads immediately", async () => {
    // This used to wait up to a minute for the download — the "Updating…"
    // that sat there for seconds on desktop and mobile alike.
    vi.useFakeTimers();
    const reg = liveRegistration();
    const downloading = new FakeWorker("installing");
    reg.installing = downloading;
    installNavigator(reg);

    applyPendingUpdate();
    await vi.advanceTimersByTimeAsync(0);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(downloading.postMessage).not.toHaveBeenCalled();
  });

  it("skip-waits a parked build and reloads as soon as it starts activating", async () => {
    vi.useFakeTimers();
    const reg = liveRegistration();
    const parked = new FakeWorker("installed");
    reg.waiting = parked;
    installNavigator(reg);

    applyPendingUpdate();
    await vi.advanceTimersByTimeAsync(0);
    expect(parked.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(reload).not.toHaveBeenCalled();

    parked.to("activating");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads on controllerchange, and still reloads only once", async () => {
    vi.useFakeTimers();
    const reg = liveRegistration();
    const parked = new FakeWorker("installed");
    reg.waiting = parked;
    const container = installNavigator(reg);

    applyPendingUpdate();
    await vi.advanceTimersByTimeAsync(0);
    container.fire("controllerchange");
    parked.to("activating");
    await vi.advanceTimersByTimeAsync(2_000);

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
