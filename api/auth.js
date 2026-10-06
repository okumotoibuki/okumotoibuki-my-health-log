// ログイン（メールアドレス + パスワード）
// メールのワンタイムコードは届かないことがあったため、Supabase のパスワード認証に切り替えた。
// パスワードは Supabase の auth.users にだけ置き、リポジトリには書かない。
import { route, send, body, HttpError } from './_lib/http.js';
import { authFetch, ownerEmail } from './_lib/supabase.js';

const session = d => ({
  access_token: d.access_token,
  refresh_token: d.refresh_token,
  expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
  email: d.user?.email || null,
});

const BAD_LOGIN = 'メールアドレスかパスワードが正しくありません';

export default route(['POST'], async (req, res) => {
  const b = body(req);
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';

  switch (b.action) {
    case 'login': {
      const password = typeof b.password === 'string' ? b.password : '';
      if (!email || !password) throw new HttpError(400, 'メールアドレスとパスワードを入力してください');
      // オーナー以外は Supabase に問い合わせずに断る。文言は同じにして、登録されているアドレスかを推測させない
      if (email !== ownerEmail()) throw new HttpError(401, BAD_LOGIN);
      const r = await authFetch('/token?grant_type=password', { body: { email, password } });
      if (r.status === 429) throw new HttpError(429, '試行回数が多すぎます。少し待ってから試してください。');
      if (!r.ok || !r.data?.access_token) {
        if (r.status !== 400) console.error('[auth] password login failed', r.status, r.data);
        throw new HttpError(401, BAD_LOGIN);
      }
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
