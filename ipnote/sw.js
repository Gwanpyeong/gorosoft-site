/* 현장 IP 기록 — 화면 파일만 기기에 저장해 두고, 데이터는 Firestore가 따로 관리합니다.
   화면 파일은 "네트워크 먼저, 안 되면 저장본" 방식이라 업데이트가 바로 반영됩니다. */
const CACHE = 'ipnote-v20261110c';
const SHELL = ['/ipnote/', '/ipnote/app.js?v=20261110c', '/firebase-config.js?v=20261026b', '/ipnote/manifest.webmanifest', '/ipnote/icon-180.png', '/ipnote/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('ipnote-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameApp = url.origin === location.origin && (url.pathname.startsWith('/ipnote/') || url.pathname === '/firebase-config.js');
  const sdk = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  const font = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameApp && !sdk && !font) return; // 로그인·Firestore 통신은 건드리지 않음
  if (sdk || font) {
    // 버전이 고정된 파일: 저장본 먼저
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)) } return res })));
    return;
  }
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)) }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(hit => hit || caches.match('/ipnote/'))));
});
