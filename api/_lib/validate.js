// 入力の検証・正規化（副作用なし。tests/validate.test.js が検証する）
// AI の出力もユーザーの編集も、DB に書く前に必ずここを通す。

export const PARTS = ['胸', '肩', '腹筋', '二頭', '三頭', '背中', '下半身'];
export const SLOTS = ['朝食', '昼食', '夕食', '間食', 'サプリ'];
/** 食べた量。null は不明（移行前の記録・サプリ） */
export const AMOUNTS = ['完食', '半分', '少し', '食べていない'];
/** 体重の朝・夜 */
export const PERIODS = ['朝', '夜'];
/** 1 通に付けられる写真の枚数 */
export const MAX_IMAGES = 4;
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

/** 指定タイムゾーンでの現在時刻（HH:MM） */
export function nowIn(tz = TIMEZONE, now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
}

/** 「7:05」「07:05」「07:05:00」を「07:05」にする。時刻として読めなければ null */
export function normTime(v) {
  const m = typeof v === 'string' ? /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*$/.exec(v) : null;
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/**
 * 記録の時刻を決める。
 * - 送られてきた時刻があればそれ（今日の記録で今より後なら今に丸める＝未来の時刻は記録しない）
 * - 無ければ fallback（今日の記録なら「今」、過去日なら null＝時刻不明）
 */
export function resolveTime(v, { date, today, now, fallback = date === today ? now : null }) {
  const t = normTime(v);
  if (!t) return fallback ?? null;
  return date === today && now && t > now ? now : t;
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

/** 体重の朝・夜。指定が無ければ時刻から（15時より前は朝）。時刻も無ければ不明 */
export function periodFor(v, time) {
  if (PERIODS.includes(v)) return v;
  return time ? (time < '15:00' ? '朝' : '夜') : null;
}

export function normalizeMeal(m, { hour = 12 } = {}) {
  if (!m || typeof m !== 'object') return null;
  const slot = SLOTS.includes(m.slot) ? m.slot : slotForHour(hour);
  // サプリは量を聞かない。それ以外で量が分からないものは null（不明）
  const amount = slot !== 'サプリ' && AMOUNTS.includes(m.amount) ? m.amount : null;
  // 「朝は食べていない」も記録として残す（0kcal）
  if (amount === '食べていない') {
    return { slot, amount, name: text(m.name) || `${slot}なし`, kcal: 0, p: 0, f: 0, c: 0, from_photo: false };
  }
  const p = num(m.p, 0, 500) ?? 0;
  const f = num(m.f, 0, 500) ?? 0;
  const c = num(m.c, 0, 1000) ?? 0;
  let kcal = num(m.kcal, 0, 5000);
  if (kcal == null) kcal = Math.min(5000, Math.round(p * 4 + f * 9 + c * 4));
  // 中身の無い食事は保存しない（サプリは 0kcal でも名前があれば残す）
  if (kcal === 0 && p === 0 && f === 0 && c === 0 && !(slot === 'サプリ' && text(m.name))) return null;
  return {
    slot, amount,
    name: text(m.name) || (slot === 'サプリ' ? 'サプリ' : '食事'),
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
 * - 時刻（HH:MM）は項目ごと → Record の time → 既定（resolveTime）の順。体重は 1 日に何回でも残せる
 * - 区分か量が分からない食事は保存せず、名前を unresolved（呼び出し側が渡す配列）に入れる
 */
export function normalizeRecords(list, { today, hour = 12, now = `${String(hour).padStart(2, '0')}:00`, imageCount = 0, hasImage, unresolved = [] } = {}) {
  if (hasImage !== undefined && !imageCount) imageCount = hasImage ? 1 : 0;
  // 写真の番号（1 始まり）。範囲外は null。番号が無くても写真が 1 枚だけならそれ
  const photoNo = (v, flag) => {
    const n = num(v, 1, imageCount);
    if (n != null) return n;
    return flag === true && imageCount === 1 ? 1 : null;
  };
  if (!Array.isArray(list)) return [];
  const byDate = new Map();
  for (const x of list.slice(0, 31)) {
    if (!x || typeof x !== 'object') continue;
    const date = x.date == null || x.date === '' ? today : x.date;
    if (!isValidDate(date) || date > today) continue;
    const r = byDate.get(date) || { date, weights: [], bodyPhotos: [], meals: [], training: [] };
    const at = (v, fallback) => resolveTime(normTime(v) ?? normTime(x.time), { date, today, now, ...(fallback === undefined ? {} : { fallback }) });
    const sleep = num(x.sleep_hours, 0, 24, 2);
    const golf = num(x.golf_score, 18, 200);
    if (sleep != null) r.sleep_hours = sleep;
    if (golf != null) r.golf_score = golf;
    // weights: [{kg, time, period}]。旧形式の weight_kg（+ weight_time）も受け付ける
    const ws = Array.isArray(x.weights) ? x.weights.slice(0, 10) : [];
    if (x.weight_kg != null) ws.push({ kg: x.weight_kg, time: x.weight_time });
    for (const w of ws) {
      const kg = num(w?.kg ?? w?.weight_kg, 20, 300, 1);
      if (kg == null) continue;
      const time = at(w.time);
      const period = periodFor(w.period, time);
      if (r.weights.some(o => o.kg === kg && o.time === time && o.period === period)) continue; // 同じ測定の重複
      if (r.weights.length < 10) r.weights.push({ kg, time, period });
    }
    // 身体写真: body_photos: [{photo, time}]。旧形式の body_photo: true（写真 1 枚のとき）も受け付ける
    const bps = Array.isArray(x.body_photos) ? x.body_photos.slice(0, MAX_IMAGES) : [];
    if (x.body_photo === true) bps.push({ photo: x.body_photo_index, time: x.body_photo_time, legacy: true });
    for (const b of bps) {
      const photo = photoNo(b?.photo, b?.legacy === true || b?.photo == null);
      if (photo != null && !r.bodyPhotos.some(o => o.photo === photo)) r.bodyPhotos.push({ photo, time: at(b.time) });
    }
    for (const m of Array.isArray(x.meals) ? x.meals.slice(0, 10) : []) {
      // 区分と量（サプリは区分だけ）が AI の出力で確定していない食事は保存しない。
      // normalizeMeal は区分を時刻から補うが、ここでは「聞き返すべき食事」を推測で埋めない（unresolved に返す）
      if (!m || typeof m !== 'object') continue;
      if (!SLOTS.includes(m.slot) || (m.slot !== 'サプリ' && !AMOUNTS.includes(m.amount))) {
        unresolved.push(text(m.name) || '食事');
        continue;
      }
      const meal = normalizeMeal(m, { hour });
      if (!meal) continue;
      // 時刻の言及が無い食事は、今の時間帯の食事のときだけ「今」とみなす（夜に「昼はラーメン」と送ったら時刻不明）
      const time = at(m.time, date === today && meal.slot === slotForHour(hour) ? now : null);
      const photo = meal.amount === '食べていない' ? null : photoNo(m.photo, meal.from_photo);
      r.meals.push({ ...meal, from_photo: photo != null, photo, time });
    }
    for (const t of Array.isArray(x.training) ? x.training.slice(0, 20) : []) {
      const w = normalizeWorkout(t);
      if (w) r.training.push({ ...w, time: at(t.time) });
    }
    byDate.set(date, r);
  }
  return [...byDate.values()].filter(
    r => r.sleep_hours != null || r.weights.length || r.golf_score != null || r.bodyPhotos.length || r.meals.length || r.training.length,
  );
}

/** チャットの message（文字列 or [{type:'text'},{type:'image_url'}...]）を検証し、本文と画像（最大 MAX_IMAGES 枚）に分ける */
export function parseMessage(message) {
  const MAX_TEXT = 2000;
  if (typeof message === 'string') {
    const t = message.trim().slice(0, MAX_TEXT);
    return t ? { text: t, images: [] } : null;
  }
  if (!Array.isArray(message)) return null;
  let t = '';
  const images = [];
  for (const part of message.slice(0, MAX_IMAGES + 2)) {
    if (part?.type === 'text' && typeof part.text === 'string') t += part.text;
    if (part?.type === 'image_url' && typeof part.image_url?.url === 'string') {
      if (images.length >= MAX_IMAGES) return null;
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(part.image_url.url)) return null;
      images.push(part.image_url.url);
    }
  }
  t = t.trim().slice(0, MAX_TEXT);
  if (!t && !images.length) return null;
  return { text: t, images };
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
  const at = t => (t ? `${t} ` : '');
  for (const r of records) {
    if (r.sleep_hours != null) lines.push(['sleep', `睡眠 ${hm(r.sleep_hours)}`]);
    for (const w of r.weights) lines.push(['weight', `${at(w.time)}${w.period ? `${w.period}の` : ''}体重 ${w.kg.toFixed(1)}kg`]);
    for (const b of r.bodyPhotos) lines.push(['weight', `${at(b.time)}身体写真`]);
    for (const m of r.meals) {
      lines.push(['food', m.amount === '食べていない'
        ? `${at(m.time)}${m.slot} 食べていない`
        : `${at(m.time)}${m.slot} ${m.name}${m.amount ? `（${m.amount}）` : ''} ${n(m.kcal)}kcal（P${m.p} F${m.f} C${m.c}）`]);
    }
    for (const t of r.training) lines.push(['train', `${at(t.time)}${t.name}（${t.part}） ${t.sets.map(x => `${x.w}kg×${x.r}`).join(', ')}`]);
    if (r.golf_score != null) lines.push(['golf', `ゴルフ ${r.golf_score}`]);
  }
  return lines;
}
