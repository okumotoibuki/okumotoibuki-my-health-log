import { test } from 'node:test';
import assert from 'node:assert/strict';
import auth from '../api/auth.js';

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_ok', OWNER_EMAIL: 'owner@example.com' };

// fetch と環境変数を差し替えて /api/auth を呼ぶ
async function call(body, reply) {
  const prevEnv = { ...process.env }, prevFetch = globalThis.fetch, calls = [];
  Object.assign(process.env, ENV);
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(reply.data), { status: reply.status });
  };
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.code = s; return this; }, json(b) { this.body = b; } };
  try {
    await auth({ method: 'POST', body, headers: {} }, res);
  } finally {
    globalThis.fetch = prevFetch;
    for (const k of Object.keys(ENV)) if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  return { res, calls };
}

test('login: オーナーはパスワードで Supabase に問い合わせてセッションを返す', async () => {
  const { res, calls } = await call(
    { action: 'login', email: ' Owner@Example.com ', password: 'pw' },
    { status: 200, data: { access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { email: 'owner@example.com' } } });
  assert.equal(res.code, 200);
  assert.equal(res.body.access_token, 'a');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://x.supabase.co/auth/v1/token?grant_type=password');
  assert.deepEqual(calls[0].body, { email: 'owner@example.com', password: 'pw' });
});

test('login: オーナー以外は Supabase に問い合わせず、間違いと同じ応答で断る', async () => {
  const other = await call({ action: 'login', email: 'someone@example.com', password: 'pw' }, { status: 200, data: {} });
  assert.equal(other.res.code, 401);
  assert.equal(other.calls.length, 0);
  const wrong = await call({ action: 'login', email: 'owner@example.com', password: 'bad' }, { status: 400, data: { error: 'invalid_grant' } });
  assert.equal(wrong.res.code, 401);
  assert.equal(wrong.res.body.error, other.res.body.error);
});

test('login: パスワードが空なら 400', async () => {
  const { res, calls } = await call({ action: 'login', email: 'owner@example.com', password: '' }, { status: 200, data: {} });
  assert.equal(res.code, 400);
  assert.equal(calls.length, 0);
});
