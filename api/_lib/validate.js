// 入力の検証・正規化（副作用なし。tests/validate.test.js が検証する）
// AI の出力もユーザーの編集も、DB に書く前に必ずここを通す。

export const PARTS = ['胸', '肩', '腹筋', '二頭', '三頭', '背中', '下半身'];
export const SLOTS = ['朝食', '昼食', '夕食', '間食'];
export const TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Tokyo';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 指定タイムゾーンでの今日（YYYY-MM-DD）。サーバーは UTC で動くので必ずこれを使う */
export function todayIn(tz = TIMEZONE, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** 指定タイムゾーンでの現在の時（0-23） */
export function hourIn(tz = TIMEZONE, now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now));
}

/** 実在する日付か（2026-02-30 のようなものを弾く） */
export function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function addDaysStr(s, n) {
  const d = new Date(s + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const finite = v => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);

/** 範囲外・数値でないものは null。丸め桁を指定できる */
export function num(v, min, max, digits = 0) {
  const n = finite(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  const k = 10 ** digits;
  return Math.round(n * k) / k;
}

export function text(v, max = 80) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

export function slotForHour(h) {
  return h < 10 ? '朝食' : h < 15 ? '昼食' : h < 21 ? '夕食' : '間食';
}

export function normalizeMeal(m, { hour = 12 } = {}) {
  if (!m || typeof m !== 'object') return null;
  const p = num(m.p, 0, 500) ?? 0;
  const f = num(m.f, 0, 500) ?? 0;
  const c = num(m.c, 0, 1000) ?? 0;
  let kcal = num(m.kcal, 0, 5000);
  if (kcal == null) kcal = Math.min(5000, Math.round(p * 4 + f * 9 + c * 4));
  if (kcal === 0 && p === 0 && f === 0 && c === 0) return null; // 中身の無い食事は保存しない
  return {
    slot: SLOTS.includes(m.slot) ? m.slot : slotForHour(hour),
    name: text(m.name) || '食事',
    kcal, p, f, c,
    from_photo: m.from_photo === true,
  };
}

export function normalizeSets(sets) {
  if (!Array.isArray(sets)) return null;
  const out = sets
    .slice(0, 30)
    .map(s => ({ w: num(s?.w, 0, 1000, 1), r: num(s?.r, 1, 200) }))
    .filter(s => s.w != null && s.r != null);
  return out.length ? out : null;
}

export function normalizeWorkout(t) {
  if (!t || typeof t !== 'object' || !PARTS.includes(t.part)) return null;
  const sets = normalizeSets(t.sets);
  if (!sets) return null;
  return { part: t.part, name: text(t.name) || t.part, sets };
}

/**
 * AI が返した records を正規化する。
 * - 日付が無い / 不正 → today。未来日は捨てる（CLAUDE.md の契約）
 * - 同じ日付の Record はまとめる
 * - 値が 1 つも残らない Record は捨てる
 */
export function normalizeRecords(list, { today, hour = 12, hasImage = false } = {}) {
  if (!Array.isArray(list)) return [];
  const byDate = new Map();
  for (const x of list.slice(0, 31)) {
    if (!x || typeof x !== 'object') continue;
    const date = x.date == null || x.date === '' ? today : x.date;
    if (!isValidDate(date) || date > today) continue;
    const r = byDate.get(date) || { date, meals: [], training: [] };
    const sleep = num(x.sleep_hours, 0, 24, 2);
    const weight = num(x.weight_kg, 20, 300, 1);
    const golf = num(x.golf_score, 18, 200);
    if (sleep != null) r.sleep_hours = sleep;
    if (weight != null) r.weight_kg = weight;
    if (golf != null) r.golf_score = golf;
    if (x.body_photo === true && hasImage) r.body_photo = true;
    for (const m of Array.isArray(x.meals) ? x.meals.slice(0, 10) : []) {
      const meal = normalizeMeal(m, { hour });
      if (meal) r.meals.push({ ...meal, from_photo: meal.from_photo && hasImage });
    }
    for (const t of Array.isArray(x.training) ? x.training.slice(0, 20) : []) {
      const w = normalizeWorkout(t);
      if (w) r.training.push(w);
    }
    byDate.set(date, r);
  }
  return [...byDate.values()].filter(
    r => r.sleep_hours != null || r.weight_kg != null || r.golf_score != null || r.body_photo || r.meals.length || r.training.length,
  );
}

/** チャットの message（文字列 or [{type:'text'},{type:'image_url'}]）を検証し、本文と画像に分ける */
export function parseMessage(message) {
  const MAX_TEXT = 2000;
  if (typeof message === 'string') {
    const t = message.trim().slice(0, MAX_TEXT);
    return t ? { text: t, image: null } : null;
  }
  if (!Array.isArray(message)) return null;
  let t = '', image = null;
  for (const part of message.slice(0, 4)) {
    if (part?.type === 'text' && typeof part.text === 'string') t += part.text;
    if (part?.type === 'image_url' && typeof part.image_url?.url === 'string' && !image) image = part.image_url.url;
  }
  t = t.trim().slice(0, MAX_TEXT);
  if (image && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) return null;
  if (!t && !image) return null;
  return { text: t, image };
}

/** data URL → { buffer, contentType, ext }。5MB を超えるものは null */
export function decodeDataUrl(url) {
  const m = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url || '');
  if (!m) return null;
  const buffer = Buffer.from(m[3], 'base64');
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) return null;
  return { buffer, contentType: m[1], ext: m[2] === 'jpeg' ? 'jpg' : m[2] };
}

/** 保存した記録を、チャットに出す 1 行ずつの要約にする */
export function summarizeSaved(records) {
  const lines = [];
  const n = v => Math.round(v).toLocaleString('ja-JP');
  const hm = h => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}時間${m % 60 ? `${m % 60}分` : ''}`; };
  for (const r of records) {
    if (r.sleep_hours != null) lines.push(['sleep', `睡眠 ${hm(r.sleep_hours)}`]);
    if (r.weight_kg != null) lines.push(['weight', `体重 ${r.weight_kg.toFixed(1)}kg`]);
    if (r.body_photo) lines.push(['weight', '身体写真']);
    for (const m of r.meals) lines.push(['food', `${m.name} ${n(m.kcal)}kcal（P${m.p} F${m.f} C${m.c}）`]);
    for (const t of r.training) lines.push(['train', `${t.name} ${t.sets.length}セット（${t.part}）`]);
    if (r.golf_score != null) lines.push(['golf', `ゴルフ ${r.golf_score}`]);
  }
  return lines;
}
