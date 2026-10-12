import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyRows } from '../api/chat.js';

test('historyRows: 2 行とも同じキーを持ち、NOT NULL の列（image_paths / awaiting）に null を入れない', () => {
  // 複数行 insert は全行のキーの和集合で列を送り、無いキーは null になる。片方にだけキーがあると insert ごと失敗する
  const rows = historyRows({ userId: 'u', text: '昼食', imagePaths: ['p1'], reply: 'ok', saved: [['food', 'x']], awaiting: true, at: 0 });
  assert.equal(rows.length, 2);
  assert.deepEqual(Object.keys(rows[0]).sort(), Object.keys(rows[1]).sort());
  for (const r of rows) {
    assert.ok(Array.isArray(r.image_paths));
    assert.equal(typeof r.awaiting, 'boolean');
  }
  assert.deepEqual(rows.map(r => r.role), ['user', 'assistant']);
  assert.equal(rows[1].awaiting, true);
  assert.equal(rows[0].awaiting, false);
  assert.ok(rows[0].created_at < rows[1].created_at);
});
