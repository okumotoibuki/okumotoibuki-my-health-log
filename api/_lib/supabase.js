// Supabase への接続。service role キーは使わない:
// ユーザー本人のアクセストークンで接続するので、RLS（自分の行だけ）がそのまま効く。
import { createClient } from '@supabase/supabase-js';
import { HttpError, requireEnv } from './http.js';

export const supabaseUrl = () => requireEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
export const anonKey = () =>
  requireEnv('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
export const ownerEmail = () => requireEnv('OWNER_EMAIL').toLowerCase();

/** GoTrue（Supabase Auth）の REST を叩く */
export async function authFetch(path, { method = 'POST', body, token } = {}) {
  const r = await fetch(`${supabaseUrl()}/auth/v1${path}`, {
    method,
    headers: {
      apikey: anonKey(),
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 200) }; }
  return { ok: r.ok, status: r.status, data };
}

// 同じトークンでの連続リクエスト（ホーム初期表示など）で毎回 /user を引かない
const userCache = new Map();
const USER_CACHE_MS = 60_000;

/**
 * Authorization: Bearer <access_token> を検証し、オーナー本人であることを確かめる。
 * 戻り値の db は本人のトークンで接続したクライアント（RLS 有効）。
 */
export async function requireUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'ログインしてください');

  let user = null;
  const hit = userCache.get(token);
  if (hit && hit.until > Date.now()) user = hit.user;
  else {
    const r = await authFetch('/user', { method: 'GET', token });
    if (!r.ok || !r.data?.id) throw new HttpError(401, 'ログインの有効期限が切れました');
    user = r.data;
    if (userCache.size > 50) userCache.clear();
    userCache.set(token, { user, until: Date.now() + USER_CACHE_MS });
  }
  // サインアップを塞いでいても、念のため本人以外は通さない
  if ((user.email || '').toLowerCase() !== ownerEmail()) throw new HttpError(403, 'このアカウントでは利用できません');

  const db = createClient(supabaseUrl(), anonKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { user, db };
}

/** Supabase のエラーを投げ直す（呼び出し元で毎回 if (error) を書かない） */
export function must({ data, error }, what) {
  if (error) {
    const e = new Error(`${what}: ${error.message}`);
    e.cause = error;
    throw e;
  }
  return data;
}
