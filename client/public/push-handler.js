/*
 * Web-Push display handler, imported into the generated Workbox service worker
 * (vite.config.ts → workbox.importScripts). The generated SW handles precache +
 * navigation fallback; this adds the two listeners it doesn't: showing an
 * incoming push, and focusing/opening the app when the user taps it.
 *
 * Payload shape is what the server sends (shared/push/push.service.js sendToUser):
 *   { title, body, url, tag }
 */
/* eslint-disable no-restricted-globals */
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
    data: { url: data.url || "/notifications" },
    icon: "/icons/app-icon-192.png",
    badge: "/icons/app-icon-192.png",
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
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
