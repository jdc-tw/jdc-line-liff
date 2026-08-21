const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// 由來（2026-08-20 誤發事故 → 2026-08-21 加儀器）：
// 使用者說只按了一次，後端卻被呼叫三次，成因至今未定案。nonce 用來判是哪一層：
//   同一個 nonce 三筆 ⇒ 一次點擊被重複執行（網路層或 GAS 層重送）
//   三個不同 nonce    ⇒ 瀏覽器真的送了三次（前端還有沒抓到的路徑）
//
// ⚠️ 這整件事只有一個會靜默失效的地方：**nonce 若在 jsonp 內產生，
//    每次重送都會拿到新的一個，兩種情況看起來一模一樣。** 紀錄照長、只是分不出東西。
//    人眼看不出來，所以這裡用掃原始碼守住順序——刻意讀字串而不是 require，
//    因為這三支是 stats.html 的 inline script，沒有模組可以匯入。

const SRC = fs.readFileSync(path.join(__dirname, '..', 'stats.html'), 'utf8');
const ENTRIES = ['snSend', 'bcSendOne', 'bcSend'];

/** 抽出某支函式的原始碼：從 `function 名(){` 到下一個行首 `function `。 */
function bodyOf(name) {
  const start = SRC.indexOf('function ' + name + '(){');
  assert.ok(start >= 0, '找不到 ' + name + '——它被改名或刪了，這組測試要跟著改');
  const rest = SRC.slice(start + 1);
  const end = rest.indexOf('\nfunction ');
  return end < 0 ? rest : rest.slice(0, end);
}

ENTRIES.forEach((name) => {
  test(`${name} 有產生 nonce`, () => {
    assert.ok(bodyOf(name).indexOf('newNonce()') >= 0,
      name + ' 沒有產生 nonce ⇒ 那條路徑的呼叫在紀錄裡是「（無）」，判不出層');
  });

  test(`${name} 的 nonce 在 confirm 之前產生`, () => {
    const b = bodyOf(name);
    const n = b.indexOf('newNonce()');
    const c = b.indexOf('confirm(');
    if (c < 0) return;                       // 這支沒有確認框就不適用
    assert.ok(n < c,
      name + ' 的 nonce 產生在 confirm 之後。使用者取消再重按會被當成同一次操作，'
      + '或反過來把一次操作切成兩個 nonce——兩種都會讓判讀失真');
  });

  test(`${name} 的 nonce 在 jsonp 之外產生——這是整支儀器唯一會靜默失效的地方`, () => {
    const b = bodyOf(name);
    const n = b.indexOf('newNonce()');
    const j = b.indexOf('jsonp(');
    assert.ok(j >= 0, name + ' 裡找不到 jsonp 呼叫');
    assert.ok(n < j,
      name + ' 的 nonce 產生在 jsonp 之後或之內 ⇒ 每次重送都是新的 nonce ⇒ '
      + '「送三次」與「被執行三次」看起來一模一樣，整個實驗白做（而且是安靜地白做）');
  });

  test(`${name} 真的把 nonce 送出去了`, () => {
    assert.ok(/nonce\s*:\s*nonce/.test(bodyOf(name)),
      name + ' 產生了 nonce 卻沒放進 jsonp 參數——後端只會收到「（無）」');
  });
});

test('newNonce 每次都不一樣', () => {
  const m = SRC.match(/function newNonce\(\)\{([\s\S]*?)\n\}/);
  assert.ok(m, '找不到 newNonce 的定義');
  const fn = new Function('return function newNonce(){' + m[1] + '\n}')();
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(fn());
  assert.strictEqual(seen.size, 500, 'nonce 撞號了——撞號會把兩次不同的操作看成同一次');
});
