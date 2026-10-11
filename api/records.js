// 記録の追加・編集・削除（ホームのカードをタップして開く編集シートから呼ぶ）
//   PATCH  { type:'day', date, sleep_hours?, golf_score? }   null を送るとその値を消す
//   POST   { type:'weight', date, time, period, weight_kg }   体重は測るたびに 1 件（1 日に何回でも）。period は '朝'|'夜'
//   PATCH  { type:'weight', id, time, period, weight_kg }
//   PATCH  { type:'meal', id, time, slot, amount, name, kcal, p, f, c }   slot にサプリ、amount は 完食|半分|少し|食べていない
//   PATCH  { type:'workout', id, time, part, name, sets }
//   DELETE { type:'weight'|'meal'|'workout'|'body_photo', id }
// time は "HH:MM"。null / '' で「時刻不明」にできる。今日の記録に今より後の時刻は入れられない。
import { route, send, body, HttpError } from './_lib/http.js';
import { requireUser, must } from './_lib/supabase.js';
import { removeIfOrphan } from './_lib/data.js';
import { PERIODS, isValidDate, normalizeMeal, normalizeWorkout, normTime, num, nowIn, periodFor, todayIn } from './_lib/validate.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLE = { weight: 'weights', meal: 'meals', workout: 'workouts', body_photo: 'body_photos' };

/** 入力の時刻を検証する。未指定・空は null（時刻不明） */
function parseTime(v, date) {
  if (v == null || v === '') return null;
  const t = normTime(v);
  if (!t) throw new HttpError(400, '時刻が正しくありません');
  if (date === todayIn() && t > nowIn()) throw new HttpError(400, '未来の時刻は記録できません');
  return t;
}

function parsePeriod(v, time) {
  if (v != null && v !== '' && !PERIODS.includes(v)) throw new HttpError(400, '朝か夜を選んでください');
  return periodFor(v, time);
}

function parseWeight(v) {
  const w = num(v, 20, 300, 1);
  if (w == null) throw new HttpError(400, '体重は 20〜300kg の範囲で入力してください');
  return w;
}

export default route(['POST', 'PATCH', 'DELETE'], async (req, res) => {
  const { user, db } = await requireUser(req);
  const b = body(req);

  if (b.type === 'day') {
    if (req.method !== 'PATCH' || !isValidDate(b.date) || b.date > todayIn()) throw new HttpError(400, '日付が正しくありません');
    // 体重は weights に移った。古いアプリから来たら黙って捨てずに知らせる
    if ('weight_kg' in b) throw new HttpError(400, 'アプリが古いままです。再読み込みしてから入力してください');
    const fields = { sleep_hours: [0, 24, 2], golf_score: [18, 200, 0] };
    const patch = {};
    for (const [k, [min, max, d]] of Object.entries(fields)) {
      if (!(k in b)) continue;
      if (b[k] === null || b[k] === '') patch[k] = null;
      else {
        const v = num(b[k], min, max, d);
        if (v == null) throw new HttpError(400, `${k} の値が範囲外です`);
        patch[k] = v;
      }
    }
    if (!Object.keys(patch).length) throw new HttpError(400, '変更がありません');
    const row = must(await db.from('daily_logs')
      .upsert({ user_id: user.id, date: b.date, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id,date' })
      .select('sleep_hours,golf_score').single(), '日次記録の更新');
    // 全部空になった行は残さない
    if (row.sleep_hours == null && row.golf_score == null) {
      must(await db.from('daily_logs').delete().eq('date', b.date), '日次記録の削除');
    }
    return send(res, 200, { ok: true });
  }

  if (req.method === 'POST') {
    if (b.type !== 'weight') throw new HttpError(400, 'この記録はここから追加できません');
    if (!isValidDate(b.date) || b.date > todayIn()) throw new HttpError(400, '日付が正しくありません');
    const time = parseTime(b.time, b.date);
    const row = { user_id: user.id, date: b.date, time, period: parsePeriod(b.period, time), weight_kg: parseWeight(b.weight_kg) };
    must(await db.from('weights').insert(row), '体重の保存');
    return send(res, 200, { ok: true });
  }

  const table = TABLE[b.type];
  if (!table || typeof b.id !== 'string' || !UUID.test(b.id)) throw new HttpError(400, '対象が正しくありません');

  if (req.method === 'DELETE') {
    const hasPhoto = table === 'meals' || table === 'body_photos';
    const rows = must(await db.from(table).delete().eq('id', b.id).select(hasPhoto ? 'id,photo_path' : 'id'), '削除');
    if (!rows.length) throw new HttpError(404, '記録が見つかりません');
    if (hasPhoto) await removeIfOrphan(db, rows[0].photo_path);
    return send(res, 200, { ok: true });
  }

  // 未来の時刻かどうかは記録の日付で決まるので、先に読む
  const cur = must(await db.from(table).select('date').eq('id', b.id).maybeSingle(), '記録の取得');
  if (!cur) throw new HttpError(404, '記録が見つかりません');
  // time を送ってこない（古いアプリ）ときは今の時刻を消さずに残す
  const timePatch = 'time' in b ? { time: parseTime(b.time, cur.date) } : {};

  let patch;
  if (b.type === 'weight') {
    patch = { ...timePatch, weight_kg: parseWeight(b.weight_kg) };
    if ('period' in b) patch.period = parsePeriod(b.period, timePatch.time);
  } else if (b.type === 'meal') {
    const m = normalizeMeal(b);
    if (!m) throw new HttpError(400, 'カロリーか PFC を入力してください');
    patch = { ...timePatch, slot: m.slot, name: m.name, kcal: m.kcal, p: m.p, f: m.f, c: m.c };
    if ('amount' in b) patch.amount = m.amount;
  } else if (b.type === 'workout') {
    const w = normalizeWorkout(b);
    if (!w) throw new HttpError(400, '部位とセット（重量・回数）を入力してください');
    patch = { ...timePatch, ...w };
  } else throw new HttpError(400, 'この記録は編集できません');

  const rows = must(await db.from(table).update(patch).eq('id', b.id).select('id'), '更新');
  if (!rows.length) throw new HttpError(404, '記録が見つかりません');
  send(res, 200, { ok: true });
});
