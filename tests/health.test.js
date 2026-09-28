import { test } from 'node:test';
import assert from 'node:assert/strict';
import health, { keyHint, urlHint } from '../api/health.js';
import { classifyKey, anonKey, UnsafeKeyError } from '../api/_lib/supabase.js';

const jwt = payload => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');

test('keyHint は値そのものを返さない（短い値は末尾も出さない）', () => {
  const short = 'mistaken-secret-1234';
  const h = keyHint(short);
  assert.deepEqual(h, { kind: 'unknown', length: short.length });
  assert.ok(!JSON.stringify(h).includes('1234'));
});

test('keyHint は種類と文字数、長いキーだけ末尾 4 文字を返す', () => {
  const pub = 'sb_publishable_' + 'x'.repeat(27) + 'ABCD';
  assert.deepEqual(keyHint(pub), { kind: 'publishable', length: 46, last4: 'ABCD' });
  assert.match(keyHint(jwt({ role: 'anon' })).kind, /^legacy_jwt（role: anon）/);
  assert.match(keyHint('sb_secret_' + 'z'.repeat(30)).kind, /^secret/);
});

test('classifyKey: 高権限キー（secret / service_role / 読めない JWT）は使わせない', () => {
  assert.equal(classifyKey('sb_publishable_abc').allowed, true);
  assert.equal(classifyKey(jwt({ role: 'anon' })).allowed, true);
  assert.equal(classifyKey('sb_secret_abc').allowed, false);
  assert.equal(classifyKey(jwt({ role: 'service_role' })).allowed, false);
  assert.equal(classifyKey('eyJ.not-base64-json.x').allowed, false);
});

test('anonKey は高権限キーが入っていたら投げる', () => {
  const prev = process.env.SUPABASE_ANON_KEY;
  try {
    process.env.SUPABASE_ANON_KEY = jwt({ role: 'service_role' });
    assert.throws(() => anonKey(), UnsafeKeyError);
    process.env.SUPABASE_ANON_KEY = 'sb_publishable_ok';
    assert.equal(anonKey(), 'sb_publishable_ok');
  } finally {
    if (prev === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = prev;
  }
});

test('/api/health は高権限キーを Supabase に送らず forbidden_key で 503 を返す', async () => {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response('{}', { status: 200 }); };
  try {
    Object.assign(process.env, { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'sb_secret_' + 'q'.repeat(30), OWNER_EMAIL: 'a@b.c', AI_GATEWAY_API_KEY: 'x' });
    let out;
    const res = { setHeader() {}, status(c) { this.c = c; return this; }, json(b) { out = [this.c, b]; } };
    await health({ method: 'GET', headers: {}, url: '/api/health' }, res);
    assert.equal(out[0], 503);
    assert.equal(out[1].supabase.status, 'forbidden_key');
    assert.equal(called, false, 'Supabase への通信は発生しない');
    assert.ok(!JSON.stringify(out[1]).includes('qqqqqqqq'));
  } finally {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('urlHint は Supabase の URL のときだけホスト名を返し、それ以外は値を出さない', () => {
  assert.equal(urlHint('https://abcdef.supabase.co'), 'abcdef.supabase.co');
  assert.equal(urlHint('https://abcdef.supabase.co/'), 'abcdef.supabase.co');
  assert.equal(urlHint('postgresql://postgres:pass@db.abcdef.supabase.co:5432/postgres'), null);
  assert.equal(urlHint('https://user:pass@abcdef.supabase.co'), null);
  assert.equal(urlHint('http://abcdef.supabase.co'), null);
  assert.equal(urlHint('not a url'), null);
});

test('/api/health は想定外の URL に接続せず、値も返さない', async () => {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response('{}', { status: 200 }); };
  try {
    Object.assign(process.env, { SUPABASE_URL: 'postgresql://postgres:TopSecretPw@db.x.supabase.co:5432/postgres', SUPABASE_ANON_KEY: 'sb_publishable_ok', OWNER_EMAIL: 'a@b.c', AI_GATEWAY_API_KEY: 'x' });
    let out;
    const res = { setHeader() {}, status(c) { this.c = c; return this; }, json(b) { out = [this.c, b]; } };
    await health({ method: 'GET', headers: {}, url: '/api/health' }, res);
    assert.equal(out[0], 503);
    assert.equal(out[1].supabase.status, 'invalid_url');
    assert.equal(called, false);
    assert.ok(!JSON.stringify(out[1]).includes('TopSecretPw'));
  } finally {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
