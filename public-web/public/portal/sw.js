/*
 * The client portal's service worker — scope `/portal/`, registered by the
 * portal (features/portal/lib/portal-pwa.ts), served as-is from this folder.
 *
 * Three jobs, and nothing else:
 *
 *   1. SHOW a push from the team (shared/push/push.service.js buildPayload —
 *      the server sends { title, body, url, tag, renotify, timestamp, … }),
 *      always. Safari, and every app installed on an iPhone, withdraws the
 *      subscription of a site whose pushes show nothing; the server already
 *      skips a reply the client has read, so there is nothing to hide here.
 *   2. OPEN the portal where the notification points: an open portal window is
 *      focused and told where to go (the page routes without a reload),
 *      otherwise a new one opens.
 *   3. SAY "you are offline" when the portal is opened with no connection,
 *      instead of the browser's dinosaur. Only page loads are touched; every
 *      other request goes straight to the network, as if this file did not
 *      exist — nothing is cached, so nothing can ever be stale.
 *
 * No framework and no build step: it is copied into the build unchanged, and
 * it must work on every browser the portal supports.
 */
/* global self, clients, URL, Response */
"use strict";

var SCOPE = "/portal/";

self.addEventListener("install", function () {
  // A new version takes over at once; it holds no cache that could disagree.
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : "" };
  }
  var options = {
    body: data.body || "",
    tag: data.tag || undefined,
    // Only meaningful with a tag: a replacing notification alerts again
    // rather than swapping in silently.
    renotify: data.tag ? Boolean(data.renotify) : false,
    requireInteraction: Boolean(data.requireInteraction),
    timestamp: typeof data.timestamp === "number" ? data.timestamp : Date.now(),
    data: { url: typeof data.url === "string" ? data.url : SCOPE },
    // The tenant's own icon, rendered by the API from its branding and
    // resolved by Host (src/routes/pwa.js).
    icon: "/icons/app-icon-192.png",
    badge: "/icons/app-icon-192.png",
  };
  event.waitUntil(self.registration.showNotification(data.title || "", options));
});

/** Only a path inside the portal, on this origin — never somewhere else. */
function portalUrl(raw) {
  try {
    var u = new URL(raw || SCOPE, self.location.origin);
    if (u.origin !== self.location.origin) return SCOPE;
    if (u.pathname !== "/portal" && u.pathname.indexOf(SCOPE) !== 0) return SCOPE;
    return u.pathname + u.search + u.hash;
  } catch (e) {
    return SCOPE;
  }
}

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var target = portalUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        var path = "";
        try {
          path = new URL(c.url).pathname;
        } catch (e) {
          path = "";
        }
        if (path === "/portal" || path.indexOf(SCOPE) === 0) {
          // The page routes to it itself (portal-pwa.ts) — no reload, so a
          // half-written message survives the tap.
          c.postMessage({ type: "praxis:portal-open", url: target });
          return "focus" in c ? c.focus() : undefined;
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    }),
  );
});

/*
 * The browser replaced this device's subscription on its own. Re-subscribe
 * with the same key and tell any open portal window; the portal re-registers
 * the device with the server every time it starts (portal-pwa.ts), which is
 * the backstop when no window is open now.
 */
self.addEventListener("pushsubscriptionchange", function (event) {
  event.waitUntil(
    (async function () {
      try {
        var old = event.oldSubscription;
        var key = old && old.options && old.options.applicationServerKey;
        var sub = event.newSubscription || (key
          ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
          : null);
        if (!sub) return;
        var list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (var i = 0; i < list.length; i++) {
          list[i].postMessage({ type: "praxis:portal-push-changed" });
        }
      } catch (e) {
        /* the next portal start re-registers the device */
      }
    })(),
  );
});

var OFFLINE = {
  en: { title: "You are offline", body: "Connect to the internet to see your shipments, documents and invoices.", retry: "Try again" },
  fr: { title: "Vous êtes hors ligne", body: "Connectez-vous à Internet pour voir vos expéditions, documents et factures.", retry: "Réessayer" },
};

function offlinePage(lang) {
  var w = OFFLINE[lang] || OFFLINE.en;
  var html =
    '<!doctype html><html lang="' + (OFFLINE[lang] ? lang : "en") + '"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>" + w.title + "</title>" +
    "<style>html{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;" +
    "font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;text-align:center}" +
    "h1{font-size:1.4rem;margin:0 0 8px}p{margin:0 0 20px;opacity:.75;max-width:22rem}" +
    "button{font:inherit;font-weight:600;padding:12px 22px;border-radius:999px;border:1px solid currentColor;" +
    "background:transparent;color:inherit;cursor:pointer}</style></head><body><main>" +
    "<h1>" + w.title + "</h1><p>" + w.body + "</p>" +
    '<button type="button" onclick="location.reload()">' + w.retry + "</button>" +
    "</main></body></html>";
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.mode !== "navigate" || req.method !== "GET") return;
  event.respondWith(
    fetch(req).catch(function () {
      var lang = String((self.navigator && self.navigator.language) || "en").slice(0, 2).toLowerCase();
      return offlinePage(lang);
    }),
  );
});
