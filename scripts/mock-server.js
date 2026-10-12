// 画面確認用のモックサーバー（Supabase / AI 不要）
//   node scripts/mock-server.js  →  http://localhost:4173
// public/ を配信し、/api/* をメモリ上の簡易実装で返す。ログインのパスワードは mock（メールアドレスは何でもよい）。
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
  const morning = +(73 + i * 0.05).toFixed(1);
  days[k] = { sleep: +(6.5 + (i % 4) * 0.3).toFixed(2), weights: [{ id: randomUUID(), time: '07:10', period: '朝', kg: morning }], meals: [], training: [], bodyPhotos: [] };
  if (i % 3 === 0) days[k].weights.push({ id: randomUUID(), time: '22:30', period: '夜', kg: +(morning + 0.8).toFixed(1) });
  days[k].meals.push({ id: randomUUID(), time: '12:20', slot: '昼食', amount: '完食', name: '鶏むね定食', kcal: 620, p: 42, f: 14, c: 88, img: null });
  if (i % 4 === 1) days[k].meals.push({ id: randomUUID(), time: null, slot: '朝食', amount: '食べていない', name: '朝食なし', kcal: 0, p: 0, f: 0, c: 0, img: null });
  days[k].meals.push({ id: randomUUID(), time: '08:00', slot: 'サプリ', amount: null, name: 'マルチビタミン', kcal: 0, p: 0, f: 0, c: 0, img: null });
  if (i % 2 === 0) days[k].training.push({ id: randomUUID(), time: '19:00', part: '胸', name: 'ベンチプレス', sets: [{ w: 80, r: 8 }, { w: 80, r: 8 }, { w: 80, r: 7 }] });
  if (i % 7 === 3) days[k].golf = 90 + (i % 5);
}
const chat = [];
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const newDay = () => ({ weights: [], meals: [], training: [], bodyPhotos: [] });
/** 本番の loadDays と同じ形にする（時刻順・時刻不明は後ろ、weight はその日最初の測定） */
const withWeight = d => {
  const byT = (a, b) => (a.time ?? '99') < (b.time ?? '99') ? -1 : (a.time ?? '99') > (b.time ?? '99') ? 1 : 0;
  for (const l of ['weights', 'meals', 'training', 'bodyPhotos']) d[l].sort(byT);
  return { ...d, ...(d.weights.length ? { weight: d.weights[0].kg } : {}) };
};

const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise(r => { let s = ''; req.on('data', c => { s += c; }); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } }); });
const findRow = id => { for (const [k, d] of Object.entries(days)) for (const list of ['weights', 'meals', 'training', 'bodyPhotos']) { const i = d[list].findIndex(x => x.id === id); if (i >= 0) return { k, list, i }; } return null; };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p.startsWith('/api/')) {
    const b = ['POST', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : {};
    if (p === '/api/auth') {
      if (b.action === 'login') return b.password === 'mock'
        ? json(res, 200, { access_token: 'mock', refresh_token: 'mock', expires_at: Math.floor(Date.now() / 1000) + 3600, email: b.email })
        : json(res, 401, { error: 'メールアドレスかパスワードが正しくありません' });
      if (b.action === 'refresh') return json(res, 200, { access_token: 'mock', refresh_token: 'mock', expires_at: Math.floor(Date.now() / 1000) + 3600 });
      return json(res, 200, { ok: true });
    }
    if (req.headers.authorization !== 'Bearer mock') return json(res, 401, { error: 'ログインしてください' });
    if (p === '/api/logs') {
      const from = url.searchParams.get('from'), to = url.searchParams.get('to');
      const out = Object.fromEntries(Object.entries(days).filter(([k]) => k >= from && k <= to).map(([k, d]) => [k, withWeight(d)]));
      const golf = Object.entries(days).filter(([, d]) => d.golf != null).map(([date, d]) => ({ date, score: d.golf, prev_night_sleep: null }));
      return json(res, 200, { today: key(today), days: out, ...(url.searchParams.get('golf') ? { golf } : {}) });
    }
    if (p === '/api/chat') {
      if (req.method === 'GET') return json(res, 200, { messages: chat });
      if (req.method === 'DELETE') { chat.length = 0; return json(res, 200, { ok: true }); }
      const text = typeof b.message === 'string' ? b.message : b.message?.find?.(x => x.type === 'text')?.text || '';
      const imgs = Array.isArray(b.message) ? b.message.filter(x => x.type === 'image_url').map(x => x.image_url.url) : [];
      const at0 = new Date().toISOString();
      const k0 = key(today);
      // 写真だけで区分・量が分からない → 聞き返す（本番の ask と同じ流れ）
      if (imgs.length && !/朝食|昼食|夕食|間食|サプリ/.test(text)) {
        const reply = `写真${imgs.length}枚を受け取りました。どの食事で、どれくらい食べましたか？`;
        chat.push({ id: randomUUID(), role: 'user', content: text, imgs, saved: [], created_at: at0 }, { id: randomUUID(), role: 'assistant', content: reply, saved: [], created_at: at0, awaiting: true });
        return json(res, 200, { reply, saved: [], suggestions: ['昼食・完食', '昼食・半分', '夕食・完食', 'サプリ'], awaiting: true, dates: [] });
      }
      const sm = text.match(/(朝食|昼食|夕食|間食|サプリ)(?:・(完食|半分|少し|食べていない))?/);
      if (sm && (imgs.length || chat.at(-1)?.awaiting)) {
        const amount = sm[1] === 'サプリ' ? null : sm[2] || '完食';
        const kc = amount === '食べていない' ? 0 : amount === '半分' ? 350 : 700;
        (days[k0] ||= newDay()).meals.push({ id: randomUUID(), time: nowHM(), slot: sm[1], amount, name: amount === '食べていない' ? `${sm[1]}なし` : 'カレーライス', kcal: kc, p: kc ? 20 : 0, f: kc ? 20 : 0, c: kc ? 100 : 0, img: imgs[0] || chat.findLast(m => m.imgs?.length)?.imgs[0] || null });
        const saved = [['food', `${nowHM()} ${sm[1]} ${amount === '食べていない' ? '食べていない' : `カレーライス（${amount || ''}） ${kc}kcal`}`]];
        chat.push({ id: randomUUID(), role: 'user', content: text, imgs, saved: [], created_at: at0 }, { id: randomUUID(), role: 'assistant', content: '記録しました（推定値です）。', saved, created_at: at0 });
        return json(res, 200, { reply: '記録しました（推定値です）。', saved, suggestions: [], dates: [k0] });
      }
      if (/失敗/.test(text)) return json(res, 502, { error: 'AI からエラーが返りました。' });
      const saved = [], dates = [], k = key(today);
      const m = text.match(/体重\D*(\d{2,3}(?:\.\d)?)/);
      if (m) { const t = nowHM(); const pd = /夜/.test(text) ? '夜' : '朝'; (days[k] ||= newDay()).weights.push({ id: randomUUID(), time: t, period: pd, kg: +m[1] }); saved.push(['weight', `${t} ${pd}の体重 ${(+m[1]).toFixed(1)}kg`]); dates.push(k); }
      const reply = saved.length ? '記録しました。前週より少し下がっています。' : '（モック）記録したい内容を送ってください。';
      const at = new Date().toISOString();
      chat.push({ id: randomUUID(), role: 'user', content: text, imgs, saved: [], created_at: at }, { id: randomUUID(), role: 'assistant', content: reply, saved, created_at: at });
      return json(res, 200, { reply, saved, suggestions: ['今週の振り返り'], dates });
    }
    if (p === '/api/records') {
      if (b.type === 'day') {
        const d = (days[b.date] ||= newDay());
        for (const [f, t] of [['sleep_hours', 'sleep'], ['golf_score', 'golf']]) if (f in b) { if (b[f] == null) delete d[t]; else d[t] = b[f]; }
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && b.type === 'weight') {
        (days[b.date] ||= newDay()).weights.push({ id: randomUUID(), time: b.time || null, period: b.period || null, kg: b.weight_kg });
        return json(res, 200, { ok: true });
      }
      const hit = findRow(b.id);
      if (!hit) return json(res, 404, { error: '記録が見つかりません' });
      if (req.method === 'DELETE') days[hit.k][hit.list].splice(hit.i, 1);
      else Object.assign(days[hit.k][hit.list][hit.i], { time: b.time || null },
        b.type === 'weight' ? { kg: b.weight_kg, period: b.period || null }
          : b.type === 'meal' ? (b.amount === '食べていない'
            ? { slot: b.slot, amount: b.amount, name: b.name, kcal: 0, p: 0, f: 0, c: 0 }
            : { slot: b.slot, amount: b.amount || null, name: b.name, kcal: b.kcal ?? b.p * 4 + b.f * 9 + b.c * 4, p: b.p, f: b.f, c: b.c })
            : { part: b.part, name: b.name, sets: b.sets });
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
}).listen(PORT, () => console.log(`mock: http://localhost:${PORT}  （パスワード mock）`));
