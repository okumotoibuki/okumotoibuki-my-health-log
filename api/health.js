// GET /api/health — 設定が揃っていて、実際に Supabase につながるかを返す（秘密の値は返さない）
import { route, send } from './_lib/http.js';
import { authFetch, supabaseUrl, anonKey } from './_lib/supabase.js';

const has = (...keys) => keys.some(k => !!process.env[k]?.trim());

/**
 * 貼り間違いの切り分け用に、キーの「種類」と「文字数」だけを返す。
 * 値そのものは返さない — 別用途の秘密を誤って貼った場合も、認証なしのこの API から漏らさないため。
 * 末尾 4 文字は、十分長い（32 文字以上 = 4 文字では推測に使えない）ときだけ添える。
 */
export function keyHint(k) {
  const kind = k.startsWith('sb_publishable_') ? 'publishable'
    : k.startsWith('sb_secret_') ? 'secret（サーバー用の秘密鍵。ここに入れてはいけない）'
    : k.startsWith('eyJ') ? 'legacy_jwt'
    : 'unknown';
  return { kind, length: k.length, ...(k.length >= 32 ? { last4: k.slice(-4) } : {}) };
}
const hint = keyHint;

/** Supabase Auth がこのキーを受け付けるか。設定の取得は副作用が無いので確認に使える */
async function checkSupabaseKey() {
  let url, key;
  try { url = supabaseUrl(); key = anonKey(); } catch { return { status: 'missing' }; }
  try {
    const r = await authFetch('/settings', { method: 'GET' });
    if (r.ok) return { status: 'ok', url, key: hint(key) };
    if (r.status === 401 || r.status === 403) return { status: 'invalid_key', url, key: hint(key) };
    return { status: `http_${r.status}`, url, key: hint(key) };
  } catch {
    return { status: 'unreachable', url, key: hint(key) };
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
