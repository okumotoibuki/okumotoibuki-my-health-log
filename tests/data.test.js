import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveRecords } from '../api/_lib/data.js';

/** workouts テーブルだけを持つ最小の偽 db */
function fakeDb(rows = []) {
  const ok = data => ({ data, error: null });
  let n = rows.length;
  return {
    rows,
    from: () => ({
      select: () => ({ eq: (_c, date) => Promise.resolve(ok(rows.filter(r => r.date === date))) }),
      update: patch => ({ eq: (_c, id) => { Object.assign(rows.find(r => r.id === id), patch); return Promise.resolve(ok(null)); } }),
      insert: row => ({ select: () => { const r = { id: `w${++n}`, ...row }; rows.push(r); return Promise.resolve(ok([r])); } }),
    }),
  };
}

const rec = training => ({ date: '2026-10-12', weights: [], meals: [], bodyPhotos: [], training });

test('saveRecords: 同じ日の同じ種目はセットを追加し、行を増やさない', async () => {
  const db = fakeDb();
  await saveRecords(db, 'u', [rec([{ time: '20:26', part: '胸', name: 'ダンベルベンチプレス', sets: [{ w: 20, r: 15 }] }])]);
  await saveRecords(db, 'u', [rec([{ time: '20:31', part: '胸', name: 'ダンベル ベンチプレス', sets: [{ w: 20, r: 12 }] }])]);
  await saveRecords(db, 'u', [rec([{ time: '20:41', part: '胸', name: 'インクラインダンベルプレス', sets: [{ w: 15, r: 12 }] }])]);
  assert.equal(db.rows.length, 2);
  assert.deepEqual(db.rows[0].sets, [{ w: 20, r: 15 }, { w: 20, r: 12 }]);
  assert.equal(db.rows[0].time, '20:26');
});

test('saveRecords: 1 回の送信に同じ種目が 2 つあっても 1 行にまとまる', async () => {
  const db = fakeDb();
  await saveRecords(db, 'u', [rec([
    { time: null, part: '背中', name: 'ラットプルダウン', sets: [{ w: 50, r: 10 }] },
    { time: null, part: '背中', name: 'ラットプルダウン', sets: [{ w: 50, r: 8 }] },
  ])]);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].sets.length, 2);
});
