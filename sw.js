// IMPORTANT: bump this on every release so old caches are deleted
const CACHE = "lifeos-v3.3.0-cache";
const CORE = [
  "./",
  "./index.html",
  "./styles/app.css",
  "./manifest.json",  "./src/app.js",
  "./src/config.js",
  "./src/version.js",
  "./src/updater.js",
  "./src/engine/engine.js",
  "./src/engine/store.js",
  "./src/ui/views.js",
  "./src/ui/chart.js",
  "./src/history/sha256.js",
  "./src/history/historyRecorder.js",
  "./src/history/historyVerifier.js",
  "./src/security/crypto.js",
  "./src/sync/supabaseClient.js",
  "./src/sync/vaultSync.js",
  "./src/sync/deviceManager.js",
];

self.addEventListener("install", (event)=>{
  event.waitUntil(
    caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())
  );
});
self.addEventListener("activate", (event)=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.map(k=>k===CACHE?null:caches.delete(k)))).then(()=>self.clients.claim())
  );
});

self.addEventListener("message", (event)=>{
  if (event.data?.type === "SKIP_WAITING"){
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event)=>{
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // don't cache cross-origin

  // Always fetch version file fresh (force update depends on it)
  if (url.pathname.endsWith("/version.json")){
    event.respondWith(fetch(req, { cache: "no-store" }).catch(()=>caches.match(req)));
    return;
  }

  event.respondWith((async ()=>{
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    try{
      const res = await fetch(req);
      // cache GET only
      if (req.method === "GET" && res.ok) cache.put(req, res.clone());
      return res;
    }catch(_e){
      return cached || new Response("Offline", {status:503});
    }
  })());
});