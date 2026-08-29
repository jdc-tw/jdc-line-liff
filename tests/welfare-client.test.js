const { test } = require('node:test');
const assert = require('node:assert');
const { fnv8, isHexSelection, encodeSelection,
        newNonce } = require('../assets/welfare-client.js');
// gasCall 的測試搬到 tests/gas-call.test.js（它是全站傳輸層，不屬福委會）
const VECTORS = require('./fixtures/selection-vectors.json');

const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ empNo: 'E' + i, status: 'ok' }));
const pickedOf = (v, rows) =>
  v.picked === 'ALL' ? rows.map((r) => r.empNo) : v.picked.map((i) => rows[i].empNo);

VECTORS.forEach((v) => {
  test('🔴 前端 encodeSelection 與後端同向量：' + v.why, () => {
    const rows = rowsOf(v.n);
    assert.equal(encodeSelection(rows, pickedOf(v, rows)), v.hex);
  });
});

test('🔴 前端 fnv8 與後端算出同一個值（audienceRev 兩邊要對得起來）', () => {
  // 🔴 **這三個值是 2026-08-25 用計畫指定的 fnv8 演算法實跑出來的**，
  //    寫死在這裡而不是留給實作者「跑一次貼回來」。
  //    理由與 MID_AUTUMN_DIGEST 同一條（第四輪審查 #6）：
  //    **expected 值若由實作者從自己剛寫的程式碼算出來，就防不了第一次就寫錯。**
  //    這裡的獨立權威是「計畫指定的演算法」，不是任何一邊的實作。
  assert.equal(fnv8('abc'), '1a47e90b');
  assert.equal(fnv8(''), '811c9dc5');
  assert.equal(fnv8('E0|U0|ok'), '3e0d55f1');
});

test('對照組：上面那三個值真的在分辨輸入（不是任何輸入都得到同一個）', () => {
  assert.equal(fnv8('abd'), '1f47f0ea');          // 與 abc 只差一個字元
  assert.equal(fnv8('E0|U0|unbound'), 'c94c0728');
  assert.notEqual(fnv8('abc'), fnv8('abd'));
});

test('isHexSelection 與後端同規則', () => {
  ['', '00', 'ff01'].forEach((s) => assert.equal(isHexSelection(s), true, s));
  ['0', 'FF', 'zz', null].forEach((s) => assert.equal(isHexSelection(s), false, String(s)));
});

test('newNonce：每次不同、非空、可放進 URL', () => {
  const a = newNonce(), b = newNonce();
  assert.notEqual(a, b);
  assert.ok(a.length > 8);
  assert.equal(encodeURIComponent(a), a, 'nonce 不該需要跳脫');
});
