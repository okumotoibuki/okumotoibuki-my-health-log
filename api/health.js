// GET /api/health — 設定が揃っていて、実際に Supabase につながるかを返す（秘密の値は返さない）
import { route, send, requireEnv } from './_lib/http.js';
import { authFetch, supabaseUrl, anonKey, classifyKey, UnsafeKeyError } from './_lib/supabase.js';

const has = (...keys) => keys.some(k => !!process.env[k]?.trim());

/**
 * 貼り間違いの切り分け用に、キーの「種類」と「文字数」だけを返す。
 * 値そのものは返さない — 別用途の秘密を誤って貼った場合も、認証なしのこの API から漏らさないため。
 * 末尾 4 文字は、十分長い（32 文字以上 = 4 文字では推測に使えない）ときだけ添える。
 */
export function keyHint(k) {
  const c = classifyKey(k);
  const kind = c.kind === 'secret' ? 'secret（サーバー用の秘密鍵。ここに入れてはいけない）'
    : c.kind === 'legacy_jwt' ? `legacy_jwt（role: ${c.role ?? '不明'}）`
    : c.kind;
  return { kind, length: k.length, ...(k.length >= 32 ? { last4: k.slice(-4) } : {}) };
}

/**
 * URL も値そのものは返さない（接続文字列などを誤って貼った場合にパスワードごと漏れるため）。
 * https://<ref>.supabase.co の形のときだけホスト名を返す。
 */
export function urlHint(v) {
  let u;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(u.hostname) || u.username || u.password) return null;
  return u.hostname;
}

/** Supabase Auth がこのキーを受け付けるか。設定の取得は副作用が無いので確認に使える */
async function checkSupabaseKey() {
  let raw, key;
  try { raw = supabaseUrl(); } catch { return { status: 'missing' }; }
  const url = urlHint(raw);
  // 想定外の形の URL には接続しない（値も返さない）
  if (!url) return { status: 'invalid_url' };
  try { key = anonKey(); } catch (e) {
    if (!(e instanceof UnsafeKeyError)) return { status: 'missing', url };
    // 高権限キーは Supabase に送らずに止める（受け付けられて ok になってしまうため）
    const raw = requireEnv('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    return { status: 'forbidden_key', url, key: keyHint(raw) };
  }
  try {
    const r = await authFetch('/settings', { method: 'GET' });
    if (r.ok) return { status: 'ok', url, key: keyHint(key) };
    if (r.status === 401 || r.status === 403) return { status: 'invalid_key', url, key: keyHint(key) };
    return { status: `http_${r.status}`, url, key: keyHint(key) };
  } catch {
    return { status: 'unreachable', url, key: keyHint(key) };
  }
}

export default route(['GET'], async (req, res) => {
  const supabase = await checkSupabaseKey();
  const checks = {
    supabase: supabase.status === 'ok',
    owner: has('OWNER_EMAIL'),
    ai: has('AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN') || !!req.headers['x-vercel-oidc-token'],
  };
  const ok = Object.values(checks).every(Boolean);
  send(res, ok ? 200 : 503, { ok, checks, supabase });
});
