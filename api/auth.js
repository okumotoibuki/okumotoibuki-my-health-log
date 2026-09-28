// ログイン（メールのワンタイムコード）
// iOS のホーム画面 PWA は Safari とストレージが別なので、メールのリンクを開く方式だと
// PWA 側にログインが残らない。6 桁のコードを PWA に打ち込む方式にしている。
import { route, send, body, HttpError } from './_lib/http.js';
import { authFetch, ownerEmail } from './_lib/supabase.js';

const session = d => ({
  access_token: d.access_token,
  refresh_token: d.refresh_token,
  expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
  email: d.user?.email || null,
});

export default route(['POST'], async (req, res) => {
  const b = body(req);
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';

  switch (b.action) {
    case 'send': {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'メールアドレスを確認してください');
      // オーナー以外には送らない。応答は同じにして、登録されているアドレスかを推測させない
      if (email !== ownerEmail()) return send(res, 200, { ok: true });
      // ここに来るのはオーナーのアドレスだけなので、初回はユーザーを作ってよい
      // （初回ログイン後は Supabase の「新規登録」を無効にする = README の手順）
      const r = await authFetch('/otp', { body: { email, create_user: true } });
      if (!r.ok) {
        console.error('[auth] otp failed', r.status, r.data);
        throw new HttpError(r.status === 429 ? 429 : 502, r.status === 429 ? 'コードの送信回数が多すぎます。少し待ってから試してください。' : 'コードを送れませんでした。');
      }
      return send(res, 200, { ok: true });
    }
    case 'verify': {
      const code = String(b.code || '').replace(/\D/g, '');
      if (!email || code.length < 6) throw new HttpError(400, 'コードを確認してください');
      if (email !== ownerEmail()) throw new HttpError(401, 'コードが正しくないか、有効期限が切れています');
      const r = await authFetch('/verify', { body: { type: 'email', email, token: code } });
      if (!r.ok || !r.data?.access_token) throw new HttpError(401, 'コードが正しくないか、有効期限が切れています');
      return send(res, 200, session(r.data));
    }
    case 'refresh': {
      if (typeof b.refresh_token !== 'string' || !b.refresh_token) throw new HttpError(400, 'refresh_token がありません');
      const r = await authFetch('/token?grant_type=refresh_token', { body: { refresh_token: b.refresh_token } });
      if (!r.ok || !r.data?.access_token) throw new HttpError(401, 'もう一度ログインしてください');
      if ((r.data.user?.email || '').toLowerCase() !== ownerEmail()) throw new HttpError(403, 'このアカウントでは利用できません');
      return send(res, 200, session(r.data));
    }
    case 'logout': {
      const h = req.headers.authorization || '';
      if (h.startsWith('Bearer ')) await authFetch('/logout', { token: h.slice(7) }).catch(() => {});
      return send(res, 200, { ok: true });
    }
    default:
      throw new HttpError(400, 'action が不正です');
  }
});
