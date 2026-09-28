// GET /api/health — 設定が揃っているかだけを返す（値は返さない）
import { route, send } from './_lib/http.js';

const has = (...keys) => keys.some(k => !!process.env[k]?.trim());

export default route(['GET'], async (req, res) => {
  const checks = {
    supabase: has('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL') &&
      has('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    owner: has('OWNER_EMAIL'),
    ai: has('AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN') || !!req.headers['x-vercel-oidc-token'],
  };
  const ok = Object.values(checks).every(Boolean);
  send(res, ok ? 200 : 503, { ok, checks });
});
