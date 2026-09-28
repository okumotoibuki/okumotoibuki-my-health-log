import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, vol, tot, hmText, key, parseKey, monthKey, chart } from '../public/js/util.js';

test('esc はシングルクォートも含めてエスケープする', () => {
  assert.equal(esc(`<img src=x onerror='a'>&"`), '&lt;img src=x onerror=&#39;a&#39;&gt;&amp;&quot;');
  assert.equal(esc(null), '');
});

test('vol / tot', () => {
  const r = {
    training: [{ part: '胸', sets: [{ w: 80, r: 8 }, { w: 80, r: 8 }] }, { part: '背中', sets: [{ w: 100, r: 5 }] }],
    meals: [{ p: 10, f: 5, c: 20, kcal: 165 }, { p: 30, f: 10, c: 50, kcal: 410 }],
  };
  assert.equal(vol(r), 1280 + 500);
  assert.equal(vol(r, '胸'), 1280);
  assert.equal(vol(null), 0);
  assert.deepEqual(tot(r), { p: 40, f: 15, c: 70, kcal: 575 });
});

test('hmText は 60 分に繰り上がらない', () => {
  assert.equal(hmText(7.5), '7時間30分');
  assert.equal(hmText(6.999), '7時間0分');
});

test('key / parseKey / monthKey は往復できる', () => {
  const d = parseKey('2026-01-05');
  assert.equal(key(d), '2026-01-05');
  assert.equal(monthKey(d), '2026-01');
});

test('chart は値が全部空でも SVG を返す', () => {
  const s = chart({ vals: [null, null], labels: ['月', '火'], sel: 1, color: 'red', label: 'x' });
  assert.ok(s.startsWith('<svg'));
});
