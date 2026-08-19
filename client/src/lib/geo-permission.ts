/**
 * Browser geolocation permission — the clock's recovery path.
 *
 * A punch must NEVER be blocked because this helper failed. The tenant
 * geofence policy decides whether a location-less punch is accepted; this
 * only answers "can we ask?" and "how does the person turn it back on?".
 */

export type GeoPermission = "granted" | "denied" | "prompt" | "unsupported";

export async function queryGeoPermission(): Promise<GeoPermission> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return "unsupported";
  }
  const perms = navigator.permissions;
  if (!perms || typeof perms.query !== "function") return "prompt";
  try {
    const status = await perms.query({ name: "geolocation" as PermissionName });
    const s = status.state;
    if (s === "granted" || s === "denied" || s === "prompt") return s;
    return "prompt";
  } catch {
    // Safari (and some embedded webviews) reject the query. Treat as prompt so
    // the next getCurrentPosition is what actually asks.
    return "prompt";
  }
}

/**
 * Keep the OS permission warm after grant, and notice a mid-shift revoke.
 *
 * Does NOT return coordinates for a punch — last-known must never become this
 * punch's location. Success is a no-op; PERMISSION_DENIED is the signal.
 */
export function watchGeoFix(onDenied: () => void): () => void {
  if (typeof navigator === "undefined" || !navigator.geolocation?.watchPosition) {
    return () => undefined;
  }
  const id = navigator.geolocation.watchPosition(
    () => undefined,
    (err) => {
      if (err && (err.code === 1 || /denied/i.test(String(err.message || "")))) onDenied();
    },
    { enableHighAccuracy: true, maximumAge: 60_000, timeout: 20_000 },
  );
  return () => {
    try {
      navigator.geolocation.clearWatch(id);
    } catch {
      /* @silent:teardown — the watch is already gone; nothing to report */
    }
  };
}

export function watchGeoPermission(onChange: (state: GeoPermission) => void): () => void {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return () => undefined;
  }
  let cancelled = false;
  let stop: (() => void) | null = null;
  void navigator.permissions
    .query({ name: "geolocation" as PermissionName })
    .then((status) => {
      if (cancelled) return;
      const emit = () => {
        const s = status.state;
        onChange(s === "granted" || s === "denied" || s === "prompt" ? s : "prompt");
      };
      emit();
      status.addEventListener("change", emit);
      stop = () => status.removeEventListener("change", emit);
    })
    .catch(() => {
      /*
       * Safari and some embedded webviews reject the geolocation query. Not a
       * silent case: leaving the caller with no state at all is what paints a
       * working clock as broken. Emit the same answer `queryGeoPermission`
       * gives on the same rejection — "prompt" — so the one browser that
       * cannot be watched still starts from a defined state, and the next
       * getCurrentPosition is what actually asks.
       */
      if (!cancelled) onChange("prompt");
    });
  return () => {
    cancelled = true;
    stop?.();
  };
}

/** OS/browser steps when the permission was revoked. Plain words, no markup. */
export function geoRecoverySteps(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): string[] {
  const ios = /iPhone|iPad|iPod/i.test(ua);
  const android = /Android/i.test(ua);
  if (ios) {
    return [
      "Open Settings on this iPhone or iPad.",
      "Scroll to Safari (or the browser you used to install the app).",
      "Tap Location and choose While Using the App.",
      "Come back here and tap Retry.",
    ];
  }
  if (android) {
    return [
      "Open this site's lock icon or the three-dot menu.",
      "Tap Permissions or Site settings.",
      "Set Location to Allow.",
      "Come back here and tap Retry.",
    ];
  }
  return [
    "Click the lock or tune icon in the address bar.",
    "Set Location to Allow.",
    "If it still fails, install the app so the permission can stay granted.",
    "Come back here and tap Retry.",
  ];
}
