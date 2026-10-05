/* ============================================================
   sw.js — Service Worker，离线缓存
   策略：网络优先（network-first），断网时回退到缓存。
   这样每次更新代码都能拿到最新版，避免新旧代码不匹配导致白屏。
   ============================================================ */

const CACHE = 'inventory-app-v3';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  // 网络优先：先请求最新资源，成功则更新缓存；失败（离线）则用缓存
  e.respondWith(
    fetch(e.request).then(res => {
      if (res && res.status === 200 && e.request.url.startsWith(self.location.origin)) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => {
      return caches.match(e.request).then(cached => {
        if (cached) return cached;
        // 导航请求回退到首页
        if (e.request.mode === 'navigate') return caches.match('./index.html');
        return new Response('离线且无缓存', { status: 503 });
      });
    })
  );
});
