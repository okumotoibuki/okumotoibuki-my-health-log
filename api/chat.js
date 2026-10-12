// Vercel Function: PWA → (this) → Vercel AI Gateway → モデル
//   GET    会話履歴（直近 60 件）
//   POST   メッセージ（写真は最大 4 枚）を送り、AI の抽出した記録を DB に保存して返す
//   DELETE 会話履歴を消す（記録は消さない）
//
// AI が「どの食事か・どれだけ食べたか」を聞き返したとき（ask）は記録せず、会話の行に awaiting を立てる。
// 次の返事が写真なしなら、直前の写真をもう一度 AI に見せて記録する（写真を送り直さなくてよい）。
import { route, send, body, HttpError } from './_lib/http.js';
import { requireUser, must } from './_lib/supabase.js';
import { SYSTEM, callGateway } from './_lib/ai.js';
import { buildContext, downloadAsDataUrl, removeIfOrphan, saveRecords, signPaths, uploadPhoto } from './_lib/data.js';
import { normalizeRecords, parseMessage, summarizeSaved, todayIn, hourIn, nowIn } from './_lib/validate.js';

const HISTORY_FOR_AI = 12;

/** 行の写真（移行前の行は image_path に 1 枚） */
const pathsOf = r => (r.image_paths?.length ? r.image_paths : r.image_path ? [r.image_path] : []);

/**
 * AI が聞き返したまま記録していない写真（新しい順の履歴から探す）。
 * 「写真 → 聞き返し → 返事 → また聞き返し」のように何度聞き返しても、元の写真までさかのぼる。
 * 聞き返しでない AI の返事が挟まったら、そこで終わり（もう答えた写真）。
 */
function pendingPhotos(rows) {
  if (rows[0]?.role !== 'assistant' || !rows[0].awaiting) return [];
  for (const r of rows) {
    if (r.role === 'assistant') { if (!r.awaiting) return []; continue; }
    const p = pathsOf(r);
    if (p.length) return p;
  }
  return [];
}

export default route(['GET', 'POST', 'DELETE'], async (req, res) => {
  const { user, db } = await requireUser(req);

  if (req.method === 'GET') {
    const rows = must(await db.from('chat_messages').select('id,role,content,image_path,image_paths,saved,created_at')
      .order('created_at', { ascending: false }).limit(60), '会話履歴の取得');
    const urls = await signPaths(db, rows.flatMap(pathsOf));
    return send(res, 200, {
      messages: rows.reverse().map(r => ({
        id: r.id, role: r.role, content: r.content, saved: r.saved || [], created_at: r.created_at,
        imgs: pathsOf(r).map(p => urls[p] || null),
      })),
    });
  }

  if (req.method === 'DELETE') {
    const rows = must(await db.from('chat_messages').delete().eq('user_id', user.id).select('image_path,image_paths'), '会話履歴の削除');
    // 会話にしか使っていない写真は消す（記録に紐付いた写真は残る）
    for (const p of new Set(rows.flatMap(pathsOf))) await removeIfOrphan(db, p);
    return send(res, 200, { ok: true });
  }

  const msg = parseMessage(body(req).message);
  if (!msg) throw new HttpError(400, 'メッセージか写真（4 枚まで）を送ってください');

  const at = new Date(), today = todayIn(undefined, at), hour = hourIn(undefined, at), now = nowIn(undefined, at);
  const [context, hist] = await Promise.all([
    buildContext(db, today, hour, now),
    db.from('chat_messages').select('role,content,image_path,image_paths,awaiting').order('created_at', { ascending: false }).limit(HISTORY_FOR_AI),
  ]);
  const histRows = must(hist, '会話履歴の取得');

  // 直前に AI が聞き返していて、今回は写真が無い → 聞き返した時の写真をもう一度見せる
  let photoPaths = [], images = msg.images, reused = false;
  const prev = images.length ? [] : pendingPhotos(histRows);
  if (prev.length) {
    const urls = await Promise.all(prev.map(p => downloadAsDataUrl(db, p)));
    if (urls.every(Boolean)) { photoPaths = prev; images = urls; reused = true; }
  }
  // 新しい写真は先に保存する（記録と会話履歴の両方から同じファイルを参照する）
  if (!reused && images.length) {
    photoPaths = [];
    for (const img of images) {
      const p = await uploadPhoto(db, user.id, today, img);
      if (!p) throw new HttpError(400, '写真を読み込めませんでした（JPEG / PNG / WebP、5MB まで）');
      photoPaths.push(p);
    }
  }

  const history = histRows.slice().reverse()
    .map(m => {
      const n = m.role === 'user' ? pathsOf(m).length : 0;
      return { role: m.role, content: (n ? `[写真${n}枚] ` : '') + m.content };
    })
    .filter(m => m.content);

  const note = reused ? `（直前に送った写真${images.length}枚についての返事）` : images.length > 1 ? `（写真${images.length}枚。順に写真1〜${images.length}）` : '';
  const userContent = images.length
    ? [{ type: 'text', text: (msg.text || '（写真のみ）') + note }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))]
    : msg.text;

  let out, records;
  try {
    out = await callGateway(
      [{ role: 'system', content: SYSTEM + '\n\ncontext:\n' + JSON.stringify(context) }, ...history, { role: 'user', content: userContent }],
      { oidcToken: req.headers['x-vercel-oidc-token'] },
    );
    records = normalizeRecords(out.records, { today, hour, now, imageCount: images.length });
    await saveRecords(db, user.id, records, photoPaths);
  } catch (e) {
    // 今回アップロードした写真は、どこからも参照されていなければ消す（再送でまたアップロードされる）
    if (!reused) for (const p of photoPaths) await removeIfOrphan(db, p).catch(() => {});
    throw e;
  }
  const saved = summarizeSaved(records);
  // 聞き返し: 写真があり、まだ何も記録しておらず、AI が答えを待っている
  const awaiting = out.ask === true && images.length > 0 && !records.length;
  const reply = String(out.reply || '').slice(0, 2000) || (saved.length ? '記録しました。' : 'うまく読み取れませんでした。もう一度送ってください。');
  const suggestions = Array.isArray(out.suggestions) ? out.suggestions.slice(0, 4).map(s => String(s).slice(0, 40)).filter(Boolean) : [];

  // 会話履歴の保存は失敗しても応答を返す（記録そのものは保存済み）
  try {
    // 同じ insert の行は created_at が同じになり並び順が決まらないので、明示的にずらす
    const t = Date.now();
    must(await db.from('chat_messages').insert([
      { user_id: user.id, role: 'user', content: msg.text, image_paths: reused ? [] : photoPaths, created_at: new Date(t).toISOString() },
      { user_id: user.id, role: 'assistant', content: reply, saved, awaiting, created_at: new Date(t + 1).toISOString() },
    ]), '会話履歴の保存');
  } catch (e) {
    console.error('[chat] history save failed', e);
  }

  return send(res, 200, { reply, saved, suggestions, awaiting, dates: records.map(r => r.date) });
});
