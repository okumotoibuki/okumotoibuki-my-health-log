// GET /api/logs?from=YYYY-MM-DD&to=YYYY-MM-DD[&golf=1]
// 期間内の記録を 1 日ずつ返す。golf=1 のときは全期間のゴルフスコアも返す。
import { route, send, HttpError } from './_lib/http.js';
import { requireUser } from './_lib/supabase.js';
import { loadDays, loadGolf } from './_lib/data.js';
import { isValidDate, todayIn } from './_lib/validate.js';

const MAX_DAYS = 120;

export default route(['GET'], async (req, res) => {
  const { db } = await requireUser(req);
  const { from, to, golf } = req.query || {};
  if (!isValidDate(from) || !isValidDate(to) || from > to) throw new HttpError(400, '期間の指定が正しくありません');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 >= MAX_DAYS) throw new HttpError(400, `期間は ${MAX_DAYS} 日以内にしてください`);

  const [days, golfList] = await Promise.all([loadDays(db, from, to), golf === '1' ? loadGolf(db) : null]);
  send(res, 200, { today: todayIn(), days, ...(golfList ? { golf: golfList } : {}) });
});
