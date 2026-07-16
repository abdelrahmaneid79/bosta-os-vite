/**
 * BostaOS service worker — makes the LOCAL OCR reader work offline.
 * Precaches the self-hosted Tesseract assets (worker + wasm core + ara/eng
 * language data) so that, once installed, the day-report importer reads photos
 * with the device in airplane mode. App-shell + other same-origin GETs are
 * cached opportunistically (stale-while-revalidate). Cross-origin requests are
 * never touched. Bump CACHE_VERSION when the OCR assets change.
 */
const CACHE_VERSION = "bostaos-v1";
const OCR_CACHE = `${CACHE_VERSION}-ocr`;
const APP_CACHE = `${CACHE_VERSION}-app`;

// The OCR payload that MUST be available offline (self-hosted, same-origin).
const OCR_ASSETS = [
  "/ocr/worker.min.js",
  "/ocr/tesseract-core-simd-lstm.js",
  "/ocr/tesseract-core-simd-lstm.wasm",
  "/ocr/tesseract-core-simd-lstm.wasm.js",
  "/ocr/tesseract-core-lstm.js",
  "/ocr/tesseract-core-lstm.wasm",
  "/ocr/tesseract-core-lstm.wasm.js",
  "/ocr/lang/eng.traineddata.gz",
  "/ocr/lang/ara.traineddata.gz",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    // 1) OCR payload (the offline-critical part). Cache each individually so one
    //    missing variant doesn't abort the install.
    const ocr = await caches.open(OCR_CACHE);
    await Promise.all(OCR_ASSETS.map((u) => ocr.add(u).catch(() => undefined)));

    // 2) App shell so the whole app cold-starts in airplane mode: cache "/" and
    //    the entry JS/CSS it references (hashed at build time — parsed from HTML).
    const app = await caches.open(APP_CACHE);
    try {
      const res = await fetch("/", { cache: "no-store" });
      if (res.ok) {
        const html = await res.clone().text();
        await app.put("/", res);
        const refs = [...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
        await Promise.all([...new Set(refs)].map((u) => app.add(u).catch(() => undefined)));
      }
    } catch { /* offline at install — assets fill in via runtime caching */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never intercept cross-origin

  // OCR assets: cache-first (they're large + immutable within a version).
  if (url.pathname.startsWith("/ocr/")) {
    event.respondWith((async () => {
      const cache = await caches.open(OCR_CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  // App shell + assets: stale-while-revalidate, with an offline navigation
  // fallback to the cached shell so any client route cold-loads in airplane mode.
  event.respondWith((async () => {
    const cache = await caches.open(APP_CACHE);
    const hit = await cache.match(req);
    const network = fetch(req)
      .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
      .catch(async () => hit || (req.mode === "navigate" ? await cache.match("/") : undefined));
    return hit || network;
  })());
});
