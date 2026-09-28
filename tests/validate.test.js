import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayIn, hourIn, isValidDate, addDaysStr, num, normalizeRecords, normalizeMeal, normalizeWorkout,
  parseMessage, decodeDataUrl, summarizeSaved, slotForHour,
} from '../api/_lib/validate.js';
import { parseAiJson } from '../api/_lib/ai.js';

const TODAY = '2026-09-28';

test('todayIn はタイムゾーンで日付を決める（UTC 15:30 は JST の翌日）', () => {
  const t = new Date('2026-09-27T15:30:00Z');
  assert.equal(todayIn('Asia/Tokyo', t), '2026-09-28');
  assert.equal(todayIn('UTC', t), '2026-09-27');
  assert.equal(hourIn('Asia/Tokyo', t), 0);
});

test('isValidDate は実在しない日付を弾く', () => {
  assert.ok(isValidDate('2024-02-29'));
  assert.ok(!isValidDate('2026-02-29'));
  assert.ok(!isValidDate('2026-9-1'));
  assert.ok(!isValidDate(null));
  assert.equal(addDaysStr('2026-03-01', -1), '2026-02-28');
});

test('num は範囲外・非数を null にし、丸める', () => {
  assert.equal(num('72.44', 20, 300, 1), 72.4);
  assert.equal(num(19, 20, 300), null);
  assert.equal(num('abc', 0, 10), null);
  assert.equal(num('', 0, 10), null);
  assert.equal(num(Infinity, 0, 10), null);
});

test('slotForHour', () => {
  assert.equal(slotForHour(7), '朝食');
  assert.equal(slotForHour(12), '昼食');
  assert.equal(slotForHour(19), '夕食');
  assert.equal(slotForHour(23), '間食');
});

test('normalizeRecords: 未来日を捨て、日付なしは今日、同じ日はまとめる', () => {
  const out = normalizeRecords([
    { date: '2026-09-29', weight_kg: 70 },
    { weight_kg: 72.4 },
    { date: TODAY, sleep_hours: 7.5 },
    { date: '2026-02-30', golf_score: 90 },
  ], { today: TODAY });
  assert.equal(out.length, 1);
  assert.deepEqual({ date: out[0].date, w: out[0].weight_kg, s: out[0].sleep_hours }, { date: TODAY, w: 72.4, s: 7.5 });
});

test('normalizeRecords: 範囲外の値・部位外の種目・空の食事は保存しない', () => {
  const out = normalizeRecords([{
    date: TODAY, weight_kg: 900, sleep_hours: -1, golf_score: 5,
    meals: [{ name: '空', kcal: 0 }, { name: 'サラダ', p: 10, f: 5, c: 20 }],
    training: [{ part: '首', name: 'x', sets: [{ w: 10, r: 10 }] }, { part: '胸', name: 'ベンチ', sets: [{ w: 80, r: 8 }, { w: 'a', r: 8 }] }],
  }], { today: TODAY, hour: 13 });
  assert.equal(out.length, 1);
  const r = out[0];
  assert.equal(r.weight_kg, undefined);
  assert.equal(r.sleep_hours, undefined);
  assert.equal(r.golf_score, undefined);
  assert.equal(r.meals.length, 1);
  assert.equal(r.meals[0].kcal, 10 * 4 + 5 * 9 + 20 * 4); // kcal が無ければ PFC から
  assert.equal(r.meals[0].slot, '昼食');
  assert.equal(r.training.length, 1);
  assert.deepEqual(r.training[0].sets, [{ w: 80, r: 8 }]);
});

test('normalizeRecords: 写真が無いのに body_photo / from_photo は立てない', () => {
  const rec = [{ date: TODAY, body_photo: true, meals: [{ name: 'カレー', kcal: 800, from_photo: true }] }];
  const noImg = normalizeRecords(rec, { today: TODAY });
  assert.equal(noImg[0].body_photo, undefined);
  assert.equal(noImg[0].meals[0].from_photo, false);
  const withImg = normalizeRecords(rec, { today: TODAY, hasImage: true });
  assert.equal(withImg[0].body_photo, true);
  assert.equal(withImg[0].meals[0].from_photo, true);
});

test('normalizeRecords: 値が 1 つも無い Record と配列以外は捨てる', () => {
  assert.deepEqual(normalizeRecords([{ date: TODAY }], { today: TODAY }), []);
  assert.deepEqual(normalizeRecords('x', { today: TODAY }), []);
  assert.deepEqual(normalizeRecords(null, { today: TODAY }), []);
});

test('normalizeMeal / normalizeWorkout: 名前の制御文字と長さ', () => {
  const m = normalizeMeal({ name: 'a\n<b>' + 'x'.repeat(200), kcal: 100, slot: '夕食' });
  assert.ok(!m.name.includes('\n'));
  assert.equal(m.name.length, 80);
  assert.equal(normalizeWorkout({ part: '背中', sets: [] }), null);
  assert.equal(normalizeWorkout({ part: '背中', name: '', sets: [{ w: 0, r: 10 }] }).name, '背中');
});

test('parseMessage: 文字列・画像付き・不正な画像', () => {
  assert.deepEqual(parseMessage('  体重 72  '), { text: '体重 72', image: null });
  assert.equal(parseMessage('   '), null);
  const img = 'data:image/jpeg;base64,AAAA';
  assert.deepEqual(parseMessage([{ type: 'text', text: '夕食' }, { type: 'image_url', image_url: { url: img } }]), { text: '夕食', image: img });
  assert.equal(parseMessage([{ type: 'image_url', image_url: { url: 'https://evil.example/x.jpg' } }]), null);
  assert.equal(parseMessage({}), null);
});

test('decodeDataUrl', () => {
  const d = decodeDataUrl('data:image/png;base64,' + Buffer.from('hello').toString('base64'));
  assert.equal(d.ext, 'png');
  assert.equal(d.buffer.toString(), 'hello');
  assert.equal(decodeDataUrl('data:text/html;base64,AAAA'), null);
});

test('summarizeSaved', () => {
  const lines = summarizeSaved(normalizeRecords([{ date: TODAY, sleep_hours: 7.25, golf_score: 92 }], { today: TODAY }));
  assert.deepEqual(lines, [['sleep', '睡眠 7時間15分'], ['golf', 'ゴルフ 92']]);
});

test('parseAiJson: コードブロック・前置き付き・壊れた JSON', () => {
  assert.equal(parseAiJson('```json\n{"reply":"ok","records":[]}\n```').reply, 'ok');
  assert.equal(parseAiJson('はい。{"reply":"ok2"} 以上').reply, 'ok2');
  assert.deepEqual(parseAiJson('ただの文章'), { reply: 'ただの文章', records: [] });
});
