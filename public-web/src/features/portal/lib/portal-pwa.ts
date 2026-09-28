/**
 * The portal as an app (client portal redesign PR 2): installable on a phone
 * or a desk, and able to be told things while it is closed.
 *
 * Three pieces, each scoped to `/portal/` and none of them touching the
 * marketing site:
 *
 *   · the manifest link, added on the way into the portal and removed on the
 *     way out (src/routes/pwa.js serves it, per tenant, per Host);
 *   · the service worker, `public/portal/sw.js` — shows a push, opens the
 *     portal where it points, says "offline" instead of the browser's page;
 *   · push itself — asked for only when the person presses "Turn on", never on
 *     load. A permission prompt nobody asked for is the one most people
 *     refuse, and a browser does not let a site ask again after a refusal.
 *
 * An iPhone only offers push to a portal added to the Home Screen (iOS 16.4
 * and later), which is why "install" and "notifications" sit together.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { portalPushSubscribe, portalPushUnsubscribe, type PushSubscriptionBody } from "@/lib/portal-api";

const SW_URL = "/portal/sw.js";
const SCOPE = "/portal/";

export type PushState = "unsupported" | "install-first" | "blocked" | "off" | "on";

const hasWindow = () => typeof window !== "undefined" && typeof navigator !== "undefined";

export function isIos(): boolean {
  if (!hasWindow()) return false;
  const ua = navigator.userAgent || "";
  // iPadOS reports itself as a Mac; the touch points give it away.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
}

/** Opened from the Home Screen or as an installed app, rather than in a tab. */
export function isInstalled(): boolean {
  if (!hasWindow()) return false;
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standalone || (!!window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
}

function pushSupported(): boolean {
  return hasWindow() && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/* ── the service worker ──────────────────────────────────────────────────── */

let registering: Promise<ServiceWorkerRegistration | null> | null = null;

/** Register once per page; null where there are no service workers (or it failed). */
export function portalWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!hasWindow() || !("serviceWorker" in navigator)) return Promise.resolve(null);
  if (!registering) {
    registering = navigator.serviceWorker
      .register(SW_URL, { scope: SCOPE, updateViaCache: "none" })
      .catch(() => {
        registering = null;
        return null; // @silent:storage — no worker means no offline page and no push; the portal works
      });
  }
  return registering;
}

/* ── the manifest, and the page talking to the worker ────────────────────── */

function headTags(theme: "light" | "dark", lang: "en" | "fr") {
  const made: HTMLElement[] = [];
  const add = (tag: "link" | "meta", attrs: Record<string, string>) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    document.head.appendChild(el);
    made.push(el);
  };
  add("link", { rel: "manifest", href: `/portal/manifest.webmanifest?theme=${theme}&lang=${lang}` });
  // What an iPhone puts on the Home Screen — the tenant's own icon, by Host.
  add("link", { rel: "apple-touch-icon", href: "/icons/app-icon-192.png" });
  add("meta", { name: "mobile-web-app-capable", content: "yes" });
  add("meta", { name: "apple-mobile-web-app-capable", content: "yes" });
  return () => made.forEach((el) => el.remove());
}

/**
 * Mounted once by the portal: the manifest while the portal is open, the
 * worker registered, and a tapped notification routed without a reload (so a
 * half-written message survives it).
 */
export function usePortalPwa({ theme, lang }: { theme: "light" | "dark"; lang: "en" | "fr" }) {
  const navigate = useNavigate();
  React.useEffect(() => headTags(theme, lang), [theme, lang]);
  React.useEffect(() => {
    void portalWorker();
    if (!hasWindow() || !("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string } | null;
      if (d && d.type === "praxis:portal-open" && typeof d.url === "string" && d.url.startsWith("/portal")) navigate(d.url);
      if (d && d.type === "praxis:portal-push-changed") void resyncPush();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [navigate]);
}

/* ── push ────────────────────────────────────────────────────────────────── */

/**
 * The VAPID public key (base64url) as the bytes `subscribe()` wants. The
 * return type is left to inference on purpose: it is a Uint8Array over a plain
 * ArrayBuffer, which is what `BufferSource` accepts — annotating it as a bare
 * `Uint8Array` widens it to one TypeScript will not pass there.
 */
function keyBytes(base64url: string) {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const had = sub.options && sub.options.applicationServerKey;
  if (!had) return true; // cannot tell; the server's fingerprint check covers a rotation
  const a = new Uint8Array(had);
  return a.length === key.length && a.every((b, i) => b === key[i]);
}

async function subscription(): Promise<PushSubscription | null> {
  const reg = await portalWorker();
  if (!reg || !reg.pushManager) return null;
  return reg.pushManager.getSubscription().catch(() => null); // @silent:storage — read as "not subscribed"
}

/** Where this device stands — for the switch on the Account screen. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return isIos() && !isInstalled() ? "install-first" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  return (await subscription()) ? "on" : "off";
}

/** Remembered for the worker's "subscription changed" message. */
let last: { publicKey: string; lang: "en" | "fr" } | null = null;

async function subscribeWith(reg: ServiceWorkerRegistration, publicKey: string, lang: "en" | "fr") {
  const key = keyBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // Minted under a key this deployment no longer signs with: start again.
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe().catch(() => false); // @silent:teardown — replaced just below
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await portalPushSubscribe(sub.toJSON() as PushSubscriptionBody, lang);
  last = { publicKey, lang };
}

/** "Turn on": the permission prompt, then this device registered with the server. */
export async function enablePush(publicKey: string, lang: "en" | "fr"): Promise<PushState> {
  if (!pushSupported()) return isIos() && !isInstalled() ? "install-first" : "unsupported";
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "off";
  const reg = await portalWorker();
  if (!reg) return "unsupported";
  await subscribeWith(reg, publicKey, lang);
  return "on";
}

/** "Turn off" on this device: the server forgets it, then the browser does. */
export async function disablePush(): Promise<PushState> {
  const sub = await subscription();
  if (sub) {
    await portalPushUnsubscribe(sub.endpoint);
    await sub.unsubscribe().catch(() => false); // @silent:teardown — the server no longer sends to it
  }
  return pushSupported() && Notification.permission === "denied" ? "blocked" : "off";
}

/**
 * On every start of a signed-in portal: a device that already has notifications
 * on is re-registered, which keeps the server in step after the browser
 * rotated the subscription on its own, and binds a shared computer's device to
 * whoever is signed in now. Asks nothing and does nothing when push is off.
 */
export async function syncPush(publicKey: string | null, lang: "en" | "fr"): Promise<void> {
  if (!publicKey || !pushSupported() || Notification.permission !== "granted") return;
  const reg = await portalWorker();
  if (!reg || !(await reg.pushManager.getSubscription())) return;
  await subscribeWith(reg, publicKey, lang);
}

async function resyncPush() {
  if (last) await syncPush(last.publicKey, last.lang).catch(() => undefined); // @silent:storage — the next start retries
}

/**
 * Signing out: this device stops receiving the person's notifications. Best
 * effort and quick — it must never stand between a person and signing out.
 */
export async function forgetPushDevice(): Promise<void> {
  try {
    const sub = await subscription();
    if (!sub) return;
    await portalPushUnsubscribe(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe().catch(() => false);
  } catch {
    /* @silent:teardown — signing out goes ahead either way */
  }
}

/* ── install ─────────────────────────────────────────────────────────────── */

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

// Registered as soon as the portal's code loads: Chrome fires this once the
// manifest link is in place, and holding it is what lets a button install.
if (hasWindow()) {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installedNow = true;
    notify();
  });
}

export type InstallState = "installed" | "ready" | "ios" | "unavailable";

function installState(): InstallState {
  if (installedNow || isInstalled()) return "installed";
  if (deferred) return "ready";
  if (isIos()) return "ios";
  return "unavailable";
}

/** Whether the portal can be installed here, and how. */
export function useInstall() {
  const [state, setState] = React.useState<InstallState>(installState);
  React.useEffect(() => {
    const on = () => setState(installState());
    listeners.add(on);
    on();
    return () => {
      listeners.delete(on);
    };
  }, []);
  const install = React.useCallback(async () => {
    const e = deferred;
    if (!e) return false;
    await e.prompt();
    const choice = await e.userChoice;
    deferred = null;
    if (choice.outcome === "accepted") installedNow = true;
    notify();
    return choice.outcome === "accepted";
  }, []);
  return { state, install };
}
