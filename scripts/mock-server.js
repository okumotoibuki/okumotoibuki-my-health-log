// 画面確認用のモックサーバー（Supabase / AI 不要）
//   node scripts/mock-server.js  →  http://localhost:4173
// public/ を配信し、/api/* をメモリ上の簡易実装で返す。ログインコードは 000000。
// 本番の API と同じ契約（README の「API」）に合わせてあるので、画面の動作確認に使える。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';

const ROOT = new URL('../public/', import.meta.url).pathname;
const PORT = Number(process.env.PORT || 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const pad = n => String(n).padStart(2, '0');
const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const days = {};
for (let i = 20; i >= 0; i--) {
  const d = new Date(today); d.setDate(d.getDate() - i);
  const k = key(d);
  days[k] = { sleep: +(6.5 + (i % 4) * 0.3).toFixed(2), weight: +(74 - (20 - i) * 0.05).toFixed(1), meals: [], training: [], bodyPhotos: [] };
  days[k].meals.push({ id: randomUUID(), slot: '昼食', name: '鶏むね定食', kcal: 620, p: 42, f: 14, c: 88, img: null });
  if (i % 2 === 0) days[k].training.push({ id: randomUUID(), part: '胸', name: 'ベンチプレス', sets: [{ w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 7 }] });
  if (i % 7 === 3) days[k].golf = 90 + (i % 5);
}
const chat = [];

const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise(r => { let s = ''; req.on('data', c => { s += c; }); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } }); });
const findRow = id => { for (const [k, d] of Object.entries(days)) for (const list of ['meals', 'training', 'bodyPhotos']) { const i = d[list].findIndex(x => x.id === id); if (i >= 0) return { k, list, i }; } return null; };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p.startsWith('/api/')) {
    const b = ['POST', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : {};
    if (p === '/api/auth') {
      if (b.action === 'send') return json(res, 200, { ok: true });
      if (b.action === 'verify') return b.code === '000000'
        ? json(res, 200, { access_token: 'mock', refresh_token: 'mock', expires_at: Math.floor(Date.now() / 1000) + 3600, email: b.email })
        : json(res, 401, { error: 'コードが正しくないか、有効期限が切れています' });
      if (b.action === 'refresh') return json(res, 200, { access_token: 'mock', refresh_token: 'mock', expires_at: Math.floor(Date.now() / 1000) + 3600 });
      return json(res, 200, { ok: true });
    }
    if (req.headers.authorization !== 'Bearer mock') return json(res, 401, { error: 'ログインしてください' });
    if (p === '/api/logs') {
      const from = url.searchParams.get('from'), to = url.searchParams.get('to');
      const out = Object.fromEntries(Object.entries(days).filter(([k]) => k >= from && k <= to));
      const golf = Object.entries(days).filter(([, d]) => d.golf != null).map(([date, d]) => ({ date, score: d.golf, prev_night_sleep: null }));
      return json(res, 200, { today: key(today), days: out, ...(url.searchParams.get('golf') ? { golf } : {}) });
    }
    if (p === '/api/chat') {
      if (req.method === 'GET') return json(res, 200, { messages: chat });
      if (req.method === 'DELETE') { chat.length = 0; return json(res, 200, { ok: true }); }
      const text = typeof b.message === 'string' ? b.message : b.message?.find?.(x => x.type === 'text')?.text || '';
      if (/失敗/.test(text)) return json(res, 502, { error: 'AI からエラーが返りました。' });
      const saved = [], dates = [], k = key(today);
      const m = text.match(/体重\D*(\d{2,3}(?:\.\d)?)/);
      if (m) { (days[k] ||= { meals: [], training: [], bodyPhotos: [] }).weight = +m[1]; saved.push(['weight', `体重 ${(+m[1]).toFixed(1)}kg`]); dates.push(k); }
      const reply = saved.length ? '記録しました。前週より少し下がっています。' : '（モック）記録したい内容を送ってください。';
      const at = new Date().toISOString();
      chat.push({ id: randomUUID(), role: 'user', content: text, saved: [], created_at: at }, { id: randomUUID(), role: 'assistant', content: reply, saved, created_at: at });
      return json(res, 200, { reply, saved, suggestions: ['今週の振り返り'], dates });
    }
    if (p === '/api/records') {
      if (b.type === 'day') {
        const d = (days[b.date] ||= { meals: [], training: [], bodyPhotos: [] });
        for (const [f, t] of [['sleep_hours', 'sleep'], ['weight_kg', 'weight'], ['golf_score', 'golf']]) if (f in b) { if (b[f] == null) delete d[t]; else d[t] = b[f]; }
        return json(res, 200, { ok: true });
      }
      const hit = findRow(b.id);
      if (!hit) return json(res, 404, { error: '記録が見つかりません' });
      if (req.method === 'DELETE') days[hit.k][hit.list].splice(hit.i, 1);
      else Object.assign(days[hit.k][hit.list][hit.i], b.type === 'meal' ? { slot: b.slot, name: b.name, kcal: b.kcal ?? b.p * 4 + b.f * 9 + b.c * 4, p: b.p, f: b.f, c: b.c } : { part: b.part, name: b.name, sets: b.sets });
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not found' });
  }
  const file = normalize(join(ROOT, p === '/' ? 'index.html' : p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, () => console.log(`mock: http://localhost:${PORT}  （ログインコード 000000）`));
