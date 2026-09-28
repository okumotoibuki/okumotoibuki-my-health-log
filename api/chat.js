// Vercel Function: PWA → (this) → Vercel AI Gateway → モデル
//   GET    会話履歴（直近 60 件）
//   POST   メッセージを送り、AI の抽出した記録を DB に保存して返す
//   DELETE 会話履歴を消す（記録は消さない）
import { route, send, body, HttpError } from './_lib/http.js';
import { requireUser, must } from './_lib/supabase.js';
import { SYSTEM, callGateway } from './_lib/ai.js';
import { buildContext, removeIfOrphan, saveRecords, signPaths, uploadPhoto } from './_lib/data.js';
import { normalizeRecords, parseMessage, summarizeSaved, todayIn, hourIn } from './_lib/validate.js';

const HISTORY_FOR_AI = 12;

export default route(['GET', 'POST', 'DELETE'], async (req, res) => {
  const { user, db } = await requireUser(req);

  if (req.method === 'GET') {
    const rows = must(await db.from('chat_messages').select('id,role,content,image_path,saved,created_at')
      .order('created_at', { ascending: false }).limit(60), '会話履歴の取得');
    const urls = await signPaths(db, rows.map(r => r.image_path));
    return send(res, 200, {
      messages: rows.reverse().map(r => ({
        id: r.id, role: r.role, content: r.content, saved: r.saved || [], created_at: r.created_at,
        img: r.image_path ? urls[r.image_path] || null : null,
      })),
    });
  }

  if (req.method === 'DELETE') {
    const rows = must(await db.from('chat_messages').delete().eq('user_id', user.id).select('image_path'), '会話履歴の削除');
    // 会話にしか使っていない写真は消す（記録に紐付いた写真は残る）
    for (const p of new Set(rows.map(r => r.image_path).filter(Boolean))) await removeIfOrphan(db, p);
    return send(res, 200, { ok: true });
  }

  const msg = parseMessage(body(req).message);
  if (!msg) throw new HttpError(400, 'メッセージか写真を送ってください');

  const today = todayIn(), hour = hourIn();
  const [context, hist] = await Promise.all([
    buildContext(db, today, hour),
    db.from('chat_messages').select('role,content,image_path').order('created_at', { ascending: false }).limit(HISTORY_FOR_AI),
  ]);
  const history = must(hist, '会話履歴の取得').reverse()
    .map(m => ({ role: m.role, content: (m.image_path && m.role === 'user' ? '[写真] ' : '') + m.content }))
    .filter(m => m.content);

  const userContent = msg.image
    ? [{ type: 'text', text: msg.text || '（写真のみ）' }, { type: 'image_url', image_url: { url: msg.image } }]
    : msg.text;

  const out = await callGateway(
    [{ role: 'system', content: SYSTEM + '\n\ncontext:\n' + JSON.stringify(context) }, ...history, { role: 'user', content: userContent }],
    { oidcToken: req.headers['x-vercel-oidc-token'] },
  );

  const records = normalizeRecords(out.records, { today, hour, hasImage: !!msg.image });
  let photoPath = await saveRecords(db, user.id, records, msg.image);
  const saved = summarizeSaved(records);
  const reply = String(out.reply || '').slice(0, 2000) || (saved.length ? '記録しました。' : 'うまく読み取れませんでした。もう一度送ってください。');
  const suggestions = Array.isArray(out.suggestions) ? out.suggestions.slice(0, 3).map(s => String(s).slice(0, 40)).filter(Boolean) : [];

  // 会話履歴の保存は失敗しても応答を返す（記録そのものは保存済み）
  try {
    if (msg.image && !photoPath) photoPath = await uploadPhoto(db, user.id, today, msg.image);
    // 同じ insert の行は created_at が同じになり並び順が決まらないので、明示的にずらす
    const t = Date.now();
    must(await db.from('chat_messages').insert([
      { user_id: user.id, role: 'user', content: msg.text, image_path: msg.image ? photoPath : null, created_at: new Date(t).toISOString() },
      { user_id: user.id, role: 'assistant', content: reply, saved, created_at: new Date(t + 1).toISOString() },
    ]), '会話履歴の保存');
  } catch (e) {
    console.error('[chat] history save failed', e);
  }

  return send(res, 200, { reply, saved, suggestions, dates: records.map(r => r.date) });
});
