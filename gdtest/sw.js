/* GORO Drive 미리보기 — 화면 파일은 "네트워크 먼저, 안 되면 저장본" 방식. 기록은 기기(localStorage)에만 저장. */
const CACHE = 'gdtest-v20261120c';
const SHELL = ['/gdtest/', '/gdtest/manifest.webmanifest', '/gdtest/icon-180.png', '/gdtest/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x.startsWith('gdtest-') && x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === location.origin && (url.pathname.startsWith('/gdtest/') || url.pathname === '/firebase-config.js');
  const font = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'cdn.jsdelivr.net' || (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')); /* 글꼴·글자 인식 파일: 버전 고정이라 저장본 먼저 */
  if (!same && !font) return;
  if (font) { e.respondWith(caches.match(req).then(h => h || fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); return r; }))); return; }
  e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r; })
    .catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(h => h || caches.match('/gdtest/'))));
});
