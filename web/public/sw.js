/* Segundo service worker: installable, quick to open, honest when offline.
   Pages: network first (money on screen must be live), the last good copy if the network is gone, then an offline
   page. Built assets: cache first (their names change with every build). /api/* is never cached or touched. */
const VERSION = "segundo-v1";
const SHELL = `${VERSION}-shell`;
const PAGES = `${VERSION}-pages`;
const ASSETS = `${VERSION}-assets`;
const PRECACHE = ["/app", "/icons/icon-192.png", "/icons/icon-512.png"];

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Offline · Segundo</title>
<style>:root{--paper:#edf1ec;--ink:#17332b;--soft:#4e6159;--serial:#c0266d}@media (prefers-color-scheme:dark){:root{--paper:#0f1a17;--ink:#e2ede6;--soft:#93a69c;--serial:#ff5c9d}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--paper);color:var(--ink);font:16px/1.55 system-ui,sans-serif;padding:24px}
main{max-width:30rem}h1{font-size:28px;line-height:1.1;margin:0 0 12px}p{color:var(--soft);margin:0 0 18px}
button{min-height:46px;padding:0 20px;border-radius:6px;border:1.5px solid var(--ink);background:var(--ink);color:var(--paper);font:600 15.5px system-ui,sans-serif}
.s{color:var(--serial)}</style></head><body><main><h1>You're offline</h1>
<p>Segundo needs the network to show live pay and to send anything. Nothing was sent while you were offline, and money already in your wallet is safe on Monad.</p>
<button onclick="location.reload()">Try again</button></main></body></html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const offline = () => new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !url.search) {
            const copy = res.clone();
            caches.open(PAGES).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match("/app")) || offline()),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(ASSETS).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
