// 記録の編集・削除（ホームのカードをタップして開く編集シートから呼ぶ）
//   PATCH  { type:'day', date, sleep_hours?, weight_kg?, golf_score? }   null を送るとその値を消す
//   PATCH  { type:'meal', id, slot, name, kcal, p, f, c }
//   PATCH  { type:'workout', id, part, name, sets }
//   DELETE { type:'meal'|'workout'|'body_photo', id }
import { route, send, body, HttpError } from './_lib/http.js';
import { requireUser, must } from './_lib/supabase.js';
import { removeIfOrphan } from './_lib/data.js';
import { isValidDate, normalizeMeal, normalizeWorkout, num, todayIn } from './_lib/validate.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLE = { meal: 'meals', workout: 'workouts', body_photo: 'body_photos' };

export default route(['PATCH', 'DELETE'], async (req, res) => {
  const { user, db } = await requireUser(req);
  const b = body(req);

  if (b.type === 'day') {
    if (req.method !== 'PATCH' || !isValidDate(b.date) || b.date > todayIn()) throw new HttpError(400, '日付が正しくありません');
    const fields = { sleep_hours: [0, 24, 2], weight_kg: [20, 300, 1], golf_score: [18, 200, 0] };
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
      .select('sleep_hours,weight_kg,golf_score').single(), '日次記録の更新');
    // 全部空になった行は残さない
    if (row.sleep_hours == null && row.weight_kg == null && row.golf_score == null) {
      must(await db.from('daily_logs').delete().eq('date', b.date), '日次記録の削除');
    }
    return send(res, 200, { ok: true });
  }

  const table = TABLE[b.type];
  if (!table || typeof b.id !== 'string' || !UUID.test(b.id)) throw new HttpError(400, '対象が正しくありません');

  if (req.method === 'DELETE') {
    const rows = must(await db.from(table).delete().eq('id', b.id).select(table === 'workouts' ? 'id' : 'id,photo_path'), '削除');
    if (!rows.length) throw new HttpError(404, '記録が見つかりません');
    await removeIfOrphan(db, rows[0].photo_path);
    return send(res, 200, { ok: true });
  }

  let patch;
  if (b.type === 'meal') {
    const m = normalizeMeal(b);
    if (!m) throw new HttpError(400, 'カロリーか PFC を入力してください');
    patch = { slot: m.slot, name: m.name, kcal: m.kcal, p: m.p, f: m.f, c: m.c };
  } else if (b.type === 'workout') {
    const w = normalizeWorkout(b);
    if (!w) throw new HttpError(400, '部位とセット（重量・回数）を入力してください');
    patch = w;
  } else throw new HttpError(400, 'この記録は編集できません');

  const rows = must(await db.from(table).update(patch).eq('id', b.id).select('id'), '更新');
  if (!rows.length) throw new HttpError(404, '記録が見つかりません');
  send(res, 200, { ok: true });
});
