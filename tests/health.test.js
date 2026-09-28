import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyHint } from '../api/health.js';

test('keyHint は値そのものを返さない（短い値は末尾も出さない）', () => {
  const short = 'mistaken-secret-1234';
  const h = keyHint(short);
  assert.deepEqual(h, { kind: 'unknown', length: short.length });
  assert.ok(!JSON.stringify(h).includes('1234'));
});

test('keyHint は種類と文字数、長いキーだけ末尾 4 文字を返す', () => {
  const pub = 'sb_publishable_' + 'x'.repeat(27) + 'ABCD';
  assert.deepEqual(keyHint(pub), { kind: 'publishable', length: 46, last4: 'ABCD' });
  assert.equal(keyHint('eyJ' + 'a'.repeat(100)).kind, 'legacy_jwt');
  assert.match(keyHint('sb_secret_' + 'z'.repeat(30)).kind, /^secret/);
});
