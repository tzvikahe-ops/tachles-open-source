const CACHE = "tachles-web-v4";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Never cache authenticated API calls or other cross-origin responses.
  if (url.origin !== self.location.origin) return;

  const isNavigation = event.request.mode === "navigate";
  const isStaticAsset = url.pathname.startsWith("/assets/") ||
    APP_SHELL.includes(url.pathname);
  if (!isNavigation && !isStaticAsset) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const cacheKey = isNavigation ? "/" : event.request;
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(cacheKey, copy));
        }
        return response;
      })
      .catch(() => {
        const cacheKey = isNavigation ? "/" : event.request;
        return caches.match(cacheKey).then((cached) => cached ?? Response.error());
      }),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { body: event.data?.text() ?? "" };
  }
  const title = payload.title || "תזכורת מתכלס";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "יש משהו שמחכה לך.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: payload.tag || "tachles-reminder",
      renotify: true,
      data: { url: payload.url || "/?view=reminders" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          if ("navigate" in client) {
            return client.navigate(destination).then(() => client.focus());
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(destination);
    }),
  );
});
