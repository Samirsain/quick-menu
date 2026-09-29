// The site's only service worker: QuickMenu app caching + OneSignal push.
// A scope can have just one worker, so OneSignal's worker is imported here rather than registered separately
// (index.html points OneSignal at this same file). Keep the file name: OneSignal looks for it.
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// Bump when the caching rules change; old caches are deleted on activate.
const CACHE = "quickmenu-v1";
const SHELL = ["/", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png", "/menu-cover.jpg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("quickmenu-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const cachePut = (req, res) => {
  if (res.ok && res.type === "basic") {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy));
  }
  return res;
};

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Only our own static files. Supabase, Cloudinary and OneSignal always go straight to the network.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // Pages: always try the network first so a new deploy shows up right away;
  // offline, fall back to the cached app shell (every route is the same index.html).
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).then((res) => cachePut("/", res)).catch(() => caches.match("/")));
    return;
  }

  // Build files have a content hash in the name and never change: cache first.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => cachePut(req, res))));
  }
});
