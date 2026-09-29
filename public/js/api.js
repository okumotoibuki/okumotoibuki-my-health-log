// ログイン状態の保持と API 呼び出し
// セッションは localStorage に置く（本人専用端末・ホーム画面 PWA を前提）。

const KEY = 'mhl.session';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

let session = null;
try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { session = null; }
const listeners = new Set();

function save(s) {
  session = s;
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* 保存できなくてもこのタブでは動く */ }
  listeners.forEach(f => f(!!s));
}

export const isLoggedIn = () => !!session?.refresh_token;
export const onAuthChange = f => listeners.add(f);

async function raw(path, { method = 'GET', body, token } = {}) {
  let r;
  try {
    r = await fetch(path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, navigator.onLine === false ? 'オフラインです。電波の良い場所でもう一度お試しください。' : 'サーバーに接続できませんでした。');
  }
  let data = null;
  try { data = await r.json(); } catch { data = null; }
  if (!r.ok) throw new ApiError(r.status, data?.error || `エラーが起きました（${r.status}）`);
  return data;
}

// 同時に複数のリクエストが期限切れに気付いても、更新は 1 回だけにする
let refreshing = null;
async function refresh() {
  if (!session?.refresh_token) throw new ApiError(401, 'ログインしてください');
  refreshing ||= raw('/api/auth', { method: 'POST', body: { action: 'refresh', refresh_token: session.refresh_token } })
    .then(s => { save(s); return s; })
    .catch(e => { if (e.status === 401 || e.status === 403) save(null); throw e; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

async function token() {
  if (!session) throw new ApiError(401, 'ログインしてください');
  if (session.expires_at * 1000 - Date.now() < 60_000) await refresh();
  return session.access_token;
}

/** 認証付きの API 呼び出し。401 のときは 1 回だけトークンを更新してやり直す */
export async function api(path, opts = {}) {
  try {
    return await raw(path, { ...opts, token: await token() });
  } catch (e) {
    if (e.status !== 401 || !session) throw e;
    await refresh();
    return raw(path, { ...opts, token: session.access_token });
  }
}

export const sendCode = email => raw('/api/auth', { method: 'POST', body: { action: 'send', email } });
export const verifyCode = async (email, code) => save(await raw('/api/auth', { method: 'POST', body: { action: 'verify', email, code } }));

/**
 * メールのリンクから戻ってきたとき、URL の # に入っているログイン情報を取り込む。
 * 取り込んだら URL から消す（履歴や共有でトークンが残らないように）。
 * 戻り値: 'ok' / エラー文言 / null（リンクから来たのではない）
 */
export function consumeLinkLogin() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.has('access_token') && !h.has('error_description') && !h.has('error')) return null;
  history.replaceState(null, '', location.pathname + location.search);
  if (!h.get('access_token') || !h.get('refresh_token')) {
    return h.get('error_code') === 'otp_expired' ? 'リンクの有効期限が切れています。もう一度コードを送ってください。' : 'リンクでログインできませんでした。もう一度コードを送ってください。';
  }
  const expiresIn = Number(h.get('expires_in')) || 3600;
  save({
    access_token: h.get('access_token'),
    refresh_token: h.get('refresh_token'),
    expires_at: Number(h.get('expires_at')) || Math.floor(Date.now() / 1000) + expiresIn,
    email: null,
  });
  return 'ok';
}

export async function logout() {
  const t = session?.access_token;
  save(null);
  if (t) await raw('/api/auth', { method: 'POST', body: { action: 'logout' }, token: t }).catch(() => {});
  // オフライン用に保存していた記録も消す
  try { const n = await caches.keys(); await Promise.all(n.filter(k => k.startsWith('mhl-data')).map(k => caches.delete(k))); } catch { /* noop */ }
}
