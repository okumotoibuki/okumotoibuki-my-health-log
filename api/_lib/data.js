// DB の読み書き。すべて本人のトークンで接続した db（RLS 有効）を受け取る。
import { randomUUID } from 'node:crypto';
import { must } from './supabase.js';
import { PARTS, addDaysStr, decodeDataUrl } from './validate.js';

const BUCKET = 'photos';
const SIGN_SECONDS = 60 * 60 * 6; // 表示用の署名付き URL は 6 時間

/* ---------- 写真 ---------- */

export async function uploadPhoto(db, userId, date, dataUrl) {
  const img = decodeDataUrl(dataUrl);
  if (!img) return null;
  const path = `${userId}/${date}/${randomUUID()}.${img.ext}`;
  must(await db.storage.from(BUCKET).upload(path, img.buffer, { contentType: img.contentType, upsert: false }), '写真の保存');
  return path;
}

export async function removePhotos(db, paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  const { error } = await db.storage.from(BUCKET).remove(list);
  // 写真の削除に失敗しても記録の削除は成立させる（孤児ファイルはログに残す）
  if (error) console.error('[photos] remove failed', list, error.message);
}

/** 同じ写真を他の行（食事・身体写真・会話）が参照していなければ Storage から消す */
export async function removeIfOrphan(db, path) {
  if (!path) return;
  const counts = await Promise.all(['meals', 'body_photos'].map(t =>
    db.from(t).select('id', { count: 'exact', head: true }).eq('photo_path', path)));
  const chat = await db.from('chat_messages').select('id', { count: 'exact', head: true }).eq('image_path', path);
  const used = [...counts, chat].reduce((a, r) => a + (r.count || 0), 0);
  if (!used) await removePhotos(db, [path]);
}

export async function signPaths(db, paths) {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length) return {};
  const data = must(await db.storage.from(BUCKET).createSignedUrls(list, SIGN_SECONDS), '写真 URL の発行');
  const map = {};
  for (const x of data || []) if (x.signedUrl && x.path) map[x.path] = x.signedUrl;
  return map;
}

/* ---------- 読み出し ---------- */

/** from..to（両端含む）の記録を 1 日ずつにまとめて返す */
export async function loadDays(db, from, to) {
  const [logs, meals, workouts, photos] = await Promise.all([
    db.from('daily_logs').select('date,sleep_hours,weight_kg,golf_score').gte('date', from).lte('date', to),
    db.from('meals').select('id,date,slot,name,kcal,p,f,c,from_photo,photo_path,created_at').gte('date', from).lte('date', to).order('created_at'),
    db.from('workouts').select('id,date,part,name,sets,created_at').gte('date', from).lte('date', to).order('created_at'),
    db.from('body_photos').select('id,date,photo_path,created_at').gte('date', from).lte('date', to).order('created_at'),
  ]);
  const L = must(logs, '日次記録の取得'), M = must(meals, '食事の取得'), W = must(workouts, 'トレーニングの取得'), P = must(photos, '身体写真の取得');
  const urls = await signPaths(db, [...M.map(m => m.photo_path), ...P.map(p => p.photo_path)]);

  const days = {};
  const day = d => (days[d] ||= { meals: [], training: [], bodyPhotos: [] });
  for (const l of L) {
    const r = day(l.date);
    if (l.sleep_hours != null) r.sleep = Number(l.sleep_hours);
    if (l.weight_kg != null) r.weight = Number(l.weight_kg);
    if (l.golf_score != null) r.golf = l.golf_score;
  }
  for (const m of M) {
    day(m.date).meals.push({ id: m.id, slot: m.slot, name: m.name, kcal: m.kcal, p: m.p, f: m.f, c: m.c, img: urls[m.photo_path] || null });
  }
  for (const w of W) day(w.date).training.push({ id: w.id, part: w.part, name: w.name, sets: w.sets });
  for (const p of P) day(p.date).bodyPhotos.push({ id: p.id, img: urls[p.photo_path] || null });
  return days;
}

/** これまでの全ゴルフスコアと、その前夜の睡眠 */
export async function loadGolf(db) {
  const G = must(await db.from('daily_logs').select('date,golf_score').not('golf_score', 'is', null).order('date').limit(500), 'ゴルフの取得');
  if (!G.length) return [];
  const prev = G.map(g => addDaysStr(g.date, -1));
  const S = must(await db.from('daily_logs').select('date,sleep_hours').in('date', prev), '睡眠の取得');
  const sleep = Object.fromEntries(S.map(s => [s.date, s.sleep_hours == null ? null : Number(s.sleep_hours)]));
  return G.map(g => ({ date: g.date, score: g.golf_score, prev_night_sleep: sleep[addDaysStr(g.date, -1)] ?? null }));
}

const vol = sets => sets.reduce((a, s) => a + (Number(s.w) || 0) * (Number(s.r) || 0), 0);

/** AI に渡す context（直近 30 日の要約 + ゴルフ履歴）をサーバー側で組み立てる */
export async function buildContext(db, today, hour) {
  const from = addDaysStr(today, -29);
  const [days, golf] = await Promise.all([loadDays(db, from, today), loadGolf(db)]);
  const out = [];
  for (let i = 0; i < 30; i++) {
    const d = addDaysStr(today, -i), r = days[d];
    if (!r) continue;
    const o = { date: d };
    if (r.sleep != null) o.sleep_hours = r.sleep;
    if (r.weight != null) o.weight_kg = r.weight;
    if (r.meals.length) {
      o.kcal = r.meals.reduce((a, m) => a + m.kcal, 0);
      for (const k of ['p', 'f', 'c']) o[k] = r.meals.reduce((a, m) => a + m[k], 0);
    }
    const v = {};
    for (const t of r.training) v[t.part] = (v[t.part] || 0) + vol(t.sets);
    if (Object.keys(v).length) o.volume_kg = v;
    if (r.bodyPhotos.length) o.body_photo = true;
    if (r.golf != null) o.golf_score = r.golf;
    out.push(o);
  }
  const weekday = '日月火水木金土'[new Date(today + 'T00:00:00Z').getUTCDay()];
  return { today, weekday, now_hour: hour, parts: PARTS, days: out, golf: golf.slice(-40) };
}

/* ---------- 書き込み ---------- */

/** 正規化済みの records を保存する。写真は 1 枚だけ（送られてきた添付）を必要な行に紐付ける */
export async function saveRecords(db, userId, records, image) {
  let photoPath = null;
  const needPhoto = records.some(r => r.body_photo || r.meals.some(m => m.from_photo));
  if (needPhoto && image) {
    const d = records.find(r => r.body_photo || r.meals.some(m => m.from_photo)).date;
    photoPath = await uploadPhoto(db, userId, d, image);
  }

  for (const r of records) {
    const patch = {};
    if (r.sleep_hours != null) patch.sleep_hours = r.sleep_hours;
    if (r.weight_kg != null) patch.weight_kg = r.weight_kg;
    if (r.golf_score != null) patch.golf_score = r.golf_score;
    if (Object.keys(patch).length) {
      // upsert は指定した列だけ更新する（他の列を null で消さない）
      must(await db.from('daily_logs').upsert({ user_id: userId, date: r.date, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id,date' }), '日次記録の保存');
    }
    if (r.meals.length) {
      must(await db.from('meals').insert(r.meals.map(m => ({
        user_id: userId, date: r.date, slot: m.slot, name: m.name, kcal: m.kcal, p: m.p, f: m.f, c: m.c,
        from_photo: m.from_photo, photo_path: m.from_photo ? photoPath : null,
      }))), '食事の保存');
    }
    if (r.training.length) {
      must(await db.from('workouts').insert(r.training.map(t => ({ user_id: userId, date: r.date, part: t.part, name: t.name, sets: t.sets }))), 'トレーニングの保存');
    }
    if (r.body_photo && photoPath) {
      must(await db.from('body_photos').insert({ user_id: userId, date: r.date, photo_path: photoPath }), '身体写真の保存');
    }
  }
  return photoPath;
}
