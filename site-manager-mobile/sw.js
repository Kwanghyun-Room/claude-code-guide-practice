// 앱 화면 파일을 저장해 두어 오프라인에서도 목록이 열리게 한다.
// 항상 네트워크를 먼저 시도하므로 새 버전을 배포하면 바로 반영된다.
const CACHE = 'site-links-v1';
const SHELL = ['./', 'index.html', 'app.js', 'common.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // GitHub 동기화 요청 등 다른 사이트로 가는 요청은 건드리지 않는다
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })));   // 공유로 열린 ?url=… 주소도 캐시된 화면으로
});
