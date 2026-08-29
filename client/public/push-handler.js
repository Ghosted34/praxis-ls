/*
 * Web-Push display handler, imported into the generated Workbox service worker
 * (vite.config.ts → workbox.importScripts). The generated SW handles precache +
 * navigation fallback; this adds what it doesn't: showing an incoming push,
 * focusing/opening the app when the user taps it, keeping the home-screen badge
 * honest, and re-subscribing when the browser rotates a subscription.
 *
 * Payload shape is what the server sends (shared/push/push.service.js
 * buildPayload — the two files must be changed together):
 *   { title, body, url, tag, renotify, requireInteraction,
 *     badgeCount, actions, data, timestamp }
 *
 * ── WHY `tag` IS USUALLY ABSENT NOW ─────────────────────────────────────────
 *
 * This handler used to receive `tag: <userId>` on every notification, which
 * told the OS "replace the one already showing". Every alert for a user
 * replaced the previous one, so five urgent mails arrived and the phone showed
 * one. The server now sends a tag only where collapsing means something — all
 * activity on ONE mail thread shares `mail:<threadId>` — and pairs it with
 * `renotify` so the replacement still alerts instead of swapping in silently.
 */

/**
 * The unread count on the app icon.
 *
 * This is the safety net under everything else: a banner can be swiped away
 * unread, a phone can be off past the push TTL, a doze can delay a wake. The
 * badge survives all three, so a user who missed the notification still opens
 * their phone to a "4" on the icon.
 *
 * Not supported everywhere (notably iOS Safari, at the time of writing, outside
 * an installed home-screen app), and `setAppBadge` rejects rather than throwing
 * in some builds — so both failure shapes are swallowed. A missing badge is a
 * cosmetic loss; letting it reject would abort the waitUntil and take the
 * notification with it.
 */
function applyBadge(count) {
  try {
    if (typeof count !== "number" || count < 0) return Promise.resolve();
    if (!self.navigator || typeof self.navigator.setAppBadge !== "function") {
      return Promise.resolve();
    }
    const p = count > 0
      ? self.navigator.setAppBadge(count)
      : self.navigator.clearAppBadge();
    return p && typeof p.catch === "function" ? p.catch(() => {}) : Promise.resolve();
  } catch (_e) {
    return Promise.resolve();
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = { title: "Notification", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Praxis LS";
  const options = {
    body: data.body || "",
    tag: data.tag || undefined,
    // Only meaningful alongside a tag. Without it, a replacing notification
    // updates in place with no sound or vibration — indistinguishable, to
    // someone whose phone is in their pocket, from never having arrived.
    renotify: data.tag ? Boolean(data.renotify) : false,
    // Keeps the notification on screen until it is acted on, rather than
    // auto-dismissing. Reserved for HIGH priority by the server; on a
    // notification nobody has to act on it is just something to swipe away.
    requireInteraction: Boolean(data.requireInteraction),
    // The time the EVENT happened, not the time the phone woke up to hear
    // about it. A push delayed twenty minutes by doze otherwise timestamps
    // itself as "now" and misrepresents when the mail actually landed.
    timestamp: typeof data.timestamp === "number" ? data.timestamp : Date.now(),
    data: {
      url: data.url || "/notifications",
      ...(data.data || {}),
    },
    // Per-tenant icons, rendered from that tenant's branding by the API
    // (src/routes/pwa.js) and resolved by Host — subdomain-per-tenant means
    // these paths are already this workspace's own.
    icon: "/icons/app-icon-192.png",
    badge: "/icons/app-icon-192.png",
  };
  // Up to two, because that is what a notification shade will actually render.
  if (Array.isArray(data.actions) && data.actions.length) {
    options.actions = data.actions.slice(0, 2);
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      applyBadge(data.badgeCount),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // "dismiss" is an explicit "I have seen this and I am not opening it".
  // Focusing the app anyway would be the opposite of what was asked.
  if (event.action === "dismiss") return;

  const target =
    (event.notification.data && event.notification.data.url) ||
    "/notifications";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Focus an existing tab if one is open; otherwise open a new one.
        for (const client of clients) {
          if ("focus" in client) {
            client.navigate(target).catch(() => {});
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
        return undefined;
      }),
  );
});

/**
 * The browser has replaced this device's subscription — which it does on its
 * own schedule, when a push service rotates keys or expires an endpoint.
 *
 * The old endpoint stops working at that moment. Until the server hears about
 * the new one, this device is silently unreachable: no error anywhere, just a
 * phone that has quietly stopped receiving notifications.
 *
 * Re-subscribing here restores the browser side. The SERVER side needs an
 * authenticated call, and a service worker holds no session — access tokens
 * live in the page, not here — so it cannot make one. Instead the new
 * subscription is handed to any open tab, and `registerPushSync` in the client
 * (components/pwa/push-sync.ts) re-registers it on the next app load whether a
 * tab was open or not. That is what closes the loop, and it is why that sync
 * runs on every boot rather than only when the user visits Settings.
 */
/**
 * Read this device's rotation token out of IndexedDB.
 *
 * Written by the page at subscribe time (lib/push-token-store.ts) precisely so
 * that this context can read it: a service worker has no `localStorage` and no
 * session, and IndexedDB is the only store both sides share. Resolves null on
 * any failure — the caller then leaves the repair to the next app boot.
 */
function readRotationToken() {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const open = indexedDB.open("praxis-push", 1);
      open.onupgradeneeded = () => {
        // The page normally creates this. If we got here first there is no
        // token to find, but the store must exist or the read below throws.
        if (!open.result.objectStoreNames.contains("tokens")) {
          open.result.createObjectStore("tokens");
        }
      };
      open.onerror = () => resolve(null);
      open.onblocked = () => resolve(null);
      open.onsuccess = () => {
        try {
          const req = open.result.transaction("tokens", "readonly")
            .objectStore("tokens").get("rotation");
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        } catch (_e) {
          resolve(null);
        }
      };
    } catch (_e) {
      resolve(null);
    }
  });
}

/** Persist the replacement token the server hands back after a rotation. */
function writeRotationToken(token) {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined" || !token) return resolve();
      const open = indexedDB.open("praxis-push", 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains("tokens")) {
          open.result.createObjectStore("tokens");
        }
      };
      open.onerror = () => resolve();
      open.onblocked = () => resolve();
      open.onsuccess = () => {
        try {
          const req = open.result.transaction("tokens", "readwrite")
            .objectStore("tokens").put(token, "rotation");
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
        } catch (_e) {
          resolve();
        }
      };
    } catch (_e) {
      resolve();
    }
  });
}

/**
 * The browser has replaced this device's subscription — which it does on its
 * own schedule, when a push service rotates keys or expires an endpoint.
 *
 * The old endpoint stops working at that moment, and nothing reports it: the
 * server keeps sending to a dead address, the phone keeps not receiving, and
 * neither side sees an error. The device just goes quiet.
 *
 * ── WHY THIS CAN RE-REGISTER WITHOUT A SESSION ──────────────────────────────
 *
 * `/notifications/push/subscribe` is authenticated, and a worker cannot reach
 * the Bearer token that lives in the page. So the repair used to wait for the
 * user to next open the app — and the reason they were not opening it was that
 * their notifications had stopped. The fix was gated behind the thing it broke.
 *
 * `/notifications/push/rotate` is public and authorised by a single-use token
 * this device was given when it subscribed, kept in IndexedDB, which the server
 * stores only as a SHA-256. Possession proves same-device; nothing else about
 * the caller is trusted, and the server answers identically for an unknown,
 * spent or deleted token so it cannot be probed.
 *
 * The boot-time sync in the client remains the backstop for every case this
 * cannot cover — no token stored, IndexedDB unavailable, the device offline at
 * the moment it rotated.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const old = event.oldSubscription || (await self.registration.pushManager.getSubscription());
        const key =
          (event.newSubscription && event.newSubscription.options
            && event.newSubscription.options.applicationServerKey)
          || (old && old.options && old.options.applicationServerKey);
        const sub =
          event.newSubscription
          || (key
            ? await self.registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: key,
            })
            : null);
        if (!sub) return;

        const token = await readRotationToken();
        if (token) {
          // `/api/tenant/...`, not `/api/...`. The tenant surface is mounted
          // under /tenant (routes/index.js) and the client's `tenant()` helper
          // adds that segment for every other call — a worker composing the URL
          // by hand has to add it too. Getting this wrong 404s, and because
          // everything in here is swallowed by design that would have been a
          // rotation repair which never once worked and never once complained.
          const res = await fetch("/api/tenant/notifications/push/rotate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rotation_token: token, subscription: sub.toJSON() }),
          });
          if (res.ok) {
            // Single-use: the server issued a replacement, and without storing
            // it the NEXT rotation has nothing to present.
            const body = await res.json().catch(() => null);
            const next = body && body.data && body.data.rotation_token;
            if (next) await writeRotationToken(next);
          }
        }

        // Tell any open tab either way. When the rotation call succeeded this
        // lets the page refresh what it shows; when it did not, the page's own
        // authenticated re-registration is the fallback.
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of clients) {
          client.postMessage({
            type: "PUSH_SUBSCRIPTION_CHANGED",
            subscription: sub.toJSON(),
            oldEndpoint: old ? old.endpoint : null,
          });
        }
      } catch (_e) {
        /* Nothing useful to do here — the boot-time sync in the client is the
           backstop, and it runs regardless of whether this succeeded. */
      }
    })(),
  );
});

/**
 * The page telling us the badge has changed — the user read their
 * notifications, so the number on the icon should follow. Sent by the client
 * (lib/app-badge.ts); the worker owns the badge because on some platforms only
 * the service worker's origin-scoped call sticks once the app is closed.
 */
self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || msg.type !== "SET_APP_BADGE") return;
  event.waitUntil(applyBadge(msg.count));
});
