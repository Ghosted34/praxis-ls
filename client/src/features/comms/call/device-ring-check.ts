/**
 * Can THIS device ring for a call? (calls audit A15, PR-4 step 9.)
 *
 * A ring reaches a closed app only as a web push, and each of these has to be
 * true for that: the browser supports push, notifications are allowed, this
 * device has a push subscription, and on an iPhone or iPad the app is
 * installed to the Home Screen (Safari delivers web push to installed apps
 * only). Whether the ring SOUND can play in an open tab is the fifth line.
 *
 * Everything is read through `deps` so each state is testable without a
 * browser; nothing here throws.
 */
import { isAudioBlocked } from "@/lib/notif-sound";

export type PushPermission = "unsupported" | "default" | "granted" | "denied";

export type DeviceRingStatus = {
  permission: PushPermission;
  /** This device has a push subscription; null when that cannot be read. */
  subscribed: boolean | null;
  /** The subscription's endpoint, for a Test ring to this device only. */
  endpoint: string | null;
  /** Running as an installed app (Home Screen / standalone window). */
  installed: boolean;
  /** An iPhone or iPad, where push needs the installed app. */
  ios: boolean;
  /** The ring tone would be silent until the next tap on the page. */
  soundBlocked: boolean;
};

type Deps = {
  userAgent?: string;
  maxTouchPoints?: number;
  standalone?: boolean;
  permission?: () => PushPermission;
  subscription?: () => Promise<{ endpoint: string } | null>;
  soundBlocked?: () => boolean;
};

/** iPhone, iPod, or an iPad (which reports itself as a Mac with touch). */
export function isIosDevice(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

function defaultStandalone(): boolean {
  try {
    if (typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches) return true;
  } catch {
    /* @silent:parse — no matchMedia: fall through to the iOS flag. */
  }
  return typeof navigator !== "undefined" && (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function defaultPermission(): PushPermission {
  if (typeof window === "undefined" || !("Notification" in window) || !("PushManager" in window)
      || typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return "unsupported";
  }
  return Notification.permission as PushPermission;
}

async function defaultSubscription(): Promise<{ endpoint: string } | null> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? { endpoint: sub.endpoint } : null;
}

export async function checkDeviceRing(deps: Deps = {}): Promise<DeviceRingStatus> {
  const ua = deps.userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  const touch = deps.maxTouchPoints ?? (typeof navigator !== "undefined" ? navigator.maxTouchPoints || 0 : 0);
  const permission = (deps.permission ?? defaultPermission)();
  let subscribed: boolean | null = null;
  let endpoint: string | null = null;
  if (permission !== "unsupported") {
    try {
      const sub = await (deps.subscription ?? defaultSubscription)();
      subscribed = !!sub;
      endpoint = sub?.endpoint ?? null;
    } catch {
      /* @silent:parse — no service worker yet: unknown, shown as such. */
      subscribed = null;
    }
  }
  return {
    permission,
    subscribed,
    endpoint,
    installed: deps.standalone ?? defaultStandalone(),
    ios: isIosDevice(ua, touch),
    soundBlocked: (deps.soundBlocked ?? isAudioBlocked)(),
  };
}

/** An iPhone/iPad in a browser tab: no push until it is installed. */
export function needsInstall(s: DeviceRingStatus): boolean {
  return s.ios && !s.installed;
}

/** Can a ring reach this device with the app closed? */
export function canRingWhenClosed(s: DeviceRingStatus): boolean {
  return s.permission === "granted" && s.subscribed === true && !needsInstall(s);
}
