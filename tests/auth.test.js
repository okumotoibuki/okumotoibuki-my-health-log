import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appUrl } from '../api/auth.js';

test('appUrl は APP_URL を優先し、無ければ Vercel の本番 URL を使う', () => {
  assert.equal(appUrl({ APP_URL: 'https://log.example.com/path', VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' }), 'https://log.example.com');
  assert.equal(appUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' }), 'https://x.vercel.app');
});

test('appUrl は http（localhost 以外）や読めない値を使わない', () => {
  assert.equal(appUrl({ APP_URL: 'http://evil.example.com' }), null);
  assert.equal(appUrl({ APP_URL: 'not a url' }), null);
  assert.equal(appUrl({}), null);
  assert.equal(appUrl({ APP_URL: 'http://localhost:4173' }), 'http://localhost:4173');
});
