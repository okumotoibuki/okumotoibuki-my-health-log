// GET /api/health — 設定が揃っていて、実際に Supabase につながるかを返す（秘密の値は返さない）
import { route, send } from './_lib/http.js';
import { authFetch, supabaseUrl, anonKey } from './_lib/supabase.js';

const has = (...keys) => keys.some(k => !!process.env[k]?.trim());

/** anon / publishable キーは公開前提の値だが、念のため前後と長さだけ見せる（貼り間違いの切り分け用） */
const hint = k => `${k.slice(0, 20)}…${k.slice(-4)}（${k.length}文字）`;

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
