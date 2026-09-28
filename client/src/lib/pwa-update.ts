/**
 * "A new build is downloaded and parked" — as a fact two different controls can
 * read, and one routine both of them can act on.
 *
 * WHY IT LEFT `components/pwa/pwa-updater.tsx`. That component owns the service
 * worker registration, so it owned the `needRefresh` flag too, and the only way
 * to reach the update was the toast it renders. A toast is a moment: it is
 * dismissible, it is easy to miss on a second monitor, and once it is gone the
 * staged build sits there with no route to it until the next poll happens to
 * fire again. The rail's refresh control is permanent, so it can carry the same
 * signal without expiring — but only if the signal is not locked inside one
 * component's state. Hence a tiny store: `PwaUpdater` publishes into it, anyone
 * subscribes.
 *
 * The toast is unchanged and stays the primary announcement. This is the
 * SECOND route to the same action, not a replacement for the first.
 *
 * ── WHY THIS FILE ALSO DETECTS THE UPDATE ───────────────────────────────────
 *
 * On a desktop the toast appeared within a second of a deploy. On a phone it
 * could take a logout, a login and a couple of reloads. Nothing about the
 * phone was different except its lifecycle, and the lifecycle walks straight
 * into two blind spots in workbox-window (7.4, which vite-plugin-pwa drives):
 *
 *   1. IT ONLY LOOKS FOR A PARKED BUILD, NEVER A DOWNLOADING ONE. At
 *      registration it checks `registration.waiting` and then starts listening
 *      for `updatefound`. A phone relaunches the app far more often than a
 *      desktop reloads a tab — Android discards a backgrounded PWA to reclaim
 *      memory, and coming back is a fresh page load. That navigation makes the
 *      browser check for a new service worker by itself, so on a phone the new
 *      build is routinely found WHILE THE PAGE IS STILL LOADING: `updatefound`
 *      has already fired before anything listens, and the worker is
 *      `installing`, not `waiting`, when the check happens. Missed, and never
 *      re-examined — `registration.update()` then compares against that same
 *      worker and finds nothing new. The toast arrives on the NEXT page load,
 *      which on an installed app with no reload button means signing out and
 *      back in. That is the report, exactly.
 *
 *   2. IT STOPS LISTENING AFTER THE FIRST UPDATE IT CALLS "EXTERNAL" — any
 *      `updatefound` more than 60s after registration. It then removes its own
 *      listener, so the second deploy in the life of one page is silent. A
 *      desktop tab rarely lives through two deploys; an installed phone app
 *      routinely does.
 *
 * So the registration is watched HERE, directly: its `installing` and
 * `waiting` workers are inspected when we first get hold of it and after every
 * check, `updatefound` is listened to for the life of the page, and a check is
 * made whenever the app comes back into view — launch, resume, bfcache restore,
 * reconnect, a pull-to-refresh — rather than only on a five-minute timer that a
 * phone freezes the moment the screen turns off. The plugin's own `onNeedRefresh`
 * still reports into the same store; this is the net under it, not a rival.
 *
 * A BUILD IS ANNOUNCED WHEN IT IS FOUND, NOT WHEN IT HAS FINISHED DOWNLOADING.
 * The precache is several megabytes, which is a second on office broadband and
 * can be half a minute on a phone — and that half-minute of silence is the
 * "delay" being fixed. Pressing Reload before the download is done is safe:
 * `applyPendingUpdate` waits for it, then hands over.
 */
import * as React from "react";

let updateReady = false;
let applying = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The store's raw setter. The app reports through `reportStagedBuild` and the
 *  registration watch below; this stays exported for tests and for them. */
export function setUpdateReady(ready: boolean): void {
  if (updateReady === ready) return;
  updateReady = ready;
  emit();
}

export function isUpdateReady(): boolean {
  return updateReady;
}

export function isApplyingUpdate(): boolean {
  return applying;
}

/** A new build is staged and waiting to take over this tab. */
export function useUpdateReady(): boolean {
  return React.useSyncExternalStore(subscribe, isUpdateReady, isUpdateReady);
}

/** An apply is in flight — the reload is coming, so decline further clicks. */
export function useApplyingUpdate(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    isApplyingUpdate,
    isApplyingUpdate,
  );
}

/* ── Detection ──────────────────────────────────────────────────────────── */

/** The registration being watched — the page has exactly one. */
let registration: ServiceWorkerRegistration | null = null;
let watchedRegistrations = new WeakSet<ServiceWorkerRegistration>();
let trackedWorkers = new WeakSet<ServiceWorker>();
/** The build the user said "not now" to. A re-check that finds the SAME worker
 *  must not bring the toast straight back; a newer build is a new question. */
let dismissedWorker: ServiceWorker | null = null;
/**
 * Another window applied a build and it claimed this one too (clientsClaim),
 * so the code running HERE is now older than the worker serving it — its lazy
 * chunks name files the deploy removed. The toast has to stay until a reload,
 * whatever later happens to any other download.
 */
let handedOver = false;

/**
 * Is `worker` a new build for a page that already has one?
 *
 * Only if some OTHER worker is active. Asking `registration.waiting` is not
 * enough: on a first install the worker passes through `installed` — with
 * `waiting` set to it — on its way straight to activating, and that moment is
 * "ready to work offline", never "new version available".
 */
function isNewBuild(r: ServiceWorkerRegistration, worker: ServiceWorker) {
  return !!r.active && r.active !== worker;
}

function stage(r: ServiceWorkerRegistration, worker: ServiceWorker) {
  if (!isNewBuild(r, worker) || worker === dismissedWorker) return;
  setUpdateReady(true);
}

/**
 * A worker went `redundant`. Either its download failed — in which case the
 * build we announced is not coming, and the toast has to go — or a newer
 * build replaced it, which is still an update.
 *
 * Deferred, because the registration's own `waiting` / `installing`
 * attributes are updated by tasks queued alongside the `statechange` that
 * brought us here: read in the same task, they can still name the worker that
 * has just died.
 */
function settle(r: ServiceWorkerRegistration) {
  window.setTimeout(() => {
    if (applying || handedOver) return;
    const pending = [r.installing, r.waiting].some(
      (w) => !!w && w.state !== "redundant" && w !== dismissedWorker && isNewBuild(r, w),
    );
    if (!pending) setUpdateReady(false);
  }, 250);
}

function track(r: ServiceWorkerRegistration, worker: ServiceWorker | null) {
  if (!worker || trackedWorkers.has(worker)) return;
  trackedWorkers.add(worker);
  stage(r, worker);
  if (typeof worker.addEventListener !== "function") return;
  worker.addEventListener("statechange", () => {
    if (worker.state === "installed") stage(r, worker);
    else if (worker.state === "redundant") settle(r);
  });
}

function inspect(r: ServiceWorkerRegistration) {
  track(r, r.waiting);
  track(r, r.installing);
}

/**
 * Watch a registration for new builds, for the life of the page.
 *
 * Idempotent — `PwaUpdater` hands over the registration twice (once as soon as
 * the page can ask the browser for it, once when workbox-window has finished
 * registering), and both are the same object.
 */
export function watchRegistration(r: ServiceWorkerRegistration): void {
  registration = r;
  if (!watchedRegistrations.has(r)) {
    watchedRegistrations.add(r);
    if (typeof r.addEventListener === "function")
      r.addEventListener("updatefound", () => inspect(r));
  }
  inspect(r);
}

/**
 * The plugin's `onNeedRefresh` — "a build is waiting". Goes through the same
 * dismissal rule as everything else, so a toast the user closed is not
 * re-opened by the plugin catching up with the build they closed it on.
 */
export function reportStagedBuild(): void {
  const parked = registration?.waiting ?? null;
  if (parked && parked === dismissedWorker) return;
  setUpdateReady(true);
}

/** "Not now" — hides the toast and the rail's dot until a NEWER build appears. */
export function dismissUpdate(): void {
  dismissedWorker =
    registration?.waiting ?? registration?.installing ?? dismissedWorker;
  setUpdateReady(false);
}

/* ── Checking ───────────────────────────────────────────────────────────── */

/**
 * How often a visible page asks for a new build, when nothing else has.
 *
 * `registerType: "prompt"` announces a new build only when one is DETECTED,
 * and the browser checks by itself only on a navigation — which a single-page
 * app, left open all day, never makes. Five minutes keeps a long-lived tab
 * within one coffee break of a deploy at one small request per check. It is
 * the floor, not the mechanism: the checks that matter on a phone are the
 * ones fired when the app comes back into view (see `startUpdateWatch`),
 * because a phone freezes this timer as soon as the screen goes off.
 */
const POLL_MS = 5 * 60_000;

/**
 * The floor between AUTOMATIC checks. Focus and visibility both fire on one
 * alt-tab, and a desktop user switching windows fires them all day; overlapping
 * `update()` calls against one registration are one of the ways it lands in an
 * invalid state. A person asking — a pull-to-refresh — is not rate-limited.
 */
const MIN_GAP_MS = 10_000;

/**
 * How long one check may take before it is presumed wedged.
 *
 * The in-flight latch used to be released only when `update()` settled. A
 * phone that froze the page mid-request could leave that promise pending for
 * good, and a latch that never releases turned every later check into a no-op
 * for the life of the page — a quiet way to never see a deploy again.
 */
const CHECK_TIMEOUT_MS = 20_000;

let inFlight: Promise<void> | null = null;
let inFlightSince = 0;
let lastCheck = 0;

/**
 * Ask the browser to re-fetch the service worker and, if it changed, start the
 * update lifecycle — then look at what the registration holds, rather than
 * trusting that an event will arrive to say so.
 *
 * Never throws. `update()` REJECTS (`InvalidStateError`) whenever the
 * registration is no longer usable — superseded, site data cleared, a previous
 * update mid-lifecycle — and a failed CHECK is benign by construction: the next
 * one simply tries again. A floating rejection here used to be reported as an
 * application error seven times a day.
 */
export function checkForUpdate({
  force = false,
}: { force?: boolean } = {}): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker)
    return Promise.resolve();
  // Offline: the request would only fail. `online` fires a forced check.
  if (navigator.onLine === false) return Promise.resolve();

  const now = Date.now();
  if (inFlight && now - inFlightSince < CHECK_TIMEOUT_MS) return inFlight;
  if (!force && now - lastCheck < MIN_GAP_MS) return Promise.resolve();
  lastCheck = inFlightSince = now;

  const run = (async () => {
    const r =
      registration ??
      (await navigator.serviceWorker.getRegistration().catch(() => undefined)) ??
      null;
    if (!r) return;
    watchRegistration(r);
    if (typeof r.update === "function") {
      await Promise.race([
        r.update().catch(() => {
          /* benign — the app is fine, the next check retries */
        }),
        new Promise((resolve) => window.setTimeout(resolve, CHECK_TIMEOUT_MS)),
      ]);
    }
    // `update()` resolves once a new worker is INSTALLING — before its install
    // event has run — so this is where a build found by our own check is
    // announced, whether or not `updatefound` reached a listener.
    inspect(r);
  })().finally(() => {
    if (inFlight === run) inFlight = null;
  });
  inFlight = run;
  return run;
}

let watchers = 0;
let stopTriggers: (() => void) | null = null;

/**
 * Start checking at the moments a phone actually gives us, and look at the
 * registration NOW rather than when workbox-window gets round to it.
 *
 * Returns a stop function (reference-counted, so a remount does not stack a
 * second set of listeners). The app never calls it — `PwaUpdater` lives as
 * long as the page — but tests do.
 */
export function startUpdateWatch(): () => void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator))
    return () => {};

  watchers += 1;
  if (watchers === 1) {
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };
    // A page restored from the back/forward cache fires `pageshow` and no
    // `visibilitychange` — and it is exactly the page most likely to be stale.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void checkForUpdate({ force: true });
    };
    const onFocus = () => void checkForUpdate();
    const onOnline = () => void checkForUpdate({ force: true });
    const timer = window.setInterval(onVisible, POLL_MS);

    // Control changing hands when WE did not ask for it. The first install
    // claims an uncontrolled page too, so only a page that already HAD a
    // controller is stale afterwards.
    const sw = navigator.serviceWorker;
    let hadController = !!sw.controller;
    const onControllerChange = () => {
      const was = hadController;
      hadController = true;
      if (!was || applying) return;
      if (sw.controller && sw.controller === dismissedWorker) return;
      handedOver = true;
      setUpdateReady(true);
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    sw.addEventListener("controllerchange", onControllerChange);
    stopTriggers = () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      sw.removeEventListener?.("controllerchange", onControllerChange);
    };

    // The launch check. `getRegistration()` answers from the browser's own
    // records without registering anything, so this is not waiting on the
    // workbox-window chunk to download — which on a phone is precisely the
    // window in which the navigation's own update check finds the new build.
    void checkForUpdate({ force: true });
  }

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    watchers -= 1;
    if (watchers === 0) {
      stopTriggers?.();
      stopTriggers = null;
    }
  };
}

/* ── Applying ───────────────────────────────────────────────────────────── */

/** How long to wait for a PARKED build to take control before reloading anyway. */
const TAKEOVER_BACKSTOP_MS = 1500;

/**
 * How long to wait for a build that is still DOWNLOADING before reloading
 * anyway. The takeover backstop alone would reload a phone into the OLD build
 * half-way through fetching the new one — and the toast would come straight
 * back, which reads as the button having done nothing.
 */
const DOWNLOAD_BACKSTOP_MS = 60_000;

/**
 * Apply the staged update.
 *
 * We drive this ourselves instead of calling vite-plugin-pwa's
 * `updateServiceWorker()`, because that path has two ways to do NOTHING AT ALL
 * on a click — both of which shipped as a dead button:
 *
 *   1. workbox-window's `messageSkipWaiting()` is
 *          if (this._registration && this._registration.waiting) { ...post... }
 *      — a silent no-op when `waiting` is null. No error, no reload, no
 *      feedback. Clicking again does nothing again, forever.
 *
 *   2. The reload itself is gated on `if (event.isUpdate)`, and `isUpdate` is
 *      latched ONCE at registration as `Boolean(navigator.serviceWorker
 *      .controller)`. A hard refresh (Ctrl+F5) BYPASSES the service worker, so
 *      the page loads uncontrolled, `controller` is null, `isUpdate` is false —
 *      and the reload line never runs. That is a trap with a latch:
 *      hard-refreshing to escape a stuck banner is exactly what guarantees the
 *      NEXT click is dead too.
 *
 * So: resolve the registration fresh (never a stale reference), talk to the
 * waiting worker directly, reload on `controllerchange` with no `isUpdate`
 * condition — and, above all, guarantee the call always ends in a reload. A
 * control that sometimes does nothing is the actual bug being fixed here.
 */
export function applyPendingUpdate(): void {
  if (applying) return;
  applying = true;
  emit();

  let reloaded = false;
  const reload = () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  };

  const sw = navigator.serviceWorker;
  if (!sw) {
    reload();
    return;
  }

  // The real path: the new worker activates, claims this tab (clientsClaim in
  // vite.config.ts is what makes it claim an UNCONTROLLED tab — the post-
  // Ctrl+F5 case above), and we reload the moment control changes hands.
  sw.addEventListener("controllerchange", reload, { once: true });

  // Backstop. If control never changes — no waiting worker, a worker wedged
  // mid-lifecycle, a browser that swallows the message — reload anyway rather
  // than leave the user pressing a control that does nothing. Worst case they
  // get the same version back and the toast returns; that is still strictly
  // better than silence.
  let backstop = window.setTimeout(reload, TAKEOVER_BACKSTOP_MS);
  const backstopIn = (ms: number) => {
    window.clearTimeout(backstop);
    backstop = window.setTimeout(reload, ms);
  };

  sw.getRegistration()
    .then((reg) => {
      if (!reg) return reload();

      // Already installed and parked: tell it to take over now.
      if (reg.waiting) {
        reg.waiting.postMessage({ type: "SKIP_WAITING" });
        return;
      }

      // Still downloading: skip waiting as soon as it finishes, so a user who
      // acts the instant the toast appears is not punished for being quick.
      // The backstop stretches to cover the download (see DOWNLOAD_BACKSTOP_MS)
      // and shrinks back once there is only a handover left to wait for.
      const installing = reg.installing;
      if (installing) {
        backstopIn(DOWNLOAD_BACKSTOP_MS);
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed") {
            installing.postMessage({ type: "SKIP_WAITING" });
            backstopIn(TAKEOVER_BACKSTOP_MS);
          } else if (installing.state === "redundant") {
            // The download failed. Nothing is coming; do not make them wait
            // a minute to find that out.
            reload();
          }
        });
        return;
      }

      // Nothing waiting, nothing installing — the new build is already the
      // active worker and this tab is just running old code. A plain reload is
      // exactly the right move.
      reload();
    })
    .catch(() => reload());
}

/** Test seam: drop the module's state between cases. Not used by the app. */
export function __resetPwaUpdate(): void {
  updateReady = false;
  applying = false;
  listeners.clear();
  registration = null;
  watchedRegistrations = new WeakSet();
  trackedWorkers = new WeakSet();
  dismissedWorker = null;
  handedOver = false;
  inFlight = null;
  inFlightSince = 0;
  lastCheck = 0;
  stopTriggers?.();
  stopTriggers = null;
  watchers = 0;
}
