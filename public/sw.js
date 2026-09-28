// Service Worker
// - アプリ本体（HTML/CSS/JS/アイコン）はキャッシュし、オフラインでも開けるようにする
// - 記録の読み出し（GET /api/logs, GET /api/chat）はネット優先。つながらないときだけ最後に取れた内容を返す（閲覧のみ）
// - 書き込み（POST/PATCH/DELETE）と認証はキャッシュしない
const VERSION = 'v1.0.0';
const SHELL = `mhl-shell-${VERSION}`;
const DATA = 'mhl-data';
const SHELL_FILES = ['/', '/index.html', '/styles.css', '/js/app.js', '/js/api.js', '/js/util.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('mhl-shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname === '/api/logs' || url.pathname === '/api/chat') {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(DATA).then(c => c.put(url.pathname + url.search, copy)); }
      return res;
    }).catch(async () => (await caches.match(url.pathname + url.search, { cacheName: DATA })) ||
      new Response(JSON.stringify({ error: 'オフラインです。前に表示したことのある期間だけ閲覧できます。' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    return;
  }
  if (url.pathname.startsWith('/api/')) return;

  // アプリ本体: キャッシュを先に返し、裏で更新する
  e.respondWith(caches.open(SHELL).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('/index.html') : null);
    const net = fetch(req).then(res => { if (res.ok && res.type === 'basic') c.put(req, res.clone()); return res; }).catch(() => null);
    return hit || (await net) || new Response('オフラインです', { status: 503 });
  }));
});
