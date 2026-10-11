import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayIn, hourIn, nowIn, normTime, resolveTime, periodFor, isValidDate, addDaysStr, num, normalizeRecords, normalizeMeal, normalizeWorkout,
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
  assert.deepEqual({ date: out[0].date, w: out[0].weights.map(x => x.kg), s: out[0].sleep_hours }, { date: TODAY, w: [72.4], s: 7.5 });
});

test('normalizeRecords: 範囲外の値・部位外の種目・空の食事は保存しない', () => {
  const out = normalizeRecords([{
    date: TODAY, weight_kg: 900, sleep_hours: -1, golf_score: 5,
    meals: [{ name: '空', kcal: 0 }, { name: 'サラダ', p: 10, f: 5, c: 20 }],
    training: [{ part: '首', name: 'x', sets: [{ w: 10, r: 10 }] }, { part: '胸', name: 'ベンチ', sets: [{ w: 80, r: 8 }, { w: 'a', r: 8 }] }],
  }], { today: TODAY, hour: 13 });
  assert.equal(out.length, 1);
  const r = out[0];
  assert.deepEqual(r.weights, []);
  assert.equal(r.sleep_hours, undefined);
  assert.equal(r.golf_score, undefined);
  assert.equal(r.meals.length, 1);
  assert.equal(r.meals[0].kcal, 10 * 4 + 5 * 9 + 20 * 4); // kcal が無ければ PFC から
  assert.equal(r.meals[0].slot, '昼食');
  assert.equal(r.training.length, 1);
  assert.deepEqual(r.training[0].sets, [{ w: 80, r: 8 }]);
});

test('normalizeRecords: 写真が無いのに身体写真・食事写真は紐付けない（旧形式の body_photo / from_photo も）', () => {
  const rec = [{ date: TODAY, body_photo: true, meals: [{ name: 'カレー', kcal: 800, from_photo: true }] }];
  const noImg = normalizeRecords(rec, { today: TODAY });
  assert.deepEqual(noImg[0].bodyPhotos, []);
  assert.equal(noImg[0].meals[0].photo, null);
  const withImg = normalizeRecords(rec, { today: TODAY, imageCount: 1 });
  assert.deepEqual(withImg[0].bodyPhotos.map(b => b.photo), [1]);
  assert.equal(withImg[0].meals[0].photo, 1);
});

test('normalizeRecords: 写真は複数枚。番号で食事・身体写真に振り分け、範囲外の番号は捨てる', () => {
  const [r] = normalizeRecords([{
    body_photos: [{ photo: 3 }, { photo: 4 }, { photo: 3 }, { photo: 9 }],
    meals: [
      { slot: '昼食', amount: '完食', name: 'ご飯', kcal: 250, photo: 1 },
      { slot: '昼食', amount: '完食', name: '唐揚げ', kcal: 400, photo: 1 },
      { slot: '間食', amount: '完食', name: 'プリン', kcal: 200, photo: 2 },
      { slot: '間食', amount: '完食', name: '謎', kcal: 100, photo: 7 },
    ],
  }], { today: TODAY, hour: 12, now: '12:30', imageCount: 4 });
  assert.deepEqual(r.bodyPhotos.map(b => b.photo), [3, 4]);
  assert.deepEqual(r.meals.map(m => m.photo), [1, 1, 2, null]);
});

test('normalizeMeal: サプリ・食べた量・食べていない', () => {
  assert.equal(normalizeMeal({ slot: '夕食', amount: '半分', name: 'カレー', kcal: 400 }).amount, '半分');
  assert.equal(normalizeMeal({ slot: '夕食', amount: '大盛り', name: 'カレー', kcal: 400 }).amount, null);
  const skip = normalizeMeal({ slot: '朝食', amount: '食べていない', kcal: 500 });
  assert.deepEqual({ name: skip.name, kcal: skip.kcal, p: skip.p }, { name: '朝食なし', kcal: 0, p: 0 });
  const sup = normalizeMeal({ slot: 'サプリ', amount: '完食', name: 'プロテイン', kcal: 120, p: 24 });
  assert.deepEqual({ slot: sup.slot, amount: sup.amount, kcal: sup.kcal }, { slot: 'サプリ', amount: null, kcal: 120 });
  assert.equal(normalizeMeal({ slot: 'サプリ', name: 'ビタミンC' }).kcal, 0); // 0kcal でも名前があれば残す
  assert.equal(normalizeMeal({ slot: 'サプリ' }), null);
  assert.equal(normalizeMeal({ slot: '昼食', name: '空' }), null);
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
  assert.deepEqual(parseMessage('  体重 72  '), { text: '体重 72', images: [] });
  assert.equal(parseMessage('   '), null);
  const img = 'data:image/jpeg;base64,AAAA';
  assert.deepEqual(parseMessage([{ type: 'text', text: '夕食' }, { type: 'image_url', image_url: { url: img } }]), { text: '夕食', images: [img] });
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

test('nowIn / normTime: 時刻は JST の HH:MM。読めないものは null', () => {
  assert.equal(nowIn('Asia/Tokyo', new Date('2026-09-27T22:05:00Z')), '07:05');
  assert.equal(normTime('7:05'), '07:05');
  assert.equal(normTime('22:30:00'), '22:30');
  for (const v of ['24:00', '7:5', '朝', '', null, 7]) assert.equal(normTime(v), null, String(v));
});

test('resolveTime: 指定なしは今日なら今・過去日は不明。今日の未来時刻は今に丸める', () => {
  const o = { today: TODAY, now: '08:00' };
  assert.equal(resolveTime(undefined, { ...o, date: TODAY }), '08:00');
  assert.equal(resolveTime(undefined, { ...o, date: '2026-09-27' }), null);
  assert.equal(resolveTime('21:00', { ...o, date: TODAY }), '08:00');
  assert.equal(resolveTime('21:00', { ...o, date: '2026-09-27' }), '21:00');
  assert.equal(resolveTime(undefined, { ...o, date: TODAY, fallback: null }), null);
});

test('normalizeRecords: 体重は朝と夜を別々に時刻つきで残す（同じ測定の重複は 1 件）', () => {
  const out = normalizeRecords([
    { date: '2026-09-27', weights: [{ kg: 70.2, time: '7:00' }, { kg: 71.0, time: '22:30' }, { kg: 70.2, time: '07:00' }] },
    { date: TODAY, weight_kg: 70.4 },
  ], { today: TODAY, hour: 9, now: '09:15' });
  const by = Object.fromEntries(out.map(r => [r.date, r.weights]));
  assert.deepEqual(by['2026-09-27'], [{ kg: 70.2, time: '07:00', period: '朝' }, { kg: 71, time: '22:30', period: '夜' }]);
  assert.deepEqual(by[TODAY], [{ kg: 70.4, time: '09:15', period: '朝' }]); // 時刻の言及が無ければ今
});

test('normalizeRecords: 時刻は 項目 → Record の time → 既定 の順。過去日で言及が無ければ不明', () => {
  const out = normalizeRecords([{
    date: '2026-09-27', time: '06:30',
    weights: [{ kg: 70 }],
    training: [{ part: '胸', name: 'ベンチ', sets: [{ w: 80, r: 8 }], time: '19:00' }],
  }, {
    date: '2026-09-26', weights: [{ kg: 70.5 }], meals: [{ slot: '夕食', name: 'カレー', kcal: 800 }],
  }], { today: TODAY, hour: 12, now: '12:00' });
  const r27 = out.find(r => r.date === '2026-09-27'), r26 = out.find(r => r.date === '2026-09-26');
  assert.equal(r27.weights[0].time, '06:30');
  assert.equal(r27.training[0].time, '19:00');
  assert.equal(r26.weights[0].time, null);
  assert.equal(r26.meals[0].time, null);
});

test('normalizeRecords: 今日の食事は、今の時間帯の食事のときだけ時刻を今にする', () => {
  const [r] = normalizeRecords([{ meals: [
    { slot: '夕食', name: '焼き魚', kcal: 500 },
    { slot: '昼食', name: 'ラーメン', kcal: 700 },
    { slot: '朝食', name: 'パン', kcal: 300, time: '07:30' },
  ] }], { today: TODAY, hour: 20, now: '20:10' });
  assert.deepEqual(r.meals.map(m => m.time), ['20:10', null, '07:30']);
});

test('summarizeSaved: 時刻がある記録は時刻を先頭に付ける', () => {
  const recs = normalizeRecords([{ date: '2026-09-27', weights: [{ kg: 70.2, time: '07:00' }, { kg: 71, time: '22:30' }] }], { today: TODAY });
  assert.deepEqual(summarizeSaved(recs), [['weight', '07:00 朝の体重 70.2kg'], ['weight', '22:30 夜の体重 71.0kg']]);
  const meals = normalizeRecords([{ date: '2026-09-27', meals: [
    { slot: '朝食', amount: '食べていない' },
    { slot: '昼食', amount: '半分', name: 'カレー', kcal: 400, p: 10, f: 12, c: 60, time: '12:00' },
  ] }], { today: TODAY });
  assert.deepEqual(summarizeSaved(meals).map(l => l[1]), ['朝食 食べていない', '12:00 昼食 カレー（半分） 400kcal（P10 F12 C60）']);
});

test('periodFor: 指定があればそれ、無ければ時刻から（15時より前は朝）、時刻も無ければ不明', () => {
  assert.equal(periodFor('夜', '07:00'), '夜');
  assert.equal(periodFor(undefined, '14:59'), '朝');
  assert.equal(periodFor('昼', '15:00'), '夜');
  assert.equal(periodFor(undefined, null), null);
});

test('normalizeRecords: 体重の朝・夜は指定を優先し、無ければ時刻から決める', () => {
  const [r] = normalizeRecords([{ date: '2026-09-27', weights: [{ kg: 70, period: '夜', time: '13:00' }, { kg: 70.5, time: '06:00' }, { kg: 71 }] }], { today: TODAY });
  assert.deepEqual(r.weights.map(w => w.period), ['夜', '朝', null]);
});

test('parseMessage: 写真は 4 枚まで。5 枚以上は受け付けない', () => {
  const img = 'data:image/jpeg;base64,AAAA';
  const four = [{ type: 'text', text: 'x' }, ...Array(4).fill({ type: 'image_url', image_url: { url: img } })];
  assert.equal(parseMessage(four).images.length, 4);
  assert.equal(parseMessage([...four, { type: 'image_url', image_url: { url: img } }]), null);
});
